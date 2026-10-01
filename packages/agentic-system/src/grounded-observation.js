import { createHash } from "node:crypto";

export const GROUNDED_OBSERVATION_KIND = "GROUNDED_OBSERVATION_V1";
export const GROUNDED_OBSERVATION_VERSION = 1;
export const GROUNDED_FINDING_INPUT_KIND = "GROUNDED_FINDING_INPUT_V1";
export const GROUNDED_FINDING_INPUT_VERSION = 1;

export const MISSING_PROVENANCE = "MISSING_PROVENANCE";
export const UNTRUSTED_NARRATIVE = "UNTRUSTED_NARRATIVE";

const FORBIDDEN_PORT_METHODS = Object.freeze([
  "publish",
  "claim",
  "dispatch",
  "accept",
  "recover",
  "compareAndSwap",
]);

const FORBIDDEN_FINDING_KEYS = Object.freeze([
  "finding",
  "impact",
  "disposition",
  "response",
  "verdict",
  "accepted",
  "promoted",
  "remediation",
  "principal",
]);

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

function observationContentForId(body) {
  return {
    kind: body.kind,
    version: body.version,
    subject: body.subject,
    execution: body.execution,
    facts: body.facts,
    measurements: body.measurements,
    providerEvents: body.providerEvents,
    observedAtBoundaries: body.observedAtBoundaries,
  };
}

export function observationIdFor(content) {
  return sha256Hex(canonicalString(observationContentForId(content)));
}

function defineSubject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("observation subject required");
  const mode = reqText(raw.mode, "subject.mode");
  if (mode !== "HISTORICAL" && mode !== "CURRENT") fail("subject.mode must be HISTORICAL or CURRENT");
  return freeze({
    mode,
    subjectRef: reqText(raw.subjectRef, "subject.subjectRef"),
    subjectDigest: reqHex(raw.subjectDigest, "subject.subjectDigest"),
  });
}

function defineExecution(raw) {
  if (!raw || typeof raw !== "object") fail("observation execution required");
  const executionAttemptId = reqText(raw.executionAttemptId, "execution.executionAttemptId");
  if (!executionAttemptId.startsWith("execution-attempt-id:")) {
    fail("execution.executionAttemptId must be an ExHarness attempt id, never a provider event id");
  }
  const runtimeInvocationId = reqText(raw.runtimeInvocationId, "execution.runtimeInvocationId");
  const binding = assertPin(raw.binding, "execution.binding");
  const attestations = reqArray(raw.attestations, "execution.attestations").map((a, i) =>
    assertPin(a, `execution.attestations[${i}]`),
  );
  if (runtimeInvocationId === MISSING_PROVENANCE) {
    if (attestations.length !== 0) fail("MISSING_PROVENANCE invocation requires empty attestations");
  } else if (attestations.length === 0) {
    fail("execution requires at least one runtime attestation");
  }
  return freeze({ executionAttemptId, runtimeInvocationId, binding, attestations });
}

function defineFacts(raw) {
  return freeze(
    reqArray(raw, "facts").map((f, i) => {
      if (!f || typeof f !== "object") fail(`facts[${i}] required`);
      const provenance = reqText(f.provenance, `facts[${i}].provenance`);
      if (provenance !== "PROVENANCED" && provenance !== MISSING_PROVENANCE) {
        fail(`facts[${i}].provenance must be PROVENANCED or MISSING_PROVENANCE`);
      }
      const evidenceRefs = reqArray(f.evidenceRefs, `facts[${i}].evidenceRefs`).map((p, j) =>
        assertPin(p, `facts[${i}].evidenceRefs[${j}]`),
      );
      if (provenance === "PROVENANCED" && evidenceRefs.length === 0) {
        fail(`facts[${i}] is PROVENANCED but carries no evidence ref`);
      }
      jsonSafe(f.value, `facts[${i}].value`);
      return freeze({
        factId: reqText(f.factId, `facts[${i}].factId`),
        kind: reqText(f.kind, `facts[${i}].kind`),
        value: structuredClone(f.value),
        evidenceRefs,
        provenance,
      });
    }),
  );
}

