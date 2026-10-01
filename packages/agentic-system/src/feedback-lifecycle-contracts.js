import { createHash } from "node:crypto";

export const FEEDBACK_EPISODE_KIND = "FEEDBACK_EPISODE_V1";
export const FEEDBACK_EPISODE_VERSION = 1;
export const FEEDBACK_RESPONSE_KIND = "FEEDBACK_RESPONSE_V1";
export const FEEDBACK_RESPONSE_VERSION = 1;
export const FEEDBACK_OUTCOME_POLICY_KIND = "FEEDBACK_OUTCOME_POLICY_V1";
export const FEEDBACK_OUTCOME_POLICY_VERSION = 1;
export const FEEDBACK_OUTCOME_KIND = "FEEDBACK_OUTCOME_V1";
export const FEEDBACK_OUTCOME_VERSION = 1;
export const FEEDBACK_RESOLUTION_KIND = "FEEDBACK_RESOLUTION_V1";
export const FEEDBACK_RESOLUTION_VERSION = 1;

export const FEEDBACK_DISPOSITIONS = Object.freeze(["ACTED", "REJECTED", "DEFERRED", "SUPERSEDED"]);
export const FEEDBACK_OUTCOMES = Object.freeze(["IMPROVED", "NO_CHANGE", "REGRESSED", "UNKNOWN"]);
export const FEEDBACK_RESOLUTIONS = Object.freeze([
  "IMPROVED",
  "NO_CHANGE",
  "REGRESSED",
  "REJECTED_ACKNOWLEDGED",
  "SUPERSEDED",
]);
export const FEEDBACK_IMPACT_BASES = Object.freeze(["MEASURED", "HYPOTHESIZED"]);
export const FEEDBACK_PRODUCER_KINDS = Object.freeze(["OBSERVER", "MODEL", "HUMAN", "APPLICATION"]);
export const FEEDBACK_POLICY_DIRECTIONS = Object.freeze(["HIGHER_IS_BETTER", "LOWER_IS_BETTER"]);
export const FEEDBACK_REVISIT_KINDS = Object.freeze(["AFTER_EPISODE", "AFTER_REVISION", "MANUAL"]);

const HEX64 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new TypeError(message);
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
function reqArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
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
function jsonSafe(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || seen.has(value)) fail(`${label} must be JSON-safe`);
  seen.add(value);
  let out;
  if (Array.isArray(value)) out = value.map((v, i) => jsonSafe(v, `${label}[${i}]`, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail(`${label} must be JSON-safe`);
    }
    out = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || value[key] === undefined) fail(`${label} must be JSON-safe`);
      out[key] = jsonSafe(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return out;
}

function assertPin(pin, label) {
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) fail(`${label} pin required`);
  const ref = reqText(pin.ref, `${label}.ref`);
  const digest = reqHex(pin.digest, `${label}.digest`);
  const match = ref.match(/:sha256:([a-f0-9]{64})$/);
  if (!match || match[1] !== digest) fail(`${label} pin digest mismatch`);
  return { ref, digest };
}

function assertRefDigest(ref, digest, label) {
  reqText(ref, `${label}Ref`);
  reqHex(digest, `${label}Digest`);
  const match = ref.match(/:sha256:([a-f0-9]{64})$/);
  if (!match || match[1] !== digest) fail(`${label} ref/digest mismatch`);
}

// Finding and impact are evidence; they grant no disposition, acceptance,
// lifecycle or promotion authority. Reject smuggled authority fields.
const FORBIDDEN_EPISODE_KEYS = Object.freeze([
  "principal",
  "authority",
  "disposition",
  "response",
  "verdict",
  "accepted",
  "promoted",
  "promotion",
  "resolution",
  "outcome",
]);
const FORBIDDEN_RESPONSE_KEYS = Object.freeze([
  "principal",
  "authority",
  "verdict",
  "accepted",
  "promoted",
  "promotion",
  "finding",
  "impact",
]);
const ALLOWED_EXCEPTION_KEYS = Object.freeze(["principalAuthorityRef"]);

function assertNoForbiddenKeys(value, forbidden, path, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenKeys(v, forbidden, `${path}[${i}]`, seen));
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    if (forbidden.includes(key) && !ALLOWED_EXCEPTION_KEYS.includes(key)) {
      fail(`${path}.${key} carries forbidden authority field ${key}`);
    }
    assertNoForbiddenKeys(value[key], forbidden, `${path}.${key}`, seen);
  }
}

