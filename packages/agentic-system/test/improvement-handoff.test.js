import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HOW_IMPROVEMENT_PROPOSAL_KIND,
  IMPROVEMENT_EVALUATION_HANDOFF_KIND,
  PINNED_OPTIMIZER_IDENTITY,
  buildHowEvolutionHandoff,
  defineHowImprovementProposal,
  defineImprovementEvaluationHandoff,
  evaluateHandoffOutcome,
} from "../src/improvement-proposal.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f0".repeat(32);
const SHA_1 = "1".repeat(64);
const SHA_2 = "2".repeat(64);
const SHA_3 = "3".repeat(64);

const refFor = (name, digest) => `${name}:sha256:${digest}`;
const pinned = (name, digest) => ({
  ref: refFor(name, digest),
  digest,
});

function validProposal() {
  return defineHowImprovementProposal({
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    patternProjectionRef: refFor("artifact:improvement-pattern-projection", SHA_A),
    patternProjectionDigest: SHA_A,
    patternKey: "pattern-key-001",
    patternClassification: "RECURRING",
    cohortEpisodeRefs: [refFor("artifact:feedback-episode", SHA_B)],
    baselineHow: {
      policyHeadRef: "policy-head:gen-7",
      strategyRef: refFor("artifact:execution-strategy", SHA_C),
      strategyDigest: SHA_C,
    },
    allowedHowAxis: "execution-strategy",
    optimizer: {
      engine: PINNED_OPTIMIZER_IDENTITY.engine,
      version: PINNED_OPTIMIZER_IDENTITY.version,
      commit: PINNED_OPTIMIZER_IDENTITY.commit,
      configDigest: SHA_D,
    },
    candidate: {
      strategyRef: refFor("artifact:execution-strategy-candidate", SHA_E),
      digest: SHA_E,
      diff: { temperature: 0.7 },
    },
    developmentEvidenceRefs: [],
    benchmarkAttemptRefs: [],
  });
}

const HOLDOUT_REF = refFor("case:final-holdout-1", SHA_F);

function validHandoff() {
  return defineImprovementEvaluationHandoff({
    kind: IMPROVEMENT_EVALUATION_HANDOFF_KIND,
    version: 1,
    frozenAt: new Date().toISOString(),
    whatRefs: [pinned("artifact:work-contract", SHA_A)],
    acceptanceRefs: [pinned("artifact:acceptance-policy", SHA_B)],
    baselineHowHead: {
      policyHeadRef: "policy-head:gen-7",
      strategyRef: refFor("artifact:execution-strategy", SHA_C),
      strategyDigest: SHA_C,
    },
    optimizerIdentity: {
      engine: PINNED_OPTIMIZER_IDENTITY.engine,
      version: PINNED_OPTIMIZER_IDENTITY.version,
      commit: PINNED_OPTIMIZER_IDENTITY.commit,
    },
    optimizerConfigDigest: SHA_D,
    allowedAxis: "execution-strategy",
    developmentPartition: {
      refs: [refFor("case:dev-1", SHA_1), refFor("case:dev-2", SHA_2)],
      digests: [SHA_1, SHA_2],
    },
    searchValidationPartition: {
      refs: [refFor("case:val-1", SHA_3)],
      digests: [SHA_3],
    },
    finalHoldout: { ref: HOLDOUT_REF, digest: SHA_F },
    metricPolicy: pinned("artifact:metric-policy", SHA_E),
    minEffect: 0.05,
    modelIdentity: "model:snapshot-1",
    providerIdentity: "provider:class-a",
    toolIdentities: ["tool:benchmark-runner"],
    budgetIdentity: "budget:run-42",
    evaluatorIdentity: "evaluator:independent-1",
  });
}

test("valid handoff is deeply frozen and immutable", () => {
  const handoff = validHandoff();
  assert.equal(handoff.kind, IMPROVEMENT_EVALUATION_HANDOFF_KIND);
  assert.ok(Object.isFrozen(handoff));
  assert.ok(Object.isFrozen(handoff.developmentPartition));
  assert.ok(Object.isFrozen(handoff.developmentPartition.refs));
  assert.ok(Object.isFrozen(handoff.searchValidationPartition));
  assert.ok(Object.isFrozen(handoff.finalHoldout));
  assert.ok(Object.isFrozen(handoff.metricPolicy));
  assert.ok(Object.isFrozen(handoff.baselineHowHead));
  assert.ok(Object.isFrozen(handoff.optimizerIdentity));

  // frozenAt and partitions cannot change: descriptors are non-writable.
  const frozenAtDescriptor = Object.getOwnPropertyDescriptor(
    handoff,
    "frozenAt",
  );
  assert.equal(frozenAtDescriptor.writable, false);
  assert.equal(frozenAtDescriptor.configurable, false);
  const partitionDescriptor = Object.getOwnPropertyDescriptor(
    handoff,
    "developmentPartition",
  );
  assert.equal(partitionDescriptor.writable, false);
  assert.throws(
    () => {
      "use strict";
      handoff.frozenAt = "2000-01-01T00:00:00.000Z";
    },
    TypeError,
  );
  assert.throws(
    () => {
      "use strict";
      handoff.developmentPartition.refs.push("case:evil");
    },
    TypeError,
  );
});

