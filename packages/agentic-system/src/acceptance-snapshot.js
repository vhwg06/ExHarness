import { REQUIRED_DEPLOYABLE_COMPONENTS, deepFreeze, frozenCopy, invariant, requireContentRef, requireText } from "./deployable-artifact.js";

// AcceptanceSnapshot: the deterministic verification target for Product QA. It is derived from
// exactly one current DeploymentRelease plus one AcceptancePolicy; the mandatory FRONTEND and
// BACKEND deployables, criteria, environment, verifier policy and trusted observers come from those
// two artifacts. The builder accepts no caller-selected component list.
const RUNTIME_STATUSES = ["MATCH", "MISMATCH", "MIXED", "UNKNOWN"];

export function defineAcceptancePolicy(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "AcceptancePolicy must be an object");
  for (const key of Object.keys(raw)) invariant(["kind", "version", "policyId", "environmentRef", "requiredComponents", "criterionRefs", "verifierPolicyRef", "observerRefs", "permittedRuntimeDigests"].includes(key), `AcceptancePolicy field ${key} is not supported`);
  if (raw.kind != null) invariant(raw.kind === "ACCEPTANCE_POLICY" && raw.version === 1, "AcceptancePolicy kind/version mismatch");
  const required = [...(raw.requiredComponents ?? REQUIRED_DEPLOYABLE_COMPONENTS)].sort();
  for (const kind of REQUIRED_DEPLOYABLE_COMPONENTS) invariant(required.includes(kind), `AcceptancePolicy must require ${kind}`);
  invariant(required.length === REQUIRED_DEPLOYABLE_COMPONENTS.length, "AcceptancePolicy.requiredComponents must be exactly FRONTEND and BACKEND");
  invariant(Array.isArray(raw.criterionRefs) && raw.criterionRefs.length > 0, "AcceptancePolicy requires acceptance criteria");
  invariant(Array.isArray(raw.observerRefs) && raw.observerRefs.length > 0, "AcceptancePolicy requires independent runtime observers");
  for (const observer of raw.observerRefs) invariant(!String(observer).startsWith("deployment-release:") && !String(observer).startsWith("devops"), "a DeploymentRelease or DevOps self-report is not an independent observer");
  // Optional bounded rollout tolerance: extra served digests explicitly permitted per component.
  const permitted = raw.permittedRuntimeDigests ?? {};
  invariant(permitted && typeof permitted === "object" && !Array.isArray(permitted), "AcceptancePolicy.permittedRuntimeDigests must be an object");
  for (const [kind, digests] of Object.entries(permitted)) {
    invariant(required.includes(kind), `permittedRuntimeDigests names unknown component ${kind}`);
    invariant(Array.isArray(digests) && digests.every((digest) => /^sha256:[a-f0-9]{64}$/.test(digest)), "permittedRuntimeDigests must list immutable digests");
  }
  return deepFreeze({
    kind: "ACCEPTANCE_POLICY",
    version: 1,
    policyId: requireText(raw.policyId, "AcceptancePolicy.policyId"),
    environmentRef: requireText(raw.environmentRef, "AcceptancePolicy.environmentRef"),
    requiredComponents: required,
    criterionRefs: raw.criterionRefs.map((ref, index) => requireText(ref, `AcceptancePolicy.criterionRefs[${index}]`)),
    verifierPolicyRef: requireText(raw.verifierPolicyRef, "AcceptancePolicy.verifierPolicyRef"),
    observerRefs: [...raw.observerRefs].map((ref, index) => requireText(ref, `AcceptancePolicy.observerRefs[${index}]`)).sort(),
    permittedRuntimeDigests: Object.fromEntries(Object.entries(permitted).sort(([a], [b]) => a.localeCompare(b)).map(([kind, digests]) => [kind, [...digests].sort()]))
  });
}

export function createAcceptancePolicyResolver({ artifactRegistry }) {
  invariant(artifactRegistry && typeof artifactRegistry.resolveAcceptancePolicy === "function", "policy resolver requires the deployment artifact registry");
  return Object.freeze({
    async put(raw) { return artifactRegistry.putAcceptancePolicy(defineAcceptancePolicy(raw)); },
    async resolve(ref) { const raw = await artifactRegistry.resolveAcceptancePolicy(ref); invariant(raw, `AcceptancePolicy is unavailable: ${ref}`); return defineAcceptancePolicy(raw); }
  });
}

