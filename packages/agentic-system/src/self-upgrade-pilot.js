import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";

import {
  canonicalize,
  digestValue
} from "../../core-harness/src/index.js";
import {
  ResearchContinuationKind,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  createResearchContinuationController,
  defineResearchContinuationManifest
} from "./research-continuation.js";
import { sessionHandoffFromBlackboard } from "./session-handoff.js";

const STORE_KIND = "SELF_UPGRADE_ARTIFACT";
const STORE_VERSION = 1;
const REF_PREFIX = "self-upgrade://";

export const SelfUpgradeDisposition = Object.freeze({
  KEEP_BASELINE: "KEEP_BASELINE",
  PROPOSE_FOR_REVIEW: "PROPOSE_FOR_REVIEW"
});

export const SelfUpgradeEvaluationVerdict = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE"
});

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requireRecord(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function requirePositiveInteger(value, name) {
  invariant(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

function requireNonNegativeNumber(value, name) {
  invariant(Number.isFinite(value) && value >= 0, `${name} must be a non-negative finite number`);
  return value;
}

function uniqueTextArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  const normalized = (value ?? []).map((entry, index) => requireText(entry, `${name}[${index}]`));
  invariant(new Set(normalized).size === normalized.length, `${name} must not contain duplicates`);
  invariant(normalized.length >= min, `${name} must contain at least ${min} item(s)`);
  return normalized;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function normalizePinnedArtifact(raw, name) {
  const value = requireRecord(raw, name);
  return Object.freeze({
    id: requireText(value.id, `${name}.id`),
    revision: requireText(value.revision, `${name}.revision`),
    artifactRef: requireText(value.artifactRef, `${name}.artifactRef`),
    artifactDigest: requireText(value.artifactDigest, `${name}.artifactDigest`)
  });
}

function normalizeEvaluator(raw) {
  const value = requireRecord(raw, "self-upgrade evaluator");
  return Object.freeze({
    identity: requireText(value.identity, "self-upgrade evaluator.identity"),
    revision: requireText(value.revision, "self-upgrade evaluator.revision"),
    policyRef: requireText(value.policyRef, "self-upgrade evaluator.policyRef"),
    policyRevision: requireText(value.policyRevision, "self-upgrade evaluator.policyRevision")
  });
}

function normalizeBudget(raw) {
  const value = requireRecord(raw, "self-upgrade budget");
  const budget = Object.freeze({
    scenarios: requirePositiveInteger(value.scenarios, "self-upgrade budget.scenarios"),
    policyIdentities: requirePositiveInteger(value.policyIdentities, "self-upgrade budget.policyIdentities"),
    repeatPasses: requirePositiveInteger(value.repeatPasses, "self-upgrade budget.repeatPasses"),
    maxCandidates: requirePositiveInteger(value.maxCandidates, "self-upgrade budget.maxCandidates"),
    evaluationAttempts: requirePositiveInteger(value.evaluationAttempts, "self-upgrade budget.evaluationAttempts"),
    externalMutations: Number(value.externalMutations)
  });
  invariant(budget.policyIdentities === 2, "self-upgrade pilot requires exactly two policy identities");
  invariant(budget.maxCandidates === 1, "self-upgrade pilot permits exactly one candidate");
  invariant(budget.evaluationAttempts <= 2, "self-upgrade pilot permits at most two evaluation attempts");
  invariant(budget.externalMutations === 0, "self-upgrade pilot forbids external mutations");
  return budget;
}

function allScenarioIds(protocol) {
  return [
    ...protocol.scenarios.target,
    ...protocol.scenarios.developmentControls,
    ...protocol.scenarios.recordedHoldoutControls
  ];
}

export function defineSelfUpgradeExperimentProtocol(raw) {
  const value = requireRecord(raw, "self-upgrade protocol");
  invariant(value.version === 1, "self-upgrade protocol version must be 1");
  const baseline = normalizePinnedArtifact(value.baseline, "self-upgrade baseline");
  const candidate = normalizePinnedArtifact(value.candidate, "self-upgrade candidate");
  invariant(
    baseline.id !== candidate.id || baseline.revision !== candidate.revision,
    "self-upgrade candidate must differ from baseline identity/revision"
  );

  const evaluator = normalizeEvaluator(value.evaluator);
  const candidateProducer = requireText(value.candidateProducer, "self-upgrade candidateProducer");
  invariant(evaluator.identity !== candidateProducer, "self-upgrade evaluator must be independent from candidate producer");

  const protocol = {
    version: 1,
    kind: "SELF_UPGRADE_EXPERIMENT_PROTOCOL",
    id: requireText(value.id, "self-upgrade protocol.id"),
    experimentId: requireText(value.experimentId, "self-upgrade protocol.experimentId"),
    userIntentRef: requireText(value.userIntentRef, "self-upgrade protocol.userIntentRef"),
    reviewRequirementRefs: uniqueTextArray(value.reviewRequirementRefs, "self-upgrade protocol.reviewRequirementRefs", { min: 1 }),
    sourceRevision: requireText(value.sourceRevision, "self-upgrade protocol.sourceRevision"),
    policyRevision: requireText(value.policyRevision, "self-upgrade protocol.policyRevision"),
    sourceScopes: uniqueTextArray(value.sourceScopes ?? [], "self-upgrade protocol.sourceScopes", { min: 1 }),
    policyScopes: uniqueTextArray(value.policyScopes ?? [], "self-upgrade protocol.policyScopes", { min: 1 }),
    baseline,
    candidate,
    candidateProducer,
    evaluator,
    scenarios: {
      target: uniqueTextArray(value.scenarios?.target, "self-upgrade protocol.scenarios.target", { min: 1 }),
      developmentControls: uniqueTextArray(
        value.scenarios?.developmentControls,
        "self-upgrade protocol.scenarios.developmentControls",
        { min: 1 }
      ),
      recordedHoldoutControls: uniqueTextArray(
        value.scenarios?.recordedHoldoutControls,
        "self-upgrade protocol.scenarios.recordedHoldoutControls",
        { min: 1 }
      )
    },
    budget: normalizeBudget(value.budget),
    rollback: normalizePinnedArtifact(value.rollback, "self-upgrade rollback"),
    adoptionAuthority: value.adoptionAuthority
  };

  const scenarios = allScenarioIds(protocol);
  invariant(new Set(scenarios).size === scenarios.length, "self-upgrade scenario ids must be unique");
  invariant(scenarios.length === protocol.budget.scenarios, "self-upgrade scenario membership must equal fixed scenario budget");
  invariant(
    protocol.rollback.id === baseline.id &&
      protocol.rollback.revision === baseline.revision &&
      protocol.rollback.artifactRef === baseline.artifactRef &&
      protocol.rollback.artifactDigest === baseline.artifactDigest,
    "self-upgrade rollback must name the exact accepted baseline"
  );
  invariant(protocol.adoptionAuthority === false, "self-upgrade protocol must not grant adoption authority");

  return freezeClone(protocol);
}

function normalizeScenarioResults(raw, protocol) {
  invariant(Array.isArray(raw), "self-upgrade evaluation scenarioResults must be an array");
  const allowed = new Set(Object.values(SelfUpgradeEvaluationVerdict));
  const results = raw.map((entry, index) => {
    const value = requireRecord(entry, `self-upgrade evaluation scenarioResults[${index}]`);
    const status = requireText(value.status, `self-upgrade evaluation scenarioResults[${index}].status`);
    invariant(allowed.has(status), `self-upgrade evaluation scenarioResults[${index}].status is invalid`);
    return Object.freeze({
      id: requireText(value.id, `self-upgrade evaluation scenarioResults[${index}].id`),
      status,
      evidenceRefs: uniqueTextArray(
        value.evidenceRefs ?? [],
        `self-upgrade evaluation scenarioResults[${index}].evidenceRefs`,
        { min: 1 }
      )
    });
  });

  const expected = [...allScenarioIds(protocol)].sort();
  const actual = results.map((entry) => entry.id).sort();
  invariant(new Set(actual).size === actual.length, "self-upgrade evaluation scenario ids must be unique");
  invariant(canonicalize(actual) === canonicalize(expected), "self-upgrade evaluation scenario membership changed from fixed protocol");
  return Object.freeze(results);
}

function defineSelfUpgradeEvaluation(raw, protocol, evaluator) {
  const value = requireRecord(raw, "self-upgrade evaluation");
  const verdict = requireText(value.verdict, "self-upgrade evaluation.verdict");
  invariant(
    Object.values(SelfUpgradeEvaluationVerdict).includes(verdict),
    "self-upgrade evaluation.verdict is invalid"
  );
  invariant(value.evaluatorIdentity === evaluator.identity, "self-upgrade evaluation evaluator identity mismatch");
  invariant(value.evaluatorRevision === evaluator.revision, "self-upgrade evaluation evaluator revision mismatch");
  invariant(value.evaluatorPolicyRef === evaluator.policyRef, "self-upgrade evaluation policy ref mismatch");
  invariant(value.evaluatorPolicyRevision === evaluator.policyRevision, "self-upgrade evaluation policy revision mismatch");
  invariant(value.repeatPasses === protocol.budget.repeatPasses, "self-upgrade evaluation repeat-pass budget mismatch");
  invariant(value.policyIdentityCount === protocol.budget.policyIdentities, "self-upgrade evaluation policy-identity budget mismatch");
  invariant(value.externalMutationCount === 0, "self-upgrade evaluation must not perform external mutations");
  invariant(value.adoptionAuthorized === false, "self-upgrade evaluation cannot authorize adoption");
  invariant(value.productionEvidence === false, "bounded BB-035 pilot must not claim production evidence");
  invariant(value.generalizationEvidence === false, "bounded BB-035 pilot must not claim generalization evidence");

  return freezeClone({
    verdict,
    evaluatorIdentity: evaluator.identity,
    evaluatorRevision: evaluator.revision,
    evaluatorPolicyRef: evaluator.policyRef,
    evaluatorPolicyRevision: evaluator.policyRevision,
    scenarioResults: normalizeScenarioResults(value.scenarioResults, protocol),
    repeatPasses: value.repeatPasses,
    policyIdentityCount: value.policyIdentityCount,
    externalMutationCount: value.externalMutationCount,
    evidenceRefs: uniqueTextArray(value.evidenceRefs, "self-upgrade evaluation.evidenceRefs", { min: 1 }),
    observedCost: requireNonNegativeNumber(value.observedCost, "self-upgrade evaluation.observedCost"),
    evidenceClass: requireText(value.evidenceClass, "self-upgrade evaluation.evidenceClass"),
    productionEvidence: false,
    generalizationEvidence: false,
    adoptionAuthorized: false,
    limitations: uniqueTextArray(value.limitations ?? [], "self-upgrade evaluation.limitations")
  });
}

export function defineSelfUpgradeExperimentResult({ protocol: rawProtocol, evaluation: rawEvaluation }) {
  const protocol = defineSelfUpgradeExperimentProtocol(rawProtocol);
  const evaluation = defineSelfUpgradeEvaluation(rawEvaluation, protocol, protocol.evaluator);
  const allPassing =
    evaluation.verdict === SelfUpgradeEvaluationVerdict.PASS &&
    evaluation.scenarioResults.every((entry) => entry.status === SelfUpgradeEvaluationVerdict.PASS);
  const disposition = allPassing
    ? SelfUpgradeDisposition.PROPOSE_FOR_REVIEW
    : SelfUpgradeDisposition.KEEP_BASELINE;

  const result = {
    version: 1,
    kind: "SELF_UPGRADE_EXPERIMENT_RESULT",
    protocolDigest: digestValue(protocol),
    experimentId: protocol.experimentId,
    sourceRevision: protocol.sourceRevision,
    policyRevision: protocol.policyRevision,
    baseline: protocol.baseline,
    candidate: protocol.candidate,
    evaluator: protocol.evaluator,
    scenarioResults: evaluation.scenarioResults,
    evaluationRefs: evaluation.evidenceRefs,
    observedCost: evaluation.observedCost,
    evidenceClass: evaluation.evidenceClass,
    productionEvidence: false,
    generalizationEvidence: false,
    disposition,
    selectedUntilIndependentAcceptance: protocol.baseline,
    rollback: protocol.rollback,
    adoptionControl: {
      projectAcceptanceRequired: true,
      adoptionAuthority: false,
      rolloutAuthority: false
    },
    limitations: evaluation.limitations
  };
  return freezeClone(result);
}

function normalizeInternalRef(ref) {
  requireText(ref, "self-upgrade artifact ref");
  invariant(ref.startsWith(REF_PREFIX), "self-upgrade artifact ref has invalid scheme");
  const parts = ref.slice(REF_PREFIX.length).split("/");
  invariant(parts.length === 2 && parts.every(Boolean), "self-upgrade artifact ref is malformed");
  return Object.freeze({ artifactType: parts[0], digest: parts[1] });
}

function fileNameFor(ref) {
  const parsed = normalizeInternalRef(ref);
  invariant(/^sha256:[0-9a-f]{64}$/.test(parsed.digest), "self-upgrade artifact ref digest is invalid");
  return `${parsed.artifactType}-${parsed.digest.slice("sha256:".length)}.json`;
}

function envelopeFor(artifactType, content) {
  const type = requireText(artifactType, "self-upgrade artifactType").toLowerCase();
  const frozenContent = freezeClone(content);
  const digest = digestValue({ artifactType: type, content: frozenContent });
  const ref = `${REF_PREFIX}${type}/${digest}`;
  return freezeClone({
    kind: STORE_KIND,
    version: STORE_VERSION,
    artifactType: type,
    digest,
    ref,
    content: frozenContent
  });
}

function validateEnvelope(raw) {
  const value = requireRecord(raw, "self-upgrade artifact envelope");
  invariant(value.kind === STORE_KIND && value.version === STORE_VERSION, "self-upgrade artifact envelope kind/version mismatch");
  const expected = envelopeFor(value.artifactType, value.content);
  invariant(value.digest === expected.digest && value.ref === expected.ref, "self-upgrade artifact envelope digest/ref mismatch");
  return expected;
}

export function createJsonSelfUpgradeArtifactStore({ path, fs = nodeFs }) {
  requireText(path, "self-upgrade artifact store path");
  invariant(
    fs &&
      typeof fs.mkdir === "function" &&
      typeof fs.open === "function" &&
      typeof fs.readFile === "function" &&
      typeof fs.link === "function" &&
      typeof fs.unlink === "function",
    "self-upgrade artifact store requires filesystem mkdir/open/read/link/unlink capability"
  );

  async function putArtifact({ artifactType, content }) {
    const envelope = envelopeFor(artifactType, content);
    await fs.mkdir(path, { recursive: true });
    const filePath = join(path, fileNameFor(envelope.ref));
    const tempPath = join(path, `.${fileNameFor(envelope.ref)}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    let handle = null;
    let tempExists = false;

    try {
      handle = await fs.open(tempPath, "wx");
      tempExists = true;
      await handle.writeFile(serialized, "utf8");
      await handle.close();
      handle = null;
      try {
        await fs.link(tempPath, filePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = validateEnvelope(JSON.parse(await fs.readFile(filePath, "utf8")));
        invariant(canonicalize(existing) === canonicalize(envelope), "self-upgrade artifact digest already exists with different content");
      }
    } finally {
      if (handle != null) await handle.close();
      if (tempExists) {
        try {
          await fs.unlink(tempPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
    return envelope.ref;
  }

  async function readArtifact({ ref }) {
    const filePath = join(path, fileNameFor(ref));
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`self-upgrade artifact unavailable: ${ref}`);
      throw error;
    }
    const envelope = validateEnvelope(raw);
    invariant(envelope.ref === ref, "self-upgrade artifact ref mismatch");
    return freezeClone({ sourceRef: ref, content: envelope.content });
  }

  return Object.freeze({ putArtifact, readArtifact });
}

function requireEvaluator(evaluator) {
  invariant(evaluator && typeof evaluator.evaluate === "function", "self-upgrade pilot requires evaluator.evaluate()");
  return evaluator;
}

function requireArtifactReader(reader) {
  invariant(reader && typeof reader.readArtifact === "function", "self-upgrade pilot requires artifactReader.readArtifact()");
  return reader;
}

function decodedArtifact(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.prototype.hasOwnProperty.call(raw, "content") &&
    Object.prototype.hasOwnProperty.call(raw, "sourceRef")
  ) {
    return raw.content;
  }
  return raw;
}

function artifactMatchesPin(artifact, pin, name) {
  invariant(digestValue(artifact) === pin.artifactDigest, `${name} artifact digest mismatch`);
}

export function createSelfUpgradePilotController({
  orchestrator,
  projectId,
  artifactStore,
  artifactReader,
  evaluator
}) {
  invariant(
    artifactStore &&
      typeof artifactStore.putArtifact === "function" &&
      typeof artifactStore.readArtifact === "function",
    "self-upgrade pilot requires artifactStore put/read capability"
  );
  invariant(
    orchestrator &&
      typeof orchestrator.recoverSelfUpgradeEvaluationClaim === "function",
    "self-upgrade pilot requires ApplicationOrchestrator.recoverSelfUpgradeEvaluationClaim()"
  );
  const appOrchestrator = orchestrator;
  const externalReader = requireArtifactReader(artifactReader);
  const experimentEvaluator = requireEvaluator(evaluator);

  const compositeReader = {
    async readArtifact({ ref }) {
      if (typeof ref === "string" && ref.startsWith(REF_PREFIX)) {
        return artifactStore.readArtifact({ ref });
      }
      return externalReader.readArtifact({ ref });
    }
  };
  const expectedProjectId = requireText(projectId, "projectId");
  const continuation = createResearchContinuationController({
    orchestrator,
    projectId: expectedProjectId,
    artifactReader: compositeReader
  });

  async function assertProtocolAuthority(protocol) {
    const session = sessionHandoffFromBlackboard(
      await appOrchestrator.readBlackboard(),
      { projectId: expectedProjectId }
    );
    invariant(
      protocol.userIntentRef === session.intent.id || protocol.userIntentRef === session.rootItemId,
      "self-upgrade protocol user intent ref does not match durable project intent"
    );
  }

  function assertReviewRequirement(protocol, reviewKey) {
    const key = requireText(reviewKey, "reviewKey");
    invariant(
      protocol.reviewRequirementRefs.includes(`review:${key}`),
      `self-upgrade review requirement was not predeclared by protocol: ${key}`
    );
    return key;
  }

  async function initializeExperiment({
    itemId,
    owner,
    generation,
    objective,
    protocol: rawProtocol,
    resolvedWork = []
  }) {
    const protocol = defineSelfUpgradeExperimentProtocol(rawProtocol);
    await assertProtocolAuthority(protocol);
    const questionRef = await artifactStore.putArtifact({
      artifactType: "question",
      content: {
        kind: "SELF_UPGRADE_QUESTION",
        objective: requireText(objective, "self-upgrade objective"),
        userIntentRef: protocol.userIntentRef
      }
    });
    const protocolRef = await artifactStore.putArtifact({ artifactType: "protocol", content: protocol });
    const experimentRef = await artifactStore.putArtifact({
      artifactType: "experiment",
      content: {
        id: protocol.experimentId,
        status: ResearchExperimentStatus.IN_PROGRESS,
        sourceRevision: protocol.sourceRevision,
        policyRevision: protocol.policyRevision,
        sourceScopes: protocol.sourceScopes,
        policyScopes: protocol.policyScopes,
        resumedFrom: null,
        resultRefs: [],
        evidenceRefs: []
      }
    });
    const ledgerRef = await artifactStore.putArtifact({
      artifactType: "ledger",
      content: {
        kind: "EVIDENCE_LEDGER",
        revision: 1,
        supersedes: null,
        evidence: []
      }
    });
    const manifest = defineResearchContinuationManifest({
      version: 1,
      kind: ResearchContinuationKind,
      researchId: protocol.id,
      questionRef,
      planRef: protocolRef,
      evidenceLedgerRef: ledgerRef,
      experimentRefs: [experimentRef],
      activeExperimentId: protocol.experimentId,
      sourceRevision: protocol.sourceRevision,
      policyRevision: protocol.policyRevision,
      nextAction: "evaluate fixed self-upgrade candidate"
    });
    await continuation.persistContinuation({
      itemId,
      owner,
      generation,
      manifest,
      artifactRefs: [
        questionRef,
        protocolRef,
        experimentRef,
        ledgerRef,
        protocol.baseline.artifactRef,
        protocol.candidate.artifactRef
      ],
      evidenceRefs: [ledgerRef],
      resolvedWork
    });
    return freezeClone({ manifest, protocolRef, experimentRef, ledgerRef });
  }

  async function resume({
    itemId,
    currentRevision,
    changedSourceScopes = null,
    changedPolicyScopes = null
  }) {
    const state = await continuation.resume({
      itemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    const protocol = defineSelfUpgradeExperimentProtocol(state.plan);
    let result = null;
    const completed = state.experiments.find((entry) => entry.id === protocol.experimentId && entry.status === ResearchExperimentStatus.COMPLETED);
    if (completed?.resultRefs?.length > 0) {
      result = decodedArtifact(await compositeReader.readArtifact({ ref: completed.resultRefs[0] }));
      invariant(result.kind === "SELF_UPGRADE_EXPERIMENT_RESULT", "self-upgrade completed experiment result kind mismatch");
      invariant(result.protocolDigest === digestValue(protocol), "self-upgrade completed experiment result protocol mismatch");
    }
    return freezeClone({ ...state, protocol, result });
  }

  function evaluationBlocker(protocol, attempt) {
    return `SELF_UPGRADE_EVALUATION_ATTEMPT:${attempt}:${digestValue(protocol)}`;
  }

  function parseEvaluationBlocker(blocker, protocol) {
    const value = requireText(blocker, "self-upgrade evaluation blocker");
    const match = /^SELF_UPGRADE_EVALUATION_ATTEMPT:(\d+):(sha256:[0-9a-f]{64})$/.exec(value);
    invariant(match != null, "self-upgrade evaluation blocker is malformed");
    invariant(match[2] === digestValue(protocol), "self-upgrade evaluation blocker protocol changed");
    return requirePositiveInteger(Number(match[1]), "self-upgrade evaluation blocker attempt");
  }

  function continuationArtifactRefs(state, protocol, extra = []) {
    return [...new Set([
      state.manifest.questionRef,
      state.manifest.planRef,
      ...state.manifest.experimentRefs,
      state.manifest.evidenceLedgerRef,
      protocol.baseline.artifactRef,
      protocol.candidate.artifactRef,
      ...extra
    ])];
  }

  async function runEvaluationAttempt({
    state,
    attempt,
    itemId,
    owner,
    generation,
    currentRevision,
    changedSourceScopes,
    changedPolicyScopes,
    resolvedWork,
    recoveryReason = null
  }) {
    const protocol = state.protocol;
    invariant(attempt <= protocol.budget.evaluationAttempts, "self-upgrade evaluation attempt budget exhausted");
    const attemptRef = await artifactStore.putArtifact({
      artifactType: "attempt",
      content: {
        kind: "SELF_UPGRADE_EVALUATION_ATTEMPT",
        protocolDigest: digestValue(protocol),
        attempt,
        owner: requireText(owner, "owner"),
        recoveryReason: recoveryReason == null ? null : requireText(recoveryReason, "recoveryReason")
      }
    });
    const blocker = evaluationBlocker(protocol, attempt);

    await continuation.persistContinuation({
      itemId,
      owner,
      generation,
      manifest: state.manifest,
      artifactRefs: continuationArtifactRefs(state, protocol, [attemptRef]),
      evidenceRefs: [state.manifest.evidenceLedgerRef],
      status: "BLOCKED",
      blockers: [blocker]
    });

    const [baselineRaw, candidateRaw] = await Promise.all([
      externalReader.readArtifact({ ref: protocol.baseline.artifactRef }),
      externalReader.readArtifact({ ref: protocol.candidate.artifactRef })
    ]);
    const baseline = decodedArtifact(baselineRaw);
    const candidate = decodedArtifact(candidateRaw);
    artifactMatchesPin(baseline, protocol.baseline, "self-upgrade baseline");
    artifactMatchesPin(candidate, protocol.candidate, "self-upgrade candidate");

    const rawEvaluation = await experimentEvaluator.evaluate(freezeClone({
      protocol,
      baseline,
      candidate,
      attempt,
      attemptRef
    }));
    const evaluatedResult = defineSelfUpgradeExperimentResult({ protocol, evaluation: rawEvaluation });
    const result = freezeClone({
      ...evaluatedResult,
      evaluationAttempt: {
        number: attempt,
        ref: attemptRef
      }
    });
    const resultRef = await artifactStore.putArtifact({ artifactType: "result", content: result });
    const experimentRef = await artifactStore.putArtifact({
      artifactType: "experiment",
      content: {
        id: protocol.experimentId,
        status: ResearchExperimentStatus.COMPLETED,
        sourceRevision: protocol.sourceRevision,
        policyRevision: protocol.policyRevision,
        sourceScopes: protocol.sourceScopes,
        policyScopes: protocol.policyScopes,
        resumedFrom: state.manifest.experimentRefs[0],
        resultRefs: [resultRef],
        evidenceRefs: result.evaluationRefs
      }
    });
    const ledgerRef = await artifactStore.putArtifact({
      artifactType: "ledger",
      content: {
        kind: "EVIDENCE_LEDGER",
        revision: state.evidenceLedger.revision + 1,
        supersedes: state.manifest.evidenceLedgerRef,
        evidence: [{
          id: `self-upgrade-result:${digestValue(result)}`,
          status: ResearchEvidenceStatus.CONFIRMED,
          sourceRevision: protocol.sourceRevision,
          policyRevision: protocol.policyRevision,
          sourceScopes: protocol.sourceScopes,
          policyScopes: protocol.policyScopes,
          observationRef: resultRef,
          summary: result.disposition === SelfUpgradeDisposition.PROPOSE_FOR_REVIEW
            ? "Candidate passed the fixed experiment and may be proposed for independent review."
            : "Candidate did not satisfy the fixed experiment; baseline remains selected.",
          supports: [result.disposition],
          contradicts: [],
          invalidatedBy: null
        }]
      }
    });
    const manifest = defineResearchContinuationManifest({
      ...state.manifest,
      evidenceLedgerRef: ledgerRef,
      experimentRefs: [experimentRef],
      activeExperimentId: null,
      nextAction: "submit self-upgrade experiment result for independent review"
    });

    const recovered = await appOrchestrator.recoverSelfUpgradeEvaluationClaim({
      itemId,
      owner,
      expectedBlocker: blocker
    });
    await continuation.persistContinuation({
      itemId,
      owner,
      generation: recovered.result.claimGeneration,
      manifest,
      artifactRefs: [
        manifest.questionRef,
        manifest.planRef,
        experimentRef,
        ledgerRef,
        resultRef,
        attemptRef,
        protocol.baseline.artifactRef,
        protocol.candidate.artifactRef
      ],
      evidenceRefs: [ledgerRef, ...result.evaluationRefs],
      resolvedWork
    });

    return freezeClone({ result, resultRef, manifest, experimentRef, ledgerRef, attemptRef });
  }

  async function evaluateAndCheckpoint({
    itemId,
    owner,
    generation,
    currentRevision,
    changedSourceScopes = null,
    changedPolicyScopes = null,
    resolvedWork = []
  }) {
    const state = await resume({
      itemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    invariant(state.resumeExperiment != null, "self-upgrade pilot has no active experiment to evaluate");
    invariant(state.reassessmentEvidenceIds.length === 0, "self-upgrade pilot requires evidence reassessment before evaluation");
    invariant(!state.revisionChanged, "self-upgrade pilot must checkpoint current revisions before evaluation");

    return runEvaluationAttempt({
      state,
      attempt: 1,
      itemId,
      owner,
      generation,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes,
      resolvedWork
    });
  }

  async function recoverEvaluationAndCheckpoint({
    itemId,
    owner,
    currentRevision,
    reason,
    changedSourceScopes = null,
    changedPolicyScopes = null,
    resolvedWork = []
  }) {
    const state = await resume({
      itemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    invariant(state.resumeExperiment != null, "self-upgrade pilot has no interrupted experiment to recover");
    invariant(state.item.status === "BLOCKED", "self-upgrade evaluation recovery requires BLOCKED item");
    invariant(state.item.blockers.length === 1, "self-upgrade evaluation recovery requires one exact blocker");
    invariant(state.reassessmentEvidenceIds.length === 0, "self-upgrade pilot requires evidence reassessment before recovery");
    invariant(!state.revisionChanged, "self-upgrade pilot must checkpoint current revisions before recovery");

    const previousAttempt = parseEvaluationBlocker(state.item.blockers[0], state.protocol);
    const nextAttempt = previousAttempt + 1;
    invariant(
      nextAttempt <= state.protocol.budget.evaluationAttempts,
      "self-upgrade evaluation recovery budget exhausted"
    );
    const claimed = await appOrchestrator.recoverSelfUpgradeEvaluationClaim({
      itemId,
      owner,
      expectedBlocker: state.item.blockers[0]
    });

    return runEvaluationAttempt({
      state,
      attempt: nextAttempt,
      itemId,
      owner,
      generation: claimed.result.claimGeneration,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes,
      resolvedWork,
      recoveryReason: reason
    });
  }

  async function submitForReview({
    itemId,
    owner,
    generation,
    currentRevision,
    changedSourceScopes = null,
    changedPolicyScopes = null,
    resolvedWork = [],
    reviewKey = "self-upgrade-independent-acceptance",
    reviewReason = "Independent outcome/authority review is required before any adoption decision."
  }) {
    const state = await resume({
      itemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    invariant(state.result != null, "self-upgrade pilot cannot submit before experiment completion");
    const completed = state.experiments.find((entry) => entry.id === state.protocol.experimentId);
    invariant(completed?.resultRefs?.length === 1, "self-upgrade pilot requires one exact completed result ref");

    const submitted = await continuation.submitProposal({
      itemId,
      owner,
      generation,
      resultRef: completed.resultRefs[0],
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes,
      resolvedWork,
      reviewKey: boundedReviewKey,
      reviewReason
    });
    return freezeClone({
      ...submitted,
      result: state.result,
      adoptionAuthority: false
    });
  }

  return Object.freeze({
    initializeExperiment,
    resume,
    evaluateAndCheckpoint,
    recoverEvaluationAndCheckpoint,
    submitForReview
  });
}
