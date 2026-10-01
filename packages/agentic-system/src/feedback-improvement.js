import { createHash } from "node:crypto";
import {
  defineHowImprovementProposal,
  howImprovementProposalIdFor,
  HOW_IMPROVEMENT_PROPOSAL_KIND,
  HOW_IMPROVEMENT_PROPOSAL_VERSION,
  FEEDBACK_PROPOSAL_STATUS,
} from "./feedback-contracts.js";

// BB-083 S7 — Independent improvement handoff.
//
// The handoff freezes all experiment inputs BEFORE candidate search and
// normalizes an optimizer result into a HOW_IMPROVEMENT_PROPOSAL_V1 envelope.
// The proposal is submitted to the independent BB-059 evaluation authority;
// this module never accepts, promotes, or evaluates a candidate itself, and
// never sees the final holdout membership/evidence.
//
// Seams:
// - benchmark: optional injected benchmark seam. When present and exposing
//   registerAttempt, an attempt is reserved BEFORE the candidate is accepted
//   into a proposal. No reservation -> no proposal. When absent the handoff
//   works in record-only mode (no benchmark calls).
// - clock: optional { now() } injector for deterministic frozenAt timestamps.

const HEX64 = /^[a-f0-9]{64}$/;

const FORBIDDEN_HOLDOUT_KEYS = Object.freeze(["finalHoldoutMembers", "finalHoldoutEvidence"]);

const MODEL_BACKED_MIN_PAIRS = 3;

function fail(message) {
  throw new TypeError(`FEEDBACK_IMPROVEMENT_INVALID: ${message}`);
}
function reqText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
}
function reqHex(value, label) {
  reqText(value, label);
  if (!HEX64.test(value)) fail(`${label} must be sha256 hex`);
  return value;
}
function reqRef(value, label) {
  reqText(value, label);
  const match = value.match(/:sha256:([a-f0-9]{64})$/);
  if (!match) fail(`${label} must be a content-addressed ref (<kind>:sha256:<hex>)`);
  return value;
}
function reqArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}
function reqObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalString(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalString(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function definePinnedIdentity(raw, label) {
  const v = reqObject(raw, label);
  const ref = reqRef(v.ref, `${label}.ref`);
  const digest = reqHex(v.digest, `${label}.digest`);
  if (ref.slice(-64) !== digest) fail(`${label} ref digest must equal ${label}.digest`);
  return freeze({ ref, digest });
}

function assertNoHoldoutExposure(value, path, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoHoldoutExposure(v, `${path}[${i}]`, seen));
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    if (FORBIDDEN_HOLDOUT_KEYS.includes(key)) {
      fail(`${path}.${key} is forbidden: the final holdout membership/evidence is never exposed to the handoff`);
    }
    assertNoHoldoutExposure(value[key], `${path}.${key}`, seen);
  }
}

