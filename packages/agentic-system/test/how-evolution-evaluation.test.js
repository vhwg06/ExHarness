import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../../core-harness/src/index.js";
import {
  HowEvolutionDisposition,
  HowEvolutionVerdict,
  createHowEvolutionPromotionProposal,
  createInMemoryHowEvolutionArtifactStore,
  defineHowEvolutionEvaluationProtocol,
  defineHowEvolutionEvaluationRun,
  defineHowEvolutionFinding,
  evaluateHowEvolution,
  resolveHowEvolutionProvenance
} from "../src/how-evolution.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

const POLICY_DIGEST = digestValue({ policy: "how-eval-policy" });
const SCENARIO_DIGEST = digestValue({ scenarios: "how-eval-cases" });
const METRIC_DIGEST = digestValue({ metric: "how-eval-metric" });
const EVIDENCE_DIGEST = digestValue({ evidence: "how-eval-snapshot" });

export function passingProtocol(overrides = {}) {
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

export function runFor(protocol, side, metrics, overrides = {}) {
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

export function jevReceiptFor(protocol, verdict = "PASS") {
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

test("AC-1: pinned protocol compares baseline vs candidate for one fixed semantic subject", () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baseline = defineHowEvolutionEvaluationRun(runFor(protocol, "BASELINE", {}), protocol);
  const candidate = defineHowEvolutionEvaluationRun(
    runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
    protocol
  );
  const result = evaluateHowEvolution({
    protocol,
    baselineRun: baseline,
    candidateRun: candidate,
    jevReceipt: jevReceiptFor(protocol, "PASS")
  });
  assert.equal(result.verdict, HowEvolutionVerdict.PASS);
  assert.equal(result.disposition, HowEvolutionDisposition.PROPOSE_FOR_PROMOTION);
  assert.equal(result.workContractRef, protocol.workContract.ref);
  assert.equal(result.protocolDigest, digestValue(protocol));
  assert.ok(result.pairedDeltas.length === 5);
  const holdout = result.pairedDeltas.filter((entry) => entry.partition === "holdout");
  assert.equal(holdout.length, 2);
  const proposal = createHowEvolutionPromotionProposal({ protocol, evaluation: result });
  assert.equal(proposal.proposedStrategyRef, protocol.candidateStrategy.ref);
  assert.equal(proposal.expectedPolicyHead.policyRef, protocol.expectedPolicyHead.policyRef);
});

test("AC-1 negative: candidate changes WHAT/WorkContract/acceptance", () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baseline = runFor(protocol, "BASELINE", {});
  const candidate = {
    ...runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
    workContractRef: `work-contract:sha256:${SHA_F}`
  };
  assert.throws(
    () => evaluateHowEvolution({ protocol, baselineRun: baseline, candidateRun: candidate, jevReceipt: jevReceiptFor(protocol) }),
    /fixed WHAT/
  );
});

test("AC-1/AC-4 negative: A/B case-set identity differs", () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baseline = runFor(protocol, "BASELINE", {});
  const candidate = runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 });
  candidate.caseResults = candidate.caseResults.filter((entry) => entry.caseId !== "holdout-2");
  assert.throws(
    () => defineHowEvolutionEvaluationRun(candidate, protocol),
    /case membership changed/
  );
  void baseline;
});

test("AC-3 negative: producer equals evaluator or promoter", () => {
  assert.throws(
    () => defineHowEvolutionEvaluationProtocol(passingProtocol({ candidateProducer: "independent-evaluator" })),
    /evaluator must differ from candidate producer/
  );
  assert.throws(
    () => defineHowEvolutionEvaluationProtocol(passingProtocol({ promotionAuthority: "candidate-builder" })),
    /candidate producer must differ from promotion authority/
  );
  assert.throws(
    () => defineHowEvolutionEvaluationProtocol(passingProtocol({ promotionAuthority: "independent-evaluator" })),
    /evaluator must differ from promotion authority/
  );
});

