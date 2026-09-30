import { createHash } from "node:crypto";
import { FrontendObjectiveSchema, FrontendRunAction, FrontendWorkStatus } from "./frontend-contracts.js";
import { prepareFrontendObjective, recoverPreparedFrontendObjective, runPreparedFrontendObjective } from "./frontend-application.js";
import { defineFrontendCompletionPolicy } from "./frontend-completion.js";
import { resolveContractExecutionInput } from "./domain-execution-input.js";

// Frontend runtime adapter for DomainExecutionController. It consumes only the exact
// Frontend WorkContract plus its single DomainExecutionInput and has no Backend stage,
// session or completion dependency.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
const sha = (value) => createHash("sha256").update(value).digest("hex");
const outputRef = (artifact) => Object.freeze({ ref: artifact.ref, digest: /:sha256:([0-9a-f]{64})$/.exec(artifact.ref)?.[1] ?? sha(artifact.ref) });
export const FRONTEND_DOMAIN = "FRONTEND";

function runtimeStatus(run) {
  if (run.result == null || run.decision.action === FrontendRunAction.BLOCK) return "BLOCKED";
  if (run.result.status === FrontendWorkStatus.APPLIED && run.decision.action === FrontendRunAction.RETURN) return "SUCCEEDED";
  if (run.result.status === FrontendWorkStatus.BLOCKED) return "BLOCKED";
  return "FAILED";
}

export function createFrontendExecutionStrategy({
  adapterRef,
  runtimeDeploymentRef,
  producerAuthorityRef,
  runtimeKind = "frontend-application",
  resolveDomainExecutionInput,
  repositoryReader,
  frontendWorker,
  completionPolicy = defineFrontendCompletionPolicy(),
  now = () => new Date().toISOString()
}) {
  invariant(typeof resolveDomainExecutionInput === "function", "Frontend strategy requires resolveDomainExecutionInput()");
  invariant(repositoryReader && typeof repositoryReader.readFile === "function", "Frontend strategy requires repositoryReader.readFile()");
  invariant(frontendWorker && typeof frontendWorker.execute === "function" && typeof frontendWorker.recover === "function", "Frontend strategy requires frontendWorker.execute()/recover()");

  async function prepare({ binding, contract, runtimeInvocationKey }) {
    invariant(contract && contract.owningDomain === FRONTEND_DOMAIN, "Frontend strategy accepts only FRONTEND WorkContracts");
    invariant(binding && binding.workContractRef === contract.contractRef && binding.owningDomain === contract.owningDomain && binding.workloadType === contract.workloadType, "Frontend strategy binding does not match the released WorkContract");
    requireText(runtimeInvocationKey, "runtimeInvocationKey");
    const { ref, input } = await resolveContractExecutionInput({ contract, resolveDomainExecutionInput });
    const objective = FrontendObjectiveSchema.parse({ id: contract.boardItemId, ...input.objective });
    return { inputRef: ref, prepared: await prepareFrontendObjective(objective, { repositoryReader }) };
  }

  async function invoke(adapterInput, mode) {
    const startedAt = now();
    const { inputRef, prepared } = await prepare(adapterInput);
    const options = { frontendWorker, completionPolicy };
    const run = mode === "recover" ? await recoverPreparedFrontendObjective(prepared, options) : await runPreparedFrontendObjective(prepared, options);
    const status = runtimeStatus(run);
    const outputs = status === "SUCCEEDED" ? run.result.artifacts.map(outputRef) : [];
    return Object.freeze({
      status,
      runtimeInvocationId: adapterInput.runtimeInvocationKey,
      startedAt,
      finishedAt: now(),
      effectRefs: run.result?.revision && run.result.status === FrontendWorkStatus.APPLIED ? ["frontend-revision:" + run.order.repositoryRef + "@" + run.result.revision] : [],
      traceRefs: ["frontend-work-order:" + run.order.id],
      outputArtifactRefs: outputs,
      verificationCandidateRefs: (run.result?.evidence ?? []).map((artifact) => requireText(artifact.id, "Frontend evidence id")),
      counterevidenceRefs: status === "SUCCEEDED" ? [] : [(run.completion?.reasons ?? [run.decision.reason]).map((reason) => "frontend-completion:" + reason).join(",") || "frontend-completion:BLOCKED"],
      proposedDerivationEdges: outputs.map((output) => ({ outputRef: output.ref, derivedFrom: [inputRef] })),
      domainDecision: Object.freeze({ action: run.decision.action, reason: run.decision.reason })
    });
  }

  return Object.freeze({
    adapterRef: requireText(adapterRef, "Frontend strategy adapterRef"),
    runtimeKind: requireText(runtimeKind, "Frontend strategy runtimeKind"),
    runtimeDeploymentRef: requireText(runtimeDeploymentRef, "Frontend strategy runtimeDeploymentRef"),
    producerAuthorityRef: requireText(producerAuthorityRef, "Frontend strategy producerAuthorityRef"),
    dispatch: (adapterInput) => invoke(adapterInput, "dispatch"),
    recover: (adapterInput) => invoke(adapterInput, "recover")
  });
}
