// BB-086 slice I3+I5 — proposal envelope + independent evaluation handoff.
//
// HOW_IMPROVEMENT_PROPOSAL_V1 is evidence only: it binds a pattern projection,
// cohort episodes, a baseline HOW head, exactly one allowed HOW axis, a pinned
// optimizer identity and a candidate strategy digest. It carries no
// accepted/promoted/approved/verdict authority and no policy-head mutation
// capability. Any such key at any depth is rejected.
//
// IMPROVEMENT_EVALUATION_HANDOFF_V1 freezes the evaluation contract before
// search: WHAT/acceptance refs, baseline HOW head, optimizer identity/config,
// the single allowed axis, development and search-validation partitions, the
// evaluator-owned final holdout, the metric policy with minEffect, and all
// actor identities. The bridge receives only development and search-validation
// case refs — the final holdout is never exposed to it.
//
// buildHowEvolutionHandoff maps a validated proposal + handoff onto the
// delivered BB-059 HOW_EVOLUTION_FINDING / HOW_EVOLUTION_EVALUATION_PROTOCOL
// shapes (kind constants imported from ./how-evolution.js). This module never
// promotes: only the BB-059 independent authority can authorize a promotion.

import { createHash } from "node:crypto";

import {
  HOW_EVOLUTION_FINDING_KIND,
  HOW_EVOLUTION_PROTOCOL_KIND,
} from "./how-evolution.js";

export const HOW_IMPROVEMENT_PROPOSAL_KIND = "HOW_IMPROVEMENT_PROPOSAL_V1";
export const IMPROVEMENT_EVALUATION_HANDOFF_KIND =
  "IMPROVEMENT_EVALUATION_HANDOFF_V1";

export const PINNED_OPTIMIZER_IDENTITY = Object.freeze({
  engine: "gepa",
  version: "0.1.4",
  commit: "d771eb21b5dd3228bc3f567293d2ccfc423fc900",
});

const HEX64 = /^[a-f0-9]{64}$/;
const PROPOSAL_CLASSIFICATIONS = Object.freeze(["RECURRING", "SYSTEMIC"]);

// Keys that would smuggle acceptance/promotion authority into an evidence-only
// envelope. Exact names plus any key carrying 'promot' semantics.
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "accepted",
  "promoted",
  "approved",
  "verdict",
  "policyHead",
  "policyMutation",
]);

function fail(message) {
  throw new TypeError(message);
}

function reqText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function reqHex(value, label) {
  reqText(value, label);
  if (!HEX64.test(value)) fail(`${label} must be sha256 hex`);
  return value;
}

function reqArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function reqNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`);
  }
  return value;
}

function uniqueStrings(value, label, { min = 0 } = {}) {
  const list = reqArray(value, label).map((entry, index) =>
    reqText(entry, `${label}[${index}]`),
  );
  if (new Set(list).size !== list.length) {
    fail(`${label} must not contain duplicates`);
  }
  if (list.length < min) {
    fail(`${label} must contain at least ${min} item(s)`);
  }
  return list;
}

// ref+digest convention shared with feedback-lifecycle-contracts.js: the ref
// embeds the digest as `:sha256:<hex64>` and the pair must agree.
function assertRefDigest(ref, digest, label) {
  reqText(ref, `${label}Ref`);
  reqHex(digest, `${label}Digest`);
  const match = ref.match(/:sha256:([a-f0-9]{64})$/);
  if (!match || match[1] !== digest) {
    fail(`${label} REF_DIGEST_MISMATCH: ref/digest pair does not agree`);
  }
  return { ref, digest };
}

function assertPinnedPair(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object with { ref, digest }`);
  }
  const { ref, digest } = assertRefDigest(value.ref, value.digest, label);
  return Object.freeze({ ref, digest });
}

// The proposal/handoff are evidence only. Any key granting acceptance or
// promotion authority — at any depth — invalidates the envelope.
function assertNoAuthorityKeys(value, label) {
  const seen = new Set();
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const key of Object.keys(node)) {
      const lowered = key.toLowerCase();
      if (
        FORBIDDEN_AUTHORITY_KEYS.has(key) ||
        lowered.includes("promot")
      ) {
        fail(
          `${label} PROPOSAL_FORBIDDEN_AUTHORITY_KEY: forbidden authority key '${key}' at ${path}`,
        );
      }
      walk(node[key], `${path}.${key}`);
    }
  };
  walk(value, label);
}