function episodeContentForId(body) {
  return {
    kind: body.kind,
    version: body.version,
    groundedInputRefs: body.groundedInputRefs,
    finding: body.finding,
    impact: body.impact,
    scopeKey: body.scopeKey,
    contraryEvidenceRefs: body.contraryEvidenceRefs,
  };
}

export function episodeIdFor(content) {
  return sha256Hex(canonicalString(episodeContentForId(content)));
}

function defineFinding(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("episode finding required");
  const kind = reqText(raw.kind, "finding.kind");
  const statement = reqText(raw.statement, "finding.statement");
  const evidenceRefs = reqArray(raw.evidenceRefs, "finding.evidenceRefs").map((p, i) =>
    assertPin(p, `finding.evidenceRefs[${i}]`),
  );
  const producer = raw.producer;
  if (!producer || typeof producer !== "object" || Array.isArray(producer)) fail("finding.producer required");
  const producerKind = reqText(producer.kind, "finding.producer.kind");
  if (!FEEDBACK_PRODUCER_KINDS.includes(producerKind)) {
    fail("finding.producer.kind must be OBSERVER, MODEL, HUMAN or APPLICATION");
  }
  const producerId = reqText(producer.id, "finding.producer.id");
  jsonSafe(raw.kind, "finding.kind");
  return freeze({ kind, statement, evidenceRefs, producer: freeze({ kind: producerKind, id: producerId }) });
}

function defineImpactMeasurements(raw) {
  return freeze(
    reqArray(raw, "impact.measurements").map((m, i) => {
      if (!m || typeof m !== "object") fail(`impact.measurements[${i}] required`);
      const key = reqText(m.key, `impact.measurements[${i}].key`);
      const value = m.value ?? null;
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        fail(`impact.measurements[${i}].value must be a finite number or null`);
      }
      const out = { key, value };
      if (m.unit !== undefined && m.unit !== null) out.unit = reqText(m.unit, `impact.measurements[${i}].unit`);
      else out.unit = null;
      if (m.evidenceRef !== undefined && m.evidenceRef !== null) {
        out.evidenceRef = reqText(m.evidenceRef, `impact.measurements[${i}].evidenceRef`);
      } else out.evidenceRef = null;
      if (m.reason !== undefined && m.reason !== null) {
        out.reason = reqText(m.reason, `impact.measurements[${i}].reason`);
        if (value !== null) fail(`impact.measurements[${i}] carries a reason so value must be null, never zero`);
      } else out.reason = null;
      if (value === null && out.reason === null) fail(`impact.measurements[${i}] with null value requires a reason`);
      return freeze(out);
    }),
  );
}

function defineImpact(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("episode impact required");
  const basis = reqText(raw.basis, "impact.basis");
  if (!FEEDBACK_IMPACT_BASES.includes(basis)) fail("impact.basis must be MEASURED or HYPOTHESIZED");
  const measurements = defineImpactMeasurements(raw.measurements ?? []);
  if (basis === "MEASURED") {
    if (measurements.length === 0) fail("MEASURED impact requires at least one measurement");
    for (const m of measurements) {
      if (m.value === null || typeof m.value !== "number" || !Number.isFinite(m.value)) {
        fail("MEASURED impact requires every measurement value to be a finite number, never null");
      }
    }
  }
  return freeze({ basis, measurements });
}

export function defineFeedbackEpisode(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("FEEDBACK_EPISODE_V1 required");
  assertNoForbiddenKeys(raw, FORBIDDEN_EPISODE_KEYS, "episode");
  if (raw.kind !== FEEDBACK_EPISODE_KIND) fail("episode kind must be FEEDBACK_EPISODE_V1");
  if (raw.version !== FEEDBACK_EPISODE_VERSION) fail("episode version must be 1");
  const groundedInputRefs = reqArray(raw.groundedInputRefs, "groundedInputRefs").map((p, i) =>
    assertPin(p, `groundedInputRefs[${i}]`),
  );
  if (groundedInputRefs.length === 0) fail("episode requires at least one grounded input ref");
  const finding = defineFinding(raw.finding);
  const impact = defineImpact(raw.impact);
  const scopeKey = reqText(raw.scopeKey, "scopeKey");
  const contraryEvidenceRefs = reqArray(raw.contraryEvidenceRefs, "contraryEvidenceRefs").map((p, i) =>
    assertPin(p, `contraryEvidenceRefs[${i}]`),
  );
  const body = {
    kind: FEEDBACK_EPISODE_KIND,
    version: 1,
    groundedInputRefs,
    finding,
    impact,
    scopeKey,
    contraryEvidenceRefs,
  };
  const episodeId = episodeIdFor(body);
  if (raw.episodeId !== undefined && raw.episodeId !== episodeId) {
    fail("episodeId does not match episode content");
  }
  assertNoForbiddenKeys(body, FORBIDDEN_EPISODE_KEYS, "episode");
  return freeze({ ...body, episodeId });
}