function defineMeasurements(raw) {
  return freeze(
    reqArray(raw, "measurements").map((m, i) => {
      if (!m || typeof m !== "object") fail(`measurements[${i}] required`);
      const key = reqText(m.key, `measurements[${i}].key`);
      const unit = reqText(m.unit, `measurements[${i}].unit`);
      const value = m.value ?? null;
      if (value !== null) jsonSafe(value, `measurements[${i}].value`);
      if (typeof value === "number" && !Number.isFinite(value)) fail(`measurements[${i}].value is not finite`);
      const reason = m.reason ?? null;
      const evidenceRef = m.evidenceRef ?? null;
      if (reason !== null) {
        reqText(reason, `measurements[${i}].reason`);
        if (value !== null) fail(`measurements[${i}] carries a reason so value must be null, never zero`);
      }
      if (value === null) {
        reqText(reason ?? "", `measurements[${i}].reason`);
      } else {
        if (reason !== null) fail(`measurements[${i}] is measured so reason must be null`);
        reqText(evidenceRef ?? "", `measurements[${i}].evidenceRef`);
      }
      if (evidenceRef !== null) reqText(evidenceRef, `measurements[${i}].evidenceRef`);
      return freeze({ key, value, unit, evidenceRef, reason });
    }),
  );
}

function defineProviderEvents(raw, executionBindingRef) {
  return freeze(
    reqArray(raw, "providerEvents").map((e, i) => {
      if (!e || typeof e !== "object") fail(`providerEvents[${i}] required`);
      const attemptBindingRef = reqText(e.attemptBindingRef, `providerEvents[${i}].attemptBindingRef`);
      if (attemptBindingRef !== executionBindingRef) {
        fail(`providerEvents[${i}] is not bound to the observation execution binding`);
      }
      return freeze({
        provider: reqText(e.provider, `providerEvents[${i}].provider`),
        eventKind: reqText(e.eventKind, `providerEvents[${i}].eventKind`),
        eventId: reqText(e.eventId, `providerEvents[${i}].eventId`),
        attemptBindingRef,
      });
    }),
  );
}

function defineNarrative(raw) {
  return freeze(
    reqArray(raw, "narrative").map((n, i) => {
      if (!n || typeof n !== "object") fail(`narrative[${i}] required`);
      if (n.trust !== UNTRUSTED_NARRATIVE) fail(`narrative[${i}].trust must be UNTRUSTED_NARRATIVE`);
      return freeze({ text: reqText(n.text, `narrative[${i}].text`), trust: UNTRUSTED_NARRATIVE });
    }),
  );
}

function defineBoundaries(raw) {
  return freeze(
    reqArray(raw, "observedAtBoundaries").map((b, i) => {
      if (!b || typeof b !== "object") fail(`observedAtBoundaries[${i}] required`);
      const at = reqText(b.at, `observedAtBoundaries[${i}].at`);
      if (!Number.isFinite(Date.parse(at))) fail(`observedAtBoundaries[${i}].at is not a timestamp`);
      return freeze({
        boundaryKind: reqText(b.boundaryKind, `observedAtBoundaries[${i}].boundaryKind`),
        at,
        ref: reqText(b.ref, `observedAtBoundaries[${i}].ref`),
      });
    }),
  );
}

export function defineGroundedObservation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("GROUNDED_OBSERVATION_V1 required");
  if (raw.kind !== GROUNDED_OBSERVATION_KIND) fail("observation kind must be GROUNDED_OBSERVATION_V1");
  if (raw.version !== GROUNDED_OBSERVATION_VERSION) fail("observation version must be 1");
  const subject = defineSubject(raw.subject);
  const execution = defineExecution(raw.execution);
  const facts = defineFacts(raw.facts);
  const measurements = defineMeasurements(raw.measurements);
  const providerEvents = defineProviderEvents(raw.providerEvents, execution.binding.ref);
  const narrative = defineNarrative(raw.narrative);
  const observedAtBoundaries = defineBoundaries(raw.observedAtBoundaries);
  const body = { kind: GROUNDED_OBSERVATION_KIND, version: 1, subject, execution, facts, measurements, providerEvents, narrative, observedAtBoundaries };
  const observationId = observationIdFor(body);
  if (raw.observationId !== undefined && raw.observationId !== observationId) {
    fail("observationId does not match observation content (narrative excluded)");
  }
  return freeze({ ...body, observationId });
}

