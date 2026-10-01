// Delivery rebuild 2026-10-01: re-validated on current main.
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { promises as nodeFs } from "node:fs";

import { canonicalize, digestValue } from "../../core-harness/src/index.js";

export const HOW_EVOLUTION_FINDING_KIND = "HOW_EVOLUTION_FINDING";
export const HOW_EVOLUTION_PROTOCOL_KIND = "HOW_EVOLUTION_EVALUATION_PROTOCOL";
export const HOW_EVOLUTION_PROTOCOL_VERSION = 1;
export const HOW_EVOLUTION_RUN_KIND = "HOW_EVOLUTION_EVALUATION_RUN";
export const HOW_EVOLUTION_RESULT_KIND = "HOW_EVOLUTION_EVALUATION_RESULT";
export const HOW_EVOLUTION_PROPOSAL_KIND = "HOW_EVOLUTION_PROMOTION_PROPOSAL";
export const HOW_EVOLUTION_DECISION_KIND = "HOW_EVOLUTION_PROMOTION_DECISION";
export const HOW_EVOLUTION_ROLLBACK_KIND = "HOW_EVOLUTION_ROLLBACK_DECISION";

export const HowEvolutionVerdict = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export const HowEvolutionDisposition = Object.freeze({
  PROPOSE_FOR_PROMOTION: "PROPOSE_FOR_PROMOTION",
  KEEP_BASELINE: "KEEP_BASELINE"
});

export const HowEvolutionRunSide = Object.freeze({
  BASELINE: "BASELINE",
  CANDIDATE: "CANDIDATE"
});

export const HowEvolutionCasePartition = Object.freeze({
  TRIGGER: "trigger",
  REGRESSION: "regression",
  HOLDOUT: "holdout"
});

// Fixed semantic rubric: the Jev adapter must answer exactly these typed
// questions, no more and no fewer. Defined here so both the adapter and the
// evaluation gate pin the same set without a module cycle.
export const HOW_EVOLUTION_JEV_QUESTION_IDS = Object.freeze([
  "semantic-preservation",
  "how-improvement",
  "evidence-sufficiency"
]);

