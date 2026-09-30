import { deepFreeze, frozenCopy, invariant, requireContentRef, requireText } from "./deployable-artifact.js";

// Independent runtime observation. The observer resolves one AcceptanceSnapshot and asks its own
// adapter which artifact digests are actually served per required component. It never reads the
// DeploymentRelease or any DevOps self-report as observation input, and the adapter is not told the
// expected digest. Anything except MATCH (or a MIXED set the pinned policy explicitly permits) is
// non-acceptable.
export const RuntimeObservationStatus = Object.freeze({ MATCH: "MATCH", MISMATCH: "MISMATCH", MIXED: "MIXED", UNKNOWN: "UNKNOWN" });
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function classifyRuntimeIdentity({ expectedDigest, observedDigests, permittedRuntimeDigests = [] }) {
  const observed = [...new Set(observedDigests)].sort();
  if (observed.length === 0) return { status: RuntimeObservationStatus.UNKNOWN, acceptable: false };
  if (observed.length === 1 && observed[0] === expectedDigest) return { status: RuntimeObservationStatus.MATCH, acceptable: true };
  if (!observed.includes(expectedDigest)) return { status: RuntimeObservationStatus.MISMATCH, acceptable: false };
  const bounded = observed.every((digest) => digest === expectedDigest || permittedRuntimeDigests.includes(digest));
  return { status: RuntimeObservationStatus.MIXED, acceptable: bounded };
}

export function defineRuntimeObservationEvidence(raw) {
  invariant(raw && raw.kind === "RUNTIME_OBSERVATION_EVIDENCE" && raw.version === 1, "RuntimeObservationEvidence kind/version mismatch");
  requireContentRef(raw.snapshotRef, "acceptance-snapshot", "RuntimeObservationEvidence.snapshotRef");
  requireContentRef(raw.releaseRef, "deployment-release", "RuntimeObservationEvidence.releaseRef");
  requireText(raw.observerRef, "RuntimeObservationEvidence.observerRef");
  invariant(Object.values(RuntimeObservationStatus).includes(raw.status) && typeof raw.acceptable === "boolean", "RuntimeObservationEvidence status invalid");
  return frozenCopy(raw);
}

export function createRuntimeObserver({ observerRef, observerPolicyRef, adapter, artifactRegistry, snapshotResolver, now = () => new Date().toISOString() }) {
  requireText(observerRef, "observerRef");
  invariant(!observerRef.startsWith("deployment-release:") && !observerRef.startsWith("devops"), "a DeploymentRelease or DevOps self-report cannot act as runtime observer");
  requireText(observerPolicyRef, "observerPolicyRef");
  invariant(adapter && typeof adapter.observe === "function", "runtime observer requires adapter.observe()");
  invariant(artifactRegistry && typeof artifactRegistry.putRuntimeObservationEvidence === "function", "runtime observer requires the deployment artifact registry");
  invariant(snapshotResolver && typeof snapshotResolver.resolve === "function", "runtime observer requires the AcceptanceSnapshot resolver");

  async function observe(args) {
    invariant(args && typeof args === "object", "observe requires {snapshotRef}");
    for (const key of Object.keys(args)) invariant(key === "snapshotRef", `runtime observation accepts only a snapshotRef; ${key} (for example a release self-report) is not observation input`);
    const { snapshotRef, snapshot } = await snapshotResolver.resolve(args.snapshotRef);
    invariant(snapshot.observerRefs.includes(observerRef), `observer ${observerRef} is not trusted by the pinned acceptance policy`);
    const result = await adapter.observe(deepFreeze({ environmentRef: snapshot.environmentRef, components: snapshot.components.map((component) => ({ componentKind: component.componentKind })) }));
    invariant(result && typeof result === "object" && Array.isArray(result.observations), "observer adapter must return observations");
    invariant(result.kind !== "DEPLOYMENT_RELEASE" && result.source !== "SELF_REPORT", "a DeploymentRelease or application self-report is not runtime observation");
    const components = snapshot.components.map((component) => {
      const entries = result.observations.filter((entry) => entry.componentKind === component.componentKind);
      invariant(entries.length <= 1, `observer returned several observations for ${component.componentKind}`);
      const entry = entries[0] ?? { servedDigests: [], probeRefs: [] };
      invariant(entry.source !== "SELF_REPORT", `${component.componentKind} observation is an application self-report`);
      const observedDigests = [...new Set((entry.servedDigests ?? []).map((digest) => { invariant(DIGEST.test(digest), `observed digest must be sha256:<64 hex>: ${digest}`); return digest; }))].sort();
      const classified = classifyRuntimeIdentity({ expectedDigest: component.artifactDigest, observedDigests, permittedRuntimeDigests: component.permittedRuntimeDigests });
      return { componentKind: component.componentKind, deployableRef: component.deployableRef, expectedDigest: component.artifactDigest, observedDigests, status: classified.status, acceptable: classified.acceptable, probeRefs: (entry.probeRefs ?? []).map((ref, index) => requireText(ref, `probeRefs[${index}]`)) };
    });
    const statuses = components.map((component) => component.status);
    const status = statuses.every((value) => value === "MATCH") ? "MATCH" : statuses.includes("MISMATCH") ? "MISMATCH" : statuses.includes("MIXED") ? "MIXED" : "UNKNOWN";
    const evidence = defineRuntimeObservationEvidence({
      kind: "RUNTIME_OBSERVATION_EVIDENCE",
      version: 1,
      snapshotRef,
      releaseRef: snapshot.releaseRef,
      environmentRef: snapshot.environmentRef,
      observerRef,
      observerPolicyRef,
      observedAt: requireText(now(), "observedAt"),
      components,
      status,
      acceptable: components.every((component) => component.acceptable)
    });
    const observationRef = await artifactRegistry.putRuntimeObservationEvidence(evidence);
    return deepFreeze({ observationRef, evidence });
  }

  return Object.freeze({ observerRef, observe });
}
