import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  EvaluationValidity,
  EvaluationVerdict,
  VerificationSourceKind,
  VerificationStatus,
  createCoreHarness
} from '../../../packages/core-harness/src/index.js';
import { createFileSessionStore } from './session-store.mjs';
import { sha256 } from './contract.mjs';
import { writeAtomicJson } from './resource-state.mjs';

const clone = value => structuredClone(value);
const fail = message => { throw new Error(`BASELINE_CORE_ARM_INVALID: ${message}`); };

function verificationStatus(value) {
  if (value?.status === 'ACCEPTED' || value?.status === VerificationStatus.PASS) return VerificationStatus.PASS;
  if (value?.status === 'REJECTED' || value?.status === VerificationStatus.FAIL) return VerificationStatus.FAIL;
  return VerificationStatus.INCONCLUSIVE;
}

function evaluationFor(verification, verificationRef) {
  const status = verificationStatus(verification);
  if (status === VerificationStatus.INCONCLUSIVE) return {
    validity: EvaluationValidity.INCONCLUSIVE,
    verdict: null,
    findings: ['independent verifier could not complete'],
    evidence: verificationRef ? [verificationRef] : []
  };
  return {
    validity: EvaluationValidity.VALID,
    verdict: status === VerificationStatus.PASS ? EvaluationVerdict.PASS : EvaluationVerdict.GAP,
    findings: status === VerificationStatus.PASS ? [] : ['independent verifier rejected the candidate'],
    evidence: verificationRef ? [verificationRef] : []
  };
}

function eventCounts(trajectory) {
  return Object.fromEntries([...new Set(trajectory.map(event => event.type))].sort().map(type => [type, trajectory.filter(event => event.type === type).length]));
}

