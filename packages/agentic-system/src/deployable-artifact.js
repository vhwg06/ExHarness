import { createHash } from "node:crypto";

// Exact deployable identity for Integration E/F. A deployable is one component kind plus one
// immutable artifact digest; BuildProvenance links that digest to an accepted Frontend/Backend
// source delivery (its DomainPublicationReceipt). Source revisions, mutable tags and URIs are
// metadata only and can never stand in for the digest.
export const DeployableComponentKind = Object.freeze({ FRONTEND: "FRONTEND", BACKEND: "BACKEND" });
export const REQUIRED_DEPLOYABLE_COMPONENTS = Object.freeze([DeployableComponentKind.BACKEND, DeployableComponentKind.FRONTEND]);

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PUBLICATION_REF = /^domain-publication-receipt:sha256:[a-f0-9]{64}$/;
const PROVENANCE_REF = /^build-provenance:sha256:[a-f0-9]{64}$/;

export function invariant(condition, message) { if (!condition) throw new TypeError(message); }
export function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
export const contentDigest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const deepFreeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const frozenCopy = (value) => deepFreeze(structuredClone(value));
export function requireContentRef(ref, prefix, name) {
  requireText(ref, name);
  invariant(new RegExp(`^${prefix}:sha256:[a-f0-9]{64}$`).test(ref), `${name} must be a content-addressed ${prefix} ref`);
  return ref;
}
function onlyKeys(raw, allowed, name) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${name} must be an object`);
  for (const key of Object.keys(raw)) invariant(allowed.includes(key), `${name} field ${key} is not supported`);
}
function componentKind(value, name) {
  invariant(Object.values(DeployableComponentKind).includes(value), `${name} must be FRONTEND or BACKEND`);
  return value;
}
export function requireArtifactDigest(value, name = "artifactDigest") {
  invariant(value != null && value !== "", `${name} is required: a source revision, tag or URI is not deployable identity`);
  invariant(typeof value === "string" && DIGEST.test(value), `${name} must be an immutable sha256:<64 hex> artifact digest, not a tag, alias or revision`);
  return value;
}

export function defineBuildProvenance(raw) {
  onlyKeys(raw, ["kind", "version", "componentKind", "sourceDeliveryRef", "sourceRevision", "buildEvidenceRefs", "artifactDigest", "artifactUri", "mutableTag"], "BuildProvenance");
  if (raw.kind != null) invariant(raw.kind === "BUILD_PROVENANCE" && raw.version === 1, "BuildProvenance kind/version mismatch");
  const sourceRevision = requireText(raw.sourceRevision, "BuildProvenance.sourceRevision");
  const artifactDigest = requireArtifactDigest(raw.artifactDigest, "BuildProvenance.artifactDigest");
  invariant(artifactDigest !== sourceRevision && artifactDigest.slice(7) !== sourceRevision, "BuildProvenance.artifactDigest must not be the source revision");
  const sourceDeliveryRef = requireText(raw.sourceDeliveryRef, "BuildProvenance.sourceDeliveryRef");
  invariant(PUBLICATION_REF.test(sourceDeliveryRef), "BuildProvenance.sourceDeliveryRef must be an accepted DomainPublicationReceipt ref");
  invariant(Array.isArray(raw.buildEvidenceRefs) && raw.buildEvidenceRefs.length > 0, "BuildProvenance.buildEvidenceRefs must be a non-empty array");
  const artifactUri = raw.artifactUri == null ? null : requireText(raw.artifactUri, "BuildProvenance.artifactUri");
  if (artifactUri && artifactUri.includes("@sha256:")) invariant(artifactUri.endsWith("@" + artifactDigest), "BuildProvenance.artifactUri digest differs from artifactDigest");
  return deepFreeze({
    kind: "BUILD_PROVENANCE",
    version: 1,
    componentKind: componentKind(raw.componentKind, "BuildProvenance.componentKind"),
    sourceDeliveryRef,
    sourceRevision,
    buildEvidenceRefs: raw.buildEvidenceRefs.map((ref, index) => requireText(ref, `BuildProvenance.buildEvidenceRefs[${index}]`)),
    artifactDigest,
    artifactUri,
    mutableTag: raw.mutableTag == null ? null : requireText(raw.mutableTag, "BuildProvenance.mutableTag")
  });
}

export function defineDeployableArtifactRef(raw) {
  onlyKeys(raw, ["kind", "version", "componentKind", "artifactDigest", "buildProvenanceRef"], "DeployableArtifactRef");
  if (raw.kind != null) invariant(raw.kind === "DEPLOYABLE_ARTIFACT_REF" && raw.version === 1, "DeployableArtifactRef kind/version mismatch");
  const buildProvenanceRef = requireText(raw.buildProvenanceRef, "DeployableArtifactRef.buildProvenanceRef");
  invariant(PROVENANCE_REF.test(buildProvenanceRef), "DeployableArtifactRef.buildProvenanceRef must be a content-addressed BuildProvenance ref");
  return deepFreeze({
    kind: "DEPLOYABLE_ARTIFACT_REF",
    version: 1,
    componentKind: componentKind(raw.componentKind, "DeployableArtifactRef.componentKind"),
    artifactDigest: requireArtifactDigest(raw.artifactDigest, "DeployableArtifactRef.artifactDigest"),
    buildProvenanceRef
  });
}

// Content-addressed registry for every Integration E/F artifact. put/resolve check the kind and
// version, and resolve rejects content whose digest differs from its ref.
export const DEPLOYMENT_ARTIFACTS = Object.freeze({
  BuildProvenance: ["build-provenance", "BUILD_PROVENANCE", defineBuildProvenance],
  DeployableArtifactRef: ["deployable-artifact", "DEPLOYABLE_ARTIFACT_REF", defineDeployableArtifactRef],
  DeploymentExecutionEvidence: ["deployment-execution-evidence", "DEPLOYMENT_EXECUTION_EVIDENCE", null],
  DeploymentRelease: ["deployment-release", "DEPLOYMENT_RELEASE", null],
  AcceptancePolicy: ["acceptance-policy", "ACCEPTANCE_POLICY", null],
  AcceptanceSnapshot: ["acceptance-snapshot", "ACCEPTANCE_SNAPSHOT", null],
  RuntimeObservationEvidence: ["runtime-observation-evidence", "RUNTIME_OBSERVATION_EVIDENCE", null],
  QaCriterionEvidence: ["qa-criterion-evidence", "QA_CRITERION_EVIDENCE", null],
  QualityAcceptance: ["quality-acceptance", "QUALITY_ACCEPTANCE", null]
});

export function createDeploymentArtifactRegistry({ store }) {
  invariant(store && typeof store.put === "function" && typeof store.resolve === "function", "deployment artifact registry requires an immutable artifact store");
  async function put(name, value) {
    const [prefix, kind, define] = DEPLOYMENT_ARTIFACTS[name];
    invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
    const artifact = define ? define(value) : value;
    invariant(artifact.kind === kind && artifact.version === 1, `${name} kind/version mismatch`);
    return store.put(prefix, structuredClone(artifact));
  }
  async function resolve(name, ref) {
    const [prefix, kind, define] = DEPLOYMENT_ARTIFACTS[name];
    requireContentRef(ref, prefix, `${name} ref`);
    const value = await store.resolve(ref);
    if (value == null) return null;
    invariant(value.kind === kind && value.version === 1, `${name} artifact kind/version mismatch`);
    invariant(ref === `${prefix}:sha256:${contentDigest(value)}`, `${name} artifact digest mismatch`);
    return define ? define(value) : frozenCopy(value);
  }
  const api = {};
  for (const name of Object.keys(DEPLOYMENT_ARTIFACTS)) {
    api[`put${name}`] = (value) => put(name, value);
    api[`resolve${name}`] = (ref) => resolve(name, ref);
  }
  return Object.freeze(api);
}

// An accepted source delivery is a DomainPublicationReceipt of the same component domain whose
// DomainCompletionDecision is ACCEPT.
export async function resolveAcceptedSourceDelivery({ domainArtifactRegistry, sourceDeliveryRef, componentKind: kind }) {
  invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveDomainPublicationReceipt === "function", "domainArtifactRegistry is required");
  const receipt = await domainArtifactRegistry.resolveDomainPublicationReceipt(sourceDeliveryRef);
  invariant(receipt, `source delivery is unavailable: ${sourceDeliveryRef}`);
  invariant(receipt.domain === kind, `source delivery domain ${receipt.domain} does not match component ${kind}`);
  const decision = await domainArtifactRegistry.resolveDomainCompletionDecision(receipt.completionDecisionRef);
  invariant(decision && decision.verdict === "ACCEPT" && decision.domain === kind, "source delivery is not an ACCEPT completion of its component domain");
  return deepFreeze({ receipt, decision });
}

// Persists BuildProvenance after checking its source delivery, then the DeployableArtifactRef
// that pins the same component and digest.
export async function publishDeployableArtifact({ artifactRegistry, domainArtifactRegistry, provenance: raw }) {
  const provenance = defineBuildProvenance(raw);
  await resolveAcceptedSourceDelivery({ domainArtifactRegistry, sourceDeliveryRef: provenance.sourceDeliveryRef, componentKind: provenance.componentKind });
  const buildProvenanceRef = await artifactRegistry.putBuildProvenance(provenance);
  const deployable = defineDeployableArtifactRef({ componentKind: provenance.componentKind, artifactDigest: provenance.artifactDigest, buildProvenanceRef });
  const deployableRef = await artifactRegistry.putDeployableArtifactRef(deployable);
  return deepFreeze({ buildProvenanceRef, provenance, deployableRef, deployable });
}

// Fresh-consumer resolution of one exact deployable back to its accepted source delivery.
export async function resolveDeployableProvenance({ artifactRegistry, domainArtifactRegistry, deployableRef }) {
  const deployable = await artifactRegistry.resolveDeployableArtifactRef(deployableRef);
  invariant(deployable, `deployable artifact is unavailable: ${deployableRef}`);
  const provenance = await artifactRegistry.resolveBuildProvenance(deployable.buildProvenanceRef);
  invariant(provenance, `build provenance is unavailable: ${deployable.buildProvenanceRef}`);
  invariant(provenance.componentKind === deployable.componentKind && provenance.artifactDigest === deployable.artifactDigest, "deployable does not match its build provenance");
  const sourceDelivery = await resolveAcceptedSourceDelivery({ domainArtifactRegistry, sourceDeliveryRef: provenance.sourceDeliveryRef, componentKind: provenance.componentKind });
  return deepFreeze({ deployableRef, deployable, buildProvenanceRef: deployable.buildProvenanceRef, provenance, sourceDelivery });
}
