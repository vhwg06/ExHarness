import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExecutionAttemptStatus,
  createDomainExecutionArtifactRegistry,
  createDomainExecutionPolicyPublisher,
  defineExecutionStrategyDescriptor,
  executionAttemptSubjectKey,
  executionPolicySubjectKey
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore, createJsonExecutionAttemptStore } from "../src/domain-execution-store.js";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { digestValue } from "../../core-harness/src/index.js";
const POLICY_DIGEST = digestValue({ policy: "how-eval-policy" });
const SCENARIO_DIGEST = digestValue({ scenarios: "how-eval-cases" });
const METRIC_DIGEST = digestValue({ metric: "how-eval-metric" });
const EVIDENCE_DIGEST = digestValue({ evidence: "how-eval-snapshot" });

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

function passingProtocol(overrides = {}) {
  return {
    kind: "HOW_EVOLUTION_EVALUATION_PROTOCOL",
    version: 1,
    id: "how-eval-1",
    domain: "BUSINESS_ANALYSIS",
    workloadType: "requirements-analysis",
    workContract: { ref: `work-contract:sha256:${SHA_A}`, digest: `sha256:${SHA_A}` },
    acceptanceRefs: [{ ref: `acceptance-policy:sha256:${SHA_B}`, digest: `sha256:${SHA_B}` }],
    finding: { ref: `how-evolution-finding:sha256:${SHA_C}`, digest: `sha256:${SHA_C}` },
    baselineStrategy: { ref: `execution-strategy-descriptor:sha256:${SHA_D}`, digest: `sha256:${SHA_D}` },
    candidateStrategy: { ref: `execution-strategy-descriptor:sha256:${SHA_E}`, digest: `sha256:${SHA_E}` },
    candidateProducer: "candidate-builder",
    evaluator: {
      identity: "independent-evaluator",
      revision: "2",
      policyRef: "policy:how-evaluation",
      policyRevision: "3",
      policyDigest: POLICY_DIGEST,
      modelSnapshot: "jev-1.13.0"
    },
    promotionAuthority: "promotion-authority",
    scenarioSet: {
      ref: "scenario-set:how-eval",
      version: "1",
      digest: SCENARIO_DIGEST,
      trigger: ["trigger-1"],
      regression: ["regression-critical", "regression-recovery"],
      holdout: ["holdout-1", "holdout-2"],
      holdoutOwner: "independent-evaluator"
    },
    metricPolicy: {
      ref: "metric-policy:how-eval",
      digest: METRIC_DIGEST,
      minEffect: 0.05,
      primaryMetric: "primary-score",
      criticalCaseIds: ["regression-critical"],
      recoveryCaseIds: ["regression-recovery"]
    },
    replay: { repeatCount: 1, seedPolicy: "fixed-seed", deterministic: true },
    evidenceSnapshot: {
      ref: "evidence-snapshot:how-eval",
      digest: EVIDENCE_DIGEST,
      evidenceRefs: ["evidence:causal-1", "evidence:runtime-1"]
    },
    expectedPolicyHead: {
      subjectKey: "domain-execution-policy:baseline",
      revision: "rev-1",
      generation: 1,
      policyRef: `execution-policy:sha256:${SHA_F}`
    },
    ...overrides
  };
}

