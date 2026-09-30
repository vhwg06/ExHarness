import { createHash } from "node:crypto";
import { resolveContractExecutionInput } from "./domain-execution-input.js";
import { REQUIRED_DEPLOYABLE_COMPONENTS, deepFreeze, invariant, requireText, resolveDeployableProvenance } from "./deployable-artifact.js";

// DevOps runtime adapter for DomainExecutionController. It maps one DEVOPS WorkContract plus its
// single DomainExecutionInput ({environmentRef, configRef, deployableRefs:{FRONTEND,BACKEND}}) to
// DeploymentExecutionEvidence only. It never publishes a DeploymentRelease and never judges quality:
// release currentness is owned by the DeploymentRelease controller, quality by Product QA.
export const DEVOPS_DOMAIN = "DEVOPS";
const hex = (ref) => /:sha256:([0-9a-f]{64})$/.exec(ref)?.[1] ?? createHash("sha256").update(ref).digest("hex");

export function parseDeploymentObjective(objective) {
  invariant(objective && typeof objective === "object" && !Array.isArray(objective), "DevOps objective must be an object");
  for (const key of Object.keys(objective)) invariant(["environmentRef", "configRef", "deployableRefs"].includes(key), `DevOps objective field ${key} is not supported`);
  const refs = objective.deployableRefs;
  invariant(refs && typeof refs === "object" && !Array.isArray(refs), "DevOps objective.deployableRefs must name FRONTEND and BACKEND");
  invariant(Object.keys(refs).sort().join(",") === REQUIRED_DEPLOYABLE_COMPONENTS.join(","), "DevOps objective.deployableRefs must name exactly FRONTEND and BACKEND");
  return deepFreeze({
    environmentRef: requireText(objective.environmentRef, "DevOps objective.environmentRef"),
    configRef: requireText(objective.configRef, "DevOps objective.configRef"),
    deployableRefs: { BACKEND: requireText(refs.BACKEND, "deployableRefs.BACKEND"), FRONTEND: requireText(refs.FRONTEND, "deployableRefs.FRONTEND") }
  });
}

export function createDevOpsExecutionStrategy({
  adapterRef,
  runtimeDeploymentRef,
  producerAuthorityRef,
  runtimeKind = "devops-deployment",
  resolveDomainExecutionInput,
  artifactRegistry,
  domainArtifactRegistry,
  deployer,
  now = () => new Date().toISOString()
}) {
  invariant(typeof resolveDomainExecutionInput === "function", "DevOps strategy requires resolveDomainExecutionInput()");
  invariant(artifactRegistry && typeof artifactRegistry.putDeploymentExecutionEvidence === "function", "DevOps strategy requires the deployment artifact registry");
  invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveDomainPublicationReceipt === "function", "DevOps strategy requires the domain execution artifact registry");
  invariant(deployer && typeof deployer.deploy === "function", "DevOps strategy requires deployer.deploy()");

  async function invoke({ binding, contract, runtimeInvocationKey }, mode) {
    invariant(contract && contract.owningDomain === DEVOPS_DOMAIN, "DevOps strategy accepts only DEVOPS WorkContracts");
    invariant(binding && binding.workContractRef === contract.contractRef && binding.owningDomain === contract.owningDomain && binding.workloadType === contract.workloadType, "DevOps strategy binding does not match the released WorkContract");
    requireText(runtimeInvocationKey, "runtimeInvocationKey");
    const startedAt = now();
    const { ref: inputRef, input } = await resolveContractExecutionInput({ contract, resolveDomainExecutionInput });
    const objective = parseDeploymentObjective(input.objective);
    const components = [];
    for (const kind of REQUIRED_DEPLOYABLE_COMPONENTS) {
      const resolved = await resolveDeployableProvenance({ artifactRegistry, domainArtifactRegistry, deployableRef: objective.deployableRefs[kind] });
      invariant(resolved.deployable.componentKind === kind, `deployable ${objective.deployableRefs[kind]} is not a ${kind} component`);
      components.push({ componentKind: kind, deployableRef: resolved.deployableRef, artifactDigest: resolved.deployable.artifactDigest, buildProvenanceRef: resolved.buildProvenanceRef });
    }
    const request = deepFreeze({ environmentRef: objective.environmentRef, configRef: objective.configRef, components, runtimeInvocationKey });
    const run = mode === "recover" && typeof deployer.recover === "function" ? await deployer.recover(request) : await deployer.deploy(request);
    invariant(run && ["SUCCEEDED", "FAILED", "BLOCKED", "UNKNOWN"].includes(run.status), "deployer result status invalid");
    const rolloutEvidenceRefs = (run.rolloutEvidenceRefs ?? []).map((ref, index) => requireText(ref, `rolloutEvidenceRefs[${index}]`));
    const base = { runtimeInvocationId: runtimeInvocationKey, startedAt, finishedAt: now(), traceRefs: ["devops-deployment:" + objective.environmentRef], domainDecision: Object.freeze({ action: run.status }) };
    if (run.status !== "SUCCEEDED") {
      return Object.freeze({ ...base, status: run.status, effectRefs: [], outputArtifactRefs: [], verificationCandidateRefs: [], counterevidenceRefs: ["devops-deployment:" + run.status + (run.reason ? ":" + run.reason : "")], proposedDerivationEdges: [] });
    }
    invariant(rolloutEvidenceRefs.length > 0, "a SUCCEEDED deployment must return rollout evidence");
    const evidenceRef = await artifactRegistry.putDeploymentExecutionEvidence({
      kind: "DEPLOYMENT_EXECUTION_EVIDENCE",
      version: 1,
      environmentRef: objective.environmentRef,
      configRef: objective.configRef,
      components,
      rolloutEvidenceRefs,
      inputRef,
      workContractRef: contract.contractRef,
      runtimeInvocationKey
    });
    return Object.freeze({
      ...base,
      status: "SUCCEEDED",
      effectRefs: ["devops-rollout:" + objective.environmentRef + "@" + hex(evidenceRef)],
      outputArtifactRefs: [Object.freeze({ ref: evidenceRef, digest: hex(evidenceRef) })],
      verificationCandidateRefs: rolloutEvidenceRefs,
      counterevidenceRefs: [],
      proposedDerivationEdges: [{ outputRef: evidenceRef, derivedFrom: [inputRef, ...components.map((component) => component.deployableRef)] }]
    });
  }

  return Object.freeze({
    adapterRef: requireText(adapterRef, "DevOps strategy adapterRef"),
    runtimeKind: requireText(runtimeKind, "DevOps strategy runtimeKind"),
    runtimeDeploymentRef: requireText(runtimeDeploymentRef, "DevOps strategy runtimeDeploymentRef"),
    producerAuthorityRef: requireText(producerAuthorityRef, "DevOps strategy producerAuthorityRef"),
    dispatch: (adapterInput) => invoke(adapterInput, "dispatch"),
    recover: (adapterInput) => invoke(adapterInput, "recover")
  });
}
