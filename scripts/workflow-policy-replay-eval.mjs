import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const policies = Object.freeze({
  baseline: Object.freeze({
    id: 'bb024-baseline-late-reconciliation-v1',
    version: 1,
    terminalCancellationGuard: false
  }),
  candidate: Object.freeze({
    id: 'bb024-terminal-cancellation-guard-v1',
    version: 1,
    terminalCancellationGuard: true
  })
});

const scenarios = Object.freeze([
  {
    id: 'artifact-outage',
    category: 'ARTIFACT_OUTAGE',
    revision: 'rev-2',
    initial: { status: 'QA_PENDING', remainingWork: ['Run QA verification.'] },
    events: [
      { id: 'artifact-outage:read-failed', type: 'ARTIFACT_READ_FAILED', sourceRef: 'workspace://rev-2/src/server.js' },
      { id: 'artifact-outage:source-restored', type: 'ARTIFACT_SOURCE_AVAILABLE', sourceRef: 'workspace://rev-2/src/server.js' },
      { id: 'artifact-outage:resume', type: 'RESUME' },
      { id: 'artifact-outage:qa-verified', type: 'QA_VERIFIED', outcomeRef: 'decision:qa-rev-2' }
    ]
  },
  {
    id: 'cancellation-late-reconciliation',
    category: 'CANCELLATION',
    revision: 'rev-1',
    initial: { status: 'PENDING_RECONCILIATION', remainingWork: [] },
    events: [
      { id: 'cancel:supersede', type: 'SUPERSEDE', outcomeRef: 'board:bb-100:cancelled' },
      {
        id: 'cancel:late-finding',
        type: 'RECONCILE_CURRENT_WORK_FINDING',
        finding: 'Late finding must not revive cancelled work.',
        sourceRef: 'attestation:accepted',
        baselineOutcomeRef: 'outcome:bb024-baseline-reopened',
        candidateOutcomeRef: 'outcome:bb024-candidate-superseded'
      }
    ]
  },
  {
    id: 'retry-recorded-effect',
    category: 'RETRY',
    revision: 'rev-2',
    initial: { status: 'CLAIMED', remainingWork: ['Reconcile interrupted Backend attempt.'] },
    events: [
      {
        id: 'retry:recorded-effect',
        type: 'OBSERVED_EFFECT_RESULT',
        mutating: true,
        effectState: 'CONFIRMED',
        operationRef: 'effect:backend-apply:rev-2'
      },
      { id: 'retry:request', type: 'RETRY_REQUESTED', reason: 'Interrupted attempt requires runtime reconciliation.' }
    ]
  },
  {
    id: 'review-delay',
    category: 'REVIEW_DELAY',
    revision: 'rev-2',
    initial: { status: 'PENDING_REVIEW', remainingWork: [] },
    events: [
      { id: 'review:dispatch', type: 'REVIEW_DISPATCHED', reviewKey: 'BACKEND_REVIEW', subjectRef: 'subject:rev-2' },
      { id: 'review:delay', type: 'REVIEW_DELAY_OBSERVED', durationClass: 'UNBOUNDED_FIXTURE_DELAY' },
      { id: 'review:accepted', type: 'REVIEW_ACCEPTED', decisionRef: 'decision:review-rev-2' }
    ]
  }
]);

function clone(value) {
  return structuredClone(value);
}

function appendDecision(trace, event, action, outcomeRef = null, detail = null) {
  trace.decisions.push({ eventId: event.id, action, outcomeRef, detail });
}