function rejectWriteCapablePort(dep, label) {
  if (!dep || typeof dep !== "object") fail(`${label} port required`);
  for (const name of FORBIDDEN_PORT_METHODS) {
    if (typeof dep[name] === "function") fail(`${label} exposes forbidden write-capable method ${name}`);
  }
}

function causalSubjectDigest(subject) {
  return sha256Hex(canonicalString(subject));
}

function pinForRef(ref) {
  const text = reqText(ref, "artifact ref");
  const match = text.match(/:sha256:([a-f0-9]{64})$/);
  if (!match) fail(`artifact ref must be content addressed: ${text}`);
  return freeze({ ref: text, digest: match[1] });
}

function normalizeObserverFacts(chain) {
  const facts = reqArray(chain, "observer chainEvidence");
  return facts.map((f, i) => {
    const ref = f?.ref ?? null;
    const provenance = ref == null ? MISSING_PROVENANCE : "PROVENANCED";
    const rawRefs = Array.isArray(f?.evidenceRefs) ? f.evidenceRefs : ref == null ? [] : [ref];
    const evidenceRefs = rawRefs.map((r) => {
      const text = reqText(r, `observer fact[${i}] evidence ref`);
      const match = text.match(/:sha256:([a-f0-9]{64})$/);
      if (!match) fail(`observer fact[${i}] evidence ref must be content addressed: ${text}`);
      return { ref: text, digest: match[1] };
    });
    const kind = typeof f?.factKind === "string" && f.factKind.trim() ? f.factKind : "CAUSAL_FACT";
    const value = ref ?? f?.status ?? kind;
    return { factId: `fact:${i}:${ref ?? kind}`, kind, value, evidenceRefs, provenance };
  });
}

