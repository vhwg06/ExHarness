import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../../core-harness/src/index.js";
import {
  HOW_EVOLUTION_JEV_ADAPTER_IDENTITY,
  HOW_EVOLUTION_JEV_MODEL_SNAPSHOT,
  HOW_EVOLUTION_JEV_PROVIDER_ENDPOINT_CLASS,
  HOW_EVOLUTION_JEV_QUESTION_IDS,
  createHowEvolutionJevEvaluator
} from "../src/how-evolution-jev-adapter.js";
import { defineHowEvolutionEvaluationProtocol } from "../src/how-evolution.js";

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

function evidence() {
  return {
    evidenceRefs: ["evidence:causal-1", "evidence:runtime-1"],
    evidenceDigests: ["evidence:causal-1", "evidence:runtime-1"],
    producerIdentity: "causal-observer",
    environmentDigest: `sha256:${"0".repeat(64)}`
  };
}

function passTransport(expectedModel = HOW_EVOLUTION_JEV_MODEL_SNAPSHOT) {
  return async ({ request }) => ({
    model: expectedModel,
    policyRef: request.semanticPolicyRef,
    policyDigest: request.semanticPolicyDigest,
    responseId: "jev-response-1",
    outcomes: [...HOW_EVOLUTION_JEV_QUESTION_IDS].map((questionId) => ({ questionId, outcome: "PASS" }))
  });
}

test("AC-2: Jev receipt pins exact input/output/policy/evidence/freshness identity", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({ transport: passTransport() });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.kind, "HOW_EVOLUTION_JEV_RECEIPT");
  assert.equal(receipt.adapterIdentity, HOW_EVOLUTION_JEV_ADAPTER_IDENTITY);
  assert.equal(receipt.adapterRevision, "1");
  assert.equal(receipt.providerEndpointClass, HOW_EVOLUTION_JEV_PROVIDER_ENDPOINT_CLASS);
  assert.equal(receipt.modelSnapshot, HOW_EVOLUTION_JEV_MODEL_SNAPSHOT);
  assert.equal(receipt.protocolDigest, digestValue(protocol));
  assert.equal(receipt.evaluatorIdentity, protocol.evaluator.identity);
  assert.equal(receipt.evaluatorPolicyRef, protocol.evaluator.policyRef);
  assert.equal(receipt.evaluatorPolicyDigest, protocol.evaluator.policyDigest);
  assert.deepEqual(receipt.questionIds, [...HOW_EVOLUTION_JEV_QUESTION_IDS]);
  assert.equal(typeof receipt.requestHash, "string");
  assert.equal(typeof receipt.responseHash, "string");
  assert.equal(typeof receipt.responseId, "string");
  assert.equal(receipt.semanticVerdict, "PASS");
  assert.deepEqual(receipt.evidenceRefs, ["evidence:causal-1", "evidence:runtime-1"]);
});

test("AC-2 negative: transport error fails closed to INCONCLUSIVE/KEEP_BASELINE", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({
    transport: async () => { throw new Error("network down"); }
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.ok(receipt.failureReason === "TRANSPORT_ERROR");
});

test("AC-2 negative: malformed response fails closed, never coerced to PASS", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({
    transport: async () => ({ model: HOW_EVOLUTION_JEV_MODEL_SNAPSHOT, responseId: "r1", outcomes: [] })
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
});

test("AC-2 negative: unexpected model/policy fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const wrongModel = createHowEvolutionJevEvaluator({ transport: passTransport("other-model-9") });
  const receipt = await wrongModel.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");

  const wrongPolicy = createHowEvolutionJevEvaluator({
    transport: async ({ request }) => ({
      model: HOW_EVOLUTION_JEV_MODEL_SNAPSHOT,
      policyRef: "policy:someone-else",
      policyDigest: request.semanticPolicyDigest,
      responseId: "jev-response-2",
      outcomes: [...HOW_EVOLUTION_JEV_QUESTION_IDS].map((questionId) => ({ questionId, outcome: "PASS" }))
    })
  });
  const receipt2 = await wrongPolicy.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt2.semanticVerdict, "INCONCLUSIVE");
});

test("AC-2 negative: missing atomic outcome fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({
    transport: async ({ request }) => ({
      model: HOW_EVOLUTION_JEV_MODEL_SNAPSHOT,
      policyRef: request.semanticPolicyRef,
      policyDigest: request.semanticPolicyDigest,
      responseId: "jev-response-3",
      outcomes: [
        { questionId: "semantic-preservation", outcome: "PASS" },
        { questionId: "how-improvement", outcome: "PASS" }
      ]
    })
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
});

test("AC-2/AC-3 negative: adapter is evaluate-only with no product/policy mutation capability", () => {
  const evaluator = createHowEvolutionJevEvaluator({ transport: passTransport() });
  assert.equal(typeof evaluator.evaluate, "function");
  for (const forbidden of ["publish", "promote", "rollback", "mutatePolicy", "mutateProduct", "adopt", "writePolicy", "publishPolicy"]) {
    assert.equal(evaluator[forbidden], undefined, `adapter must not expose ${forbidden}`);
  }
  assert.deepEqual(Object.keys(evaluator).sort(), ["evaluate"]);
});

test("AC-2 secret boundary: TYPESAFE_API_KEY is never persisted or returned", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  process.env.TYPESAFE_API_KEY = "secret-test-key";
  try {
    const evaluator = createHowEvolutionJevEvaluator({ transport: passTransport() });
    const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
    const serialized = JSON.stringify(receipt);
    assert.ok(!serialized.includes("secret-test-key"));
  } finally {
    delete process.env.TYPESAFE_API_KEY;
  }
});