function replayScenario(scenario, policy) {
  const state = clone(scenario.initial);
  const trace = {
    scenarioId: scenario.id,
    category: scenario.category,
    revision: scenario.revision,
    policy: { id: policy.id, version: policy.version },
    decisions: [],
    observedExternalEffects: [],
    externalDispatchCount: 0
  };

  for (const event of scenario.events) {
    switch (event.type) {
      case 'ARTIFACT_READ_FAILED':
        state.status = 'BLOCKED';
        appendDecision(trace, event, 'BLOCK_ON_UNAVAILABLE_ARTIFACT', event.sourceRef);
        break;
      case 'ARTIFACT_SOURCE_AVAILABLE':
        appendDecision(trace, event, 'OBSERVE_SOURCE_RECOVERY', event.sourceRef);
        break;
      case 'RESUME':
        if (state.status === 'BLOCKED') state.status = 'QA_PENDING';
        appendDecision(trace, event, 'RESUME_FROM_DURABLE_QA_CHECKPOINT');
        break;
      case 'QA_VERIFIED':
        state.status = 'PENDING_REVIEW';
        state.remainingWork = [];
        appendDecision(trace, event, 'SUBMIT_QA_RESULT_FOR_REVIEW', event.outcomeRef);
        break;
      case 'SUPERSEDE':
        state.status = 'SUPERSEDED';
        state.remainingWork = [];
        appendDecision(trace, event, 'CANCEL_CURRENT_WORK', event.outcomeRef);
        break;
      case 'RECONCILE_CURRENT_WORK_FINDING':
        if (state.status === 'SUPERSEDED' && policy.terminalCancellationGuard) {
          appendDecision(
            trace,
            event,
            'REJECT_TERMINAL_MUTATION',
            event.candidateOutcomeRef,
            'SUPERSEDED remains immutable'
          );
        } else {
          state.status = 'REOPENED';
          if (!state.remainingWork.includes(event.finding)) state.remainingWork.push(event.finding);
          appendDecision(
            trace,
            event,
            'APPLY_LATE_FINDING_TO_CURRENT_WORK',
            event.baselineOutcomeRef,
            'baseline reproduces BB-024 cancellation revival'
          );
        }
        break;
      case 'OBSERVED_EFFECT_RESULT':
        trace.observedExternalEffects.push({
          eventId: event.id,
          operationRef: event.operationRef,
          mutating: event.mutating,
          effectState: event.effectState
        });
        appendDecision(trace, event, 'RECORD_HISTORICAL_EFFECT_ONLY', event.operationRef);
        break;
      case 'RETRY_REQUESTED':
        state.status = 'REQUIRES_LIVE_AUTHORITY';
        appendDecision(
          trace,
          event,
          'DO_NOT_REISSUE_HISTORICAL_MUTATION',
          null,
          event.reason
        );
        break;
      case 'REVIEW_DISPATCHED':
        state.status = 'REVIEWING';
        appendDecision(trace, event, 'OBSERVE_REVIEW_DISPATCH', event.subjectRef);
        break;
      case 'REVIEW_DELAY_OBSERVED':
        appendDecision(trace, event, 'PRESERVE_REVIEW_SEMANTICS_DURING_DELAY', null, event.durationClass);
        break;
      case 'REVIEW_ACCEPTED':
        state.status = 'DONE';
        appendDecision(trace, event, 'APPLY_RECORDED_TRUSTED_ACCEPTANCE', event.decisionRef);
        break;
      default:
        throw new TypeError(`unsupported replay event: ${event.type}`);
    }
  }

  trace.final = state;
  return Object.freeze(trace);
}

function replayAll(policy) {
  return scenarios.map((scenario) => replayScenario(scenario, policy));
}

const firstBaseline = replayAll(policies.baseline);
const firstCandidate = replayAll(policies.candidate);
const secondBaseline = replayAll(policies.baseline);
const secondCandidate = replayAll(policies.candidate);

assert.deepEqual(firstBaseline, secondBaseline, 'baseline replay must be deterministic');
assert.deepEqual(firstCandidate, secondCandidate, 'candidate replay must be deterministic');