function runFor(protocol, side, metrics, overrides = {}) {
  const strategy = side === "BASELINE" ? protocol.baselineStrategy : protocol.candidateStrategy;
  return {
    kind: "HOW_EVOLUTION_EVALUATION_RUN",
    version: 1,
    runId: `${side.toLowerCase()}-run-1`,
    protocolRef: "how-evolution-protocol:sha256:" + "0".repeat(64),
    protocolDigest: digestValue(protocol),
    side,
    strategyRef: strategy.ref,
    strategyDigest: strategy.digest,
    workContractRef: protocol.workContract.ref,
    caseResults: [
      { caseId: "trigger-1", status: "PASS", primaryMetric: metrics.trigger ?? 0.8, evidenceRefs: ["evidence:trigger-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "regression-critical", status: "PASS", primaryMetric: metrics.critical ?? 0.9, evidenceRefs: ["evidence:critical-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "regression-recovery", status: "PASS", primaryMetric: metrics.recovery ?? 0.7, evidenceRefs: ["evidence:recovery-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "holdout-1", status: "PASS", primaryMetric: metrics.holdout1 ?? 0.8, evidenceRefs: ["evidence:holdout-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "holdout-2", status: "PASS", primaryMetric: metrics.holdout2 ?? 0.8, evidenceRefs: ["evidence:holdout-2"], policyCompliant: true, evidenceComplete: true, recoveryOk: true }
    ],
    ...overrides
  };
}

function jevReceiptFor(protocol, verdict = "PASS") {
  return {
    kind: "HOW_EVOLUTION_JEV_RECEIPT",
    version: 1,
    protocolDigest: digestValue(protocol),
    evaluatorIdentity: protocol.evaluator.identity,
    evaluatorRevision: protocol.evaluator.revision,
    evaluatorPolicyRef: protocol.evaluator.policyRef,
    evaluatorPolicyDigest: protocol.evaluator.policyDigest,
    modelSnapshot: "jev-1.13.0",
    semanticVerdict: verdict,
    requestHash: "request-hash-1",
    responseHash: "response-hash-1",
    questionOutcomes: [
      { questionId: "semantic-preservation", outcome: verdict },
      { questionId: "how-improvement", outcome: verdict },
      { questionId: "evidence-sufficiency", outcome: verdict }
    ],
    evidenceRefs: ["evidence:causal-1", "evidence:runtime-1"]
  };
}
import {
  createHowEvolutionPromotionProposal,
  defineHowEvolutionEvaluationProtocol,
  evaluateHowEvolution,
  publishHowEvolutionPromotion
} from "../src/how-evolution.js";

const SHA_RUNTIME = "7".repeat(64);
function freshReaders(protocol) {
  return {
    resolveCurrentSemantic: async () => ({
      workContractDigest: protocol.workContract.digest,
      acceptanceDigests: protocol.acceptanceRefs.map((entry) => entry.digest)
    }),
    resolveCurrentEvaluator: async () => ({
      policyDigest: protocol.evaluator.policyDigest,
      modelSnapshot: protocol.evaluator.modelSnapshot
    }),
    resolveCurrentScenarioSet: async () => ({ digest: protocol.scenarioSet.digest }),
    resolveCurrentEvidence: async () => ({ digest: protocol.evidenceSnapshot.digest })
  };
}

async function pinningFixture() {
  const dir = await mkdtemp(join(tmpdir(), "exharness-howpin-"));
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const artifactRegistry = createDomainExecutionArtifactRegistry({ store: immutable });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  const attemptStore = createJsonExecutionAttemptStore({ path: join(dir, "attempt-heads.json") });
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baselineStrategy = defineExecutionStrategyDescriptor({
    strategyId: "how.baseline",
    strategyVersion: "1.0.0",
    strategyKind: "application-core-loop",
    compatibleWorkloadTypes: [protocol.workloadType],
    compatibleWorkContractVersions: [1],
    adapterRef: "adapter:how-loop@1",
    runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: `git:sha256:${SHA_RUNTIME}`,
    contextRefs: ["context:how-v1"]
  });
  const candidateStrategy = defineExecutionStrategyDescriptor({ ...baselineStrategy, strategyId: "how.candidate", strategyVersion: "1.1.0" });
  const baselineRef = await artifactRegistry.putExecutionStrategyDescriptor(baselineStrategy);
  const candidateRef = await artifactRegistry.putExecutionStrategyDescriptor(candidateStrategy);
  const key = executionPolicySubjectKey(protocol.domain, protocol.workloadType);
  const policyPublisher = createDomainExecutionPolicyPublisher({
    policyAuthority: {
      async verifyExecutionPolicyPublisher({ publisher }) {
        assert.equal(publisher.identity, "promotion-authority");
        return { authorityRef: "authority:domain-policy-publisher" };
      }
    },
    artifactRegistry,
    executionPolicyStore: policyStore
  });
  const baselineHead = await policyPublisher.publish({
    publisher: { identity: "promotion-authority" },
    policy: {
      policyId: key, generation: 1, domain: protocol.domain, workloadType: protocol.workloadType,
      compatibleWorkContractVersions: [1], strategyRef: baselineRef
    }
  });
  const pinned = defineHowEvolutionEvaluationProtocol({
    ...passingProtocol(),
    baselineStrategy: { ref: baselineRef, digest: `sha256:${baselineRef.slice(baselineRef.lastIndexOf(":") + 1)}` },
    candidateStrategy: { ref: candidateRef, digest: `sha256:${candidateRef.slice(candidateRef.lastIndexOf(":") + 1)}` },
    expectedPolicyHead: {
      subjectKey: key,
      revision: baselineHead.head.revision,
      generation: 1,
      policyRef: baselineHead.head.value.policyRef
    }
  });
  return { dir, artifactRegistry, policyStore, attemptStore, policyPublisher, protocol: pinned, key, baselineRef, candidateRef };
}

test("AC-5: ACTIVE attempt retains its original ExecutionAttemptBinding across promotion", async () => {
  const f = await pinningFixture();
  try {
    const attemptKey = executionAttemptSubjectKey({
      projectId: "project-1",
      itemId: "WORK-1",
      workContractRef: f.protocol.workContract.ref
    });
    const binding = {
      kind: "EXECUTION_ATTEMPT_BINDING",
      version: 1,
      executionAttemptId: "execution-attempt-1",
      workId: "WORK-1",
      owningDomain: f.protocol.domain,
      workloadType: f.protocol.workloadType,
      workContractRef: f.protocol.workContract.ref,
      claimReleaseReceiptRef: "claim-release-receipt:1",
      observedClaimReleaseHead: { subjectKey: "claim-release:1", revision: "rev-1", receiptRef: "claim-release-receipt:1" },
      executionPolicyRef: f.protocol.expectedPolicyHead.policyRef,
      observedExecutionPolicyHead: {
        subjectKey: f.key,
        revision: f.protocol.expectedPolicyHead.revision,
        generation: 1,
        policyRef: f.protocol.expectedPolicyHead.policyRef
      },
      executionStrategyRef: f.baselineRef,
      runtimeBinding: {
        kind: "application-core-loop",
        adapterRef: "adapter:how-loop@1",
        expectedRuntimeCodeRef: `git:sha256:${SHA_RUNTIME}`,
        runtimeInvocationKey: "execution-invocation:1",
        bindingMode: "IMMUTABLE_LOCAL"
      },
      contextRefs: ["context:how-v1"],
      toolsetRef: null,
      modelProfileRef: null,
      harnessRef: null
    };
    const bindingRef = await f.artifactRegistry.putExecutionAttemptBinding(binding);
    await f.attemptStore.compareAndSwap(attemptKey, null, {
      status: ExecutionAttemptStatus.ACTIVE,
      executionAttemptId: binding.executionAttemptId,
      bindingRef,
      transitionRefs: [],
      outcomeRef: null,
      completionDecisionRef: null,
      publicationReceiptRef: null,
      judgmentBundleRef: null
    });

    const evaluation = evaluateHowEvolution({
      protocol: f.protocol,
      baselineRun: runFor(f.protocol, "BASELINE", {}),
      candidateRun: runFor(f.protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(f.protocol, "PASS")
    });
    const proposal = createHowEvolutionPromotionProposal({ protocol: f.protocol, evaluation });
    await publishHowEvolutionPromotion({
      protocol: f.protocol,
      evaluation,
      proposal,
      publisher: { identity: "promotion-authority" },
      policyPublisher: f.policyPublisher,
      artifactRegistry: f.artifactRegistry,
      executionPolicyStore: f.policyStore,
      currentness: freshReaders(f.protocol)
    });

    // The old ACTIVE attempt still binds the old strategy/policy.
    const head = await f.attemptStore.current(attemptKey);
    assert.equal(head.value.status, ExecutionAttemptStatus.ACTIVE);
    assert.equal(head.value.bindingRef, bindingRef);
    const rebound = await f.artifactRegistry.resolveExecutionAttemptBinding(head.value.bindingRef);
    assert.equal(rebound.executionStrategyRef, f.baselineRef);
    assert.equal(rebound.executionPolicyRef, f.protocol.expectedPolicyHead.policyRef);

    // A new attempt subject resolves the promoted head.
    const policyHead = await f.policyStore.current(f.key);
    assert.equal(policyHead.value.generation, 2);
    const promotedPolicy = await f.artifactRegistry.resolveExecutionPolicy(policyHead.value.policyRef);
    assert.equal(promotedPolicy.strategyRef, f.candidateRef);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-5 negative: promotion never rebinds a RECOVERY_REQUIRED attempt", async () => {
  const f = await pinningFixture();
  try {
    const attemptKey = executionAttemptSubjectKey({
      projectId: "project-1",
      itemId: "WORK-2",
      workContractRef: f.protocol.workContract.ref
    });
    const binding = {
      kind: "EXECUTION_ATTEMPT_BINDING",
      version: 1,
      executionAttemptId: "execution-attempt-2",
      workId: "WORK-2",
      owningDomain: f.protocol.domain,
      workloadType: f.protocol.workloadType,
      workContractRef: f.protocol.workContract.ref,
      claimReleaseReceiptRef: "claim-release-receipt:2",
      observedClaimReleaseHead: { subjectKey: "claim-release:2", revision: "rev-2", receiptRef: "claim-release-receipt:2" },
      executionPolicyRef: f.protocol.expectedPolicyHead.policyRef,
      observedExecutionPolicyHead: {
        subjectKey: f.key,
        revision: f.protocol.expectedPolicyHead.revision,
        generation: 1,
        policyRef: f.protocol.expectedPolicyHead.policyRef
      },
      executionStrategyRef: f.baselineRef,
      runtimeBinding: {
        kind: "application-core-loop",
        adapterRef: "adapter:how-loop@1",
        expectedRuntimeCodeRef: `git:sha256:${SHA_RUNTIME}`,
        runtimeInvocationKey: "execution-invocation:2",
        bindingMode: "IMMUTABLE_LOCAL"
      },
      contextRefs: ["context:how-v1"],
      toolsetRef: null,
      modelProfileRef: null,
      harnessRef: null
    };
    const bindingRef = await f.artifactRegistry.putExecutionAttemptBinding(binding);
    await f.attemptStore.compareAndSwap(attemptKey, null, {
      status: ExecutionAttemptStatus.RECOVERY_REQUIRED,
      executionAttemptId: binding.executionAttemptId,
      bindingRef,
      transitionRefs: [],
      outcomeRef: null,
      completionDecisionRef: null,
      publicationReceiptRef: null,
      judgmentBundleRef: null
    });

    const evaluation = evaluateHowEvolution({
      protocol: f.protocol,
      baselineRun: runFor(f.protocol, "BASELINE", {}),
      candidateRun: runFor(f.protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(f.protocol, "PASS")
    });
    const proposal = createHowEvolutionPromotionProposal({ protocol: f.protocol, evaluation });
    await publishHowEvolutionPromotion({
      protocol: f.protocol,
      evaluation,
      proposal,
      publisher: { identity: "promotion-authority" },
      policyPublisher: f.policyPublisher,
      artifactRegistry: f.artifactRegistry,
      executionPolicyStore: f.policyStore,
      currentness: freshReaders(f.protocol)
    });

    const head = await f.attemptStore.current(attemptKey);
    assert.equal(head.value.status, ExecutionAttemptStatus.RECOVERY_REQUIRED);
    assert.equal(head.value.bindingRef, bindingRef);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
