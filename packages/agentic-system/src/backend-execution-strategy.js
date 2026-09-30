import { createHash } from "node:crypto";
import { BackendObjectiveSchema, BackendRunAction, BackendWorkStatus } from "./contracts.js";
import { prepareBackendObjective, recoverPreparedBackendObjective, runPreparedBackendObjective } from "./backend-application.js";
import { defineBackendCompletionPolicy } from "./backend-completion.js";
import { resolveContractExecutionInput } from "./domain-execution-input.js";

// Backend runtime adapter for DomainExecutionController. It consumes only the exact
// released-claim WorkContract plus its single DomainExecutionInput, maps them to a
// BackendObjective, and runs prepare/run/recover of the Backend application. It never
// calls the Backend->QA composite flow and never selects policy, strategy or runtime.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const outputRef = (artifact) => Object.freeze({ ref: artifact.ref, digest: /:sha256:([0-9a-f]{64})$/.exec(artifact.ref)?.[1] ?? sha(artifact.ref) });
export const BACKEND_DOMAIN = "BACKEND";

function runtimeStatus(run) {
  if (run.result == null || run.decision.action === BackendRunAction.BLOCK) return "BLOCKED";
  if (run.result.status === BackendWorkStatus.APPLIED && run.decision.action === BackendRunAction.RETURN) return "SUCCEEDED";
  if (run.result.status === BackendWorkStatus.BLOCKED) return "BLOCKED";
  return "FAILED";
}

export function createBackendExecutionStrategy({
  adapterRef,
  runtimeDeploymentRef,
  producerAuthorityRef,
  runtimeKind = "backend-application",
  resolveDomainExecutionInput,
  repositoryReader,
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null,
  now = () => new Date().toISOString()
}) {
  invariant(typeof resolveDomainExecutionInput === "function", "Backend strategy requires resolveDomainExecutionInput()");
  invariant(repositoryReader && typeof repositoryReader.readFile === "function", "Backend strategy requires repositoryReader.readFile()");
  invariant(backendWorker && typeof backendWorker.execute === "function" && typeof backendWorker.recover === "function", "Backend strategy requires backendWorker.execute()/recover()");

  async function prepare({ binding, contract, runtimeInvocationKey }) {
    invariant(contract && contract.owningDomain === BACKEND_DOMAIN, "Backend strategy accepts only BACKEND WorkContracts");
    invariant(binding && binding.workContractRef === contract.contractRef && binding.owningDomain === contract.owningDomain && binding.workloadType === contract.workloadType, "Backend strategy binding does not match the released WorkContract");
    requireText(runtimeInvocationKey, "runtimeInvocationKey");
    const { ref, input } = await resolveContractExecutionInput({ contract, resolveDomainExecutionInput });
    const objective = BackendObjectiveSchema.parse({ id: contract.boardItemId, ...input.objective });
    return { inputRef: ref, prepared: await prepareBackendObjective(objective, { repositoryReader }) };
  }

  function toRuntimeResult({ inputRef, run, runtimeInvocationKey, startedAt }) {
    const status = runtimeStatus(run);
    const outputs = status === "SUCCEEDED" ? run.result.artifacts.map(outputRef) : [];
    return Object.freeze({
      status,
      runtimeInvocationId: runtimeInvocationKey,
      startedAt,
      finishedAt: now(),
      effectRefs: run.result?.revision && run.result.status === BackendWorkStatus.APPLIED ? ["backend-revision:" + run.order.repositoryRef + "@" + run.result.revision] : [],
      traceRefs: ["backend-work-order:" + run.order.id],
      outputArtifactRefs: outputs,
      verificationCandidateRefs: (run.result?.evidence ?? []).map((artifact) => requireText(artifact.id, "Backend evidence id")),
      counterevidenceRefs: status === "SUCCEEDED" ? [] : [(run.completion?.reasons ?? [run.decision.reason]).map((reason) => "backend-completion:" + reason).join(",") || "backend-completion:BLOCKED"],
      proposedDerivationEdges: outputs.map((output) => ({ outputRef: output.ref, derivedFrom: [inputRef] })),
      domainDecision: Object.freeze({ action: run.decision.action, reason: run.decision.reason })
    });
  }

  async function invoke(adapterInput, mode) {
    const startedAt = now();
    const { inputRef, prepared } = await prepare(adapterInput);
    const options = { backendWorker, completionPolicy, backendAdvisor };
    const run = mode === "recover" ? await recoverPreparedBackendObjective(prepared, options) : await runPreparedBackendObjective(prepared, options);
    return toRuntimeResult({ inputRef, run, runtimeInvocationKey: adapterInput.runtimeInvocationKey, startedAt });
  }

  return Object.freeze({
    adapterRef: requireText(adapterRef, "Backend strategy adapterRef"),
    runtimeKind: requireText(runtimeKind, "Backend strategy runtimeKind"),
    runtimeDeploymentRef: requireText(runtimeDeploymentRef, "Backend strategy runtimeDeploymentRef"),
    producerAuthorityRef: requireText(producerAuthorityRef, "Backend strategy producerAuthorityRef"),
    dispatch: (adapterInput) => invoke(adapterInput, "dispatch"),
    recover: (adapterInput) => invoke(adapterInput, "recover")
  });
}