test("AC-4 negative: aggregate gain cannot hide a new critical-case failure", () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baseline = runFor(protocol, "BASELINE", {});
  const candidate = runFor(protocol, "CANDIDATE", { holdout1: 0.95, holdout2: 0.95 });
  const critical = candidate.caseResults.find((entry) => entry.caseId === "regression-critical");
  critical.status = "FAIL";
  const result = evaluateHowEvolution({
    protocol,
    baselineRun: baseline,
    candidateRun: candidate,
    jevReceipt: jevReceiptFor(protocol, "PASS")
  });
  assert.equal(result.verdict, HowEvolutionVerdict.FAIL);
  assert.equal(result.disposition, HowEvolutionDisposition.KEEP_BASELINE);
  assert.ok(result.reasons.some((reason) => reason.includes("critical-regression")));
});

test("AC-4 negative: missing case measurement is INCONCLUSIVE, never coerced to PASS", () => {
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const strict = defineHowEvolutionEvaluationProtocol({
    ...passingProtocol(),
    replay: { repeatCount: 3, seedPolicy: "fixed-seed", deterministic: false }
  });
  const baseline = runFor(strict, "BASELINE", {});
  const candidate = runFor(strict, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 });
  const holdout = candidate.caseResults.find((entry) => entry.caseId === "holdout-1");
  delete holdout.primaryMetric;
  const result = evaluateHowEvolution({
    protocol: strict,
    baselineRun: baseline,
    candidateRun: candidate,
    jevReceipt: jevReceiptFor(strict, "PASS")
  });
  assert.equal(result.verdict, HowEvolutionVerdict.INCONCLUSIVE);
  assert.equal(result.disposition, HowEvolutionDisposition.KEEP_BASELINE);
  void baseline;
  void protocol;
});

test("finding is evidence-only and grants no candidate/evaluation/promotion authority", () => {
  const finding = defineHowEvolutionFinding({
    kind: "HOW_EVOLUTION_FINDING",
    version: 1,
    id: "finding-1",
    causalSubjectRef: "causal-observation-subject:1",
    causalSubjectDigest: digestValue("causal-observation-subject:1"),
    causalProjectionRef: "causal-projection:1",
    domain: "BUSINESS_ANALYSIS",
    workloadType: "requirements-analysis",
    baselinePolicyRef: "execution-policy:1",
    baselineStrategyRef: "execution-strategy-descriptor:1",
    howAxis: "retry-budget",
    findingProducer: "causal-observer",
    evidenceRefs: ["evidence:causal-1"]
  });
  assert.equal(finding.grants.candidateAuthority, false);
  assert.equal(finding.grants.promotionAuthority, false);
  assert.equal(finding.grants.productAcceptanceAuthority, false);
});

test("AC-8: fresh process reconstructs finding to policy head from durable refs", async () => {
  const store = createInMemoryHowEvolutionArtifactStore();
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baseline = defineHowEvolutionEvaluationRun(runFor(protocol, "BASELINE", {}), protocol);
  const candidate = defineHowEvolutionEvaluationRun(runFor(protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }), protocol);
  const result = evaluateHowEvolution({
    protocol,
    baselineRun: baseline,
    candidateRun: candidate,
    jevReceipt: jevReceiptFor(protocol, "PASS")
  });
  const proposal = createHowEvolutionPromotionProposal({ protocol, evaluation: result });
  const protocolRef = await store.put("protocol", protocol);
  const evaluationRef = await store.put("evaluation-result", result);
  const proposalRef = await store.put("promotion-proposal", proposal);
  const headStore = { async current() { return null; } };
  const provenance = await resolveHowEvolutionProvenance({
    artifactStore: store,
    executionPolicyStore: headStore,
    policySubjectKey: protocol.expectedPolicyHead.subjectKey,
    protocolRef,
    evaluationRef,
    proposalRef
  });
  assert.equal(provenance.protocolDigest, digestValue(protocol));
  assert.equal(provenance.evaluation.disposition, HowEvolutionDisposition.PROPOSE_FOR_PROMOTION);
  assert.equal(provenance.proposal.proposedStrategyRef, protocol.candidateStrategy.ref);
});