// Exactly one HOW axis. Any second axis-like key (e.g. allowedHowAxes,
// howAxis, howAxes) alongside the declared one is rejected.
function assertSingleAxisKey(container, allowedName, label) {
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    fail(`${label} must be an object`);
  }
  for (const key of Object.keys(container)) {
    if (
      key !== allowedName &&
      key.toLowerCase().includes("howax")
    ) {
      fail(
        `${label} PROPOSAL_MULTIPLE_HOW_AXES: second axis field '${key}' alongside '${allowedName}'`,
      );
    }
  }
}

function assertPinnedOptimizerIdentity(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  for (const field of ["engine", "version", "commit"]) {
    const actual = value[field];
    const expected = PINNED_OPTIMIZER_IDENTITY[field];
    if (actual !== expected) {
      fail(
        `${label} PROPOSAL_OPTIMIZER_IDENTITY_MISMATCH: ${field} must be exactly '${expected}'`,
      );
    }
  }
  return Object.freeze({
    engine: PINNED_OPTIMIZER_IDENTITY.engine,
    version: PINNED_OPTIMIZER_IDENTITY.version,
    commit: PINNED_OPTIMIZER_IDENTITY.commit,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function jsonSafe(value, label, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} must be JSON-safe`);
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) {
    fail(`${label} must be JSON-safe`);
  }
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map((entry, index) =>
      jsonSafe(entry, `${label}[${index}]`, seen),
    );
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail(`${label} must be JSON-safe`);
    }
    out = {};
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) fail(`${label} must be JSON-safe`);
      out[key] = jsonSafe(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return out;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function uniquePreserveOrder(list) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

// D7/SI2 — HOW_IMPROVEMENT_PROPOSAL_V1 validator/builder. Evidence only:
// eligible from RECURRING or SYSTEMIC patterns; INSTANCE patterns are
// ineligible and rejected.
export function defineHowImprovementProposal(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("proposal must be an object");
  }
  assertNoAuthorityKeys(raw, "proposal");
  if (raw.kind !== HOW_IMPROVEMENT_PROPOSAL_KIND) {
    fail("proposal kind must be HOW_IMPROVEMENT_PROPOSAL_V1");
  }
  if (raw.version !== 1) {
    fail("proposal version must be 1");
  }

  const classification = reqText(
    raw.patternClassification,
    "proposal.patternClassification",
  );
  if (classification === "INSTANCE") {
    fail(
      "proposal PROPOSAL_INSTANCE_INELIGIBLE: INSTANCE patterns cannot propose improvements",
    );
  }
  if (!PROPOSAL_CLASSIFICATIONS.includes(classification)) {
    fail(
      "proposal.patternClassification must be RECURRING or SYSTEMIC",
    );
  }

  assertSingleAxisKey(raw, "allowedHowAxis", "proposal");
  const allowedHowAxis = reqText(raw.allowedHowAxis, "proposal.allowedHowAxis");
  if (raw.allowedHowAxes !== undefined) {
    fail(
      "proposal PROPOSAL_MULTIPLE_HOW_AXES: allowedHowAxes array form is forbidden",
    );
  }

  const optimizerIdentity = assertPinnedOptimizerIdentity(
    raw.optimizer,
    "proposal.optimizer",
  );
  const configDigest = reqHex(
    raw.optimizer?.configDigest,
    "proposal.optimizer.configDigest",
  );

  const candidateDiff = jsonSafe(raw.candidate?.diff, "proposal.candidate.diff");
  const candidateStrategy = assertRefDigest(
    raw.candidate?.strategyRef,
    raw.candidate?.digest,
    "proposal.candidate.strategy",
  );
  const baselineStrategy = assertRefDigest(
    raw.baselineHow?.strategyRef,
    raw.baselineHow?.strategyDigest,
    "proposal.baselineHow.strategy",
  );

  const proposal = {
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    patternProjectionRef: reqText(
      raw.patternProjectionRef,
      "proposal.patternProjectionRef",
    ),
    patternProjectionDigest: reqHex(
      raw.patternProjectionDigest,
      "proposal.patternProjectionDigest",
    ),
    patternKey: reqText(raw.patternKey, "proposal.patternKey"),
    patternClassification: classification,
    cohortEpisodeRefs: uniqueStrings(
      raw.cohortEpisodeRefs,
      "proposal.cohortEpisodeRefs",
      { min: 1 },
    ),
    baselineHow: {
      policyHeadRef: reqText(
        raw.baselineHow?.policyHeadRef,
        "proposal.baselineHow.policyHeadRef",
      ),
      strategyRef: baselineStrategy.ref,
      strategyDigest: baselineStrategy.digest,
    },
    allowedHowAxis,
    optimizer: {
      ...optimizerIdentity,
      configDigest,
    },
    candidate: {
      strategyRef: candidateStrategy.ref,
      digest: candidateStrategy.digest,
      diff: candidateDiff,
    },
    developmentEvidenceRefs: uniqueStrings(
      raw.developmentEvidenceRefs ?? [],
      "proposal.developmentEvidenceRefs",
    ),
    benchmarkAttemptRefs: uniqueStrings(
      raw.benchmarkAttemptRefs ?? [],
      "proposal.benchmarkAttemptRefs",
    ),
  };

  // The projection ref must pin the digest the same way every other
  // ref+digest pair does.
  assertRefDigest(
    proposal.patternProjectionRef,
    proposal.patternProjectionDigest,
    "proposal.patternProjection",
  );

  return deepFreeze(proposal);
}

function defineCasePartition(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object with parallel refs/digests arrays`);
  }
  const refs = uniqueStrings(value.refs, `${label}.refs`, { min: 1 });
  const digests = reqArray(value.digests, `${label}.digests`).map(
    (digest, index) => reqHex(digest, `${label}.digests[${index}]`),
  );
  if (refs.length !== digests.length) {
    fail(`${label} refs/digests must be parallel arrays of equal length`);
  }
  refs.forEach((ref, index) =>
    assertRefDigest(ref, digests[index], `${label}[${index}]`),
  );
  return Object.freeze({ refs: Object.freeze(refs), digests: Object.freeze(digests) });
}

