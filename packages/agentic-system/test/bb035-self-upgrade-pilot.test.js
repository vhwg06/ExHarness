import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { digestValue } from "../../core-harness/src/index.js";
import { createApplicationOrchestrator } from "../src/application-orchestrator.js";
import { createJsonBlackboardStore } from "../src/blackboard-json-payload.js";
import { BlackboardStatus } from "../src/blackboard-orchestrator.js";
import { createSessionHandoffSurface } from "../src/session-handoff.js";
import {
  SelfUpgradeDisposition,
  SelfUpgradeEvaluationVerdict,
  createJsonSelfUpgradeArtifactStore,
  createSelfUpgradePilotController,
  defineSelfUpgradeExperimentProtocol,
  defineSelfUpgradeExperimentResult
} from "../src/self-upgrade-pilot.js";

const PROJECT_ID = "bb035-project";
const ITEM_ID = "bb035-pilot";
const SOURCE_REVISION = "repo@accepted";
const POLICY_REVISION = "self-upgrade-policy@1";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function workItem() {
  return {
    id: ITEM_ID,
    work: "Run one bounded self-upgrade experiment and submit its result for independent acceptance.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: ["run fixed experiment", "submit result"],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function externalArtifacts() {
  const baseline = {
    kind: "WORKFLOW_POLICY",
    id: "accepted-terminal-cancellation-policy",
    revision: "7",
    rule: "SUPERSEDED remains terminal"
  };
  const candidate = {
    kind: "WORKFLOW_POLICY",
    id: "candidate-terminal-cancellation-policy",
    revision: "8",
    rule: "SUPERSEDED remains terminal and late reconciliation is ignored"
  };
  return {
    baseline,
    candidate,
    reader: {
      async readArtifact({ ref }) {
        if (ref === "artifact:baseline") return structuredClone(baseline);
        if (ref === "artifact:candidate") return structuredClone(candidate);
        throw new Error(`external artifact unavailable: ${ref}`);
      }
    }
  };
}

function protocol(artifacts, overrides = {}) {
  return {
    version: 1,
    id: "bb035-terminal-cancellation-upgrade",
    experimentId: "experiment-1",
    userIntentRef: "intent:exharness-agentic-system",
    reviewRequirementRefs: ["review:independent-outcome-authority"],
    sourceRevision: SOURCE_REVISION,
    policyRevision: POLICY_REVISION,
    sourceScopes: ["packages/agentic-system/src/application-orchestrator.js"],
    policyScopes: ["policy/self-upgrade"],
    baseline: {
      id: artifacts.baseline.id,
      revision: artifacts.baseline.revision,
      artifactRef: "artifact:baseline",
      artifactDigest: digestValue(artifacts.baseline)
    },
    candidate: {
      id: artifacts.candidate.id,
      revision: artifacts.candidate.revision,
      artifactRef: "artifact:candidate",
      artifactDigest: digestValue(artifacts.candidate)
    },
    candidateProducer: "candidate-builder",
    evaluator: {
      identity: "independent-evaluator",
      revision: "2",
      policyRef: "policy:bb035-evaluation",
      policyRevision: "3"
    },
    scenarios: {
      target: ["cancellation-late-reconciliation"],
      developmentControls: ["artifact-outage", "retry-recorded-effect"],
      recordedHoldoutControls: ["review-delay"]
    },
    budget: {
      scenarios: 4,
      policyIdentities: 2,
      repeatPasses: 2,
      maxCandidates: 1,
      evaluationAttempts: 2,
      externalMutations: 0
    },
    rollback: {
      id: artifacts.baseline.id,
      revision: artifacts.baseline.revision,
      artifactRef: "artifact:baseline",
      artifactDigest: digestValue(artifacts.baseline)
    },
    adoptionAuthority: false,
    ...overrides
  };
}

function evaluation(verdict = SelfUpgradeEvaluationVerdict.PASS, overrides = {}) {
  const scenarioStatus = verdict === SelfUpgradeEvaluationVerdict.PASS
    ? SelfUpgradeEvaluationVerdict.PASS
    : verdict;
  return {
    verdict,
    evaluatorIdentity: "independent-evaluator",
    evaluatorRevision: "2",
    evaluatorPolicyRef: "policy:bb035-evaluation",
    evaluatorPolicyRevision: "3",
    scenarioResults: [
      { id: "cancellation-late-reconciliation", status: scenarioStatus, evidenceRefs: ["evidence:target"] },
      { id: "artifact-outage", status: scenarioStatus, evidenceRefs: ["evidence:dev-1"] },
      { id: "retry-recorded-effect", status: scenarioStatus, evidenceRefs: ["evidence:dev-2"] },
      { id: "review-delay", status: scenarioStatus, evidenceRefs: ["evidence:holdout"] }
    ],
    repeatPasses: 2,
    policyIdentityCount: 2,
    externalMutationCount: 0,
    evidenceRefs: ["evidence:target", "evidence:dev-1", "evidence:dev-2", "evidence:holdout"],
    observedCost: 4,
    evidenceClass: "DETERMINISTIC_SELF_UPGRADE_IMPLEMENTATION_PILOT",
    productionEvidence: false,
    generalizationEvidence: false,
    adoptionAuthorized: false,
    limitations: ["deterministic recorded scenarios", "no production rollout evidence"],
    ...overrides
  };
}

async function withProject({ evaluatorOutput = evaluation() } = {}, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb035-"));
  const boardPath = join(directory, "blackboard.json");
  const selfUpgradePath = join(directory, "self-upgrade");
  const artifacts = externalArtifacts();

  function makeOrchestrator() {
    return createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
  }

  function makeStore() {
    return createJsonSelfUpgradeArtifactStore({ path: selfUpgradePath });
  }

  function makeController(output = evaluatorOutput, evaluatorOverride = null) {
    return createSelfUpgradePilotController({
      orchestrator: makeOrchestrator(),
      projectId: PROJECT_ID,
      artifactStore: makeStore(),
      artifactReader: artifacts.reader,
      evaluator: evaluatorOverride ?? {
        async evaluate(input) {
          assert.equal(input.protocol.candidate.id, artifacts.candidate.id);
          assert.equal(input.protocol.baseline.id, artifacts.baseline.id);
          return structuredClone(output);
        }
      }
    });
  }

  try {
    const orchestrator = makeOrchestrator();
    const surface = createSessionHandoffSurface({ orchestrator, projectId: PROJECT_ID });
    await surface.initialize({
      userIntent: {
        id: "bb035-user-intent",
        objective: "Evaluate bounded upgrades without self-authorizing adoption.",
        bullets: ["keep baseline on failed or inconclusive experiments"],
        constraints: ["independent review before adoption", "no live mutation"]
      },
      items: [workItem()]
    });
    await run({ artifacts, makeController, makeOrchestrator, makeStore });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function initializePilot({ artifacts, makeController, makeOrchestrator }) {
  const orchestrator = makeOrchestrator();
  const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-init" });
  const controller = makeController();
  await controller.initializeExperiment({
    itemId: ITEM_ID,
    owner: "session-init",
    generation: claim.result.claimGeneration,
    objective: "Test the fixed terminal-cancellation candidate.",
    protocol: protocol(artifacts)
  });
}

test("BB-035 PASS survives fresh sessions and can only become a reviewable proposal", async () => {
  await withProject({}, async ({ artifacts, makeController, makeOrchestrator, makeStore }) => {
    await initializePilot({ artifacts, makeController, makeOrchestrator });

    let fresh = makeController();
    let resumed = await fresh.resume({
      itemId: ITEM_ID,
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
    });
    assert.equal(resumed.resumeExperiment.id, "experiment-1");
    assert.equal(resumed.result, null);

    let orchestrator = makeOrchestrator();
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-evaluate" });
    const evaluated = await makeController().evaluateAndCheckpoint({
      itemId: ITEM_ID,
      owner: "session-evaluate",
      generation: claim.result.claimGeneration,
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
      resolvedWork: ["run fixed experiment"]
    });
    assert.equal(evaluated.result.disposition, SelfUpgradeDisposition.PROPOSE_FOR_REVIEW);
    assert.deepEqual(evaluated.result.selectedUntilIndependentAcceptance, protocol(artifacts).baseline);
    assert.deepEqual(evaluated.result.rollback, protocol(artifacts).baseline);
    assert.equal(evaluated.result.adoptionControl.adoptionAuthority, false);
    assert.equal(evaluated.result.adoptionControl.rolloutAuthority, false);

    const freshStore = makeStore();
    const persistedResult = await freshStore.readArtifact({ ref: evaluated.resultRef });
    assert.equal(persistedResult.content.disposition, SelfUpgradeDisposition.PROPOSE_FOR_REVIEW);

    fresh = makeController();
    resumed = await fresh.resume({
      itemId: ITEM_ID,
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
    });
    assert.equal(resumed.resumeExperiment, null);
    assert.equal(resumed.result.disposition, SelfUpgradeDisposition.PROPOSE_FOR_REVIEW);

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-submit" });
    const submitted = await makeController().submitForReview({
      itemId: ITEM_ID,
      owner: "session-submit",
      generation: claim.result.claimGeneration,
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
      resolvedWork: ["submit result"]
    });
    assert.equal(submitted.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(submitted.item.submission.decisionStatus, "PROPOSED");
    assert.deepEqual(
      submitted.item.reviewRequirements.map((requirement) => requirement.key),
      ["self-upgrade-independent-acceptance"]
    );
    assert.equal(submitted.adoptionAuthority, false);
    assert.equal(typeof makeController().adopt, "undefined");
  });
});

for (const verdict of [
  SelfUpgradeEvaluationVerdict.FAIL,
  SelfUpgradeEvaluationVerdict.INCONCLUSIVE
]) {
  test(`BB-035 ${verdict} keeps the accepted baseline and preserves reviewable evidence`, async () => {
    await withProject({ evaluatorOutput: evaluation(verdict) }, async ({ artifacts, makeController, makeOrchestrator }) => {
      await initializePilot({ artifacts, makeController, makeOrchestrator });
      const orchestrator = makeOrchestrator();
      const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: `session-${verdict.toLowerCase()}` });
      const evaluated = await makeController().evaluateAndCheckpoint({
        itemId: ITEM_ID,
        owner: `session-${verdict.toLowerCase()}`,
        generation: claim.result.claimGeneration,
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
        resolvedWork: ["run fixed experiment"]
      });
      assert.equal(evaluated.result.disposition, SelfUpgradeDisposition.KEEP_BASELINE);
      assert.deepEqual(evaluated.result.selectedUntilIndependentAcceptance, protocol(artifacts).baseline);
      assert.equal(evaluated.result.evaluationRefs.length, 4);

      const resumed = await makeController().resume({
        itemId: ITEM_ID,
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
      });
      assert.equal(resumed.result.disposition, SelfUpgradeDisposition.KEEP_BASELINE);
      assert.equal(resumed.evidenceLedger.evidence[0].status, "CONFIRMED");
      assert.ok(resumed.evidenceLedger.evidence[0].supports.includes(SelfUpgradeDisposition.KEEP_BASELINE));
    });
  });
}

test("BB-035 fails closed on candidate tamper, evaluator laundering and widened experiment budget", async () => {
  const artifacts = externalArtifacts();
  const valid = protocol(artifacts);

  assert.throws(
    () => defineSelfUpgradeExperimentProtocol({
      ...valid,
      evaluator: {
        ...valid.evaluator,
        identity: valid.candidateProducer
      }
    }),
    /evaluator must be independent/
  );

  assert.throws(
    () => defineSelfUpgradeExperimentProtocol({
      ...valid,
      budget: { ...valid.budget, maxCandidates: 2 }
    }),
    /exactly one candidate/
  );
  assert.throws(
    () => defineSelfUpgradeExperimentProtocol({
      ...valid,
      budget: { ...valid.budget, evaluationAttempts: 3 }
    }),
    /at most two evaluation attempts/
  );

  assert.throws(
    () => defineSelfUpgradeExperimentResult({
      protocol: valid,
      evaluation: evaluation(SelfUpgradeEvaluationVerdict.PASS, {
        externalMutationCount: 1
      })
    }),
    /must not perform external mutations/
  );

  await withProject({}, async ({ artifacts: projectArtifacts, makeController, makeOrchestrator }) => {
    await initializePilot({ artifacts: projectArtifacts, makeController, makeOrchestrator });
    projectArtifacts.candidate.rule = "tampered after protocol pin";

    const orchestrator = makeOrchestrator();
    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-tamper" });
    await assert.rejects(
      () => makeController().evaluateAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-tamper",
        generation: claim.result.claimGeneration,
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
      }),
      /candidate artifact digest mismatch/
    );
    const board = await orchestrator.readBlackboard();
    const item = board.items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.BLOCKED);
    assert.match(item.blockers[0], /^SELF_UPGRADE_EVALUATION_ATTEMPT:1:/);
    assert.equal(item.submission, null);
  });
});

