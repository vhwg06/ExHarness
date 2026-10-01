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

function evidenceRecord(ref, body, overrides = {}) {
  return {
    ref,
    digest: digestValue(body),
    body,
    producerIdentity: "causal-observer",
    environmentDigest: `sha256:${"1".repeat(64)}`,
    ...overrides
  };
}

function evidence() {
  return {
    records: [
      evidenceRecord("evidence:causal-1", "causal finding: retry budget is the bounded HOW axis"),
      evidenceRecord("evidence:runtime-1", "runtime attestation: both paired runs completed on pinned cases")
    ]
  };
}

function systemOneResponse(choices = null, model = HOW_EVOLUTION_JEV_MODEL_SNAPSHOT) {
  const resolved = choices ?? {
    "semantic-preservation": "PASS",
    "how-improvement": "PASS",
    "evidence-sufficiency": "PASS"
  };
  const answers = {};
  for (const [questionId, choice] of Object.entries(resolved)) {
    const probabilities = { PASS: 0.1, FAIL: 0.1, INCONCLUSIVE: 0.1 };
    probabilities[choice] = 0.8;
    answers[questionId] = { type: "choice", choice, confidence: 0.8, probabilities };
  }
  return { model, answers, usage: { input_tokens: 120, output_tokens: 12 } };
}

const TRUST_OK = {
  verifyEvaluatorAuthority: async () => true,
  verifyEvidenceAuthority: async () => true
};

function passTransport(model = HOW_EVOLUTION_JEV_MODEL_SNAPSHOT) {
  return async () => systemOneResponse(null, model);
}

function evaluatorWith(transport, trust = TRUST_OK) {
  return createHowEvolutionJevEvaluator({ transport, ...trust });
}

test("AC-2: Jev receipt pins exact input/output/policy/evidence/freshness identity", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = evaluatorWith(passTransport());
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
  assert.equal(receipt.responseModel, HOW_EVOLUTION_JEV_MODEL_SNAPSHOT);
  assert.deepEqual(receipt.usage, { inputTokens: 120, outputTokens: 12 });
  assert.equal(receipt.semanticVerdict, "PASS");
  assert.deepEqual(receipt.evidenceRefs, ["evidence:causal-1", "evidence:runtime-1"]);
});

test("AC-2: mock-fetch endpoint integration uses the exact SystemOne {model,state,questions} schema", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const seen = {};
  const fetchImpl = async (url, options) => {
    seen.url = url;
    seen.payload = JSON.parse(options.body);
    seen.auth = options.headers.Authorization;
    return { ok: true, async json() { return systemOneResponse(); } };
  };
  const evaluator = createHowEvolutionJevEvaluator({ fetchImpl, ...TRUST_OK });
  process.env.TYPESAFE_API_KEY = "test-key-not-real";
  let receipt;
  try {
    receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  } finally {
    delete process.env.TYPESAFE_API_KEY;
  }
  assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen.auth, "Bearer test-key-not-real");
  assert.equal(seen.payload.model, HOW_EVOLUTION_JEV_MODEL_SNAPSHOT);
  assert.ok(seen.payload.state && typeof seen.payload.state === "object");
  // Exact owner controller wire schema: questions is an OBJECT keyed by
  // question ID ({[id]: {type: 'choice', instructions, criteria}}), not an array.
  assert.ok(seen.payload.questions && typeof seen.payload.questions === "object" && !Array.isArray(seen.payload.questions));
  assert.deepEqual(Object.keys(seen.payload.questions).sort(), [...HOW_EVOLUTION_JEV_QUESTION_IDS].sort());
  for (const questionId of HOW_EVOLUTION_JEV_QUESTION_IDS) {
    const question = seen.payload.questions[questionId];
    assert.equal(question.type, "choice");
    assert.ok(typeof question.instructions === "string" && question.instructions.length > 0);
    assert.deepEqual(Object.keys(question.criteria).sort(), ["FAIL", "INCONCLUSIVE", "PASS"]);
  }
  // The evaluator receives exact bounded hash-bound evidence bodies, not opaque refs.
  assert.equal(seen.payload.state.subject.protocolDigest, digestValue(protocol));
  assert.equal(seen.payload.state.subject.workContractRef, protocol.workContract.ref);
  assert.deepEqual(seen.payload.state.scenarioSet.trigger, ["trigger-1"]);
  assert.deepEqual(seen.payload.state.metricPolicy.criticalCaseIds, ["regression-critical"]);
  assert.equal(seen.payload.state.evidence.length, 2);
  for (const record of seen.payload.state.evidence) {
    assert.ok(typeof record.body === "string" && record.body.length > 0);
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(record.digest));
    assert.equal(typeof record.producerIdentity, "string");
  }
  assert.equal(receipt.semanticVerdict, "PASS");
  assert.equal(receipt.responseModel, HOW_EVOLUTION_JEV_MODEL_SNAPSHOT);
});