export function createGroundedObservationProjector({ observer, artifactRegistry, artifactStore } = {}) {
  if (!observer || typeof observer !== "object") fail("projector requires an observer port");
  if (!artifactRegistry || typeof artifactRegistry !== "object") fail("projector requires an artifactRegistry port");
  if (!artifactStore || typeof artifactStore !== "object") fail("projector requires an artifactStore port");
  rejectWriteCapablePort(observer, "observer");
  rejectWriteCapablePort(artifactRegistry, "artifactRegistry");
  rejectWriteCapablePort(artifactStore, "artifactStore");
  for (const name of ["queryHistorical", "chainEvidence", "describeExecution"]) {
    if (typeof observer[name] !== "function") fail(`observer must expose query-only method ${name}`);
  }
  for (const name of ["resolveExecutionAttemptBinding", "resolveRuntimeExecutionAttestation"]) {
    if (typeof artifactRegistry[name] !== "function") fail(`artifactRegistry must expose ${name}`);
  }
  for (const name of ["put", "resolve"]) {
    if (typeof artifactStore[name] !== "function") fail(`artifactStore must expose ${name}`);
  }

  async function projectObservation({
    subject,
    subjectRef = null,
    subjectDigest = null,
    bindingRef,
    attestationRefs = null,
    providerEvents = [],
    narrative = [],
    measurements = [],
  } = {}) {
    if (!subject || typeof subject !== "object") fail("projectObservation requires a pinned CausalObservationSubject");
    if (subject.kind !== "CAUSAL_OBSERVATION_SUBJECT" || subject.version !== 1) {
      fail("subject must be a CAUSAL_OBSERVATION_SUBJECT v1");
    }
    if (subject.mode !== "HISTORICAL" && subject.mode !== "CURRENT") fail("subject.mode must be HISTORICAL or CURRENT");
    const actualDigest = causalSubjectDigest(subject);
    if (subjectDigest !== null && subjectDigest !== actualDigest) fail("subject digest mismatch");
    let pinnedRef = subjectRef;
    if (pinnedRef === null) {
      pinnedRef = await artifactStore.put("causal-observation-subject", structuredClone(subject));
    }
    reqText(pinnedRef, "subjectRef");
    const boundRef = reqText(bindingRef, "bindingRef");
    const binding = await artifactRegistry.resolveExecutionAttemptBinding(boundRef);
    if (!binding) fail(`ExecutionAttemptBinding is unavailable: ${boundRef}`);
    const executionAttemptId = reqText(binding.executionAttemptId, "binding.executionAttemptId");
    if (!executionAttemptId.startsWith("execution-attempt-id:")) {
      fail("binding executionAttemptId must be an ExHarness attempt id");
    }
    let attRefs = attestationRefs;
    if (attRefs === null) {
      const described = await observer.describeExecution({ subject });
      const inferred = described?.runtimeAttestationRef ?? null;
      attRefs = inferred == null ? [] : [inferred];
      if (Array.isArray(described?.runtimeInvocations) && described.runtimeInvocations.length > 0) {
        attRefs = described.runtimeInvocations.map((r) => reqText(r.attestationRef, "observer attestationRef"));
      }
    }
    reqArray(attRefs, "attestationRefs");
    if (attRefs.length === 0) fail("execution identity requires at least one runtime attestation");
    const attestations = [];
    for (const ref of attRefs) {
      const text = reqText(ref, "attestationRef");
      const att = await artifactRegistry.resolveRuntimeExecutionAttestation(text);
      if (!att) fail(`RuntimeExecutionAttestation is unavailable: ${text}`);
      if (att.bindingRef !== boundRef) fail("runtime attestation/binding relation mismatch");
      if (att.executionAttemptId !== executionAttemptId) fail("runtime attestation/attempt relation mismatch");
      attestations.push({ attestationRef: text, attestation: att });
    }
    const runtimeInvocationId = reqText(attestations[0].attestation.runtimeInvocationId, "runtimeInvocationId");
    const chain = await observer.chainEvidence({ subject });
    const facts = normalizeObserverFacts(chain);
    const narrativeInput = reqArray(narrative, "narrative").map((n, i) => {
      if (typeof n === "string") return { text: n, trust: UNTRUSTED_NARRATIVE };
      if (!n || typeof n !== "object") fail(`narrative[${i}] required`);
      if (n.trust !== undefined && n.trust !== UNTRUSTED_NARRATIVE) {
        fail(`narrative[${i}].trust must be UNTRUSTED_NARRATIVE`);
      }
      return { text: reqText(n.text, `narrative[${i}].text`), trust: UNTRUSTED_NARRATIVE };
    });
    const observedAtBoundaries = attestations.map(({ attestationRef, attestation }) => ({
      boundaryKind: "RUNTIME_INVOCATION",
      at: attestation.finishedAt ?? attestation.startedAt,
      ref: attestationRef,
    }));
    const candidate = {
      kind: GROUNDED_OBSERVATION_KIND,
      version: 1,
      subject: { mode: subject.mode, subjectRef: pinnedRef, subjectDigest: actualDigest },
      execution: {
        executionAttemptId,
        runtimeInvocationId,
        binding: pinForRef(boundRef),
        attestations: attestations.map(({ attestationRef }) => pinForRef(attestationRef)),
      },
      facts,
      measurements: structuredClone(measurements),
      providerEvents: structuredClone(providerEvents),
      narrative: narrativeInput,
      observedAtBoundaries,
    };
    const observation = defineGroundedObservation(candidate);
    const observationRef = await artifactStore.put("grounded-observation", structuredClone(observation));
    return freeze({ observation, observationRef });
  }

  return freeze({ projectObservation });
}

// ---------------------------------------------------------------------------
// GROUNDED_FINDING_INPUT_V1: the only feedback-facing output. Evidence only.
// ---------------------------------------------------------------------------

const GROUNDING_STATUSES = Object.freeze(["GROUNDED", "UNRESOLVED"]);
const UNRESOLVED_REASONS = Object.freeze([
  MISSING_PROVENANCE,
  "MISSING_CONTEXT",
  "UNSATISFIED_CONTEXT",
  "STALE_CONTEXT",
  "AMBIGUOUS_CONTEXT",
  "CURRENTNESS_UNVERIFIABLE",
  "SUBJECT_MISMATCH",
]);