function mean(values) {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function createImprovementHandoff({ benchmark = null, clock = null } = {}) {
  if (benchmark !== null && benchmark !== undefined && (typeof benchmark !== "object" || Array.isArray(benchmark))) {
    fail("benchmark must be an object or omitted");
  }
  if (clock !== null && clock !== undefined && typeof clock?.now !== "function") {
    fail("clock must expose now() or be omitted");
  }
  const now = clock ? () => clock.now() : () => new Date().toISOString();
  const scopes = new Map();

  function freezeExperimentScope({ howSubject, optimizerIdentity, partitions, metricPolicy } = {}) {
    const input = { howSubject, optimizerIdentity, partitions, metricPolicy };
    // The final holdout NAME may be recorded; its membership/evidence is
    // never accepted here, anywhere in the input.
    assertNoHoldoutExposure(input, "freezeExperimentScope input");

    const subject = definePinnedIdentity(howSubject, "howSubject");

    const optRaw = reqObject(optimizerIdentity, "optimizerIdentity");
    const optimizer = freeze({
      name: reqText(optRaw.name, "optimizerIdentity.name"),
      ref: reqRef(optRaw.ref, "optimizerIdentity.ref"),
    });

    const partRaw = reqObject(partitions, "partitions");
    if (partRaw.finalHoldoutSealed !== true) fail("partitions.finalHoldoutSealed must be true");
    const parts = {
      development: reqText(partRaw.development, "partitions.development"),
      searchValidation: reqText(partRaw.searchValidation, "partitions.searchValidation"),
      finalHoldoutSealed: true,
    };
    if (partRaw.finalHoldout !== undefined && partRaw.finalHoldout !== null) {
      parts.finalHoldout = reqText(partRaw.finalHoldout, "partitions.finalHoldout");
    }
    const partitionFrozen = freeze(parts);

    const policyRaw = reqObject(metricPolicy, "metricPolicy");
    const policyRef = reqRef(policyRaw.ref, "metricPolicy.ref");
    const policyDigest = reqHex(policyRaw.digest, "metricPolicy.digest");
    if (policyRef.slice(-64) !== policyDigest) {
      fail("metricPolicy ref digest must equal metricPolicy.digest");
    }
    // minEffect is required and finite; it is never invented here.
    const minEffect = policyRaw.minEffect;
    if (typeof minEffect !== "number" || !Number.isFinite(minEffect)) {
      fail("metricPolicy.minEffect must be a finite number; no universal percentage is invented");
    }
    const policy = freeze({ ref: policyRef, digest: policyDigest, minEffect });

    const content = freeze({
      howSubject: subject,
      optimizerIdentity: optimizer,
      partitions: partitionFrozen,
      metricPolicy: policy,
    });
    const scopeId = sha256Hex(canonicalString(content));
    const scope = freeze({
      scopeId,
      howSubject: content.howSubject,
      optimizerIdentity: content.optimizerIdentity,
      partitions: content.partitions,
      metricPolicy: content.metricPolicy,
      frozenAt: reqText(now(), "frozenAt"),
    });
    scopes.set(scopeId, scope);
    return scope;
  }

  function lookupScope(scopeId) {
    reqText(scopeId, "scopeId");
    const scope = scopes.get(scopeId);
    if (!scope) fail(`unknown scopeId: ${scopeId}`);
    return scope;
  }

  function submitCandidate({ scopeId, candidateEvidenceRef, optimizerResult } = {}) {
    const scope = lookupScope(scopeId);
    // optimizerResult is untrusted: only its candidateEvidenceRef is ever
    // extracted. accepted/promoted/verdict/score fields are ignored — the
    // optimizer never accepts, promotes, or judges.
    if (optimizerResult !== undefined && optimizerResult !== null) {
      reqObject(optimizerResult, "optimizerResult");
    }
    const trustedRef =
      candidateEvidenceRef !== undefined && candidateEvidenceRef !== null
        ? candidateEvidenceRef
        : optimizerResult?.candidateEvidenceRef;
    const evidenceRef = reqRef(trustedRef, "candidateEvidenceRef");

    // Reserve the benchmark attempt BEFORE accepting the candidate. No
    // reservation -> no proposal dispatch.
    if (benchmark !== null && benchmark !== undefined && typeof benchmark.registerAttempt === "function") {
      let reservation;
      try {
        reservation = benchmark.registerAttempt({ scopeId, candidateEvidenceRef: evidenceRef });
      } catch (err) {
        fail(`benchmark.registerAttempt failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (reservation === null || reservation === undefined) {
        fail("benchmark reservation failed: no attempt reserved, candidate not dispatched");
      }
    }

    const proposal = defineHowImprovementProposal({
      kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
      version: HOW_IMPROVEMENT_PROPOSAL_VERSION,
      howSubject: { ref: scope.howSubject.ref, digest: scope.howSubject.digest },
      optimizerIdentity: { name: scope.optimizerIdentity.name, ref: scope.optimizerIdentity.ref },
      partitions: {
        development: scope.partitions.development,
        searchValidation: scope.partitions.searchValidation,
        finalHoldoutSealed: scope.partitions.finalHoldoutSealed,
      },
      metricPolicy: {
        ref: scope.metricPolicy.ref,
        digest: scope.metricPolicy.digest,
        minEffect: scope.metricPolicy.minEffect,
      },
      candidateEvidenceRef: evidenceRef,
      status: FEEDBACK_PROPOSAL_STATUS.PROPOSED,
    });
    return freeze({ proposal, proposalId: howImprovementProposalIdFor(proposal) });
  }

  // Deterministic final comparison of paired baseline/candidate repeats.
  // Never success by default: missing or insufficient measurements are
  // INCONCLUSIVE, unknowable comparisons are UNKNOWN, and IMPROVED is only
  // returned for a decisive aggregate margin over the frozen minEffect.
  function evaluateFinal({ scopeId, baselineEvidenceRef, candidateEvidenceRef, measurements, policy } = {}) {
    const scope = lookupScope(scopeId);
    reqRef(baselineEvidenceRef, "baselineEvidenceRef");
    reqRef(candidateEvidenceRef, "candidateEvidenceRef");
    const pol = policy === undefined || policy === null ? {} : reqObject(policy, "policy");
    const modelBacked = pol.modelBacked === true;
    const direction = pol.direction === undefined || pol.direction === null ? "higher" : pol.direction;
    if (direction !== "higher" && direction !== "lower") {
      fail("policy.direction must be 'higher' or 'lower'");
    }
    const minEffect = scope.metricPolicy.minEffect;

    const detailBase = freeze({
      scopeId,
      baselineEvidenceRef,
      candidateEvidenceRef,
      minEffect,
      direction,
      modelBacked,
    });

    if (measurements === undefined || measurements === null) {
      return freeze({
        scopeId,
        outcome: "INCONCLUSIVE",
        detail: freeze({ ...detailBase, reason: "measurements missing" }),
      });
    }
    const m = reqObject(measurements, "measurements");
    const baseline = reqArray(m.baseline, "measurements.baseline");
    const candidate = reqArray(m.candidate, "measurements.candidate");

    const caseKey = (entry, label, i) => {
      reqObject(entry, `${label}[${i}]`);
      return reqText(entry.case, `${label}[${i}].case`);
    };
    const valueOf = (entry, label, i) => {
      const v = entry.value;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        fail(`${label}[${i}].value must be a finite number`);
      }
      return v;
    };

    const group = (entries, label) => {
      const byCase = new Map();
      entries.forEach((entry, i) => {
        const key = caseKey(entry, label, i);
        const value = valueOf(entry, label, i);
        if (!byCase.has(key)) byCase.set(key, { values: [], criticalRegression: false });
        const bucket = byCase.get(key);
        bucket.values.push(value);
        if (entry.criticalRegression === true) bucket.criticalRegression = true;
      });
      return byCase;
    };
    const baselineByCase = group(baseline, "measurements.baseline");
    const candidateByCase = group(candidate, "measurements.candidate");

    // Any critical regression flag dominates: REGRESSED even if the
    // aggregate improves.
    const regressedCases = [];
    for (const [key, bucket] of candidateByCase) {
      if (bucket.criticalRegression) regressedCases.push(key);
    }
    for (const [key, bucket] of baselineByCase) {
      if (bucket.criticalRegression && !regressedCases.includes(key)) regressedCases.push(key);
    }
    if (regressedCases.length > 0) {
      return freeze({
        scopeId,
        outcome: "REGRESSED",
        detail: freeze({ ...detailBase, regressedCases: freeze([...regressedCases]) }),
      });
    }

    // Pair repeats per case on shared case keys.
    const pairs = [];
    for (const [key, base] of baselineByCase) {
      const cand = candidateByCase.get(key);
      if (!cand) continue;
      const n = Math.min(base.values.length, cand.values.length);
      if (n === 0) continue;
      pairs.push({ case: key, pairs: n, baselineMean: mean(base.values.slice(0, n)), candidateMean: mean(cand.values.slice(0, n)) });
    }

    if (pairs.length === 0) {
      // Measurements exist but baseline/candidate cannot be related on any
      // case: the comparison subject is unknowable, never IMPROVED.
      return freeze({
        scopeId,
        outcome: "UNKNOWN",
        detail: freeze({ ...detailBase, reason: "no paired cases between baseline and candidate" }),
      });
    }

    const requiredPairs = modelBacked ? MODEL_BACKED_MIN_PAIRS : 1;
    const thinCases = pairs.filter((p) => p.pairs < requiredPairs).map((p) => p.case);
    if (thinCases.length > 0) {
      return freeze({
        scopeId,
        outcome: "INCONCLUSIVE",
        detail: freeze({
          ...detailBase,
          reason: modelBacked
            ? `model-backed comparison requires >= ${MODEL_BACKED_MIN_PAIRS} paired repeats per case`
            : "insufficient paired repeats",
          requiredPairsPerCase: requiredPairs,
          thinCases: freeze(thinCases),
        }),
      });
    }

    const diffs = pairs.map((p) => p.candidateMean - p.baselineMean);
    const aggregate = mean(diffs);
    const effect = direction === "lower" ? -aggregate : aggregate;

    let outcome;
    if (minEffect === 0) {
      outcome = effect > 0 ? "IMPROVED" : effect < 0 ? "REGRESSED" : "NO_CHANGE";
    } else {
      outcome = effect >= minEffect ? "IMPROVED" : effect <= -minEffect ? "REGRESSED" : "NO_CHANGE";
    }

    return freeze({
      scopeId,
      outcome,
      detail: freeze({
        ...detailBase,
        effect,
        aggregate,
        cases: freeze(pairs.map((p) => freeze({ case: p.case, pairs: p.pairs }))),
      }),
    });
  }

  return freeze({ freezeExperimentScope, submitCandidate, evaluateFinal });
}