export function createCoreArm({ directory, executionId, work, seedCandidate, executeAttempt, verifyCandidate, clock = () => new Date().toISOString() } = {}) {
  if (!directory || !executionId || !work || !seedCandidate || typeof executeAttempt !== 'function' || typeof verifyCandidate !== 'function')
    fail('directory, executionId, work, seedCandidate, executeAttempt and verifyCandidate are required');
  const root = resolve(directory);
  const store = createFileSessionStore(root);
  const coreClock = () => {
    const value = clock();
    return value instanceof Date ? value.toISOString() : String(value);
  };
  let lastVerification = null;
  let lastVerificationRef = null;

  const environment = {
    async observe({ candidate, request }) {
      return { kind: 'FIXTURE_EXECUTION_OBSERVATION', candidate: clone(candidate), request: clone(request), at: coreClock() };
    },
    async act({ candidate, action }) {
      const existing = action?.result?.candidateDigest === candidate.version ? action.result : null;
      const result = existing ?? await executeAttempt({ executionId, candidate: clone(candidate), action: clone(action) });
      if (!result || typeof result !== 'object' || typeof result.candidateDigest !== 'string') fail('common executor must return candidateDigest');
      const mutated = result.candidateDigest !== candidate.version;
      return {
        mutated,
        candidate: mutated ? { id: executionId, version: result.candidateDigest } : clone(candidate),
        result: {
          candidateDigest: result.candidateDigest,
          candidateRef: result.candidateRef ?? null,
          attemptId: result.attemptId ?? null,
          provider: clone(result.provider ?? null),
          timing: clone(result.timing ?? null),
          driverResult: clone(result.driverResult ?? null),
          executionIdentity: executionId
        }
      };
    }
  };
  const evaluator = {
    async evaluate({ verifications }) {
      const verification = verifications.at(-1) ?? lastVerification;
      return evaluationFor(verification, lastVerificationRef);
    }
  };
  const fixedDisabled = {
    async decide() { return { enabled: false, dose: null, reason: 'fixed benchmark profile' }; }
  };
  const harness = createCoreHarness({
    environment,
    evaluator,
    sessionStore: store,
    supervisor: { async inspect() { return null; } },
    contextProjector: { async project() { return null; } },
    dosagePolicy: fixedDisabled,
    clock: coreClock,
    idFactory: () => `${executionId}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  });

  async function existingState() { return store.load(executionId); }

  async function run({ attemptId, taskId, fault, verificationRef = null, action = null } = {}) {
    await mkdir(root, { recursive: true });
    let persisted = await existingState();
    if (!persisted) {
      await harness.start({ sessionId: executionId, work: { ...clone(work), taskId, arm: 'EXHARNESS', executionId }, seedCandidate });
      persisted = await harness.workState(executionId);
    }
    const hasObservation = persisted.trajectory.some(event => event.type === 'OBSERVED');
    if (!hasObservation) await harness.observe(executionId, { taskId, fault, attemptId, executionId });
    persisted = await harness.workState(executionId);

    const currentEvaluation = persisted.persistentMemory.evaluations.find(item => item.candidate.id === persisted.currentCandidate.id && item.candidate.version === persisted.currentCandidate.version);
    const latestActed = persisted.trajectory.filter(event => event.type === 'ACTED').at(-1) ?? null;
    const reuseCompletedAction = currentEvaluation?.validity === EvaluationValidity.VALID && currentEvaluation.verdict === EvaluationVerdict.PASS;
    let actionResult = reuseCompletedAction ? latestActed : currentEvaluation ? null : latestActed;
    let actionView = actionResult ? {
      eventId: actionResult.id,
      mutated: actionResult.mutated,
      candidate: clone(actionResult.after),
      result: clone(actionResult.result)
    } : null;
    if (!actionView) {
      actionView = await harness.act(executionId, {
        kind: 'COMMON_MINI_ATTEMPT',
        attemptId,
        taskId,
        fault,
        result: action
      });
    }

    persisted = await harness.workState(executionId);
    const currentCandidate = clone(persisted.currentCandidate);
    const existingVerification = persisted.persistentMemory.verifications.find(item => item.candidate.id === currentCandidate.id && item.candidate.version === currentCandidate.version);
    let verificationArtifact = existingVerification ?? null;
    if (!verificationArtifact) {
      const executionResult = actionView.result ?? {};
      const verified = await verifyCandidate({
        candidateRef: executionResult.candidateRef,
        candidateDigest: currentCandidate.version,
        taskId,
        fault,
        attemptId
      });
      lastVerification = verified;
      lastVerificationRef = verificationRef;
      verificationArtifact = await harness.recordVerification(executionId, {
        candidate: currentCandidate,
        claim: `fixture checks for ${taskId}`,
        status: verificationStatus(verified),
        evidence: [verificationRef ?? `verification:${executionId}`],
        summary: verified.status,
        details: clone(verified),
        request: { taskId, fault, attemptId },
        source: { kind: VerificationSourceKind.CAPABILITY, name: 'fixture.acceptance.verifyCandidate' }
      });
    } else {
      lastVerification = existingVerification.details ?? existingVerification;
      lastVerificationRef = verificationRef;
    }

    persisted = await harness.workState(executionId);
    const existingEvaluation = persisted.persistentMemory.evaluations.find(item => item.candidate.id === currentCandidate.id && item.candidate.version === currentCandidate.version);
    const evaluation = existingEvaluation ?? await harness.evaluate(executionId, { taskId, verificationRef });
    let promotion = persisted.persistentMemory.lineage.find(item => item.candidate.id === currentCandidate.id && item.candidate.version === currentCandidate.version && item.kind === 'PROMOTED') ?? null;
    if (!promotion && actionView.mutated && evaluation.validity === EvaluationValidity.VALID && evaluation.verdict === EvaluationVerdict.PASS)
      promotion = await harness.promote(executionId);
    const state = await harness.workState(executionId);
    await writeAtomicJson(join(root, 'core-state.json'), state);
    await writeAtomicJson(join(root, 'core-events.json'), {
      schemaVersion: 1,
      evidenceClass: 'LIVE_CORE_TRACE',
      executionId,
      sessionId: executionId,
      eventCounts: eventCounts(state.trajectory),
      events: state.trajectory,
      stateHash: `sha256:${sha256(state)}`
    });
    return {
      arm: 'EXHARNESS',
      executionId,
      sessionId: executionId,
      attemptId,
      candidateDigest: state.currentCandidate.version,
      candidateRef: actionView.result?.candidateRef ?? null,
      mutated: actionView.mutated,
      executor: clone(actionView.result ?? null),
      verification: clone(verificationArtifact),
      evaluation: clone(evaluation),
      promotion: clone(promotion),
      core: {
        eventCounts: eventCounts(state.trajectory),
        stateBytes: Buffer.byteLength(JSON.stringify(state)),
        events: state.trajectory.map(event => ({ type: event.type, id: event.id, candidate: event.candidate }))
      },
      state
    };
  }

  return Object.freeze({ harness, store, run, state: existingState });
}

export async function auditCoreTrace(path, { executionId, requirePromotion = false } = {}) {
  const trace = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (trace.schemaVersion !== 1 || trace.evidenceClass !== 'LIVE_CORE_TRACE' || trace.executionId !== executionId)
    fail('Core trace identity mismatch');
  const required = ['SESSION_STARTED', 'OBSERVED', 'ACTED', 'VERIFIED', 'EVALUATED'];
  for (const type of required) if (!trace.events.some(event => event.type === type)) fail(`Core trace missing ${type}`);
  if (requirePromotion && !trace.events.some(event => event.type === 'PROMOTED')) fail('Core trace missing PROMOTED');
  if (trace.stateHash !== `sha256:${sha256(trace.state ?? {})}` && trace.state) fail('Core trace state hash mismatch');
  return trace;
}
