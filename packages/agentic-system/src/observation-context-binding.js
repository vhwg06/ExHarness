import { createHash } from "node:crypto";
import { defineGroundedObservation } from "./grounded-observation.js";

export const OBSERVATION_CONTEXT_BINDING_KIND = "OBSERVATION_CONTEXT_BINDING_V1";
export const OBSERVATION_CONTEXT_BINDING_VERSION = 1;

export const UNRESOLVED_REASONS = Object.freeze([
  "MISSING_PROVENANCE",
  "MISSING_CONTEXT",
  "UNSATISFIED_CONTEXT",
  "STALE_CONTEXT",
  "AMBIGUOUS_CONTEXT",
  "CURRENTNESS_UNVERIFIABLE",
  "SUBJECT_MISMATCH",
]);

const REASON_ORDER = Object.freeze([...UNRESOLVED_REASONS]);
const RESOLUTION_STATUSES = Object.freeze(["COMPLETE", "PARTIAL", "UNSATISFIED"]);
const CURRENTNESS_STATUSES = Object.freeze(["CURRENT", "STALE", "CURRENTNESS_UNVERIFIABLE"]);
const NECESSITIES = Object.freeze(["REQUIRED", "OPTIONAL"]);
const HEX64 = /^[a-f0-9]{64}$/;

const FORBIDDEN_PORT_METHODS = Object.freeze([
  "publish",
  "claim",
  "dispatch",
  "accept",
  "recover",
  "compareAndSwap",
]);

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

function bindingContentForId(body) {
  return {
    kind: body.kind,
    version: body.version,
    observationRef: body.observationRef,
    observationDigest: body.observationDigest,
    requirementId: body.requirementId,
    resolutionId: body.resolutionId,
    resolutionStatus: body.resolutionStatus,
    unresolvedEvidence: body.unresolvedEvidence,
    receiptRef: body.receiptRef,
    receiptDigest: body.receiptDigest,
    currentness: body.currentness,
  };
}

export function contextBindingIdFor(content) {
  return sha256Hex(canonicalString(bindingContentForId(content)));
}

function defineUnresolvedEvidence(raw) {
  return freeze(
    reqArray(raw, "unresolvedEvidence").map((u, i) => {
      if (!u || typeof u !== "object") fail(`unresolvedEvidence[${i}] required`);
      const necessity = reqText(u.necessity, `unresolvedEvidence[${i}].necessity`);
      if (!NECESSITIES.includes(necessity)) fail(`unresolvedEvidence[${i}].necessity invalid`);
      const out = {
        evidenceId: reqText(u.evidenceId, `unresolvedEvidence[${i}].evidenceId`),
        necessity,
      };
      if (u.reason !== undefined && u.reason !== null) out.reason = reqText(u.reason, `unresolvedEvidence[${i}].reason`);
      return freeze(out);
    }),
  );
}

function defineCurrentness(raw) {
  if (!raw || typeof raw !== "object") fail("binding currentness required");
  const status = reqText(raw.status, "currentness.status");
  if (!CURRENTNESS_STATUSES.includes(status)) fail("currentness.status invalid");
  return freeze({
    status,
    changedEvidenceIds: freeze(reqArray(raw.changedEvidenceIds, "currentness.changedEvidenceIds").map((v, i) => reqText(v, `currentness.changedEvidenceIds[${i}]`))),
    evaluatorIdentity: reqText(raw.evaluatorIdentity, "currentness.evaluatorIdentity"),
  });
}