function policyContentForDigest(body) {
  return {
    kind: body.kind,
    version: body.version,
    metricKey: body.metricKey,
    direction: body.direction,
    minEffect: body.minEffect,
    noChangeBand: body.noChangeBand,
    requiredMeasurementKeys: body.requiredMeasurementKeys,
  };
}

export function outcomePolicyDigestFor(policy) {
  return sha256Hex(canonicalString(policyContentForDigest(policy)));
}

export function defineFeedbackOutcomePolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("FEEDBACK_OUTCOME_POLICY_V1 required");
  if (raw.kind !== FEEDBACK_OUTCOME_POLICY_KIND) fail("outcome policy kind must be FEEDBACK_OUTCOME_POLICY_V1");
  if (raw.version !== FEEDBACK_OUTCOME_POLICY_VERSION) fail("outcome policy version must be 1");
  const metricKey = reqText(raw.metricKey, "policy.metricKey");
  const direction = reqText(raw.direction, "policy.direction");
  if (!FEEDBACK_POLICY_DIRECTIONS.includes(direction)) {
    fail("policy.direction must be HIGHER_IS_BETTER or LOWER_IS_BETTER");
  }
  const minEffect = raw.minEffect;
  if (typeof minEffect !== "number" || !Number.isFinite(minEffect) || minEffect <= 0) {
    fail("policy.minEffect must be a finite number greater than zero");
  }
  const noChangeBand = raw.noChangeBand;
  if (typeof noChangeBand !== "number" || !Number.isFinite(noChangeBand) || noChangeBand < 0) {
    fail("policy.noChangeBand must be a finite number at or above zero");
  }
  if (noChangeBand > minEffect) fail("policy.noChangeBand must not exceed minEffect");
  const requiredMeasurementKeys = reqArray(raw.requiredMeasurementKeys, "policy.requiredMeasurementKeys").map(
    (k, i) => reqText(k, `policy.requiredMeasurementKeys[${i}]`),
  );
  if (requiredMeasurementKeys.length === 0) fail("policy requires at least one required measurement key");
  if (!requiredMeasurementKeys.includes(metricKey)) {
    fail("policy.requiredMeasurementKeys must include metricKey");
  }
  if (new Set(requiredMeasurementKeys).size !== requiredMeasurementKeys.length) {
    fail("policy.requiredMeasurementKeys must be unique");
  }
  return freeze({
    kind: FEEDBACK_OUTCOME_POLICY_KIND,
    version: 1,
    metricKey,
    direction,
    minEffect,
    noChangeBand,
    requiredMeasurementKeys: freeze([...requiredMeasurementKeys]),
  });
}

function defineRevisitCondition(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("revisitCondition must be an object or null");
  const kind = reqText(raw.kind, "revisitCondition.kind");
  if (!FEEDBACK_REVISIT_KINDS.includes(kind)) fail("revisitCondition.kind invalid");
  const ref = raw.ref ?? null;
  if (ref !== null) reqText(ref, "revisitCondition.ref");
  return freeze({ kind, ref });
}