export function defineAcceptanceSnapshot(raw) {
  invariant(raw && raw.kind === "ACCEPTANCE_SNAPSHOT" && raw.version === 1, "AcceptanceSnapshot kind/version mismatch");
  requireContentRef(raw.releaseRef, "deployment-release", "AcceptanceSnapshot.releaseRef");
  requireContentRef(raw.acceptancePolicyRef, "acceptance-policy", "AcceptanceSnapshot.acceptancePolicyRef");
  requireText(raw.releaseHeadRevision, "AcceptanceSnapshot.releaseHeadRevision");
  invariant(Array.isArray(raw.components) && raw.components.map((component) => component.componentKind).join(",") === REQUIRED_DEPLOYABLE_COMPONENTS.join(","), "AcceptanceSnapshot must pin BACKEND and FRONTEND");
  invariant(Array.isArray(raw.acceptableRuntimeStatuses) && raw.acceptableRuntimeStatuses.every((status) => RUNTIME_STATUSES.includes(status)), "AcceptanceSnapshot runtime statuses invalid");
  return frozenCopy(raw);
}

export function createAcceptanceSnapshotBuilder({ deploymentReleaseController, artifactRegistry, acceptancePolicyResolver }) {
  invariant(deploymentReleaseController && typeof deploymentReleaseController.current === "function", "snapshot builder requires the DeploymentRelease controller");
  invariant(artifactRegistry && typeof artifactRegistry.putAcceptanceSnapshot === "function", "snapshot builder requires the deployment artifact registry");
  invariant(acceptancePolicyResolver && typeof acceptancePolicyResolver.resolve === "function", "snapshot builder requires an acceptance policy resolver");

  function derive(release, releaseRef, releaseHeadRevision, policy, acceptancePolicyRef) {
    invariant(policy.environmentRef === release.environmentRef, "AcceptancePolicy environment differs from the release environment");
    const components = policy.requiredComponents.map((kind) => {
      const matches = release.components.filter((component) => component.componentKind === kind);
      invariant(matches.length === 1, `DeploymentRelease does not pin exactly one ${kind} deployable`);
      const [component] = matches;
      return { componentKind: kind, deployableRef: component.deployableRef, artifactDigest: component.artifactDigest, buildProvenanceRef: component.buildProvenanceRef, permittedRuntimeDigests: policy.permittedRuntimeDigests[kind] ?? [] };
    });
    return defineAcceptanceSnapshot({
      kind: "ACCEPTANCE_SNAPSHOT",
      version: 1,
      environmentRef: release.environmentRef,
      releaseRef,
      releaseHeadRevision,
      acceptancePolicyRef,
      components,
      criterionRefs: [...policy.criterionRefs],
      verifierPolicyRef: policy.verifierPolicyRef,
      observerRefs: [...policy.observerRefs],
      acceptableRuntimeStatuses: ["MATCH"]
    });
  }

  // build({releaseRef, acceptancePolicyRef}) only: component selection is not an input.
  async function build(args) {
    invariant(args && typeof args === "object", "snapshot build requires {releaseRef, acceptancePolicyRef}");
    for (const key of Object.keys(args)) invariant(["releaseRef", "acceptancePolicyRef"].includes(key), `AcceptanceSnapshot components are derived from the release; ${key} is not accepted`);
    const releaseRef = requireContentRef(args.releaseRef, "deployment-release", "releaseRef");
    const policy = await acceptancePolicyResolver.resolve(args.acceptancePolicyRef);
    const head = await deploymentReleaseController.current(policy.environmentRef);
    invariant(head && head.releaseRef === releaseRef, "AcceptanceSnapshot requires the current DeploymentRelease for the environment");
    const snapshot = derive(head.release, releaseRef, head.revision, policy, args.acceptancePolicyRef);
    const snapshotRef = await artifactRegistry.putAcceptanceSnapshot(snapshot);
    return deepFreeze({ snapshotRef, snapshot });
  }

  // Historical resolution: recomputes the snapshot from its immutable release and policy, so an
  // omitted, substituted or mixed-release component list is rejected even after the head moved.
  async function resolve(snapshotRef) {
    const raw = await artifactRegistry.resolveAcceptanceSnapshot(snapshotRef);
    invariant(raw, `AcceptanceSnapshot is unavailable: ${snapshotRef}`);
    const snapshot = defineAcceptanceSnapshot(raw);
    const release = await deploymentReleaseController.resolveRelease(snapshot.releaseRef);
    const policy = await acceptancePolicyResolver.resolve(snapshot.acceptancePolicyRef);
    const expected = derive(release, snapshot.releaseRef, snapshot.releaseHeadRevision, policy, snapshot.acceptancePolicyRef);
    invariant(JSON.stringify(expected) === JSON.stringify(snapshot), "AcceptanceSnapshot does not match its release and policy (omitted or substituted component)");
    return deepFreeze({ snapshotRef, snapshot, release, policy });
  }

  return Object.freeze({ build, resolve });
}