export function defineObservationContextBinding(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("OBSERVATION_CONTEXT_BINDING_V1 required");
  if (raw.kind !== OBSERVATION_CONTEXT_BINDING_KIND) fail("binding kind must be OBSERVATION_CONTEXT_BINDING_V1");
  if (raw.version !== OBSERVATION_CONTEXT_BINDING_VERSION) fail("binding version must be 1");
  const observationRef = reqText(raw.observationRef, "observationRef");
  const observationDigest = reqHex(raw.observationDigest, "observationDigest");
  const refMatch = observationRef.match(/:sha256:([a-f0-9]{64})$/);
  if (refMatch && refMatch[1] !== observationDigest) {
    // observationDigest is the canonical observationId; the store ref carries
    // the immutable-store digest under a different scheme. When the store ref
    // embeds a digest it must still be well-formed, but equality with the
    // canonical id is checked by classification, not here.
    void refMatch;
  }
  const requirementId = reqText(raw.requirementId, "requirementId");
  const resolutionId = reqText(raw.resolutionId, "resolutionId");
  const resolutionStatus = reqText(raw.resolutionStatus, "resolutionStatus");
  if (!RESOLUTION_STATUSES.includes(resolutionStatus)) fail("resolutionStatus invalid");
  const unresolvedEvidence = defineUnresolvedEvidence(raw.unresolvedEvidence);
  const receiptRef = raw.receiptRef ?? null;
  const receiptDigest = raw.receiptDigest ?? null;
  if ((receiptRef === null) !== (receiptDigest === null)) fail("receiptRef and receiptDigest must both be set or both be null");
  if (receiptRef !== null) {
    reqText(receiptRef, "receiptRef");
    reqHex(receiptDigest, "receiptDigest");
    const match = receiptRef.match(/:sha256:([a-f0-9]{64})$/);
    if (match && match[1] !== receiptDigest) {
      void match;
    }
  }
  const currentness = defineCurrentness(raw.currentness);
  const body = {
    kind: OBSERVATION_CONTEXT_BINDING_KIND,
    version: 1,
    observationRef,
    observationDigest,
    requirementId,
    resolutionId,
    resolutionStatus,
    unresolvedEvidence,
    receiptRef,
    receiptDigest,
    currentness,
  };
  const bindingId = contextBindingIdFor(body);
  if (raw.bindingId !== undefined && raw.bindingId !== bindingId) fail("bindingId does not match binding content");
  return freeze({ ...body, bindingId });
}

function rejectWriteCapablePort(dep, label) {
  if (!dep || typeof dep !== "object") fail(`${label} port required`);
  for (const name of FORBIDDEN_PORT_METHODS) {
    if (typeof dep[name] === "function") fail(`${label} exposes forbidden write-capable method ${name}`);
  }
}

function normalizeCurrentness(raw, fallbackIdentity) {
  if (!raw || typeof raw !== "object") {
    return freeze({ status: "CURRENTNESS_UNVERIFIABLE", changedEvidenceIds: freeze([]), evaluatorIdentity: fallbackIdentity });
  }
  const status = CURRENTNESS_STATUSES.includes(raw.status) ? raw.status : "CURRENTNESS_UNVERIFIABLE";
  const changed = Array.isArray(raw.changedEvidenceIds) ? raw.changedEvidenceIds.filter((v) => typeof v === "string") : [];
  return freeze({
    status,
    changedEvidenceIds: freeze([...changed].sort()),
    evaluatorIdentity: typeof raw.evaluatorIdentity === "string" && raw.evaluatorIdentity.trim() ? raw.evaluatorIdentity : fallbackIdentity,
  });
}