const inv = (condition, message) => {
  if (!condition) throw new TypeError(message);
};
const txt = (value, name) => {
  inv(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
};
const fr = (value) => Object.freeze(structuredClone(value));
const num = (value, name) => {
  inv(typeof value === "number" && Number.isFinite(value), `${name} must be a finite number`);
  return value;
};

function shaHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(value, name, { min = 0 } = {}) {
  inv(Array.isArray(value), `${name} must be an array`);
  const out = value.map((entry, index) => txt(entry, `${name}[${index}]`));
  inv(new Set(out).size === out.length, `${name} must not contain duplicates`);
  inv(out.length >= min, `${name} must contain at least ${min} item(s)`);
  return Object.freeze(out);
}

function pinnedRef(value, name) {
  inv(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  const ref = txt(value.ref, `${name}.ref`);
  const digest = txt(value.digest, `${name}.digest`);
  inv(/^sha256:[0-9a-f]{64}$/.test(digest), `${name}.digest must be sha256:<64hex>`);
  inv(ref.endsWith(`:${digest}`), `${name} ref must end with its digest`);
  return Object.freeze({ ref, digest });
}

function optionalPinnedRef(value, name) {
  if (value == null) return null;
  return pinnedRef(value, name);
}

// J1 — Finding: one BB-058 causal projection bound into immutable evidence-only state.
export function defineHowEvolutionFinding(raw) {
  inv(raw && typeof raw === "object" && !Array.isArray(raw), "HOW_EVOLUTION_FINDING required");
  inv(raw.kind === HOW_EVOLUTION_FINDING_KIND, "HOW_EVOLUTION_FINDING kind mismatch");
  inv(raw.version === 1, "HOW_EVOLUTION_FINDING version must be 1");
  const finding = {
    kind: HOW_EVOLUTION_FINDING_KIND,
    version: 1,
    id: txt(raw.id, "finding.id"),
    causalSubjectRef: txt(raw.causalSubjectRef, "finding.causalSubjectRef"),
    causalSubjectDigest: txt(raw.causalSubjectDigest ?? digestValue(raw.causalSubjectRef), "finding.causalSubjectDigest"),
    causalProjectionRef: txt(raw.causalProjectionRef, "finding.causalProjectionRef"),
    domain: txt(raw.domain, "finding.domain"),
    workloadType: txt(raw.workloadType, "finding.workloadType"),
    baselinePolicyRef: txt(raw.baselinePolicyRef, "finding.baselinePolicyRef"),
    baselineStrategyRef: txt(raw.baselineStrategyRef, "finding.baselineStrategyRef"),
    howAxis: txt(raw.howAxis, "finding.howAxis"),
    findingProducer: txt(raw.findingProducer, "finding.findingProducer"),
    observedAt: txt(raw.observedAt ?? "1970-01-01T00:00:00.000Z", "finding.observedAt"),
    evidenceRefs: uniqueStrings(raw.evidenceRefs ?? [], "finding.evidenceRefs", { min: 1 }),
    grants: Object.freeze({
      candidateAuthority: false,
      evaluationAuthority: false,
      promotionAuthority: false,
      rollbackAuthority: false,
      productAcceptanceAuthority: false
    })
  };
  inv(/^sha256:[0-9a-f]{64}$/.test(finding.causalSubjectDigest), "finding.causalSubjectDigest must be sha256:<64hex>");
  return fr(finding);
}

function normalizeEvaluator(raw) {
  inv(raw && typeof raw === "object", "protocol evaluator required");
  const evaluator = {
    identity: txt(raw.identity, "evaluator.identity"),
    revision: txt(raw.revision, "evaluator.revision"),
    policyRef: txt(raw.policyRef, "evaluator.policyRef"),
    policyRevision: txt(raw.policyRevision, "evaluator.policyRevision"),
    policyDigest: txt(raw.policyDigest, "evaluator.policyDigest"),
    modelSnapshot: txt(raw.modelSnapshot, "evaluator.modelSnapshot")
  };
  inv(/^sha256:[0-9a-f]{64}$/.test(evaluator.policyDigest), "evaluator.policyDigest must be sha256:<64hex>");
  return Object.freeze(evaluator);
}

function normalizeScenarioSet(raw) {
  inv(raw && typeof raw === "object", "protocol scenarioSet required");
  const trigger = uniqueStrings(raw.trigger ?? [], "scenarioSet.trigger", { min: 1 });
  const regression = uniqueStrings(raw.regression ?? [], "scenarioSet.regression", { min: 1 });
  const holdout = uniqueStrings(raw.holdout ?? [], "scenarioSet.holdout", { min: 1 });
  const all = [...trigger, ...regression, ...holdout];
  inv(new Set(all).size === all.length, "scenarioSet case ids must be unique across partitions");
  return Object.freeze({
    ref: txt(raw.ref, "scenarioSet.ref"),
    version: txt(raw.version ?? "1", "scenarioSet.version"),
    digest: txt(raw.digest, "scenarioSet.digest"),
    trigger,
    regression,
    holdout,
    holdoutOwner: txt(raw.holdoutOwner, "scenarioSet.holdoutOwner")
  });
}

function normalizeMetricPolicy(raw) {
  inv(raw && typeof raw === "object", "protocol metricPolicy required");
  const maxCost = raw.maxCostRegression == null ? null : num(raw.maxCostRegression, "metricPolicy.maxCostRegression");
  const maxTokens = raw.maxTokenRegression == null ? null : num(raw.maxTokenRegression, "metricPolicy.maxTokenRegression");
  const maxLatency = raw.maxLatencyRegressionMs == null ? null : num(raw.maxLatencyRegressionMs, "metricPolicy.maxLatencyRegressionMs");
  inv(maxCost == null || maxCost >= 0, "metricPolicy.maxCostRegression must be non-negative");
  inv(maxTokens == null || maxTokens >= 0, "metricPolicy.maxTokenRegression must be non-negative");
  inv(maxLatency == null || maxLatency >= 0, "metricPolicy.maxLatencyRegressionMs must be non-negative");
  return Object.freeze({
    ref: txt(raw.ref, "metricPolicy.ref"),
    digest: txt(raw.digest, "metricPolicy.digest"),
    minEffect: num(raw.minEffect, "metricPolicy.minEffect"),
    primaryMetric: txt(raw.primaryMetric ?? "primary-score", "metricPolicy.primaryMetric"),
    criticalCaseIds: uniqueStrings(raw.criticalCaseIds ?? [], "metricPolicy.criticalCaseIds"),
    recoveryCaseIds: uniqueStrings(raw.recoveryCaseIds ?? [], "metricPolicy.recoveryCaseIds"),
    maxCostRegression: maxCost,
    maxTokenRegression: maxTokens,
    maxLatencyRegressionMs: maxLatency
  });
}

function normalizePolicyHead(raw, name) {
  inv(raw && typeof raw === "object", `${name} required`);
  return Object.freeze({
    subjectKey: txt(raw.subjectKey, `${name}.subjectKey`),
    revision: txt(raw.revision, `${name}.revision`),
    generation: (() => {
      inv(Number.isInteger(raw.generation) && raw.generation > 0, `${name}.generation must be a positive integer`);
      return raw.generation;
    })(),
    policyRef: txt(raw.policyRef, `${name}.policyRef`)
  });
}

// J2 — Protocol: pin fixed WHAT, A/B HOW refs, actors, cases, metrics, replay/budget,
// evidence and expected policy head before evaluation.
export function defineHowEvolutionEvaluationProtocol(raw) {
  inv(raw && typeof raw === "object" && !Array.isArray(raw), "HOW_EVOLUTION_EVALUATION_PROTOCOL required");
  inv(raw.kind === HOW_EVOLUTION_PROTOCOL_KIND, "HOW_EVOLUTION_EVALUATION_PROTOCOL kind mismatch");
  inv(raw.version === HOW_EVOLUTION_PROTOCOL_VERSION, "HOW_EVOLUTION_EVALUATION_PROTOCOL version must be 1");

  const workContract = pinnedRef(raw.workContract, "protocol.workContract");
  const acceptanceRefs = (() => {
    inv(Array.isArray(raw.acceptanceRefs) && raw.acceptanceRefs.length > 0, "protocol.acceptanceRefs must be a non-empty array");
    return Object.freeze(raw.acceptanceRefs.map((entry, index) => pinnedRef(entry, `protocol.acceptanceRefs[${index}]`)));
  })();
  const finding = pinnedRef(raw.finding, "protocol.finding");
  const baselineStrategy = pinnedRef(raw.baselineStrategy, "protocol.baselineStrategy");
  const candidateStrategy = pinnedRef(raw.candidateStrategy, "protocol.candidateStrategy");
  inv(
    baselineStrategy.ref !== candidateStrategy.ref || baselineStrategy.digest !== candidateStrategy.digest,
    "protocol candidate strategy must differ from baseline strategy"
  );
  const evaluator = normalizeEvaluator(raw.evaluator);
  const candidateProducer = txt(raw.candidateProducer, "protocol.candidateProducer");
  const promotionAuthority = txt(raw.promotionAuthority, "protocol.promotionAuthority");
  inv(evaluator.identity !== candidateProducer, "protocol evaluator must differ from candidate producer");
  inv(candidateProducer !== promotionAuthority, "protocol candidate producer must differ from promotion authority");
  inv(evaluator.identity !== promotionAuthority, "protocol evaluator must differ from promotion authority");
  const scenarioSet = normalizeScenarioSet(raw.scenarioSet);
  inv(scenarioSet.holdoutOwner !== candidateProducer, "protocol holdout owner must differ from candidate producer");
  const metricPolicy = normalizeMetricPolicy(raw.metricPolicy);
  const evidenceSnapshot = (() => {
    inv(raw.evidenceSnapshot && typeof raw.evidenceSnapshot === "object", "protocol.evidenceSnapshot required");
    return Object.freeze({
      ref: txt(raw.evidenceSnapshot.ref, "evidenceSnapshot.ref"),
      digest: txt(raw.evidenceSnapshot.digest, "evidenceSnapshot.digest"),
      evidenceRefs: uniqueStrings(raw.evidenceSnapshot.evidenceRefs ?? [], "evidenceSnapshot.evidenceRefs", { min: 1 })
    });
  })();
  const replay = Object.freeze({
    repeatCount: (() => {
      const count = raw.replay?.repeatCount ?? 1;
      inv(Number.isInteger(count) && count >= 1, "replay.repeatCount must be a positive integer");
      return count;
    })(),
    seedPolicy: txt(raw.replay?.seedPolicy ?? "fixed-seed", "replay.seedPolicy"),
    deterministic: raw.replay?.deterministic !== false
  });
  if (!replay.deterministic) {
    inv(replay.repeatCount >= 3, "stochastic workloads require at least three paired repeats");
  }
  const budget = Object.freeze({
    maxCases: (() => {
      const total = scenarioSet.trigger.length + scenarioSet.regression.length + scenarioSet.holdout.length;
      const max = raw.budget?.maxCases ?? total;
      inv(Number.isInteger(max) && max === total, "protocol case budget must equal pinned case membership");
      return max;
    })(),
    evaluationAttempts: 1
  });
  const expectedPolicyHead = normalizePolicyHead(raw.expectedPolicyHead, "protocol.expectedPolicyHead");
  const baselinePolicyHead = normalizePolicyHead(raw.baselinePolicyHead ?? raw.expectedPolicyHead, "protocol.baselinePolicyHead");
  inv(
    baselinePolicyHead.subjectKey === expectedPolicyHead.subjectKey &&
      baselinePolicyHead.revision === expectedPolicyHead.revision &&
      baselinePolicyHead.generation === expectedPolicyHead.generation &&
      baselinePolicyHead.policyRef === expectedPolicyHead.policyRef,
    "protocol baseline head must equal the evaluated expected policy head"
  );

  const protocol = {
    kind: HOW_EVOLUTION_PROTOCOL_KIND,
    version: HOW_EVOLUTION_PROTOCOL_VERSION,
    id: txt(raw.id, "protocol.id"),
    domain: txt(raw.domain, "protocol.domain"),
    workloadType: txt(raw.workloadType, "protocol.workloadType"),
    workContract,
    acceptanceRefs,
    finding,
    domainScope: txt(raw.domainScope ?? `${raw.domain}/${raw.workloadType}`, "protocol.domainScope"),
    baselinePolicyHead,
    baselineStrategy,
    candidateStrategy,
    candidateProducer,
    evaluator,
    promotionAuthority,
    scenarioSet,
    metricPolicy,
    replay,
    evidenceSnapshot,
    budget,
    expectedPolicyHead,
    declaredHowAxis: txt(raw.declaredHowAxis ?? "execution-strategy", "protocol.declaredHowAxis")
  };
  return fr(protocol);
}

function casePartitionOf(protocol, caseId) {
  if (protocol.scenarioSet.trigger.includes(caseId)) return HowEvolutionCasePartition.TRIGGER;
  if (protocol.scenarioSet.regression.includes(caseId)) return HowEvolutionCasePartition.REGRESSION;
  if (protocol.scenarioSet.holdout.includes(caseId)) return HowEvolutionCasePartition.HOLDOUT;
  return null;
}

function triStateObservation(value, name) {
  if (value == null) return null;
  inv(typeof value === "boolean", `${name} must be a boolean when present`);
  return value;
}

function finiteOrNull(value, name) {
  if (value == null) return null;
  return num(value, name);
}

// Paired per-case run receipts. Baseline and candidate execute identical pinned cases.
// Hard-gate observations are tri-state: an explicit true/false is evidence; an
// absent observation is unknown and forces INCONCLUSIVE, never a pass.
// Stochastic protocols (replay.repeatCount > 1) must carry the actual paired
// repeats per case: `repeats` must contain exactly repeatCount finite samples
// whose mean equals the reported primaryMetric.
export function defineHowEvolutionEvaluationRun(raw, protocol) {
  const resolvedProtocol = defineHowEvolutionEvaluationProtocol(protocol);
  inv(raw && typeof raw === "object" && !Array.isArray(raw), "HOW_EVOLUTION_EVALUATION_RUN required");
  inv(raw.kind === HOW_EVOLUTION_RUN_KIND, "HOW_EVOLUTION_EVALUATION_RUN kind mismatch");
  inv(raw.version === 1, "HOW_EVOLUTION_EVALUATION_RUN version must be 1");
  inv(Object.values(HowEvolutionRunSide).includes(raw.side), "evaluation run side must be BASELINE or CANDIDATE");
  inv(raw.protocolDigest === digestValue(resolvedProtocol), "evaluation run protocol digest mismatch");
  const expectedStrategy = raw.side === HowEvolutionRunSide.BASELINE
    ? resolvedProtocol.baselineStrategy
    : resolvedProtocol.candidateStrategy;
  inv(
    raw.strategyRef === expectedStrategy.ref && raw.strategyDigest === expectedStrategy.digest,
    `evaluation run strategy must equal the pinned ${raw.side} strategy`
  );
  inv(Array.isArray(raw.caseResults) && raw.caseResults.length > 0, "evaluation run caseResults must be a non-empty array");
  const repeatCount = resolvedProtocol.replay.repeatCount;
  const seen = new Set();
  const results = raw.caseResults.map((entry, index) => {
    inv(entry && typeof entry === "object", `evaluation run caseResults[${index}] must be an object`);
    const caseId = txt(entry.caseId, `evaluation run caseResults[${index}].caseId`);
    inv(!seen.has(caseId), `evaluation run case id duplicated: ${caseId}`);
    seen.add(caseId);
    const partition = casePartitionOf(resolvedProtocol, caseId);
    inv(partition != null, `evaluation run case is outside the pinned scenario set: ${caseId}`);
    inv(Object.values(HowEvolutionVerdict).includes(entry.status), `evaluation run caseResults[${index}].status is invalid`);
    inv(entry.primaryMetric == null || (typeof entry.primaryMetric === "number" && Number.isFinite(entry.primaryMetric)),
      `evaluation run caseResults[${index}].primaryMetric must be a finite number when present`);
    const measurement = entry.primaryMetric == null ? null : entry.primaryMetric;
    if (repeatCount > 1) {
      inv(
        Array.isArray(entry.repeats) && entry.repeats.length === repeatCount &&
          entry.repeats.every((sample) => typeof sample === "number" && Number.isFinite(sample)),
        `evaluation run caseResults[${index}].repeats must contain exactly ${repeatCount} finite paired samples`
      );
      const mean = entry.repeats.reduce((sum, sample) => sum + sample, 0) / entry.repeats.length;
      inv(
        measurement != null && Math.abs(measurement - mean) <= 1e-9,
        `evaluation run caseResults[${index}].primaryMetric must equal the mean of its paired repeats`
      );
    } else {
      inv(entry.repeats == null, `evaluation run caseResults[${index}].repeats requires a stochastic replay budget`);
    }
    return Object.freeze({
      caseId,
      partition,
      status: entry.status,
      primaryMetric: measurement,
      repeats: entry.repeats == null ? null : Object.freeze([...entry.repeats]),
      policyCompliant: triStateObservation(entry.policyCompliant, `evaluation run caseResults[${index}].policyCompliant`),
      evidenceComplete: triStateObservation(entry.evidenceComplete, `evaluation run caseResults[${index}].evidenceComplete`),
      recoveryOk: triStateObservation(entry.recoveryOk, `evaluation run caseResults[${index}].recoveryOk`),
      tokens: finiteOrNull(entry.tokens, `evaluation run caseResults[${index}].tokens`),
      cost: finiteOrNull(entry.cost, `evaluation run caseResults[${index}].cost`),
      latencyMs: finiteOrNull(entry.latencyMs, `evaluation run caseResults[${index}].latencyMs`),
      evidenceRefs: uniqueStrings(entry.evidenceRefs ?? [], `evaluation run caseResults[${index}].evidenceRefs`, { min: 1 })
    });
  });
  const expected = [
    ...resolvedProtocol.scenarioSet.trigger,
    ...resolvedProtocol.scenarioSet.regression,
    ...resolvedProtocol.scenarioSet.holdout
  ].sort();
  const actual = [...seen].sort();
  inv(canonicalize(actual) === canonicalize(expected), "evaluation run case membership changed from fixed protocol");
  // A missing primaryMetric is not rejected here: the evaluation gate types it
  // INCONCLUSIVE per the incomplete rule instead of coercing or throwing.
  return fr({
    kind: HOW_EVOLUTION_RUN_KIND,
    version: 1,
    runId: txt(raw.runId, "evaluation run.runId"),
    protocolRef: txt(raw.protocolRef, "evaluation run.protocolRef"),
    protocolDigest: raw.protocolDigest,
    side: raw.side,
    strategyRef: raw.strategyRef,
    strategyDigest: raw.strategyDigest,
    workContractRef: txt(raw.workContractRef ?? resolvedProtocol.workContract.ref, "evaluation run.workContractRef"),
    caseResults: Object.freeze(results)
  });
}

function normalizeJevReceipt(raw, protocol) {
  inv(raw && typeof raw === "object", "Jev semantic receipt required");
  inv(raw.kind === "HOW_EVOLUTION_JEV_RECEIPT", "Jev receipt kind mismatch");
  inv(raw.version === 1, "Jev receipt version must be 1");
  inv(raw.protocolDigest === digestValue(protocol), "Jev receipt protocol digest mismatch");
  inv(raw.evaluatorIdentity === protocol.evaluator.identity, "Jev receipt evaluator identity mismatch");
  inv(raw.evaluatorRevision === protocol.evaluator.revision, "Jev receipt evaluator revision mismatch");
  inv(raw.evaluatorPolicyRef === protocol.evaluator.policyRef, "Jev receipt evaluator policy ref mismatch");
  inv(raw.evaluatorPolicyDigest === protocol.evaluator.policyDigest, "Jev receipt evaluator policy digest mismatch");
  inv(raw.modelSnapshot === protocol.evaluator.modelSnapshot, "Jev receipt model snapshot mismatch");
  inv(Object.values(HowEvolutionVerdict).includes(raw.semanticVerdict), "Jev receipt semantic verdict is invalid");
  inv(typeof raw.requestHash === "string" && raw.requestHash.length > 0, "Jev receipt request hash required");
  inv(typeof raw.responseHash === "string" && raw.responseHash.length > 0, "Jev receipt response hash required");
  inv(Array.isArray(raw.questionOutcomes), "Jev receipt question outcomes required");
  inv(
    raw.questionOutcomes.length === HOW_EVOLUTION_JEV_QUESTION_IDS.length,
    "Jev receipt must cover the complete pinned semantic question set"
  );
  const seenQuestions = new Set();
  for (const [index, outcome] of raw.questionOutcomes.entries()) {
    inv(outcome && typeof outcome === "object", `Jev receipt questionOutcomes[${index}] must be an object`);
    const questionId = txt(outcome.questionId, `Jev receipt questionOutcomes[${index}].questionId`);
    inv(HOW_EVOLUTION_JEV_QUESTION_IDS.includes(questionId), `Jev receipt question is outside the pinned set: ${questionId}`);
    inv(!seenQuestions.has(questionId), `Jev receipt question duplicated: ${questionId}`);
    seenQuestions.add(questionId);
    inv(Object.values(HowEvolutionVerdict).includes(outcome.outcome), `Jev receipt questionOutcomes[${index}].outcome is invalid`);
  }
  const receiptEvidence = uniqueStrings(raw.evidenceRefs ?? [], "Jev receipt.evidenceRefs", { min: 1 });
  const expectedEvidence = [...protocol.evidenceSnapshot.evidenceRefs].sort();
  inv(
    canonicalize([...receiptEvidence].sort()) === canonicalize(expectedEvidence),
    "Jev receipt evidence identity must equal the pinned evidence snapshot"
  );
  return fr({
    kind: "HOW_EVOLUTION_JEV_RECEIPT",
    version: 1,
    protocolDigest: raw.protocolDigest,
    evaluatorIdentity: raw.evaluatorIdentity,
    evaluatorRevision: raw.evaluatorRevision,
    evaluatorPolicyRef: raw.evaluatorPolicyRef,
    evaluatorPolicyDigest: raw.evaluatorPolicyDigest,
    modelSnapshot: raw.modelSnapshot,
    semanticVerdict: raw.semanticVerdict,
    requestHash: raw.requestHash,
    responseHash: raw.responseHash,
    questionOutcomes: raw.questionOutcomes,
    evidenceRefs: receiptEvidence
  });
}

// J3 — Evaluation: paired same-case runs + hard gates; Jev handles the semantic
// rubric only. Returns an immutable result with PROPOSE_FOR_PROMOTION or KEEP_BASELINE.
// Evaluation never mutates policy or product currentness.
export function evaluateHowEvolution({ protocol: rawProtocol, baselineRun: rawBaseline, candidateRun: rawCandidate, jevReceipt: rawReceipt }) {
  const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
  const baselineRun = defineHowEvolutionEvaluationRun(rawBaseline, protocol);
  const candidateRun = defineHowEvolutionEvaluationRun(rawCandidate, protocol);
  inv(baselineRun.side === HowEvolutionRunSide.BASELINE, "baseline run side mismatch");
  inv(candidateRun.side === HowEvolutionRunSide.CANDIDATE, "candidate run side mismatch");
  inv(baselineRun.workContractRef === protocol.workContract.ref, "baseline run changed the fixed WHAT");
  inv(candidateRun.workContractRef === protocol.workContract.ref, "candidate run changed the fixed WHAT");
  const jev = normalizeJevReceipt(rawReceipt, protocol);

  const reasons = [];
  const baselineByCase = new Map(baselineRun.caseResults.map((entry) => [entry.caseId, entry]));
  const candidateByCase = new Map(candidateRun.caseResults.map((entry) => [entry.caseId, entry]));
  const pairedDeltas = [];
  let verdict = HowEvolutionVerdict.PASS;

  const markFail = (code) => {
    reasons.push(code);
    if (verdict === HowEvolutionVerdict.PASS) verdict = HowEvolutionVerdict.FAIL;
  };
  const markInconclusive = (code) => {
    reasons.push(code);
    if (verdict === HowEvolutionVerdict.PASS) verdict = HowEvolutionVerdict.INCONCLUSIVE;
  };
  const enforceOperationalRegression = (maximum, baselineValue, candidateValue, caseId, metric) => {
    if (maximum == null) return;
    if (baselineValue == null || candidateValue == null) {
      markInconclusive(`INCONCLUSIVE:${metric}-unknown:${caseId}`);
    } else if (candidateValue - baselineValue > maximum) {
      markFail(`FAIL:${metric}-regression:${caseId}`);
    }
  };

  for (const caseId of [...baselineByCase.keys()].sort()) {
    const baseline = baselineByCase.get(caseId);
    const candidate = candidateByCase.get(caseId);
    inv(candidate != null, `candidate run is missing pinned case: ${caseId}`);
    inv(baseline.partition === candidate.partition, `case partition changed between runs: ${caseId}`);
    if (
      baseline.status === HowEvolutionVerdict.INCONCLUSIVE ||
      candidate.status === HowEvolutionVerdict.INCONCLUSIVE
    ) {
      markInconclusive(`INCONCLUSIVE:case-status:${caseId}`);
    }
    if (candidate.primaryMetric == null || baseline.primaryMetric == null) {
      markInconclusive(`INCONCLUSIVE:missing-measurement:${caseId}`);
    } else {
      pairedDeltas.push(Object.freeze({
        caseId,
        partition: candidate.partition,
        baselineMetric: baseline.primaryMetric,
        candidateMetric: candidate.primaryMetric,
        delta: candidate.primaryMetric - baseline.primaryMetric
      }));
    }
    // Unknown hard-gate observations stay unknown: they force INCONCLUSIVE,
    // never a pass. Explicit non-compliance fails.
    if (candidate.policyCompliant == null || baseline.policyCompliant == null) {
      markInconclusive(`INCONCLUSIVE:policy-unknown:${caseId}`);
    } else if (!candidate.policyCompliant) {
      markFail(`FAIL:policy-noncompliant:${caseId}`);
    }
    if (candidate.evidenceComplete == null || baseline.evidenceComplete == null) {
      markInconclusive(`INCONCLUSIVE:evidence-incomplete:${caseId}`);
    } else if (!candidate.evidenceComplete || !baseline.evidenceComplete) {
      markInconclusive(`INCONCLUSIVE:evidence-incomplete:${caseId}`);
    }
    // Predeclared operational regression constraints bind both sides: a
    // missing observation while the constraint is declared is INCONCLUSIVE,
    // and a breach beyond the declared maximum is FAIL.
    enforceOperationalRegression(protocol.metricPolicy.maxCostRegression, baseline.cost, candidate.cost, caseId, "cost");
    enforceOperationalRegression(protocol.metricPolicy.maxTokenRegression, baseline.tokens, candidate.tokens, caseId, "tokens");
    enforceOperationalRegression(protocol.metricPolicy.maxLatencyRegressionMs, baseline.latencyMs, candidate.latencyMs, caseId, "latencyMs");
  }

  // Hard gates: no new critical failure, 100% policy/evidence completeness,
  // recovery non-regression. Aggregate gain cannot hide a critical regression.
  for (const caseId of protocol.metricPolicy.criticalCaseIds) {
    const baseline = baselineByCase.get(caseId);
    const candidate = candidateByCase.get(caseId);
    inv(baseline != null && candidate != null, `critical case is outside the pinned scenario set: ${caseId}`);
    if (baseline.status === HowEvolutionVerdict.PASS && candidate.status !== HowEvolutionVerdict.PASS) {
      markFail(`FAIL:critical-regression:${caseId}`);
    }
  }
  for (const caseId of protocol.metricPolicy.recoveryCaseIds) {
    const baseline = baselineByCase.get(caseId);
    const candidate = candidateByCase.get(caseId);
    if (baseline && candidate) {
      if (candidate.recoveryOk == null || baseline.recoveryOk == null) {
        markInconclusive(`INCONCLUSIVE:recovery-unknown:${caseId}`);
      } else if (!candidate.recoveryOk) {
        markFail(`FAIL:recovery-regression:${caseId}`);
      }
    }
    void baseline;
  }

  // Value gate: held-out primary metric delta must meet the predeclared minEffect.
  const holdoutDeltas = pairedDeltas.filter((entry) => entry.partition === HowEvolutionCasePartition.HOLDOUT);
  if (holdoutDeltas.length === 0) {
    markInconclusive("INCONCLUSIVE:holdout-missing");
  } else if (verdict === HowEvolutionVerdict.PASS) {
    const mean = holdoutDeltas.reduce((sum, entry) => sum + entry.delta, 0) / holdoutDeltas.length;
    if (!(mean >= protocol.metricPolicy.minEffect)) {
      markFail(`FAIL:min-effect:${mean}`);
    }
  }

  // Jev semantic rubric: a non-PASS semantic verdict keeps the baseline.
  if (jev.semanticVerdict === HowEvolutionVerdict.FAIL) {
    markFail("FAIL:jev-semantic");
  } else if (jev.semanticVerdict === HowEvolutionVerdict.INCONCLUSIVE) {
    markInconclusive("INCONCLUSIVE:jev-semantic");
  } else if (!jev.questionOutcomes.every((entry) => entry.outcome === HowEvolutionVerdict.PASS)) {
    markFail("FAIL:jev-question");
  }

  const disposition = verdict === HowEvolutionVerdict.PASS
    ? HowEvolutionDisposition.PROPOSE_FOR_PROMOTION
    : HowEvolutionDisposition.KEEP_BASELINE;

  return fr({
    kind: HOW_EVOLUTION_RESULT_KIND,
    version: 1,
    protocolDigest: digestValue(protocol),
    baselineRunDigest: digestValue(baselineRun),
    candidateRunDigest: digestValue(candidateRun),
    jevReceiptDigest: digestValue(jev),
    workContractRef: protocol.workContract.ref,
    verdict,
    disposition,
    pairedDeltas: Object.freeze(pairedDeltas),
    reasons: Object.freeze(reasons.length > 0 ? reasons : ["PASS:all-gates"]),
    evaluatedAt: new Date().toISOString()
  });
}

// J4 — Promotion proposal: SATISFIED evaluation creates only a proposal.
// A distinct promoter revalidates pins/current head, then calls the existing
// domain execution policy publisher; its authority check, generation+1 and CAS
// remain the only policy-currentness mutation.
export function createHowEvolutionPromotionProposal({ protocol: rawProtocol, evaluation }) {
  const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
  inv(evaluation && typeof evaluation === "object", "promotion proposal requires an evaluation result");
  inv(evaluation.kind === HOW_EVOLUTION_RESULT_KIND, "promotion proposal evaluation kind mismatch");
  inv(evaluation.protocolDigest === digestValue(protocol), "promotion proposal protocol digest mismatch");
  inv(
    evaluation.disposition === HowEvolutionDisposition.PROPOSE_FOR_PROMOTION &&
      evaluation.verdict === HowEvolutionVerdict.PASS,
    "only a PASS evaluation with PROPOSE_FOR_PROMOTION may produce a promotion proposal"
  );
  return fr({
    kind: HOW_EVOLUTION_PROPOSAL_KIND,
    version: 1,
    protocolDigest: digestValue(protocol),
    evaluationDigest: digestValue(evaluation),
    proposedStrategyRef: protocol.candidateStrategy.ref,
    proposedStrategyDigest: protocol.candidateStrategy.digest,
    expectedPolicyHead: fr({ ...protocol.expectedPolicyHead }),
    requiredAuthority: protocol.promotionAuthority,
    domain: protocol.domain,
    workloadType: protocol.workloadType,
    createdAt: new Date().toISOString()
  });
}

function headEquals(a, b) {
  return a.subjectKey === b.subjectKey && a.revision === b.revision &&
    a.generation === b.generation && a.policyRef === b.policyRef;
}

// Freshness over semantic subject, evaluator policy, cases, evidence and expected head.
// All four currentness readers are required: promotion with only a head check
// is refused. Any drift fails closed and requires a fresh evaluation.
export async function assertHowEvolutionPromotionCurrentness({
  protocol: rawProtocol,
  evaluation,
  proposal,
  executionPolicyStore,
  resolveCurrentSemantic,
  resolveCurrentEvaluator,
  resolveCurrentScenarioSet,
  resolveCurrentEvidence
}) {
  const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
  for (const [name, reader] of [
    ["semantic subject", resolveCurrentSemantic],
    ["evaluator policy", resolveCurrentEvaluator],
    ["scenario set", resolveCurrentScenarioSet],
    ["evidence snapshot", resolveCurrentEvidence]
  ]) {
    inv(typeof reader === "function", `promotion requires a ${name} freshness proof; refusing without it`);
  }
  inv(evaluation?.protocolDigest === digestValue(protocol), "promotion currentness protocol digest mismatch");
  inv(proposal?.protocolDigest === digestValue(protocol), "promotion proposal protocol digest mismatch");
  inv(proposal?.evaluationDigest === digestValue(evaluation), "promotion proposal evaluation digest mismatch");
  inv(
    evaluation.disposition === HowEvolutionDisposition.PROPOSE_FOR_PROMOTION,
    "stale/non-actionable evaluation cannot authorize promotion"
  );
  inv(executionPolicyStore && typeof executionPolicyStore.current === "function", "promotion requires the execution policy head reader");
  const head = await executionPolicyStore.current(proposal.expectedPolicyHead.subjectKey);
  inv(head != null, "execution policy head is unavailable");
  const currentHead = {
    subjectKey: proposal.expectedPolicyHead.subjectKey,
    revision: head.revision,
    generation: head.value?.generation,
    policyRef: head.value?.policyRef
  };
  inv(headEquals(currentHead, proposal.expectedPolicyHead), "execution policy head changed since evaluation; re-evaluate before promotion");

  const currentSemantic = await resolveCurrentSemantic();
  inv(currentSemantic?.workContractDigest === protocol.workContract.digest, "semantic subject changed since evaluation; re-evaluate before promotion");
  const currentAcceptance = [...(currentSemantic?.acceptanceDigests ?? [])].sort();
  const pinnedAcceptance = protocol.acceptanceRefs.map((entry) => entry.digest).sort();
  inv(canonicalize(currentAcceptance) === canonicalize(pinnedAcceptance), "acceptance policy changed since evaluation; re-evaluate before promotion");
  const currentEvaluator = await resolveCurrentEvaluator();
  inv(currentEvaluator?.policyDigest === protocol.evaluator.policyDigest, "evaluator policy changed since evaluation; re-evaluate before promotion");
  inv(currentEvaluator?.modelSnapshot === protocol.evaluator.modelSnapshot, "evaluator model changed since evaluation; re-evaluate before promotion");
  const currentScenarioSet = await resolveCurrentScenarioSet();
  inv(currentScenarioSet?.digest === protocol.scenarioSet.digest, "scenario set changed since evaluation; re-evaluate before promotion");
  const currentEvidence = await resolveCurrentEvidence();
  inv(currentEvidence?.digest === protocol.evidenceSnapshot.digest, "evidence snapshot changed since evaluation; re-evaluate before promotion");
  return fr({ head, currentHead: fr(currentHead) });
}

export async function publishHowEvolutionPromotion({
  protocol: rawProtocol,
  evaluation,
  proposal,
  publisher,
  policyPublisher,
  artifactRegistry,
  executionPolicyStore,
  currentness = {}
}) {
  const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
  inv(publisher && typeof publisher.identity === "string" && publisher.identity.length > 0, "promotion requires a publisher identity");
  inv(proposal?.requiredAuthority === publisher.identity, "promotion authority mismatch; an independent authority is required");
  inv(protocol.promotionAuthority === publisher.identity, "promotion publisher is not the protocol promotion authority");
  inv(protocol.candidateProducer !== publisher.identity, "candidate producer cannot promote its own candidate");
  inv(protocol.evaluator.identity !== publisher.identity, "evaluator cannot promote the candidate it judged");
  inv(policyPublisher && typeof policyPublisher.publish === "function", "promotion requires the domain execution policy publisher");
  inv(artifactRegistry && typeof artifactRegistry.resolveExecutionStrategyDescriptor === "function", "promotion requires the domain execution artifact registry");

  await assertHowEvolutionPromotionCurrentness({
    protocol,
    evaluation,
    proposal,
    executionPolicyStore,
    ...currentness
  });

  const strategy = await artifactRegistry.resolveExecutionStrategyDescriptor(proposal.proposedStrategyRef);
  inv(strategy != null, "promotion candidate strategy is unavailable");
  const embeddedStrategyDigest = `sha256:${proposal.proposedStrategyRef.slice(proposal.proposedStrategyRef.lastIndexOf(":") + 1)}`;
  inv(embeddedStrategyDigest === proposal.proposedStrategyDigest, "promotion candidate strategy digest mismatch");

  const published = await policyPublisher.publish({
    publisher: fr({ identity: publisher.identity }),
    policy: {
      policyId: proposal.expectedPolicyHead.subjectKey,
      generation: proposal.expectedPolicyHead.generation + 1,
      domain: protocol.domain,
      workloadType: protocol.workloadType,
      compatibleWorkContractVersions: [1],
      strategyRef: proposal.proposedStrategyRef
    }
  });
  const decision = fr({
    kind: HOW_EVOLUTION_DECISION_KIND,
    version: 1,
    protocolDigest: digestValue(protocol),
    evaluationDigest: digestValue(evaluation),
    proposalDigest: digestValue(proposal),
    fromHead: fr({ ...proposal.expectedPolicyHead }),
    toPolicyRef: published.policyRef,
    toGeneration: published.policy.generation,
    authority: publisher.identity,
    decidedAt: new Date().toISOString()
  });
  return fr({ published: fr(published), decision });
}

// J5 — Rollback: an independent fenced successor generation selecting an exact
// prior accepted strategy and linking the reversed promotion/evaluation.
// The rollback publisher must be the protocol promotion authority, independent
// from both the candidate producer and the evaluator. The reversed promotion
// must bind the reversed evaluation, the exact evaluated protocol and its own
// resulting head; the live current head must still equal that promotion head,
// otherwise the rollback is refused as a current-head mismatch. History is
// never rewritten.
export async function publishHowEvolutionRollback({
  protocol: rawProtocol,
  targetStrategyRef,
  targetStrategyDigest,
  reversedPromotion,
  reversedEvaluation,
  reasonEvidenceRefs,
  publisher,
  policyPublisher,
  artifactRegistry,
  executionPolicyStore,
  currentHead
}) {
  const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
  inv(publisher && typeof publisher.identity === "string" && publisher.identity.length > 0, "rollback requires a publisher identity");
  inv(publisher.identity === protocol.promotionAuthority, "rollback requires the protocol promotion authority");
  inv(protocol.candidateProducer !== publisher.identity, "candidate producer cannot roll back its own candidate");
  inv(protocol.evaluator.identity !== publisher.identity, "evaluator cannot roll back the candidate it judged");
  inv(artifactRegistry && typeof artifactRegistry.resolveExecutionStrategyDescriptor === "function", "rollback requires the domain execution artifact registry");
  inv(policyPublisher && typeof policyPublisher.publish === "function", "rollback requires the domain execution policy publisher");
  inv(executionPolicyStore && typeof executionPolicyStore.current === "function", "rollback requires the execution policy head reader");
  const targetRef = txt(targetStrategyRef, "rollback.targetStrategyRef");
  const targetDigest = txt(targetStrategyDigest, "rollback.targetStrategyDigest");
  inv(
    targetRef === protocol.baselineStrategy.ref && targetDigest === protocol.baselineStrategy.digest,
    "rollback target must equal the exact accepted baseline strategy"
  );
  const strategy = await artifactRegistry.resolveExecutionStrategyDescriptor(targetRef);
  inv(strategy != null, "rollback target strategy is unavailable");
  const embeddedTargetDigest = `sha256:${targetRef.slice(targetRef.lastIndexOf(":") + 1)}`;
  inv(embeddedTargetDigest === targetDigest, "rollback target strategy digest mismatch");
  inv(reversedPromotion && typeof reversedPromotion === "object", "rollback requires the reversed promotion decision");
  inv(reversedPromotion.kind === HOW_EVOLUTION_DECISION_KIND, "rollback reversed promotion kind mismatch");
  inv(reversedPromotion.protocolDigest === digestValue(protocol), "rollback reversed promotion protocol mismatch");
  inv(reversedPromotion.authority === protocol.promotionAuthority, "rollback reversed promotion authority mismatch");
  inv(reversedEvaluation && typeof reversedEvaluation === "object", "rollback requires the reversed evaluation result");
  inv(reversedEvaluation.kind === HOW_EVOLUTION_RESULT_KIND, "rollback reversed evaluation kind mismatch");
  inv(reversedEvaluation.protocolDigest === digestValue(protocol), "rollback reversed evaluation protocol mismatch");
  inv(
    reversedEvaluation.disposition === HowEvolutionDisposition.PROPOSE_FOR_PROMOTION,
    "rollback requires a reversed evaluation that proposed promotion"
  );
  inv(
    reversedPromotion.evaluationDigest === digestValue(reversedEvaluation),
    "rollback reversed promotion does not bind the reversed evaluation"
  );
  const evidenceRefs = uniqueStrings(reasonEvidenceRefs, "rollback.reasonEvidenceRefs", { min: 1 });

  const head = currentHead ?? await executionPolicyStore.current(protocol.expectedPolicyHead.subjectKey);
  inv(head != null, "execution policy head is unavailable for rollback");
  const fromHead = {
    subjectKey: protocol.expectedPolicyHead.subjectKey,
    revision: head.revision,
    generation: head.value?.generation,
    policyRef: head.value?.policyRef
  };
  inv(Number.isInteger(fromHead.generation) && fromHead.generation > 0, "execution policy head generation invalid");
  inv(
    fromHead.policyRef === reversedPromotion.toPolicyRef && fromHead.generation === reversedPromotion.toGeneration,
    "rollback current head does not match the reversed promotion head; re-resolve the promotion lineage before rollback"
  );

  const published = await policyPublisher.publish({
    publisher: fr({ identity: publisher.identity }),
    policy: {
      policyId: fromHead.subjectKey,
      generation: fromHead.generation + 1,
      domain: protocol.domain,
      workloadType: protocol.workloadType,
      compatibleWorkContractVersions: [1],
      strategyRef: targetRef
    }
  });
  const decision = fr({
    kind: HOW_EVOLUTION_ROLLBACK_KIND,
    version: 1,
    protocolDigest: digestValue(protocol),
    targetStrategyRef: targetRef,
    targetStrategyDigest: targetDigest,
    reversedPromotionDigest: digestValue(reversedPromotion),
    reversedEvaluationDigest: digestValue(reversedEvaluation),
    fromHead: fr(fromHead),
    toPolicyRef: published.policyRef,
    toGeneration: published.policy.generation,
    reasonKind: "ROLLBACK",
    reasonEvidenceRefs: evidenceRefs,
    authority: publisher.identity,
    decidedAt: new Date().toISOString()
  });
  return fr({ published: fr(published), decision });
}

function artifactFileName(ref) {
  const digest = ref.slice(ref.lastIndexOf(":") + 1);
  inv(/^[0-9a-f]{64}$/.test(digest), "how-evolution artifact ref digest is invalid");
  const prefix = ref.slice(0, ref.lastIndexOf(":")).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `${prefix}-${digest}.json`;
}

export function createInMemoryHowEvolutionArtifactStore() {
  const records = new Map();
  async function put(kind, content) {
    const label = txt(kind, "artifact kind").toLowerCase();
    inv(content && typeof content === "object", "artifact content must be an object");
    const digest = digestValue({ artifactKind: label, content: fr(content) });
    const ref = `how-evolution-${label}:${digest}`;
    if (!records.has(ref)) records.set(ref, fr({ kind: label, digest, ref, content: fr(content) }));
    return ref;
  }
  async function resolve(ref) {
    const record = records.get(txt(ref, "artifact ref"));
    if (record == null) throw new Error(`how-evolution artifact unavailable: ${ref}`);
    return fr(record.content);
  }
  async function resolveEnvelope(ref) {
    const record = records.get(txt(ref, "artifact ref"));
    if (record == null) throw new Error(`how-evolution artifact unavailable: ${ref}`);
    return fr(record);
  }
  return Object.freeze({ put, resolve, resolveEnvelope });
}

export function createJsonHowEvolutionArtifactStore({ path, fs = nodeFs }) {
  txt(path, "how-evolution artifact store path");
  inv(fs && typeof fs.mkdir === "function" && typeof fs.open === "function" &&
    typeof fs.readFile === "function" && typeof fs.link === "function" &&
    typeof fs.unlink === "function", "how-evolution artifact store requires filesystem mkdir/open/read/link/unlink capability");
  async function put(kind, content) {
    const label = txt(kind, "artifact kind").toLowerCase();
    inv(content && typeof content === "object", "artifact content must be an object");
    const digest = digestValue({ artifactKind: label, content: fr(content) });
    const ref = `how-evolution-${label}:${digest}`;
    await fs.mkdir(path, { recursive: true });
    const filePath = join(path, artifactFileName(ref));
    const tempPath = join(path, `.${artifactFileName(ref)}.${randomUUID()}.tmp`);
    const envelope = { kind: "HOW_EVOLUTION_ARTIFACT", version: 1, artifactKind: label, digest, ref, content: fr(content) };
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
        const existing = JSON.parse(await fs.readFile(filePath, "utf8"));
        inv(existing.digest === digest && existing.ref === ref, "how-evolution artifact digest already exists with different content");
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
    return ref;
  }
  async function resolve(ref) {
    const filePath = join(path, artifactFileName(txt(ref, "artifact ref")));
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`how-evolution artifact unavailable: ${ref}`);
      throw error;
    }
    inv(raw.ref === ref, "how-evolution artifact ref mismatch");
    const recomputed = digestValue({ artifactKind: txt(raw.artifactKind, "artifact kind"), content: raw.content });
    inv(`how-evolution-${raw.artifactKind}:${recomputed}` === ref, "how-evolution artifact digest mismatch");
    return fr(raw.content);
  }
  return Object.freeze({ put, resolve });
}