test("handoff rejects mismatched optimizer identity", () => {
  const raw = {
    kind: IMPROVEMENT_EVALUATION_HANDOFF_KIND,
    version: 1,
    frozenAt: new Date().toISOString(),
    whatRefs: [pinned("artifact:work-contract", SHA_A)],
    acceptanceRefs: [pinned("artifact:acceptance-policy", SHA_B)],
    baselineHowHead: {
      policyHeadRef: "policy-head:gen-7",
      strategyRef: refFor("artifact:execution-strategy", SHA_C),
      strategyDigest: SHA_C,
    },
    optimizerIdentity: {
      engine: "gepa",
      version: "0.1.4",
      commit: "0".repeat(64),
    },
    optimizerConfigDigest: SHA_D,
    allowedAxis: "execution-strategy",
    developmentPartition: {
      refs: [refFor("case:dev-1", SHA_1)],
      digests: [SHA_1],
    },
    searchValidationPartition: {
      refs: [refFor("case:val-1", SHA_3)],
      digests: [SHA_3],
    },
    finalHoldout: { ref: HOLDOUT_REF, digest: SHA_F },
    metricPolicy: pinned("artifact:metric-policy", SHA_E),
    minEffect: 0.05,
    modelIdentity: "model:snapshot-1",
    providerIdentity: "provider:class-a",
    toolIdentities: ["tool:benchmark-runner"],
    budgetIdentity: "budget:run-42",
    evaluatorIdentity: "evaluator:independent-1",
  };
  assert.throws(
    () => defineImprovementEvaluationHandoff(raw),
    /OPTIMIZER_IDENTITY_MISMATCH/,
  );
});

test("handoff rejects non-parallel partition arrays", () => {
  const handoff = validHandoff();
  const raw = JSON.parse(JSON.stringify(handoff));
  raw.developmentPartition.digests = [SHA_1];
  assert.throws(
    () => defineImprovementEvaluationHandoff(raw),
    /parallel/,
  );
});

