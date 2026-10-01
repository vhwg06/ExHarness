import { createHash } from "node:crypto";
import { resolveExecutionJudgmentBundle } from "./domain-execution-control.js";
import { DEVOPS_DOMAIN } from "./devops-execution-strategy.js";
import { REQUIRED_DEPLOYABLE_COMPONENTS, deepFreeze, frozenCopy, invariant, requireContentRef, requireText, resolveDeployableProvenance } from "./deployable-artifact.js";

// DeploymentRelease publication and currentness (DevOps authority only). A release is immutable
// and names the exact FE+BE deployables, config and rollout evidence that one ACCEPT DevOps
// completion published. DeploymentReleaseHead(environmentRef) is CAS currentness; every head
// mutation and every QA final-currentness check runs under one per-environment mutation guard.
export const deploymentReleaseSubjectKey = (environmentRef) => "deployment-release-head:" + createHash("sha256").update(JSON.stringify({ environmentRef: requireText(environmentRef, "environmentRef") })).digest("hex");

export class DeploymentReleaseDriftError extends TypeError {
  constructor(message) { super(message); this.name = "DeploymentReleaseDriftError"; this.code = "DEPLOYMENT_RELEASE_DRIFT"; }
}

// Per-key serial guard. Callers that share one guard instance cannot interleave for a key.
export function createDeploymentMutationGuard() {
  const tails = new Map();
  return Object.freeze({
    async withEnvironment(environmentRef, action) {
      requireText(environmentRef, "environmentRef");
      const previous = tails.get(environmentRef) ?? Promise.resolve();
      let release;
      const current = new Promise((resolve) => { release = resolve; });
      const tail = previous.then(() => current);
      tails.set(environmentRef, tail);
      await previous;
      try { return await action(); }
      finally { release(); if (tails.get(environmentRef) === tail) tails.delete(environmentRef); }
    }
  });
}

export function defineDeploymentRelease(raw) {
  invariant(raw && raw.kind === "DEPLOYMENT_RELEASE" && raw.version === 1, "DeploymentRelease kind/version mismatch");
  invariant(Array.isArray(raw.components) && raw.components.map((component) => component.componentKind).join(",") === REQUIRED_DEPLOYABLE_COMPONENTS.join(","), "DeploymentRelease must pin exactly one BACKEND and one FRONTEND deployable");
  for (const component of raw.components) {
    requireContentRef(component.deployableRef, "deployable-artifact", "DeploymentRelease deployableRef");
    requireContentRef(component.buildProvenanceRef, "build-provenance", "DeploymentRelease buildProvenanceRef");
    invariant(/^sha256:[a-f0-9]{64}$/.test(component.artifactDigest), "DeploymentRelease artifactDigest must be immutable");
  }
  requireText(raw.environmentRef, "DeploymentRelease.environmentRef");
  requireText(raw.configRef, "DeploymentRelease.configRef");
  requireContentRef(raw.deploymentEvidenceRef, "deployment-execution-evidence", "DeploymentRelease.deploymentEvidenceRef");
  requireContentRef(raw.devopsJudgmentBundleRef, "execution-judgment-bundle", "DeploymentRelease.devopsJudgmentBundleRef");
  requireContentRef(raw.devopsCompletionDecisionRef, "domain-completion-decision", "DeploymentRelease.devopsCompletionDecisionRef");
  requireContentRef(raw.devopsPublicationReceiptRef, "domain-publication-receipt", "DeploymentRelease.devopsPublicationReceiptRef");
  invariant(Array.isArray(raw.rolloutEvidenceRefs) && raw.rolloutEvidenceRefs.length > 0, "DeploymentRelease requires rollout evidence");
  if (raw.previousReleaseRef != null) requireContentRef(raw.previousReleaseRef, "deployment-release", "DeploymentRelease.previousReleaseRef");
  return frozenCopy(raw);
}