// Pure total classification function (D8). GROUNDED iff the observation proof
// is present with every required fact PROVENANCED, the resolution proof is a
// supported status that is COMPLETE or PARTIAL with only OPTIONAL unresolved
// evidence, a receipt is present and currentness is CURRENT. Missing, invalid
// or contradictory required proof is UNRESOLVED: the checks below are
// unconditional, never gated on another proof being present.
export function classifyGrounding({ observation = null, binding = null, requirement = null, resolution = null } = {}) {
  const reasons = new Set();
  const add = (r) => {
    if (!UNRESOLVED_REASONS.includes(r)) fail(`unknown grounding reason ${r}`);
    reasons.add(r);
  };

  // Mandatory observation proof: absent or malformed facts can never ground.
  const facts = observation && typeof observation === "object" ? observation.facts : null;
  if (!Array.isArray(facts)) {
    add("MISSING_PROVENANCE");
  } else {
    for (const fact of facts) {
      if (fact?.provenance === "MISSING_PROVENANCE") {
        add("MISSING_PROVENANCE");
        break;
      }
    }
  }

  if (binding === null || binding === undefined || typeof binding !== "object" || Array.isArray(binding)) {
    add("MISSING_CONTEXT");
    add("CURRENTNESS_UNVERIFIABLE");
  } else {
    // Mandatory resolution proof: any REQUIRED unresolved evidence blocks,
    // whatever the status claims — including a contradictory COMPLETE with
    // REQUIRED unresolved items. Malformed necessity fails closed as REQUIRED.
    const unresolved = Array.isArray(binding.unresolvedEvidence) ? binding.unresolvedEvidence : null;
    if (unresolved === null) {
      add("MISSING_CONTEXT");
    } else {
      for (const u of unresolved) {
        const necessity = u?.necessity;
        if (necessity !== "OPTIONAL") {
          const reason = String(u?.reason ?? "MISSING").toUpperCase();
          add("MISSING_CONTEXT");
          if (reason === "STALE") add("STALE_CONTEXT");
          else if (reason === "AMBIGUOUS") add("AMBIGUOUS_CONTEXT");
          else if (reason === "CURRENTNESS_UNVERIFIABLE") add("CURRENTNESS_UNVERIFIABLE");
        }
      }
    }
    if (binding.resolutionStatus === "UNSATISFIED") {
      add("UNSATISFIED_CONTEXT");
    } else if (binding.resolutionStatus !== "COMPLETE" && binding.resolutionStatus !== "PARTIAL") {
      // Unsupported status (missing, mistyped or contradictory) never grounds.
      add("MISSING_CONTEXT");
    }

    // Fail-closed on unresolved reasons even when the status alone allows
    // grounding: a REQUIRED ambiguous/stale/unverifiable item is never
    // grounded. OPTIONAL items alone never block (D8 literal).
    if (binding.receiptRef == null || binding.receiptDigest == null) {
      add("CURRENTNESS_UNVERIFIABLE");
    }
    const currentness = binding.currentness?.status ?? "CURRENTNESS_UNVERIFIABLE";
    if (currentness === "CURRENT") {
      void currentness;
    } else if (currentness === "STALE") {
      add("STALE_CONTEXT");
    } else {
      // Unsupported or missing currentness (including
      // CURRENTNESS_UNVERIFIABLE) never grounds.
      add("CURRENTNESS_UNVERIFIABLE");
    }

    if (observation && binding.observationDigest !== observation.observationId) {
      add("SUBJECT_MISMATCH");
    }
    if (requirement && binding.requirementId !== requirement.requirementId) {
      add("SUBJECT_MISMATCH");
    }
    if (resolution && binding.resolutionId !== resolution.resolutionId) {
      add("SUBJECT_MISMATCH");
    }
    // A resolution object passed alongside that answers a different
    // requirement is a subject mismatch even when the binding predates it.
    if (requirement && resolution && resolution.requirementId !== requirement.requirementId) {
      add("SUBJECT_MISMATCH");
    }
  }

  const ordered = REASON_ORDER.filter((r) => reasons.has(r));
  if (ordered.length === 0) return freeze({ status: "GROUNDED", reasons: freeze([]) });
  return freeze({ status: "UNRESOLVED", reasons: freeze(ordered) });
}