// D10/SI4 — IMPROVEMENT_EVALUATION_HANDOFF_V1 validator/builder. The handoff
// freezes every evaluation input before search; partitions, holdout, metric
// policy and minEffect are immutable afterwards.
export function defineImprovementEvaluationHandoff(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("handoff must be an object");
  }
  assertNoAuthorityKeys(raw, "handoff");
  if (raw.kind !== IMPROVEMENT_EVALUATION_HANDOFF_KIND) {
    fail("handoff kind must be IMPROVEMENT_EVALUATION_HANDOFF_V1");
  }
  if (raw.version !== 1) {
    fail("handoff version must be 1");
  }

  const frozenAt = reqText(raw.frozenAt, "handoff.frozenAt");
  if (!Number.isFinite(Date.parse(frozenAt))) {
    fail("handoff.frozenAt must be an ISO-8601 timestamp");
  }

  assertSingleAxisKey(raw, "allowedAxis", "handoff");
  const allowedAxis = reqText(raw.allowedAxis, "handoff.allowedAxis");

  const optimizerIdentity = assertPinnedOptimizerIdentity(
    raw.optimizerIdentity,
    "handoff.optimizerIdentity",
  );
  const baselineHowStrategy = assertRefDigest(
    raw.baselineHowHead?.strategyRef,
    raw.baselineHowHead?.strategyDigest,
    "handoff.baselineHowHead.strategy",
  );

  const handoff = {
    kind: IMPROVEMENT_EVALUATION_HANDOFF_KIND,
    version: 1,
    frozenAt,
    whatRefs: Object.freeze(
      reqArray(raw.whatRefs, "handoff.whatRefs").map((entry, index) =>
        assertPinnedPair(entry, `handoff.whatRefs[${index}]`),
      ),
    ),
    acceptanceRefs: Object.freeze(
      reqArray(raw.acceptanceRefs, "handoff.acceptanceRefs").map(
        (entry, index) => assertPinnedPair(entry, `handoff.acceptanceRefs[${index}]`),
      ),
    ),
    baselineHowHead: {
      policyHeadRef: reqText(
        raw.baselineHowHead?.policyHeadRef,
        "handoff.baselineHowHead.policyHeadRef",
      ),
      strategyRef: baselineHowStrategy.ref,
      strategyDigest: baselineHowStrategy.digest,
    },
    optimizerIdentity,
    optimizerConfigDigest: reqHex(
      raw.optimizerConfigDigest,
      "handoff.optimizerConfigDigest",
    ),
    allowedAxis,
    developmentPartition: defineCasePartition(
      raw.developmentPartition,
      "handoff.developmentPartition",
    ),
    searchValidationPartition: defineCasePartition(
      raw.searchValidationPartition,
      "handoff.searchValidationPartition",
    ),
    finalHoldout: assertPinnedPair(raw.finalHoldout, "handoff.finalHoldout"),
    metricPolicy: assertPinnedPair(raw.metricPolicy, "handoff.metricPolicy"),
    minEffect: reqNumber(raw.minEffect, "handoff.minEffect"),
    modelIdentity: reqText(raw.modelIdentity, "handoff.modelIdentity"),
    providerIdentity: reqText(raw.providerIdentity, "handoff.providerIdentity"),
    toolIdentities: uniqueStrings(raw.toolIdentities, "handoff.toolIdentities", {
      min: 1,
    }),
    budgetIdentity: reqText(raw.budgetIdentity, "handoff.budgetIdentity"),
    evaluatorIdentity: reqText(raw.evaluatorIdentity, "handoff.evaluatorIdentity"),
  };

  if (handoff.whatRefs.length === 0) {
    fail("handoff.whatRefs must contain at least 1 pinned pair");
  }
  if (handoff.acceptanceRefs.length === 0) {
    fail("handoff.acceptanceRefs must contain at least 1 pinned pair");
  }

  return deepFreeze(handoff);
}