const behavioralComparison = scenarios.map((scenario, index) => {
  const baseline = firstBaseline[index];
  const candidate = firstCandidate[index];
  const baselineBehavior = {
    decisions: baseline.decisions.map(({ eventId, action, outcomeRef, detail }) => ({ eventId, action, outcomeRef, detail })),
    observedExternalEffects: baseline.observedExternalEffects,
    externalDispatchCount: baseline.externalDispatchCount,
    final: baseline.final
  };
  const candidateBehavior = {
    decisions: candidate.decisions.map(({ eventId, action, outcomeRef, detail }) => ({ eventId, action, outcomeRef, detail })),
    observedExternalEffects: candidate.observedExternalEffects,
    externalDispatchCount: candidate.externalDispatchCount,
    final: candidate.final
  };
  const changed = JSON.stringify(baselineBehavior) !== JSON.stringify(candidateBehavior);
  const firstChangedDecision = baselineBehavior.decisions.find((decision, decisionIndex) =>
    JSON.stringify(decision) !== JSON.stringify(candidateBehavior.decisions[decisionIndex])
  ) ?? null;
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    changed,
    changedEventId: firstChangedDecision?.eventId ?? null,
    baselineFinalStatus: baseline.final.status,
    candidateFinalStatus: candidate.final.status,
    baselineOutcomeRef: firstChangedDecision?.outcomeRef ?? null,
    candidateOutcomeRef: changed
      ? candidateBehavior.decisions.find((decision) => decision.eventId === firstChangedDecision?.eventId)?.outcomeRef ?? null
      : null,
    externalDispatchCount: baseline.externalDispatchCount + candidate.externalDispatchCount
  };
});

const cancellation = behavioralComparison.find((item) => item.scenarioId === 'cancellation-late-reconciliation');
assert.deepEqual(cancellation, {
  scenarioId: 'cancellation-late-reconciliation',
  category: 'CANCELLATION',
  changed: true,
  changedEventId: 'cancel:late-finding',
  baselineFinalStatus: 'REOPENED',
  candidateFinalStatus: 'SUPERSEDED',
  baselineOutcomeRef: 'outcome:bb024-baseline-reopened',
  candidateOutcomeRef: 'outcome:bb024-candidate-superseded',
  externalDispatchCount: 0
});
assert.equal(behavioralComparison.filter((item) => item.changed).length, 1);

const result = {
  schemaVersion: 1,
  evidenceClass: 'DETERMINISTIC_POLICY_REPLAY_FIXTURE',
  productionEvidence: false,
  policyPair: {
    baseline: policies.baseline,
    candidate: policies.candidate
  },
  inputContract: {
    required: ['scenarioId', 'category', 'revision', 'initialState', 'ordered observable events', 'policy identity'],
    adapterResponsesAreRecorded: true,
    providerModelCallsAreReplayed: false,
    liveRuntimeAuthorityReconstructed: false
  },
  metrics: {
    scenarioCount: scenarios.length,
    behavioralDivergenceCount: behavioralComparison.filter((item) => item.changed).length,
    cancellationRegressionReproduced: cancellation.baselineFinalStatus === 'REOPENED' && cancellation.candidateFinalStatus === 'SUPERSEDED',
    unaffectedScheduleCount: behavioralComparison.filter((item) => !item.changed).length,
    deterministicRepeatPasses: 2,
    historicalExternalEffectsObserved: [...firstBaseline, ...firstCandidate].reduce((sum, trace) => sum + trace.observedExternalEffects.length, 0),
    externalDispatchCount: [...firstBaseline, ...firstCandidate].reduce((sum, trace) => sum + trace.externalDispatchCount, 0),
    inputFixtureBytes: Buffer.byteLength(JSON.stringify(scenarios)),
    replayTraceBytes: Buffer.byteLength(JSON.stringify({ baseline: firstBaseline, candidate: firstCandidate }))
  },
  comparison: behavioralComparison,
  provenance: {
    reproducedDefect: 'BB-024 delayed finding reconciliation can revive SUPERSEDED work',
    baselineEvidence: 'packages/agentic-system/src/blackboard-orchestrator.js reconcileFinding + supersede semantics on main before BB-024 fix',
    candidateEvidence: 'PR #85 terminal cancellation guard and bb024-cancellation-reconciliation.test.js',
    referenceEvaluation: 'scripts/agentic-backend-qa-eval.mjs'
  },
  limitations: {
    fixtureOnly: true,
    realConcurrentTiming: false,
    liveFilesystemAtomicity: false,
    liveExternalEffects: false,
    modelProviderNondeterminism: false,
    causalProofWhenInputsDiffer: false,
    runtimeAuthorityReconstruction: false
  }
};

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expected = JSON.parse(await readFile(
  join(root, 'artifacts', 'bb038-workflow-replay-eval.json'),
  'utf8'
));
assert.deepEqual(result, expected, 'BB-038 workflow replay artifact drifted from its deterministic baseline');
console.log(`workflow-policy-replay-eval:${JSON.stringify(result)}`);