test("BB-035 stale source/policy revisions cannot be evaluated or submitted without continuation reconciliation", async () => {
  await withProject({}, async ({ artifacts, makeController, makeOrchestrator }) => {
    await initializePilot({ artifacts, makeController, makeOrchestrator });
    const orchestrator = makeOrchestrator();
    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-stale-evaluate" });

    await assert.rejects(
      () => makeController().evaluateAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-stale-evaluate",
        generation: claim.result.claimGeneration,
        currentRevision: { sourceRevision: "repo@new", policyRevision: POLICY_REVISION },
        changedSourceScopes: ["packages/agentic-system/src/application-orchestrator.js"]
      }),
      /evidence reassessment|checkpoint current revisions/
    );

    const item = (await orchestrator.readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.CLAIMED);
    assert.equal(item.submission, null);
  });
});


test("BB-035 concurrent evaluation on the same claim executes the evaluator at most once", async () => {
  let release;
  let startedResolve;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let calls = 0;

  await withProject({}, async ({ artifacts, makeController, makeOrchestrator }) => {
    let orchestrator = makeOrchestrator();
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-init-concurrent" });
    const evaluatorOverride = {
      async evaluate() {
        calls += 1;
        startedResolve();
        await gate;
        return evaluation();
      }
    };
    const controller = () => makeController(evaluation(), evaluatorOverride);

    await controller().initializeExperiment({
      itemId: ITEM_ID,
      owner: "session-init-concurrent",
      generation: claim.result.claimGeneration,
      objective: "Fence concurrent evaluation starts.",
      protocol: protocol(artifacts)
    });

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-concurrent" });
    const args = {
      itemId: ITEM_ID,
      owner: "session-concurrent",
      generation: claim.result.claimGeneration,
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
      resolvedWork: ["run fixed experiment"]
    };

    const first = controller().evaluateAndCheckpoint(args);
    await started;
    const second = controller().evaluateAndCheckpoint(args);
    await assert.rejects(second, /must be CLAIMED before checkpoint|claim generation is stale/);
    assert.equal(calls, 1);

    release();
    const completed = await first;
    assert.equal(completed.result.evaluationAttempt.number, 1);
  });
});