function assertValidatedProposal(proposal) {
  if (
    !proposal ||
    typeof proposal !== "object" ||
    proposal.kind !== HOW_IMPROVEMENT_PROPOSAL_KIND ||
    !Object.isFrozen(proposal)
  ) {
    fail(
      "buildHowEvolutionHandoff requires a frozen HOW_IMPROVEMENT_PROPOSAL_V1 from defineHowImprovementProposal",
    );
  }
}

function assertValidatedHandoff(handoff) {
  if (
    !handoff ||
    typeof handoff !== "object" ||
    handoff.kind !== IMPROVEMENT_EVALUATION_HANDOFF_KIND ||
    !Object.isFrozen(handoff)
  ) {
    fail(
      "buildHowEvolutionHandoff requires a frozen IMPROVEMENT_EVALUATION_HANDOFF_V1 from defineImprovementEvaluationHandoff",
    );
  }
}

// D11 — map the frozen proposal + handoff onto BB-059 finding/protocol inputs.
// The evaluator-owned final holdout is asserted absent from bridgeInput; only
// development and search-validation case refs may reach the bridge.
export function buildHowEvolutionHandoff({
  proposal,
  handoff,
  bridgeInput,
  repeatsPerCase = 3,
  context = {},
}) {
  assertValidatedProposal(proposal);
  assertValidatedHandoff(handoff);

  const bridgeRefs = reqArray(bridgeInput, "bridgeInput").map((entry, index) =>
    reqText(entry, `bridgeInput[${index}]`),
  );
  if (bridgeRefs.includes(handoff.finalHoldout.ref)) {
    fail(
      "HOLDOUT_EXPOSED: bridge input contains the evaluator-owned final holdout ref",
    );
  }

  const findingInput = deepFreeze({
    kind: HOW_EVOLUTION_FINDING_KIND,
    version: 1,
    id: proposal.patternKey,
    causalProjectionRef: proposal.patternProjectionRef,
    causalProjectionDigest: proposal.patternProjectionDigest,
    baselinePolicyRef: proposal.baselineHow.policyHeadRef,
    baselineStrategyRef: proposal.baselineHow.strategyRef,
    baselineStrategyDigest: proposal.baselineHow.strategyDigest,
    howAxis: proposal.allowedHowAxis,
    evidenceRefs: Object.freeze([...proposal.cohortEpisodeRefs]),
    proposedChange: Object.freeze({
      candidateStrategyRef: proposal.candidate.strategyRef,
      candidateStrategyDigest: proposal.candidate.digest,
    }),
    domain: context.domain ?? "cross-episode-pattern",
    workloadType: context.workloadType ?? "self-improvement",
    findingProducer: context.findingProducer ?? "improvement-proposal",
    observedAt: context.observedAt ?? handoff.frozenAt,
  });

  const findingDigest = sha256Hex(canonicalJson(findingInput));

  const caseRefs = uniquePreserveOrder([
    ...handoff.developmentPartition.refs,
    ...handoff.searchValidationPartition.refs,
  ]);

  const protocolInput = deepFreeze({
    kind: HOW_EVOLUTION_PROTOCOL_KIND,
    version: 1,
    id: `improvement-eval:${proposal.patternKey}`,
    finding: Object.freeze({
      ref: `how-evolution-finding:${proposal.patternKey}:sha256:${findingDigest}`,
      digest: findingDigest,
    }),
    baselineStrategy: Object.freeze({
      ref: proposal.baselineHow.strategyRef,
      digest: proposal.baselineHow.strategyDigest,
    }),
    candidateStrategy: Object.freeze({
      ref: proposal.candidate.strategyRef,
      digest: proposal.candidate.digest,
    }),
    baselineHowHead: handoff.baselineHowHead,
    declaredHowAxis: handoff.allowedAxis,
    caseRefs: Object.freeze(caseRefs),
    holdout: Object.freeze({
      ref: handoff.finalHoldout.ref,
      digest: handoff.finalHoldout.digest,
      evaluatorOwned: true,
      exposedToBridge: false,
    }),
    replay: Object.freeze({ repeatCount: repeatsPerCase, paired: true }),
    minEffect: handoff.minEffect,
    metricPolicy: handoff.metricPolicy,
    whatRefs: handoff.whatRefs,
    acceptanceRefs: handoff.acceptanceRefs,
    evaluatorIdentity: handoff.evaluatorIdentity,
    optimizerIdentity: handoff.optimizerIdentity,
    modelIdentity: handoff.modelIdentity,
    providerIdentity: handoff.providerIdentity,
    toolIdentities: handoff.toolIdentities,
    budgetIdentity: handoff.budgetIdentity,
    frozenAt: handoff.frozenAt,
  });

  const readiness =
    repeatsPerCase < 3
      ? Object.freeze({
          decision: "INCONCLUSIVE",
          reason: "INSUFFICIENT_PAIRED_REPEATS",
        })
      : Object.freeze({
          decision: "READY_FOR_INDEPENDENT_EVALUATION",
          reason: "AWAITING_INDEPENDENT_EVALUATION",
        });

  return deepFreeze({ findingInput, protocolInput, readiness });
}