export function defineFeedbackResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("FEEDBACK_RESPONSE_V1 required");
  assertNoForbiddenKeys(raw, FORBIDDEN_RESPONSE_KEYS, "response");
  if (raw.kind !== FEEDBACK_RESPONSE_KIND) fail("response kind must be FEEDBACK_RESPONSE_V1");
  if (raw.version !== FEEDBACK_RESPONSE_VERSION) fail("response version must be 1");
  const episodeRef = reqText(raw.episodeRef, "episodeRef");
  const episodeDigest = reqHex(raw.episodeDigest, "episodeDigest");
  assertRefDigest(episodeRef, episodeDigest, "episode");
  let previousResponseRef = null;
  if (raw.previousResponseRef !== null && raw.previousResponseRef !== undefined) {
    previousResponseRef = assertPin(raw.previousResponseRef, "previousResponseRef");
  }
  const principalAuthorityRef = reqText(raw.principalAuthorityRef, "principalAuthorityRef");
  const disposition = reqText(raw.disposition, "disposition");
  if (!FEEDBACK_DISPOSITIONS.includes(disposition)) fail("response disposition invalid");
  const rationaleRef = raw.rationaleRef ?? null;
  if (rationaleRef !== null) reqText(rationaleRef, "rationaleRef");
  const actionRefs = reqArray(raw.actionRefs ?? [], "actionRefs").map((r, i) =>
    reqText(r, `actionRefs[${i}]`),
  );
  const successorEpisodeRef = raw.successorEpisodeRef ?? null;
  if (successorEpisodeRef !== null) reqText(successorEpisodeRef, "successorEpisodeRef");
  const revisitCondition = defineRevisitCondition(raw.revisitCondition ?? null);
  let outcomePolicy = null;
  let outcomePolicyDigest = null;
  if (raw.outcomePolicy !== null && raw.outcomePolicy !== undefined) {
    outcomePolicy = defineFeedbackOutcomePolicy(raw.outcomePolicy);
    outcomePolicyDigest = outcomePolicyDigestFor(outcomePolicy);
    if (raw.outcomePolicyDigest !== undefined && raw.outcomePolicyDigest !== null) {
      reqHex(raw.outcomePolicyDigest, "outcomePolicyDigest");
      if (raw.outcomePolicyDigest !== outcomePolicyDigest) fail("outcomePolicyDigest does not match outcome policy");
    }
  } else if (raw.outcomePolicyDigest !== null && raw.outcomePolicyDigest !== undefined) {
    fail("outcomePolicyDigest without outcomePolicy is rejected");
  }

  if (disposition === "ACTED") {
    if (actionRefs.length === 0) fail("ACTED response requires non-empty actionRefs");
    if (outcomePolicy === null) fail("ACTED response requires a frozen outcomePolicy");
    if (successorEpisodeRef !== null) fail("ACTED response carries no successorEpisodeRef");
    if (revisitCondition !== null) fail("ACTED response carries no revisitCondition");
  } else if (disposition === "REJECTED") {
    if (rationaleRef === null) fail("REJECTED response requires rationaleRef");
    if (actionRefs.length !== 0) fail("REJECTED response carries no actionRefs");
    if (outcomePolicy !== null) fail("REJECTED response carries no outcomePolicy");
    if (successorEpisodeRef !== null) fail("REJECTED response carries no successorEpisodeRef");
    if (revisitCondition !== null) fail("REJECTED response carries no revisitCondition");
  } else if (disposition === "DEFERRED") {
    if (revisitCondition === null) fail("DEFERRED response requires revisitCondition");
    if (actionRefs.length !== 0) fail("DEFERRED response carries no actionRefs");
    if (outcomePolicy !== null) fail("DEFERRED response carries no outcomePolicy");
    if (successorEpisodeRef !== null) fail("DEFERRED response carries no successorEpisodeRef");
  } else if (disposition === "SUPERSEDED") {
    if (successorEpisodeRef === null) fail("SUPERSEDED response requires successorEpisodeRef");
    if (actionRefs.length !== 0) fail("SUPERSEDED response carries no actionRefs");
    if (outcomePolicy !== null) fail("SUPERSEDED response carries no outcomePolicy");
    if (revisitCondition !== null) fail("SUPERSEDED response carries no revisitCondition");
  }
  const body = freeze({
    kind: FEEDBACK_RESPONSE_KIND,
    version: 1,
    episodeRef,
    episodeDigest,
    previousResponseRef,
    principalAuthorityRef,
    disposition,
    rationaleRef,
    actionRefs: freeze([...actionRefs]),
    successorEpisodeRef,
    revisitCondition,
    outcomePolicy,
    outcomePolicyDigest,
  });
  assertNoForbiddenKeys(body, FORBIDDEN_RESPONSE_KEYS, "response");
  return body;
}

function defineOutcomeMeasurements(raw, label) {
  return freeze(
    reqArray(raw, label).map((m, i) => {
      if (!m || typeof m !== "object") fail(`${label}[${i}] required`);
      const key = reqText(m.key, `${label}[${i}].key`);
      const value = m.value ?? null;
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        // Non-finite values are never coerced; they are held as null with a
        // reason by the caller. Reject them here so classification never sees
        // an invented zero.
        fail(`${label}[${i}].value must be a finite number or null`);
      }
      return freeze({ key, value });
    }),
  );
}