test("handoff rejects forbidden authority keys", () => {
  const handoff = validHandoff();
  const raw = JSON.parse(JSON.stringify(handoff));
  raw.approved = true;
  assert.throws(
    () => defineImprovementEvaluationHandoff(raw),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("bridgeInput containing the holdout ref throws HOLDOUT_EXPOSED", () => {
  const proposal = validProposal();
  const handoff = validHandoff();
  assert.throws(
    () =>
      buildHowEvolutionHandoff({
        proposal,
        handoff,
        bridgeInput: [refFor("case:dev-1", SHA_1), HOLDOUT_REF],
      }),
    /HOLDOUT_EXPOSED/,
  );
});

test("build maps to BB-059 shapes with dev+validation cases only", () => {
  const proposal = validProposal();
  const handoff = validHandoff();
  const { findingInput, protocolInput, readiness } = buildHowEvolutionHandoff({
    proposal,
    handoff,
    bridgeInput: [
      refFor("case:dev-1", SHA_1),
      refFor("case:dev-2", SHA_2),
      refFor("case:val-1", SHA_3),
    ],
  });

  assert.equal(findingInput.kind, "HOW_EVOLUTION_FINDING");
  assert.equal(findingInput.version, 1);
  assert.equal(findingInput.id, proposal.patternKey);
  assert.deepEqual(findingInput.evidenceRefs, proposal.cohortEpisodeRefs);
  assert.equal(
    findingInput.proposedChange.candidateStrategyRef,
    proposal.candidate.strategyRef,
  );

  assert.equal(protocolInput.kind, "HOW_EVOLUTION_EVALUATION_PROTOCOL");
  assert.equal(protocolInput.version, 1);
  assert.deepEqual(protocolInput.caseRefs, [
    refFor("case:dev-1", SHA_1),
    refFor("case:dev-2", SHA_2),
    refFor("case:val-1", SHA_3),
  ]);
  assert.ok(!protocolInput.caseRefs.includes(HOLDOUT_REF));
  assert.equal(protocolInput.holdout.ref, HOLDOUT_REF);
  assert.equal(protocolInput.holdout.exposedToBridge, false);
  assert.equal(protocolInput.replay.repeatCount, 3);
  assert.equal(protocolInput.replay.paired, true);
  assert.equal(protocolInput.minEffect, handoff.minEffect);
  assert.equal(
    protocolInput.baselineStrategy.ref,
    proposal.baselineHow.strategyRef,
  );
  assert.equal(
    protocolInput.candidateStrategy.ref,
    proposal.candidate.strategyRef,
  );

  assert.equal(readiness.decision, "READY_FOR_INDEPENDENT_EVALUATION");
  assert.ok(Object.isFrozen(findingInput));
  assert.ok(Object.isFrozen(protocolInput));
});

test("fewer than 3 repeats is INCONCLUSIVE, not a throw", () => {
  const proposal = validProposal();
  const handoff = validHandoff();
  const { readiness, protocolInput } = buildHowEvolutionHandoff({
    proposal,
    handoff,
    bridgeInput: [refFor("case:dev-1", SHA_1)],
    repeatsPerCase: 2,
  });
  assert.equal(readiness.decision, "INCONCLUSIVE");
  assert.equal(readiness.reason, "INSUFFICIENT_PAIRED_REPEATS");
  assert.equal(protocolInput.replay.repeatCount, 2);
});

test("unfrozen proposal/handoff are rejected by the builder", () => {
  const handoff = validHandoff();
  const rawProposal = JSON.parse(
    JSON.stringify({ kind: HOW_IMPROVEMENT_PROPOSAL_KIND }),
  );
  assert.throws(
    () =>
      buildHowEvolutionHandoff({
        proposal: rawProposal,
        handoff,
        bridgeInput: [],
      }),
    /frozen/,
  );
});

test("critical per-case regression blocks even with aggregate gain", () => {
  const outcome = evaluateHandoffOutcome({
    perCaseResults: [
      { caseRef: "case:critical-1", baseline: 0.9, candidate: 0.8, critical: true },
      { caseRef: "case:dev-1", baseline: 0.5, candidate: 0.95, critical: false },
      { caseRef: "case:dev-2", baseline: 0.5, candidate: 0.95, critical: false },
    ],
    minEffect: 0.05,
  });
  assert.equal(outcome.decision, "BLOCKED");
  assert.equal(outcome.reason, "CRITICAL_REGRESSION");
  assert.deepEqual(outcome.regressedCases, ["case:critical-1"]);
});

test("missing evidence is INCONCLUSIVE", () => {
  const outcome = evaluateHandoffOutcome({
    perCaseResults: [
      { caseRef: "case:dev-1", baseline: 0.5, candidate: null, critical: false },
      { caseRef: "case:dev-2", baseline: 0.5, candidate: 0.7, critical: false },
    ],
    minEffect: 0.05,
  });
  assert.equal(outcome.decision, "INCONCLUSIVE");
  assert.equal(outcome.reason, "MISSING_EVIDENCE");
  assert.deepEqual(outcome.missingCases, ["case:dev-1"]);
});

test("clean results are ready for independent evaluation", () => {
  const outcome = evaluateHandoffOutcome({
    perCaseResults: [
      { caseRef: "case:dev-1", baseline: 0.5, candidate: 0.7, critical: false },
      { caseRef: "case:dev-2", baseline: 0.6, candidate: 0.65, critical: true },
    ],
    minEffect: 0.05,
  });
  assert.equal(outcome.decision, "READY_FOR_INDEPENDENT_EVALUATION");
  assert.equal(outcome.reason, "MEETS_HANDOFF_CRITERIA");
  assert.equal(outcome.minEffect, 0.05);
  assert.ok(Math.abs(outcome.aggregateDelta - 0.125) < 1e-12);
  assert.equal(outcome.caseCount, 2);
  assert.equal(outcome.criticalCaseCount, 1);
  assert.ok(Object.isFrozen(outcome));
});

test("empty perCaseResults throws", () => {
  assert.throws(
    () => evaluateHandoffOutcome({ perCaseResults: [] }),
    /at least 1 case/,
  );
});

test("module never imports or calls a promotion publisher", () => {
  const source = readFileSync(
    new URL("../src/improvement-proposal.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    !source.includes("publishHowEvolutionPromotion"),
    "must not reference publishHowEvolutionPromotion",
  );
  assert.ok(
    !source.includes("publishHowEvolutionRollback"),
    "must not reference publishHowEvolutionRollback",
  );
  const importStatements = source.match(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm) ?? [];
  assert.ok(
    importStatements.every((statement) => !/publish/i.test(statement)),
    "no import statement may reference a publish function",
  );
  // The only how-evolution.js binding is the kind constants.
  const howEvolutionImports = [...source.matchAll(/from\s+["']\.\/how-evolution\.js["']/g)];
  assert.equal(howEvolutionImports.length, 1);
  const importBlock = source.slice(0, source.indexOf('from "./how-evolution.js"'));
  assert.ok(importBlock.includes("HOW_EVOLUTION_FINDING_KIND"));
  assert.ok(importBlock.includes("HOW_EVOLUTION_PROTOCOL_KIND"));
  assert.ok(!/publish/i.test(importBlock));
});
