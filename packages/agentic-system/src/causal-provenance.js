import { createHash } from "node:crypto";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
const digestOf = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const freeze = (value) => Object.freeze(structuredClone(value));

export const CAUSAL_LIFECYCLE_EVENT_KINDS = Object.freeze([
  "MATERIALIZED",
  "CLAIMED",
  "RELEASED",
  "RUNTIME_STARTED",
  "RUNTIME_FINISHED",
  "PUBLISHED",
  "ACCEPTED",
]);

export const MISSING_PROVENANCE = "MISSING_PROVENANCE";
export const UNKNOWN_PROVENANCE = "UNKNOWN";
export const INCONSISTENT_PROVENANCE = "INCONSISTENT_PROVENANCE";

function requireObservedAt(value) {
  requireText(value, "CausalLifecycleEvidence.observedAt");
  const ms = Date.parse(value);
  invariant(Number.isFinite(ms), "CausalLifecycleEvidence.observedAt must be an ISO timestamp");
  return value;
}

// Immutable observational evidence emitted by the owning production boundary
// at a real lifecycle transition. It is evidence only: no authority boundary
// may read it to gate a claim, dispatch, publication or acceptance decision.
export function defineCausalLifecycleEvidence(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "CausalLifecycleEvidence required");
  invariant(raw.kind === "CAUSAL_LIFECYCLE_EVIDENCE" && raw.version === 1, "CausalLifecycleEvidence kind/version mismatch");
  const workId = requireText(raw.workId, "CausalLifecycleEvidence.workId");
  invariant(CAUSAL_LIFECYCLE_EVENT_KINDS.includes(raw.eventKind), `CausalLifecycleEvidence.eventKind ${String(raw.eventKind)} is not a lifecycle boundary`);
  const evidence = {
    kind: "CAUSAL_LIFECYCLE_EVIDENCE",
    version: 1,
    workId,
    eventKind: raw.eventKind,
    observedAt: requireObservedAt(raw.observedAt),
    projectId: raw.projectId == null ? null : requireText(raw.projectId, "CausalLifecycleEvidence.projectId"),
    workContractRef: raw.workContractRef == null ? null : requireText(raw.workContractRef, "CausalLifecycleEvidence.workContractRef"),
    claimGeneration: raw.claimGeneration == null ? null : raw.claimGeneration,
    executionAttemptId: raw.executionAttemptId == null ? null : requireText(raw.executionAttemptId, "CausalLifecycleEvidence.executionAttemptId"),
    runtimeInvocationId: raw.runtimeInvocationId == null ? null : requireText(raw.runtimeInvocationId, "CausalLifecycleEvidence.runtimeInvocationId"),
    boundaryRef: raw.boundaryRef == null ? null : requireText(raw.boundaryRef, "CausalLifecycleEvidence.boundaryRef"),
  };
  if (evidence.claimGeneration != null) {
    invariant(Number.isInteger(evidence.claimGeneration) && evidence.claimGeneration > 0, "CausalLifecycleEvidence.claimGeneration invalid");
  }
  return freeze(evidence);
}

export function causalLifecycleListKey(workId) {
  return "causal-lifecycle:" + digestOf({ workId: requireText(workId, "workId") });
}

// Write-only evidence sink. The returned surface exposes only `record()`:
// no read, list, delete or rewrite path exists here. Reads go through the
// observer/reconstruction boundary against the same head store + artifact
// store, so production writers can never rewrite observation history.
export function createCausalLifecycleEvidenceSink({ artifactStore, evidenceHeadStore, now = () => new Date().toISOString() } = {}) {
  invariant(artifactStore && typeof artifactStore.put === "function", "causal sink requires an immutable artifact store");
  invariant(evidenceHeadStore && typeof evidenceHeadStore.current === "function" && typeof evidenceHeadStore.compareAndSwap === "function", "causal sink requires a CAS head store");
  invariant(typeof now === "function", "causal sink requires a now() clock");

  async function record(raw) {
    const candidate = { ...raw };
    if (candidate.observedAt == null) candidate.observedAt = now();
    const evidence = defineCausalLifecycleEvidence(candidate);
    const evidenceRef = await artifactStore.put("causal-lifecycle-evidence", structuredClone(evidence));
    const key = causalLifecycleListKey(evidence.workId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const head = await evidenceHeadStore.current(key);
      const refs = [...((head?.value?.evidenceRefs) ?? [])];
      if (!refs.includes(evidenceRef)) refs.push(evidenceRef);
      const next = { workId: evidence.workId, evidenceRefs: refs };
      if (await evidenceHeadStore.compareAndSwap(key, head?.revision ?? null, next)) {
        return freeze({ evidenceRef, evidence });
      }
    }
    throw new TypeError(`causal lifecycle evidence CAS conflict for ${evidence.workId}`);
  }

  return Object.freeze({ record });
}

// Read path used only by the reconstruction boundary (never by production
// authority). Resolves the pinned per-work evidence refs in stored order.
export async function listCausalLifecycleEvidence({ artifactStore, evidenceHeadStore } = {}, { workId } = {}) {
  invariant(artifactStore && typeof artifactStore.resolve === "function", "causal read requires an artifact store");
  invariant(evidenceHeadStore && typeof evidenceHeadStore.current === "function", "causal read requires a head store");
  const id = requireText(workId, "workId");
  const head = await evidenceHeadStore.current(causalLifecycleListKey(id));
  const refs = [...((head?.value?.evidenceRefs) ?? [])];
  const entries = [];
  for (const ref of refs) {
    const raw = await artifactStore.resolve(ref);
    invariant(raw, `CausalLifecycleEvidence is unavailable: ${ref}`);
    const evidence = defineCausalLifecycleEvidence(raw);
    invariant(evidence.workId === id, "causal lifecycle evidence work mismatch");
    entries.push(freeze({ evidenceRef: ref, evidence }));
  }
  return freeze(entries);
}