// J6 — Reconstruction: a fresh process starts from the current policy head or a
// promotion/rollback receipt and resolves the entire provenance chain by exact
// refs+digests, without conversation history.
export async function resolveHowEvolutionProvenance({
  artifactStore,
  artifactRegistry,
  executionPolicyStore,
  policySubjectKey,
  protocolRef,
  evaluationRef = null,
  proposalRef = null,
  decisionRef = null
}) {
  inv(artifactStore && typeof artifactStore.resolve === "function", "provenance reconstruction requires an artifact store");
  txt(policySubjectKey, "provenance policySubjectKey");
  txt(protocolRef, "provenance protocolRef");
  const protocol = defineHowEvolutionEvaluationProtocol(await artifactStore.resolve(protocolRef));
  if (typeof artifactStore.resolveEnvelope === "function") {
    const envelope = await artifactStore.resolveEnvelope(protocolRef);
    inv(envelope.ref === protocolRef, "protocol envelope ref mismatch");
    inv(digestValue(envelope.content) === digestValue(protocol), "protocol envelope content mismatch");
  }
  const head = executionPolicyStore && typeof executionPolicyStore.current === "function"
    ? await executionPolicyStore.current(policySubjectKey)
    : null;
  let evaluation = null;
  let proposal = null;
  let decision = null;
  if (evaluationRef != null) {
    evaluation = await artifactStore.resolve(evaluationRef);
    inv(evaluation.kind === HOW_EVOLUTION_RESULT_KIND, "provenance evaluation kind mismatch");
    inv(evaluation.protocolDigest === digestValue(protocol), "provenance evaluation protocol mismatch");
  }
  if (proposalRef != null) {
    proposal = await artifactStore.resolve(proposalRef);
    inv(proposal.kind === HOW_EVOLUTION_PROPOSAL_KIND, "provenance proposal kind mismatch");
    inv(proposal.protocolDigest === digestValue(protocol), "provenance proposal protocol mismatch");
    if (evaluation != null) inv(proposal.evaluationDigest === digestValue(evaluation), "provenance proposal evaluation mismatch");
  }
  if (decisionRef != null) {
    decision = await artifactStore.resolve(decisionRef);
    inv(
      decision.kind === HOW_EVOLUTION_DECISION_KIND || decision.kind === HOW_EVOLUTION_ROLLBACK_KIND,
      "provenance decision kind mismatch"
    );
    inv(decision.protocolDigest === digestValue(protocol), "provenance decision protocol mismatch");
  }
  let headPolicy = null;
  let headStrategy = null;
  if (head?.value?.policyRef != null && artifactRegistry?.resolveExecutionPolicy != null) {
    headPolicy = await artifactRegistry.resolveExecutionPolicy(head.value.policyRef);
    inv(headPolicy != null, "provenance head policy is unavailable");
    if (artifactRegistry.resolveExecutionStrategyDescriptor != null && headPolicy.strategyRef != null) {
      headStrategy = await artifactRegistry.resolveExecutionStrategyDescriptor(headPolicy.strategyRef);
    }
  }
  void shaHex;
  void canonicalize;
  return fr({
    protocolRef,
    protocol,
    protocolDigest: digestValue(protocol),
    evaluationRef,
    evaluation,
    proposalRef,
    proposal,
    decisionRef,
    decision,
    policyHead: head,
    headPolicy,
    headStrategy
  });
}