// Decide the handoff outcome from paired per-case baseline/candidate results.
// Critical per-case regression blocks promotion even with aggregate gain;
// missing evidence is INCONCLUSIVE, never success. Actual promotion stays with
// the BB-059 independent authority.
export function evaluateHandoffOutcome({
  perCaseResults,
  minEffect = 0,
  epsilon = 1e-9,
}) {
  const results = reqArray(perCaseResults, "perCaseResults");
  if (results.length === 0) {
    fail("perCaseResults must contain at least 1 case");
  }
  reqNumber(minEffect, "minEffect");
  reqNumber(epsilon, "epsilon");

  const normalized = results.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`perCaseResults[${index}] must be an object`);
    }
    const caseRef = reqText(entry.caseRef, `perCaseResults[${index}].caseRef`);
    if (typeof entry.critical !== "boolean") {
      fail(`perCaseResults[${index}].critical must be a boolean`);
    }
    return {
      caseRef,
      critical: entry.critical,
      baseline: entry.baseline,
      candidate: entry.candidate,
      hasEvidence:
        typeof entry.baseline === "number" &&
        Number.isFinite(entry.baseline) &&
        typeof entry.candidate === "number" &&
        Number.isFinite(entry.candidate),
    };
  });

  const regressedCases = normalized
    .filter(
      (entry) =>
        entry.hasEvidence &&
        entry.critical &&
        entry.candidate < entry.baseline - epsilon,
    )
    .map((entry) => entry.caseRef);
  if (regressedCases.length > 0) {
    return deepFreeze({
      decision: "BLOCKED",
      reason: "CRITICAL_REGRESSION",
      regressedCases: Object.freeze(regressedCases),
    });
  }

  const missingCases = normalized
    .filter((entry) => !entry.hasEvidence)
    .map((entry) => entry.caseRef);
  if (missingCases.length > 0) {
    return deepFreeze({
      decision: "INCONCLUSIVE",
      reason: "MISSING_EVIDENCE",
      missingCases: Object.freeze(missingCases),
    });
  }

  const aggregateDelta =
    normalized.reduce(
      (sum, entry) => sum + (entry.candidate - entry.baseline),
      0,
    ) / normalized.length;

  return deepFreeze({
    decision: "READY_FOR_INDEPENDENT_EVALUATION",
    reason: "MEETS_HANDOFF_CRITERIA",
    minEffect,
    aggregateDelta,
    caseCount: normalized.length,
    criticalCaseCount: normalized.filter((entry) => entry.critical).length,
  });
}