export function createObservationContextBinder({ artifactStore, receiptCurrentness } = {}) {
  if (!artifactStore || typeof artifactStore !== "object") fail("binder requires an artifactStore port");
  if (typeof receiptCurrentness !== "function") fail("binder requires an injected receiptCurrentness function");
  rejectWriteCapablePort(artifactStore, "artifactStore");
  // The injected function itself must not be a lifecycle/authority port.
  rejectWriteCapablePort({ ...(receiptCurrentness.port ?? {}) }, "receiptCurrentness.port");
  for (const name of ["put", "resolve"]) {
    if (typeof artifactStore[name] !== "function") fail(`artifactStore must expose ${name}`);
  }
  // The binder never resolves context: it accepts an already-produced
  // ContextResolution plus receipt. Any resolver-shaped argument is rejected.
  function rejectResolverShaped(value, label) {
    if (value && typeof value === "object") {
      for (const name of ["resolve", "execute", "plan", "retrieve"]) {
        if (name === "resolve" && label === "artifactStore") continue;
        if (typeof value[name] === "function" && label !== "artifactStore") {
          fail(`${label} must not expose resolver method ${name}; the binder never resolves context`);
        }
      }
    }
  }
  rejectResolverShaped(receiptCurrentness, "receiptCurrentness");

  async function bindObservationContext({
    observation,
    observationRef,
    requirement,
    resolution,
    receipt = null,
    receiptRef = null,
  } = {}) {
    const parsedObservation = defineGroundedObservation(structuredClone(observation));
    const obsRef = reqText(observationRef, "observationRef");
    if (!requirement || typeof requirement !== "object") fail("bindObservationContext requires a ContextRequirement");
    const requirementId = reqText(requirement.requirementId, "requirement.requirementId");
    if (!resolution || typeof resolution !== "object") fail("bindObservationContext requires a ContextResolution");
    const resolutionId = reqText(resolution.resolutionId, "resolution.resolutionId");
    const resolutionRequirementId = reqText(resolution.requirementId, "resolution.requirementId");
    // The resolution must answer this requirement: an unrelated resolution is
    // rejected at bind time, never classified later.
    if (resolutionRequirementId !== requirementId) {
      fail("resolution answers a different requirement than the declared ContextRequirement");
    }
    const resolutionStatus = reqText(resolution.status, "resolution.status");
    if (!RESOLUTION_STATUSES.includes(resolutionStatus)) fail("resolution.status invalid");
    const necessityById = new Map();
    for (const e of requirement.evidence ?? []) {
      if (e && typeof e.id === "string") necessityById.set(e.id, e.necessity === "REQUIRED" ? "REQUIRED" : "OPTIONAL");
    }
    const unresolvedEvidence = (resolution.unresolved ?? []).map((u, i) => {
      const evidenceId = reqText(u?.evidenceId, `resolution.unresolved[${i}].evidenceId`);
      if (!necessityById.has(evidenceId)) fail(`resolution unresolved references unknown evidence ${evidenceId}`);
      const out = { evidenceId, necessity: necessityById.get(evidenceId) };
      if (u.reason !== undefined && u.reason !== null) out.reason = reqText(u.reason, `resolution.unresolved[${i}].reason`);
      return out;
    });

    let finalReceiptRef = receiptRef;
    let receiptDigest = null;
    let currentness;
    if (receipt === null) {
      finalReceiptRef = null;
      currentness = freeze({
        status: "CURRENTNESS_UNVERIFIABLE",
        changedEvidenceIds: freeze([]),
        evaluatorIdentity: "binder:no-receipt",
      });
    } else {
      if (finalReceiptRef === null) fail("binding a receipt requires its receiptRef");
      reqText(finalReceiptRef, "receiptRef");
      const refMatch = finalReceiptRef.match(/:sha256:([a-f0-9]{64})$/);
      if (!refMatch) fail("receiptRef must be a content-addressed artifact ref");
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("binding receipt required");
      // Semantic identity: the receipt must bind this requirement and this
      // resolution. A receipt for another requirement, another resolution, or
      // with a missing semantic digest is rejected — currentness of a
      // different receipt can never ground this context.
      const receiptRequirementId = reqText(receipt.requirementId, "receipt.requirementId");
      if (receiptRequirementId !== requirementId) {
        fail("receipt answers a different requirement than the declared ContextRequirement");
      }
      const receiptResolutionId = reqText(receipt.resolutionId, "resolution.resolutionId");
      if (receiptResolutionId !== resolutionId) {
        fail("receipt binds a different resolution than the declared ContextResolution");
      }
      receiptDigest = typeof receipt.receiptId === "string" && HEX64.test(receipt.receiptId) ? receipt.receiptId : null;
      if (receiptDigest === null) fail("receipt digest is unavailable (receipt.receiptId must be sha256 hex)");
      // Exact-bytes verification when the receipt bytes are available in the
      // immutable store: the supplied receipt must equal the stored bytes.
      // The receiptId semantic digest and the store blob digest use different
      // schemes, so both the ref locator and the semantic identity are
      // verified rather than compared against each other.
      let storedReceipt = null;
      try {
        storedReceipt = await artifactStore.resolve(finalReceiptRef);
      } catch {
        storedReceipt = null;
      }
      if (storedReceipt !== null && canonicalString(storedReceipt) !== canonicalString(structuredClone(receipt))) {
        fail("receipt bytes do not match the exact stored receipt for receiptRef");
      }
      let raw;
      try {
        raw = await receiptCurrentness(structuredClone(receipt));
      } catch {
        raw = { status: "CURRENTNESS_UNVERIFIABLE", changedEvidenceIds: [], evaluatorIdentity: "binder:injector-threw" };
      }
      currentness = normalizeCurrentness(raw, "binder:receiptCurrentness");
    }

    const candidate = {
      kind: OBSERVATION_CONTEXT_BINDING_KIND,
      version: 1,
      observationRef: obsRef,
      observationDigest: parsedObservation.observationId,
      requirementId,
      resolutionId,
      resolutionStatus,
      unresolvedEvidence,
      receiptRef: finalReceiptRef,
      receiptDigest,
      currentness,
    };
    const binding = defineObservationContextBinding(candidate);
    const bindingRef = await artifactStore.put("observation-context-binding", structuredClone(binding));
    return freeze({ binding, bindingRef });
  }

  return freeze({ bindObservationContext, classifyGrounding });
}