function assertNoForbiddenKeys(value, path, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`, seen));
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    if (FORBIDDEN_FINDING_KEYS.includes(key)) {
      fail(`finding input carries forbidden authority key ${path}.${key}`);
    }
    assertNoForbiddenKeys(value[key], `${path}.${key}`, seen);
  }
}

function findingInputContentForId(body) {
  return {
    kind: body.kind,
    version: body.version,
    observationRefs: body.observationRefs,
    contextBindingRef: body.contextBindingRef,
    contextBindingDigest: body.contextBindingDigest,
    groundingStatus: body.groundingStatus,
    unresolvedReasons: body.unresolvedReasons,
    uncertainty: body.uncertainty,
  };
}

export function findingInputIdFor(content) {
  return sha256Hex(canonicalString(findingInputContentForId(content)));
}

export function defineGroundedFindingInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("GROUNDED_FINDING_INPUT_V1 required");
  assertNoForbiddenKeys(raw, "findingInput");
  if (raw.kind !== GROUNDED_FINDING_INPUT_KIND) fail("finding input kind must be GROUNDED_FINDING_INPUT_V1");
  if (raw.version !== GROUNDED_FINDING_INPUT_VERSION) fail("finding input version must be 1");
  const observationRefs = reqArray(raw.observationRefs, "observationRefs").map((p, i) =>
    assertPin(p, `observationRefs[${i}]`),
  );
  if (observationRefs.length === 0) fail("finding input requires at least one observation ref");
  const contextBindingRef = reqText(raw.contextBindingRef, "contextBindingRef");
  const contextBindingDigest = reqHex(raw.contextBindingDigest, "contextBindingDigest");
  const refMatch = contextBindingRef.match(/:sha256:([a-f0-9]{64})$/);
  if (!refMatch || refMatch[1] !== contextBindingDigest) fail("contextBindingRef/digest mismatch");
  const groundingStatus = reqText(raw.groundingStatus, "groundingStatus");
  if (!GROUNDING_STATUSES.includes(groundingStatus)) fail("groundingStatus must be GROUNDED or UNRESOLVED");
  const unresolvedReasons = reqArray(raw.unresolvedReasons, "unresolvedReasons").map((r, i) => {
    reqText(r, `unresolvedReasons[${i}]`);
    if (!UNRESOLVED_REASONS.includes(r)) fail(`unresolvedReasons[${i}] is not a typed reason`);
    return r;
  });
  if (groundingStatus === "GROUNDED" && unresolvedReasons.length !== 0) {
    fail("GROUNDED finding input carries no unresolved reasons");
  }
  if (groundingStatus === "UNRESOLVED" && unresolvedReasons.length === 0) {
    fail("UNRESOLVED finding input requires at least one typed reason");
  }
  const uncertainty = raw.uncertainty;
  if (!uncertainty || typeof uncertainty !== "object" || Array.isArray(uncertainty)) {
    fail("finding input uncertainty required");
  }
  const frozen = freeze({
    kind: GROUNDED_FINDING_INPUT_KIND,
    version: 1,
    observationRefs,
    contextBindingRef,
    contextBindingDigest,
    groundingStatus,
    unresolvedReasons: freeze([...unresolvedReasons]),
    uncertainty: freeze({
      missingProvenanceFactIds: freeze(reqArray(uncertainty.missingProvenanceFactIds, "uncertainty.missingProvenanceFactIds").map((v, i) => reqText(v, `uncertainty.missingProvenanceFactIds[${i}]`))),
      unresolvedEvidenceIds: freeze(reqArray(uncertainty.unresolvedEvidenceIds, "uncertainty.unresolvedEvidenceIds").map((v, i) => reqText(v, `uncertainty.unresolvedEvidenceIds[${i}]`))),
      optionalUnresolvedEvidenceIds: freeze(reqArray(uncertainty.optionalUnresolvedEvidenceIds, "uncertainty.optionalUnresolvedEvidenceIds").map((v, i) => reqText(v, `uncertainty.optionalUnresolvedEvidenceIds[${i}]`))),
    }),
  });
  const inputId = findingInputIdFor(frozen);
  if (raw.inputId !== undefined && raw.inputId !== inputId) fail("inputId does not match finding input content");
  assertNoForbiddenKeys(frozen, "findingInput");
  return freeze({ ...frozen, inputId });
}

export async function buildGroundedFindingInput(
  { observationRefs, contextBindingRef, groundingStatus, unresolvedReasons, uncertainty, ...rest } = {},
  { artifactStore } = {},
) {
  if (!artifactStore || typeof artifactStore.put !== "function") fail("finding input requires an artifactStore port");
  rejectWriteCapablePort(artifactStore, "artifactStore");
  assertNoForbiddenKeys({ observationRefs, contextBindingRef, groundingStatus, unresolvedReasons, uncertainty, ...rest }, "findingInput");
  const candidate = {
    kind: GROUNDED_FINDING_INPUT_KIND,
    version: 1,
    observationRefs: structuredClone(observationRefs ?? []),
    contextBindingRef,
    contextBindingDigest: (contextBindingRef ?? "").match(/:sha256:([a-f0-9]{64})$/)?.[1] ?? "",
    groundingStatus,
    unresolvedReasons: [...(unresolvedReasons ?? [])],
    uncertainty: structuredClone(uncertainty ?? {}),
  };
  const input = defineGroundedFindingInput(candidate);
  const inputRef = await artifactStore.put("grounded-finding-input", structuredClone(input));
  return freeze({ input, inputRef });
}

export async function assertGroundedFindingInputCurrent(
  input,
  { receiptCurrentness = null, artifactStore = null, receipt = null } = {},
) {
  const parsed = defineGroundedFindingInput({ ...structuredClone(input), inputId: input?.inputId });
  if (!artifactStore || typeof artifactStore.resolve !== "function") {
    fail("consumption check requires an artifactStore port");
  }
  rejectWriteCapablePort(artifactStore, "artifactStore");
  const binding = await artifactStore.resolve(parsed.contextBindingRef);
  if (!binding) {
    return freeze({
      status: "UNRESOLVED",
      reasons: freeze(["CURRENTNESS_UNVERIFIABLE"]),
      detail: "context binding is unavailable at consumption time",
    });
  }
  let liveReceipt = receipt;
  if (liveReceipt === null && binding.receiptRef != null) {
    try {
      liveReceipt = await artifactStore.resolve(binding.receiptRef);
    } catch {
      liveReceipt = null;
    }
  }
  if (binding.receiptRef == null) {
    return freeze({
      status: "UNRESOLVED",
      reasons: freeze(["CURRENTNESS_UNVERIFIABLE"]),
      detail: "binding carries no receipt so consumption currentness is unverifiable",
    });
  }
  if (typeof receiptCurrentness !== "function") {
    return freeze({
      status: "UNRESOLVED",
      reasons: freeze(["CURRENTNESS_UNVERIFIABLE"]),
      detail: "no receiptCurrentness injector at consumption time",
    });
  }
  let currentness;
  try {
    currentness = await receiptCurrentness(liveReceipt ?? { receiptRef: binding.receiptRef });
  } catch {
    return freeze({
      status: "UNRESOLVED",
      reasons: freeze(["CURRENTNESS_UNVERIFIABLE"]),
      detail: "receipt currentness threw at consumption time",
    });
  }
  const status = currentness?.status ?? null;
  if (status === "CURRENT") {
    return freeze({ status: parsed.groundingStatus, reasons: freeze([...parsed.unresolvedReasons]), detail: "current at consumption" });
  }
  if (status === "STALE") {
    const reasons = [...new Set([...parsed.unresolvedReasons, "STALE_CONTEXT"])];
    return freeze({ status: "UNRESOLVED", reasons: freeze(reasons), detail: "stale at consumption" });
  }
  return freeze({
    status: "UNRESOLVED",
    reasons: freeze([...new Set([...parsed.unresolvedReasons, "CURRENTNESS_UNVERIFIABLE"])]),
    detail: "currentness unverifiable at consumption",
  });
}