test("BB-035 interrupted evaluation recovers explicitly within the fixed attempt budget", async () => {
  await withProject({}, async ({ artifacts, makeController, makeOrchestrator }) => {
    let orchestrator = makeOrchestrator();
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-init-recovery" });
    await makeController().initializeExperiment({
      itemId: ITEM_ID,
      owner: "session-init-recovery",
      generation: claim.result.claimGeneration,
      objective: "Recover one interrupted bounded evaluation.",
      protocol: protocol(artifacts)
    });

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-crash" });
    const crashing = makeController(evaluation(), {
      async evaluate() {
        throw new Error("simulated evaluator crash");
      }
    });
    await assert.rejects(
      () => crashing.evaluateAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-crash",
        generation: claim.result.claimGeneration,
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
      }),
      /simulated evaluator crash/
    );

    let item = (await makeOrchestrator().readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.BLOCKED);
    assert.match(item.blockers[0], /^SELF_UPGRADE_EVALUATION_ATTEMPT:1:/);

    const recovered = await makeController().recoverEvaluationAndCheckpoint({
      itemId: ITEM_ID,
      owner: "session-recover",
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
      reason: "previous evaluator process exited before publishing a result",
      resolvedWork: ["run fixed experiment"]
    });
    assert.equal(recovered.result.evaluationAttempt.number, 2);
    assert.equal(recovered.result.disposition, SelfUpgradeDisposition.PROPOSE_FOR_REVIEW);

    item = (await makeOrchestrator().readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.REOPENED);
    assert.deepEqual(item.remainingWork, ["submit result"]);
  });
});

