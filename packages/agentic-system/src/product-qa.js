import { createHash } from "node:crypto";
import { resolveContractExecutionInput } from "./domain-execution-input.js";
import { resolveExecutionJudgmentBundle } from "./domain-execution-control.js";
import { defineRuntimeObservationEvidence } from "./runtime-observation.js";
import { deepFreeze, frozenCopy, invariant, requireContentRef, requireText } from "./deployable-artifact.js";

// Product QA. The execution strategy is bound to one AcceptanceSnapshot, rechecks that its release is
// still current before any effect, and emits criterion + runtime-observation evidence only. It has no
// access to QualityAcceptance. QualityAcceptance is written only by the separate publisher, which
// requires an ACCEPT PRODUCT_QA completion with its publication receipt, evidence for exactly that
// snapshot, and holds the release-head guard while it commits.
export const PRODUCT_QA_DOMAIN = "PRODUCT_QA";
const hex = (ref) => /:sha256:([0-9a-f]{64})$/.exec(ref)?.[1] ?? createHash("sha256").update(ref).digest("hex");
export const qualityAcceptanceSubjectKey = (environmentRef) => "quality-acceptance-head:" + createHash("sha256").update(JSON.stringify({ environmentRef: requireText(environmentRef, "environmentRef") })).digest("hex");

function snapshotObjective(objective) {
  invariant(objective && typeof objective === "object" && !Array.isArray(objective), "Product QA objective must be an object");
  for (const key of Object.keys(objective)) invariant(key === "snapshotRef", `Product QA objective field ${key} is not supported`);
  return requireContentRef(objective.snapshotRef, "acceptance-snapshot", "Product QA objective.snapshotRef");
}