test("AC-2 negative: transport error fails closed to INCONCLUSIVE/KEEP_BASELINE", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = evaluatorWith(async () => { throw new Error("network down"); });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.ok(receipt.failureReason === "TRANSPORT_ERROR");
});

test("AC-2 negative: malformed typed Choice response fails closed, never coerced to PASS", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const badProbabilities = systemOneResponse();
  badProbabilities.answers["semantic-preservation"].probabilities = { PASS: 0.5, FAIL: 0.5, INCONCLUSIVE: 0.5 };
  const evaluator = evaluatorWith(async () => badProbabilities);
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.equal(receipt.failureReason, "MALFORMED_RESPONSE");
});

test("AC-2 negative: unexpected model fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = evaluatorWith(passTransport("other-model-9"));
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
});

test("AC-2 negative: missing atomic outcome fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const partial = systemOneResponse();
  delete partial.answers["evidence-sufficiency"];
  const evaluator = evaluatorWith(async () => partial);
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
});

test("AC-2 negative: missing authority verifiers fail closed without contacting the model", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  let calls = 0;
  const evaluator = createHowEvolutionJevEvaluator({
    transport: async () => { calls += 1; return systemOneResponse(); }
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.equal(receipt.failureReason, "AUTHORITY_VERIFIER_MISSING");
  assert.equal(calls, 0);
});

test("AC-2 negative: false evaluator authority fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({
    transport: passTransport(),
    verifyEvaluatorAuthority: async () => false,
    verifyEvidenceAuthority: async () => true
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.equal(receipt.failureReason, "AUTHORITY_FAILURE");
});

test("AC-2 negative: false evidence authority fails closed", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const evaluator = createHowEvolutionJevEvaluator({
    transport: passTransport(),
    verifyEvaluatorAuthority: async () => true,
    verifyEvidenceAuthority: async () => false
  });
  const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
  assert.equal(receipt.semanticVerdict, "INCONCLUSIVE");
  assert.equal(receipt.failureReason, "AUTHORITY_FAILURE");
});

test("AC-2 negative: fabricated evidence identities are INCONCLUSIVE, never invented", async () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const noProducer = evidence();
  delete noProducer.records[0].producerIdentity;
  const receipt1 = await evaluatorWith(passTransport()).evaluate({ protocol, evidence: noProducer });
  assert.equal(receipt1.semanticVerdict, "INCONCLUSIVE");

  const noEnvironment = evidence();
  delete noEnvironment.records[1].environmentDigest;
  const receipt2 = await evaluatorWith(passTransport()).evaluate({ protocol, evidence: noEnvironment });
  assert.equal(receipt2.semanticVerdict, "INCONCLUSIVE");

  const tampered = evidence();
  tampered.records[0].body = "rewritten evidence with the old digest";
  const receipt3 = await evaluatorWith(passTransport()).evaluate({ protocol, evidence: tampered });
  assert.equal(receipt3.semanticVerdict, "INCONCLUSIVE");

  const incomplete = { records: [evidence().records[0]] };
  const receipt4 = await evaluatorWith(passTransport()).evaluate({ protocol, evidence: incomplete });
  assert.equal(receipt4.semanticVerdict, "INCONCLUSIVE");
  assert.equal(receipt4.failureReason, "EVIDENCE_INCOMPLETE");
});

test("AC-2/AC-3 negative: adapter is evaluate-only with no product/policy mutation capability", () => {
  const evaluator = evaluatorWith(passTransport());
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
    const evaluator = evaluatorWith(passTransport());
    const receipt = await evaluator.evaluate({ protocol, evidence: evidence() });
    const serialized = JSON.stringify(receipt);
    assert.ok(!serialized.includes("secret-test-key"));
  } finally {
    delete process.env.TYPESAFE_API_KEY;
  }
});