test("BB-035 recovery fails closed after the evaluation-attempt budget is exhausted", async () => {
  await withProject({}, async ({ artifacts, makeController, makeOrchestrator }) => {
    let orchestrator = makeOrchestrator();
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-init-budget" });
    await makeController().initializeExperiment({
      itemId: ITEM_ID,
      owner: "session-init-budget",
      generation: claim.result.claimGeneration,
      objective: "Bound interrupted evaluation retries.",
      protocol: protocol(artifacts)
    });

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-crash-1" });
    const crash = () => makeController(evaluation(), {
      async evaluate() {
        throw new Error("simulated evaluator crash");
      }
    });

    await assert.rejects(
      () => crash().evaluateAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-crash-1",
        generation: claim.result.claimGeneration,
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION }
      }),
      /simulated evaluator crash/
    );
    await assert.rejects(
      () => crash().recoverEvaluationAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-crash-2",
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
        reason: "first evaluator crashed"
      }),
      /simulated evaluator crash/
    );
    await assert.rejects(
      () => makeController().recoverEvaluationAndCheckpoint({
        itemId: ITEM_ID,
        owner: "session-budget-exhausted",
        currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: POLICY_REVISION },
        reason: "second evaluator crashed"
      }),
      /recovery budget exhausted/
    );

    const item = (await makeOrchestrator().readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.BLOCKED);
    assert.match(item.blockers[0], /^SELF_UPGRADE_EVALUATION_ATTEMPT:2:/);
  });
});