export function createDeploymentReleaseController({ artifactRegistry, releaseHeadStore, domainArtifactRegistry, organizationArtifactRegistry, mutationGuard = createDeploymentMutationGuard(), projectGuard = null, projectIdForEnvironment = null, causalSink = null, causalNow = () => new Date().toISOString() }) {
  invariant(artifactRegistry && typeof artifactRegistry.putDeploymentRelease === "function", "release controller requires the deployment artifact registry");
  invariant(releaseHeadStore && typeof releaseHeadStore.current === "function" && typeof releaseHeadStore.compareAndSwap === "function", "release controller requires a CAS head store");
  invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveExecutionJudgmentBundle === "function", "release controller requires the domain execution artifact registry");
  invariant(organizationArtifactRegistry && typeof organizationArtifactRegistry.resolveWorkContract === "function", "release controller requires the organization artifact registry");
  invariant(mutationGuard && typeof mutationGuard.withEnvironment === "function", "release controller requires a mutation guard");

  async function resolveRelease(releaseRef) {
    const raw = await artifactRegistry.resolveDeploymentRelease(releaseRef);
    invariant(raw, `DeploymentRelease is unavailable: ${releaseRef}`);
    return defineDeploymentRelease(raw);
  }

  async function current(environmentRef) {
    const subjectKey = deploymentReleaseSubjectKey(environmentRef);
    const head = await releaseHeadStore.current(subjectKey);
    if (head == null) return null;
    const release = await resolveRelease(head.value.releaseRef);
    invariant(release.environmentRef === environmentRef, "DeploymentReleaseHead points at another environment");
    return deepFreeze({ subjectKey, revision: head.revision, generation: head.value.generation, releaseRef: head.value.releaseRef, release });
  }

  // DevOps publication: only an ACCEPT DEVOPS completion with a publication receipt that published
  // exactly one DeploymentExecutionEvidence can become a release.
  async function publish({ judgmentBundleRef }) {
    const packet = await resolveExecutionJudgmentBundle({ artifactRegistry: domainArtifactRegistry, organizationArtifactRegistry, bundleRef: judgmentBundleRef });
    invariant(packet.contract.owningDomain === DEVOPS_DOMAIN, "only a DEVOPS judgment can publish a DeploymentRelease");
    invariant(packet.completionDecision.verdict === "ACCEPT", "DeploymentRelease requires an ACCEPT DevOps completion decision");
    invariant(packet.publicationReceipt, "DeploymentRelease requires a DevOps DomainPublicationReceipt");
    const evidenceRefs = packet.publicationReceipt.publishedArtifactRefs.map((artifact) => artifact.ref).filter((ref) => ref.startsWith("deployment-execution-evidence:"));
    invariant(evidenceRefs.length === 1, "DevOps publication must publish exactly one DeploymentExecutionEvidence");
    const evidence = await artifactRegistry.resolveDeploymentExecutionEvidence(evidenceRefs[0]);
    invariant(evidence && evidence.workContractRef === packet.contract.contractRef, "deployment evidence does not belong to the judged DevOps contract");
    invariant(Array.isArray(evidence.components) && evidence.components.map((component) => component.componentKind).join(",") === REQUIRED_DEPLOYABLE_COMPONENTS.join(","), "deployment evidence must cover exactly BACKEND and FRONTEND");
    const components = [];
    for (const component of evidence.components) {
      const resolved = await resolveDeployableProvenance({ artifactRegistry, domainArtifactRegistry, deployableRef: component.deployableRef });
      invariant(resolved.deployable.componentKind === component.componentKind && resolved.deployable.artifactDigest === component.artifactDigest && resolved.buildProvenanceRef === component.buildProvenanceRef, `deployment evidence ${component.componentKind} identity differs from its deployable`);
      components.push({ componentKind: component.componentKind, deployableRef: component.deployableRef, artifactDigest: component.artifactDigest, buildProvenanceRef: component.buildProvenanceRef });
    }
    const environmentRef = requireText(evidence.environmentRef, "deployment evidence environmentRef");
    const subjectKey = deploymentReleaseSubjectKey(environmentRef);
    // Optional Integration G binding: closure-relevant release publications
    // can additionally serialize with product history/closure on the same
    // shared project guard. Absent by default; delivered E/F behavior unchanged.
    const projectId = typeof projectIdForEnvironment === "function" ? projectIdForEnvironment(environmentRef) : null;
    const withProject = projectGuard != null && projectId != null && typeof projectGuard.withProduct === "function"
      ? (action) => projectGuard.withProduct(projectId, action)
      : (action) => action();
    return withProject(() => mutationGuard.withEnvironment(environmentRef, async () => {
      const head = await releaseHeadStore.current(subjectKey);
      if (head?.value?.releaseRef != null && (await resolveRelease(head.value.releaseRef)).devopsJudgmentBundleRef === judgmentBundleRef) {
        const replay = await current(environmentRef);
        return deepFreeze({ releaseRef: replay.releaseRef, release: replay.release, head: replay, replayed: true });
      }
      const release = defineDeploymentRelease({
        kind: "DEPLOYMENT_RELEASE",
        version: 1,
        environmentRef,
        configRef: evidence.configRef,
        components,
        deploymentEvidenceRef: evidenceRefs[0],
        rolloutEvidenceRefs: evidence.rolloutEvidenceRefs,
        devopsJudgmentBundleRef: judgmentBundleRef,
        devopsCompletionDecisionRef: packet.bundle.pins.completionDecision.ref,
        devopsPublicationReceiptRef: packet.bundle.pins.publicationReceipt.ref,
        previousReleaseRef: head?.value?.releaseRef ?? null
      });
      const releaseRef = await artifactRegistry.putDeploymentRelease(release);
      const generation = (head?.value?.generation ?? 0) + 1;
      invariant(await releaseHeadStore.compareAndSwap(subjectKey, head?.revision ?? null, { releaseRef, generation }), "DeploymentReleaseHead CAS conflict");
      if (causalSink) {
        // Observational evidence only: sink failure never gates the release.
        try { await causalSink.record({ kind: "CAUSAL_LIFECYCLE_EVIDENCE", version: 1, workId: `deployment-release:${environmentRef}`, eventKind: "PUBLISHED", observedAt: causalNow(), boundaryRef: releaseRef }); } catch {}
      }
      return deepFreeze({ releaseRef, release, head: await current(environmentRef), replayed: false });
    }));
  }

  // Runs action only while releaseRef at headRevision is the current release for the environment,
  // holding the guard so no release publication for that environment can commit meanwhile.
  async function withCurrentReleaseGuard({ environmentRef, releaseRef, headRevision }, action) {
    requireText(releaseRef, "releaseRef");
    requireText(headRevision, "headRevision");
    invariant(typeof action === "function", "withCurrentReleaseGuard requires an action");
    return mutationGuard.withEnvironment(environmentRef, async () => {
      const head = await releaseHeadStore.current(deploymentReleaseSubjectKey(environmentRef));
      if (head?.value?.releaseRef !== releaseRef || head.revision !== headRevision) throw new DeploymentReleaseDriftError(`DeploymentRelease is no longer current for ${environmentRef}`);
      return action(deepFreeze({ environmentRef, releaseRef, headRevision }));
    });
  }

  return Object.freeze({ publish, current, resolveRelease, withCurrentReleaseGuard });
}
