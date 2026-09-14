import { BackendCompletionAction } from "./backend-completion.js";
import { runBackendObjective } from "./backend-application.js";
import { createQaHandoffFromBackendRun, runQaObjective } from "./qa-application.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function runBackendThenQaObjective({ backendObjective, qaObjective }, {
  repositoryReader,
  artifactReader,
  backendWorker,
  qaWorker,
  backendCompletionPolicy,
  backendAdvisor = null,
  qaCompletionPolicy
}) {
  invariant(backendObjective != null, "runBackendThenQaObjective requires backendObjective");
  invariant(qaObjective != null, "runBackendThenQaObjective requires qaObjective");

  const backend = await runBackendObjective(backendObjective, {
    repositoryReader,
    backendWorker,
    ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
    backendAdvisor
  });

  if (backend.completion.action !== BackendCompletionAction.ACCEPT) {
    return Object.freeze({
      backend,
      handoff: null,
      qa: null,
      decision: Object.freeze({
        stage: "BACKEND",
        action: backend.decision.action,
        reason: backend.decision.reason
      })
    });
  }

  const handoff = createQaHandoffFromBackendRun(backend);
  const qa = await runQaObjective(qaObjective, {
    handoff,
    artifactReader,
    qaWorker,
    ...(qaCompletionPolicy == null ? {} : { completionPolicy: qaCompletionPolicy })
  });

  return Object.freeze({
    backend,
    handoff,
    qa,
    decision: Object.freeze({
      stage: "QA",
      action: qa.decision.action,
      reason: qa.decision.reason
    })
  });
}