export function createProductQaExecutionStrategy({
  adapterRef,
  runtimeDeploymentRef,
  producerAuthorityRef,
  runtimeKind = "product-qa",
  resolveDomainExecutionInput,
  snapshotResolver,
  deploymentReleaseController,
  runtimeObserver,
  criterionVerifier,
  artifactRegistry,
  now = () => new Date().toISOString()
}) {
  invariant(typeof resolveDomainExecutionInput === "function", "Product QA strategy requires resolveDomainExecutionInput()");
  invariant(snapshotResolver && typeof snapshotResolver.resolve === "function", "Product QA strategy requires the AcceptanceSnapshot resolver");
  invariant(deploymentReleaseController && typeof deploymentReleaseController.current === "function", "Product QA strategy requires the DeploymentRelease controller (read-only)");
  invariant(runtimeObserver && typeof runtimeObserver.observe === "function", "Product QA strategy requires an independent runtime observer");
  invariant(criterionVerifier && typeof criterionVerifier.verify === "function", "Product QA strategy requires criterionVerifier.verify()");
  invariant(artifactRegistry && typeof artifactRegistry.putQaCriterionEvidence === "function", "Product QA strategy requires the deployment artifact registry");

  async function invoke({ binding, contract, runtimeInvocationKey }) {
    invariant(contract && contract.owningDomain === PRODUCT_QA_DOMAIN, "Product QA strategy accepts only PRODUCT_QA WorkContracts");
    invariant(binding && binding.workContractRef === contract.contractRef && binding.owningDomain === contract.owningDomain && binding.workloadType === contract.workloadType, "Product QA strategy binding does not match the released WorkContract");
    requireText(runtimeInvocationKey, "runtimeInvocationKey");
    const startedAt = now();
    const { input } = await resolveContractExecutionInput({ contract, resolveDomainExecutionInput });
    const { snapshotRef, snapshot } = await snapshotResolver.resolve(snapshotObjective(input.objective));
    const base = { runtimeInvocationId: runtimeInvocationKey, startedAt, traceRefs: ["product-qa:" + snapshotRef] };
    const head = await deploymentReleaseController.current(snapshot.environmentRef);
    if (head?.releaseRef !== snapshot.releaseRef || head.revision !== snapshot.releaseHeadRevision) {
      // Pre-start drift: the verification target is no longer current; no observation, no effects.
      return Object.freeze({ ...base, status: "BLOCKED", finishedAt: now(), effectRefs: [], outputArtifactRefs: [], verificationCandidateRefs: [], counterevidenceRefs: ["product-qa:release-drift:" + snapshotRef], proposedDerivationEdges: [], domainDecision: Object.freeze({ action: "BLOCK", reason: "RELEASE_DRIFT" }) });
    }
    const { observationRef, evidence: observation } = await runtimeObserver.observe({ snapshotRef });
    const results = [];
    for (const criterionRef of snapshot.criterionRefs) {
      const result = await criterionVerifier.verify(deepFreeze({ snapshotRef, environmentRef: snapshot.environmentRef, components: snapshot.components, criterionRef, verifierPolicyRef: snapshot.verifierPolicyRef }));
      invariant(result && ["PASS", "FAIL", "INCONCLUSIVE"].includes(result.verdict), `criterion verifier verdict invalid: ${criterionRef}`);
      results.push({ criterionRef, verdict: result.verdict, evidenceRefs: (result.evidenceRefs ?? []).map((ref, index) => requireText(ref, `criterion evidence ${index}`)) });
    }
    const criterionEvidenceRef = await artifactRegistry.putQaCriterionEvidence({ kind: "QA_CRITERION_EVIDENCE", version: 1, snapshotRef, releaseRef: snapshot.releaseRef, verifierPolicyRef: snapshot.verifierPolicyRef, runtimeObservationRef: observationRef, results, workContractRef: contract.contractRef });
    const outputs = [criterionEvidenceRef, observationRef].map((ref) => Object.freeze({ ref, digest: hex(ref) }));
    return Object.freeze({
      ...base,
      status: "SUCCEEDED",
      finishedAt: now(),
      effectRefs: [],
      outputArtifactRefs: outputs,
      verificationCandidateRefs: [criterionEvidenceRef, observationRef],
      counterevidenceRefs: [...(observation.acceptable ? [] : ["runtime-observation:" + observation.status]), ...results.filter((result) => result.verdict !== "PASS").map((result) => "criterion:" + result.criterionRef + ":" + result.verdict)],
      proposedDerivationEdges: outputs.map((output) => ({ outputRef: output.ref, derivedFrom: [snapshotRef] })),
      domainDecision: Object.freeze({ action: "RETURN", reason: "QA_EVIDENCE_PRODUCED" })
    });
  }

  return Object.freeze({
    adapterRef: requireText(adapterRef, "Product QA strategy adapterRef"),
    runtimeKind: requireText(runtimeKind, "Product QA strategy runtimeKind"),
    runtimeDeploymentRef: requireText(runtimeDeploymentRef, "Product QA strategy runtimeDeploymentRef"),
    producerAuthorityRef: requireText(producerAuthorityRef, "Product QA strategy producerAuthorityRef"),
    dispatch: invoke,
    recover: invoke
  });
}

// Product QA completion judgment: ACCEPT only when the run produced evidence for one snapshot, the
// independent observation is acceptable and every pinned criterion passed.
export function createProductQaCompletionEvaluator({ authorityRef, artifactRegistry }) {
  invariant(artifactRegistry && typeof artifactRegistry.resolveQaCriterionEvidence === "function", "Product QA completion requires the deployment artifact registry");
  return Object.freeze({
    authorityRef: requireText(authorityRef, "Product QA completion authorityRef"),
    async evaluate({ outcome }) {
      if (outcome.status !== "SUCCEEDED") return { verdict: outcome.status === "BLOCKED" ? "BLOCKED" : "INCONCLUSIVE", criterionResults: [{ criterionId: "product-qa-run", verdict: "INCONCLUSIVE", evidenceRefs: [] }], counterevidenceRefs: outcome.counterevidenceRefs };
      const criterionRef = outcome.outputArtifactRefs.map((output) => output.ref).find((ref) => ref.startsWith("qa-criterion-evidence:"));
      const observationRef = outcome.outputArtifactRefs.map((output) => output.ref).find((ref) => ref.startsWith("runtime-observation-evidence:"));
      const criteria = criterionRef ? await artifactRegistry.resolveQaCriterionEvidence(criterionRef) : null;
      const observation = observationRef ? await artifactRegistry.resolveRuntimeObservationEvidence(observationRef) : null;
      const runtimeResult = { criterionId: "runtime-identity", verdict: observation?.acceptable ? "PASS" : "FAIL", evidenceRefs: observationRef ? [observationRef] : [] };
      const criterionResults = [runtimeResult, ...(criteria?.results ?? []).map((result) => ({ criterionId: result.criterionRef, verdict: result.verdict, evidenceRefs: [criterionRef, ...result.evidenceRefs] }))];
      const verdict = criteria && observation && criterionResults.every((result) => result.verdict === "PASS") ? "ACCEPT" : "REMEDIATION_REQUIRED";
      return { verdict, criterionResults, counterevidenceRefs: [] };
    }
  });
}