export function defineFeedbackOutcome(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("FEEDBACK_OUTCOME_V1 required");
  if (raw.kind !== FEEDBACK_OUTCOME_KIND) fail("outcome kind must be FEEDBACK_OUTCOME_V1");
  if (raw.version !== FEEDBACK_OUTCOME_VERSION) fail("outcome version must be 1");
  const responseRef = reqText(raw.responseRef, "responseRef");
  const responseDigest = reqHex(raw.responseDigest, "responseDigest");
  assertRefDigest(responseRef, responseDigest, "response");
  const freshInputRef = reqText(raw.freshInputRef, "freshInputRef");
  const freshInputDigest = reqHex(raw.freshInputDigest, "freshInputDigest");
  assertRefDigest(freshInputRef, freshInputDigest, "freshInput");
  const freshness = raw.freshness;
  if (!freshness || typeof freshness !== "object" || Array.isArray(freshness)) fail("outcome freshness required");
  const freshExecutionAttemptIds = reqArray(
    freshness.freshExecutionAttemptIds,
    "freshness.freshExecutionAttemptIds",
  ).map((v, i) => reqText(v, `freshness.freshExecutionAttemptIds[${i}]`));
  const effectiveAfterBoundary = reqText(freshness.effectiveAfterBoundary, "freshness.effectiveAfterBoundary");
  if (!Number.isFinite(Date.parse(effectiveAfterBoundary))) fail("freshness.effectiveAfterBoundary is not a timestamp");
  const policyDigest = reqHex(raw.policyDigest, "policyDigest");
  const baselineMeasurements = defineOutcomeMeasurements(raw.baselineMeasurements ?? [], "baselineMeasurements");
  const freshMeasurements = defineOutcomeMeasurements(raw.freshMeasurements ?? [], "freshMeasurements");
  const outcome = reqText(raw.outcome, "outcome");
  if (!FEEDBACK_OUTCOMES.includes(outcome)) fail("outcome value invalid");
  const reasons = reqArray(raw.reasons ?? [], "reasons").map((r, i) => reqText(r, `reasons[${i}]`));
  if (outcome === "UNKNOWN" && reasons.length === 0) fail("UNKNOWN outcome requires at least one reason");
  return freeze({
    kind: FEEDBACK_OUTCOME_KIND,
    version: 1,
    responseRef,
    responseDigest,
    freshInputRef,
    freshInputDigest,
    freshness: freeze({ freshExecutionAttemptIds: freeze([...freshExecutionAttemptIds]), effectiveAfterBoundary }),
    policyDigest,
    baselineMeasurements,
    freshMeasurements,
    outcome,
    reasons: freeze([...reasons]),
  });
}

export function defineFeedbackResolution(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("FEEDBACK_RESOLUTION_V1 required");
  if (raw.kind !== FEEDBACK_RESOLUTION_KIND) fail("resolution kind must be FEEDBACK_RESOLUTION_V1");
  if (raw.version !== FEEDBACK_RESOLUTION_VERSION) fail("resolution version must be 1");
  const episodeRef = reqText(raw.episodeRef, "episodeRef");
  const episodeDigest = raw.episodeDigest ?? null;
  if (episodeDigest !== null) {
    reqHex(episodeDigest, "episodeDigest");
    assertRefDigest(episodeRef, episodeDigest, "episode");
  }
  const finalResponseRef = reqText(raw.finalResponseRef, "finalResponseRef");
  const finalResponseDigest = raw.finalResponseDigest ?? null;
  if (finalResponseDigest !== null) {
    reqHex(finalResponseDigest, "finalResponseDigest");
    assertRefDigest(finalResponseRef, finalResponseDigest, "finalResponse");
  }
  let outcomeRef = raw.outcomeRef ?? null;
  if (outcomeRef !== null) reqText(outcomeRef, "outcomeRef");
  let outcomeDigest = raw.outcomeDigest ?? null;
  if ((outcomeRef === null) !== (outcomeDigest === null)) {
    fail("outcomeRef and outcomeDigest must both be set or both be null");
  }
  if (outcomeDigest !== null) {
    reqHex(outcomeDigest, "outcomeDigest");
    assertRefDigest(outcomeRef, outcomeDigest, "outcome");
  }
  const resolution = reqText(raw.resolution, "resolution");
  if (!FEEDBACK_RESOLUTIONS.includes(resolution)) fail("resolution value invalid");
  const principalAuthorityRef = reqText(raw.principalAuthorityRef, "principalAuthorityRef");
  if ((resolution === "IMPROVED" || resolution === "NO_CHANGE" || resolution === "REGRESSED") && outcomeRef === null) {
    fail(`${resolution} resolution requires an outcomeRef`);
  }
  if ((resolution === "REJECTED_ACKNOWLEDGED" || resolution === "SUPERSEDED") && outcomeRef !== null) {
    fail(`${resolution} resolution carries no outcomeRef`);
  }
  return freeze({
    kind: FEEDBACK_RESOLUTION_KIND,
    version: 1,
    episodeRef,
    episodeDigest,
    finalResponseRef,
    finalResponseDigest,
    outcomeRef,
    outcomeDigest,
    resolution,
    principalAuthorityRef,
  });
}
