import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDomainExecutionArtifactRegistry,
  createDomainExecutionPolicyPublisher,
  defineExecutionStrategyDescriptor,
  executionPolicySubjectKey
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../src/domain-execution-store.js";
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
  assertHowEvolutionPromotionCurrentness,
  createHowEvolutionPromotionProposal,
  defineHowEvolutionEvaluationProtocol,
  evaluateHowEvolution,
  publishHowEvolutionPromotion
} from "../src/how-evolution.js";

const SHA_RUNTIME = "8".repeat(64);

async function currentnessFixture() {
  const dir = await mkdtemp(join(tmpdir(), "exharness-howcurrent-"));
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const artifactRegistry = createDomainExecutionArtifactRegistry({ store: immutable });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
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
      generation: baselineHead.head.value.generation,
      policyRef: baselineHead.head.value.policyRef
    }
  });
  const evaluation = evaluateHowEvolution({
    protocol: pinned,
    baselineRun: runFor(pinned, "BASELINE", {}),
    candidateRun: runFor(pinned, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
    jevReceipt: jevReceiptFor(pinned, "PASS")
  });
  const proposal = createHowEvolutionPromotionProposal({ protocol: pinned, evaluation });
  return { dir, artifactRegistry, policyStore, policyPublisher, protocol: pinned, evaluation, proposal, key, baselineRef, candidateRef };
}

test("AC-4: FAIL evaluation keeps the baseline current and cannot propose", async () => {
  const f = await currentnessFixture();
  try {
    const failed = evaluateHowEvolution({
      protocol: f.protocol,
      baselineRun: runFor(f.protocol, "BASELINE", {}),
      candidateRun: (() => {
        const run = runFor(f.protocol, "CANDIDATE", { holdout1: 0.95, holdout2: 0.95 });
        run.caseResults.find((entry) => entry.caseId === "regression-critical").status = "FAIL";
        return run;
      })(),
      jevReceipt: jevReceiptFor(f.protocol, "PASS")
    });
    assert.equal(failed.disposition, "KEEP_BASELINE");
    assert.throws(() => createHowEvolutionPromotionProposal({ protocol: f.protocol, evaluation: failed }),
      /only a PASS evaluation/);
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-4: INCONCLUSIVE evaluator output keeps the baseline current", async () => {
  const f = await currentnessFixture();
  try {
    const inconclusive = evaluateHowEvolution({
      protocol: f.protocol,
      baselineRun: runFor(f.protocol, "BASELINE", {}),
      candidateRun: runFor(f.protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
      jevReceipt: jevReceiptFor(f.protocol, "INCONCLUSIVE")
    });
    assert.equal(inconclusive.disposition, "KEEP_BASELINE");
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

function freshReaders(protocol, overrides = {}) {
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
    resolveCurrentEvidence: async () => ({ digest: protocol.evidenceSnapshot.digest }),
    ...overrides
  };
}

test("AC-6 negative: semantic subject drift makes the proposal non-actionable", async () => {
  const f = await currentnessFixture();
  try {
    await assert.rejects(
      assertHowEvolutionPromotionCurrentness({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        executionPolicyStore: f.policyStore,
        ...freshReaders(f.protocol, {
          resolveCurrentSemantic: async () => ({
            workContractDigest: "sha256:" + "f".repeat(64),
            acceptanceDigests: f.protocol.acceptanceRefs.map((entry) => entry.digest)
          })
        })
      }),
      /semantic subject changed/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: evaluator policy drift makes the proposal non-actionable", async () => {
  const f = await currentnessFixture();
  try {
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        publisher: { identity: "promotion-authority" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore,
        currentness: freshReaders(f.protocol, {
          resolveCurrentEvaluator: async () => ({ policyDigest: "sha256:" + "e".repeat(64) })
        })
      }),
      /evaluator policy changed/
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: scenario-set drift makes the proposal non-actionable", async () => {
  const f = await currentnessFixture();
  try {
    await assert.rejects(
      assertHowEvolutionPromotionCurrentness({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        executionPolicyStore: f.policyStore,
        ...freshReaders(f.protocol, {
          resolveCurrentScenarioSet: async () => ({ digest: "sha256:" + "d".repeat(64) })
        })
      }),
      /scenario set changed/
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: evidence snapshot drift makes the proposal non-actionable", async () => {
  const f = await currentnessFixture();
  try {
    await assert.rejects(
      assertHowEvolutionPromotionCurrentness({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        executionPolicyStore: f.policyStore,
        ...freshReaders(f.protocol, {
          resolveCurrentEvidence: async () => ({ digest: "sha256:" + "c".repeat(64) })
        })
      }),
      /evidence snapshot changed/
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: promotion with only a head check is refused without freshness proofs", async () => {
  const f = await currentnessFixture();
  try {
    for (const omitted of ["resolveCurrentSemantic", "resolveCurrentEvaluator", "resolveCurrentScenarioSet", "resolveCurrentEvidence"]) {
      const readers = freshReaders(f.protocol);
      delete readers[omitted];
      await assert.rejects(
        publishHowEvolutionPromotion({
          protocol: f.protocol,
          evaluation: f.evaluation,
          proposal: f.proposal,
          publisher: { identity: "promotion-authority" },
          policyPublisher: f.policyPublisher,
          artifactRegistry: f.artifactRegistry,
          executionPolicyStore: f.policyStore,
          currentness: readers
        }),
        /promotion requires a .* freshness proof/
      );
    }
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        publisher: { identity: "promotion-authority" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore
      }),
      /promotion requires a .* freshness proof/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: evidence racing after evaluation fails before head mutation", async () => {
  const f = await currentnessFixture();
  try {
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        publisher: { identity: "promotion-authority" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore,
        currentness: freshReaders(f.protocol, {
          resolveCurrentEvidence: async () => ({ digest: "sha256:" + "b".repeat(64) })
        })
      }),
      /evidence snapshot changed/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 1);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-6 negative: policy head racing after evaluation fails before head mutation", async () => {
  const f = await currentnessFixture();
  try {
    // A concurrent promotion advances the head to generation 2 first.
    await f.policyPublisher.publish({
      publisher: { identity: "promotion-authority" },
      policy: {
        policyId: f.key, generation: 2, domain: f.protocol.domain, workloadType: f.protocol.workloadType,
        compatibleWorkContractVersions: [1], strategyRef: f.baselineRef
      }
    });
    await assert.rejects(
      publishHowEvolutionPromotion({
        protocol: f.protocol,
        evaluation: f.evaluation,
        proposal: f.proposal,
        publisher: { identity: "promotion-authority" },
        policyPublisher: f.policyPublisher,
        artifactRegistry: f.artifactRegistry,
        executionPolicyStore: f.policyStore,
        currentness: freshReaders(f.protocol)
      }),
      /head changed since evaluation/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 2);
    assert.equal(head.value.policyRef.includes("sha256:"), true);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
