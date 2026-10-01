import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { digestValue } from "../../core-harness/src/index.js";
import {
  createDomainExecutionArtifactRegistry,
  createDomainExecutionPolicyPublisher,
  createJsonClaimReleaseStore,
  defineExecutionStrategyDescriptor,
  executionPolicySubjectKey
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../src/domain-execution-store.js";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
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
      { caseId: "trigger-1", status: "PASS", primaryMetric: metrics.trigger ?? 0.8, evidenceRefs: ["evidence:trigger-1"] },
      { caseId: "regression-critical", status: "PASS", primaryMetric: metrics.critical ?? 0.9, evidenceRefs: ["evidence:critical-1"] },
      { caseId: "regression-recovery", status: "PASS", primaryMetric: metrics.recovery ?? 0.7, evidenceRefs: ["evidence:recovery-1"] },
      { caseId: "holdout-1", status: "PASS", primaryMetric: metrics.holdout1 ?? 0.8, evidenceRefs: ["evidence:holdout-1"] },
      { caseId: "holdout-2", status: "PASS", primaryMetric: metrics.holdout2 ?? 0.8, evidenceRefs: ["evidence:holdout-2"] }
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
    evidenceRefs: ["evidence:causal-1"]
  };
}
import {
  HowEvolutionDisposition,
  createHowEvolutionPromotionProposal,
  defineHowEvolutionEvaluationProtocol,
  evaluateHowEvolution,
  publishHowEvolutionPromotion
} from "../src/how-evolution.js";

const SHA_RUNTIME = "9".repeat(64);

async function promotionFixture() {
  const dir = await mkdtemp(join(tmpdir(), "exharness-howpromo-"));
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const artifactRegistry = createDomainExecutionArtifactRegistry({ store: immutable });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  void createJsonClaimReleaseStore;
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
  const candidateStrategy = defineExecutionStrategyDescriptor({
    ...baselineStrategy,
    strategyId: "how.candidate",
    strategyVersion: "1.1.0"
  });
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
      policyId: key,
      generation: 1,
      domain: protocol.domain,
      workloadType: protocol.workloadType,
      compatibleWorkContractVersions: [1],
      strategyRef: baselineRef
    }
  });
  return { dir, immutable, artifactRegistry, policyStore, policyPublisher, protocol, baselineRef, candidateRef, baselineHead, key };
}

function protocolWithRefs(protocol, baselineRef, candidateRef, head) {
  return defineHowEvolutionEvaluationProtocol({
    ...passingProtocol(),
    baselineStrategy: { ref: baselineRef, digest: `sha256:${baselineRef.slice(baselineRef.lastIndexOf(":") + 1)}` },
    candidateStrategy: { ref: candidateRef, digest: `sha256:${candidateRef.slice(candidateRef.lastIndexOf(":") + 1)}` },
    expectedPolicyHead: {
      subjectKey: head.head.subjectKey ?? head.subjectKey ?? protocol.expectedPolicyHead.subjectKey,
      revision: head.head.revision,
      generation: head.head.value.generation,
      policyRef: head.head.value.policyRef
    }
  });
}

test("AC-5: accepted promotion creates a new immutable policy generation for new attempts", async () => {
  const fixture = promotionFixture();
  const f = await fixture;
  try {
    const protocol = protocolWithRefs(f.protocol, f.baselineRef, f.candidateRef, f.baselineHead);
    const evaluation = evaluateHowEvolution({
      protocol,
      baselineRun: runFor(protocol, "BASELINE", {}),
      candidateRun: runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(protocol, "PASS")
    });
    assert.equal(evaluation.disposition, HowEvolutionDisposition.PROPOSE_FOR_PROMOTION);
    // Evaluation alone is proposal-only: the head is unchanged.
    const before = await f.policyStore.current(f.key);
    assert.equal(before.value.generation, 1);
    const proposal = createHowEvolutionPromotionProposal({ protocol, evaluation });
    const { published, decision } = await publishHowEvolutionPromotion({
      protocol,
      evaluation,
      proposal,
      publisher: { identity: "promotion-authority" },
      policyPublisher: f.policyPublisher,
      artifactRegistry: f.artifactRegistry,
      executionPolicyStore: f.policyStore
    });
    assert.equal(published.policy.generation, 2);
    assert.equal(published.policy.strategyRef, f.candidateRef);
    assert.equal(decision.toGeneration, 2);
    const after = await f.policyStore.current(f.key);
    assert.equal(after.value.generation, 2);
    assert.equal(after.value.policyRef, published.policyRef);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-3 negative: Jev PASS alone cannot mutate policy currentness", async () => {
  const f = await promotionFixture();
  try {
    const protocol = protocolWithRefs(f.protocol, f.baselineRef, f.candidateRef, f.baselineHead);
    evaluateHowEvolution({
      protocol,
      baselineRun: runFor(protocol, "BASELINE", {}),
      candidateRun: runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(protocol, "PASS")
    });
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
    assert.equal(head.value.policyRef, f.baselineHead.policyRef);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-3 negative: candidate producer cannot evaluate-promote its own candidate", async () => {
  const f = await promotionFixture();
  try {
    const protocol = protocolWithRefs(f.protocol, f.baselineRef, f.candidateRef, f.baselineHead);
    const evaluation = evaluateHowEvolution({
      protocol,
      baselineRun: runFor(protocol, "BASELINE", {}),
      candidateRun: runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(protocol, "PASS")
    });
    const proposal = createHowEvolutionPromotionProposal({ protocol, evaluation });
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol,
        evaluation,
        proposal,
        publisher: { identity: "candidate-builder" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore
      }),
      /authority mismatch|promotion authority|not the protocol promotion authority/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-3 negative: evaluator cannot promote the candidate it judged", async () => {
  const f = await promotionFixture();
  try {
    const protocol = protocolWithRefs(f.protocol, f.baselineRef, f.candidateRef, f.baselineHead);
    const evaluation = evaluateHowEvolution({
      protocol,
      baselineRun: runFor(protocol, "BASELINE", {}),
      candidateRun: runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(protocol, "PASS")
    });
    const proposal = createHowEvolutionPromotionProposal({ protocol, evaluation });
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol,
        evaluation,
        proposal,
        publisher: { identity: "independent-evaluator" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore
      }),
      /authority mismatch|promotion authority|evaluator cannot promote/
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-3 negative: Jev adapter object has no promotion path", async () => {
  const { createHowEvolutionJevEvaluator } = await import("../src/how-evolution-jev-adapter.js");
  const adapter = createHowEvolutionJevEvaluator({ transport: async () => { throw new Error("no live Jev"); } });
  assert.equal(typeof adapter.publish, "undefined");
  assert.equal(typeof adapter.promote, "undefined");
  void digestValue;
});