export function defineQualityAcceptance(raw) {
  invariant(raw && raw.kind === "QUALITY_ACCEPTANCE" && raw.version === 1 && raw.verdict === "ACCEPT", "QualityAcceptance kind/version/verdict mismatch");
  for (const [key, prefix] of [["releaseRef", "deployment-release"], ["snapshotRef", "acceptance-snapshot"], ["runtimeObservationRef", "runtime-observation-evidence"], ["criterionEvidenceRef", "qa-criterion-evidence"], ["qaJudgmentBundleRef", "execution-judgment-bundle"], ["qaCompletionDecisionRef", "domain-completion-decision"], ["qaPublicationReceiptRef", "domain-publication-receipt"]]) requireContentRef(raw[key], prefix, `QualityAcceptance.${key}`);
  requireText(raw.releaseHeadRevision, "QualityAcceptance.releaseHeadRevision");
  requireText(raw.acceptanceAuthorityRef, "QualityAcceptance.acceptanceAuthorityRef");
  return frozenCopy(raw);
}

export function createQualityAcceptancePublisher({ domainArtifactRegistry, organizationArtifactRegistry, deploymentReleaseController, artifactRegistry, qualityAcceptanceHeadStore, snapshotResolver, acceptanceAuthorityRef }) {
  invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveExecutionJudgmentBundle === "function", "QualityAcceptance publisher requires the domain execution artifact registry");
  invariant(organizationArtifactRegistry && typeof organizationArtifactRegistry.resolveDomainExecutionInput === "function", "QualityAcceptance publisher requires the organization artifact registry");
  invariant(deploymentReleaseController && typeof deploymentReleaseController.withCurrentReleaseGuard === "function", "QualityAcceptance publisher requires the release-head guard");
  invariant(artifactRegistry && typeof artifactRegistry.putQualityAcceptance === "function", "QualityAcceptance publisher requires the deployment artifact registry");
  invariant(qualityAcceptanceHeadStore && typeof qualityAcceptanceHeadStore.compareAndSwap === "function", "QualityAcceptance publisher requires a CAS head store");
  invariant(snapshotResolver && typeof snapshotResolver.resolve === "function", "QualityAcceptance publisher requires the AcceptanceSnapshot resolver");
  requireText(acceptanceAuthorityRef, "acceptanceAuthorityRef");

  async function publish({ judgmentBundleRef, snapshotRef }) {
    const packet = await resolveExecutionJudgmentBundle({ artifactRegistry: domainArtifactRegistry, organizationArtifactRegistry, bundleRef: judgmentBundleRef });
    invariant(packet.contract.owningDomain === PRODUCT_QA_DOMAIN, "only a PRODUCT_QA judgment can publish QualityAcceptance (DevOps cannot issue a QA verdict)");
    invariant(packet.completionDecision.verdict === "ACCEPT", "QualityAcceptance requires an ACCEPT Product QA completion decision; QA SUCCEEDED or a matching observation alone is not acceptance");
    invariant(packet.publicationReceipt && packet.publicationReceipt.domain === PRODUCT_QA_DOMAIN, "QualityAcceptance requires a Product QA DomainPublicationReceipt");
    const { input } = await resolveContractExecutionInput({ contract: packet.contract, resolveDomainExecutionInput: organizationArtifactRegistry.resolveDomainExecutionInput });
    invariant(snapshotObjective(input.objective) === snapshotRef, "the QA judgment was executed for another AcceptanceSnapshot");
    const { snapshot } = await snapshotResolver.resolve(snapshotRef);
    const published = packet.publicationReceipt.publishedArtifactRefs.map((artifact) => artifact.ref);
    const criterionRefs = published.filter((ref) => ref.startsWith("qa-criterion-evidence:"));
    const observationRefs = published.filter((ref) => ref.startsWith("runtime-observation-evidence:"));
    invariant(criterionRefs.length === 1 && observationRefs.length === 1, "QA publication must publish exactly one criterion evidence and one runtime observation");
    const criteria = await artifactRegistry.resolveQaCriterionEvidence(criterionRefs[0]);
    const observation = defineRuntimeObservationEvidence(await artifactRegistry.resolveRuntimeObservationEvidence(observationRefs[0]));
    invariant(criteria && criteria.snapshotRef === snapshotRef && criteria.releaseRef === snapshot.releaseRef && criteria.runtimeObservationRef === observationRefs[0], "criterion evidence does not bind this snapshot");
    invariant(JSON.stringify(criteria.results.map((result) => result.criterionRef)) === JSON.stringify(snapshot.criterionRefs) && criteria.results.every((result) => result.verdict === "PASS"), "every pinned acceptance criterion must PASS");
    invariant(observation.snapshotRef === snapshotRef && observation.releaseRef === snapshot.releaseRef && snapshot.observerRefs.includes(observation.observerRef), "runtime observation does not come from a trusted observer for this snapshot");
    invariant(observation.acceptable === true, `runtime identity ${observation.status} is not acceptable`);
    const subjectKey = qualityAcceptanceSubjectKey(snapshot.environmentRef);
    return deploymentReleaseController.withCurrentReleaseGuard({ environmentRef: snapshot.environmentRef, releaseRef: snapshot.releaseRef, headRevision: snapshot.releaseHeadRevision }, async () => {
      const head = await qualityAcceptanceHeadStore.current(subjectKey);
      const acceptance = defineQualityAcceptance({
        kind: "QUALITY_ACCEPTANCE",
        version: 1,
        verdict: "ACCEPT",
        environmentRef: snapshot.environmentRef,
        releaseRef: snapshot.releaseRef,
        releaseHeadRevision: snapshot.releaseHeadRevision,
        snapshotRef,
        runtimeObservationRef: observationRefs[0],
        criterionEvidenceRef: criterionRefs[0],
        qaJudgmentBundleRef: judgmentBundleRef,
        qaCompletionDecisionRef: packet.bundle.pins.completionDecision.ref,
        qaPublicationReceiptRef: packet.bundle.pins.publicationReceipt.ref,
        acceptanceAuthorityRef,
        previousAcceptanceRef: head?.value?.acceptanceRef ?? null
      });
      const acceptanceRef = await artifactRegistry.putQualityAcceptance(acceptance);
      invariant(await qualityAcceptanceHeadStore.compareAndSwap(subjectKey, head?.revision ?? null, { acceptanceRef, releaseRef: snapshot.releaseRef }), "QualityAcceptance head CAS conflict");
      return deepFreeze({ acceptanceRef, acceptance });
    });
  }

  async function resolve(acceptanceRef) {
    const raw = await artifactRegistry.resolveQualityAcceptance(acceptanceRef);
    invariant(raw, `QualityAcceptance is unavailable: ${acceptanceRef}`);
    return defineQualityAcceptance(raw);
  }

  // Current acceptance for an environment: current only while it names the current release head.
  async function currentFor(environmentRef) {
    const head = await qualityAcceptanceHeadStore.current(qualityAcceptanceSubjectKey(environmentRef));
    if (head == null) return null;
    const acceptance = await resolve(head.value.acceptanceRef);
    const release = await deploymentReleaseController.current(environmentRef);
    return deepFreeze({ acceptanceRef: head.value.acceptanceRef, acceptance, current: release?.releaseRef === acceptance.releaseRef && release.revision === acceptance.releaseHeadRevision });
  }

  return Object.freeze({ publish, resolve, currentFor });
}

