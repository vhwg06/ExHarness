import { assertPort } from "./contracts.js";

export function validateCorePorts({
  environment,
  evaluator,
  sessionStore,
  supervisor,
  contextProjector,
  dosagePolicy
}) {
  assertPort(environment, "observe", "environment port");
  assertPort(environment, "act", "environment port");
  assertPort(evaluator, "evaluate", "evaluation port");
  assertPort(sessionStore, "load", "persistent work state store port");
  assertPort(sessionStore, "save", "persistent work state store port");
  assertPort(supervisor, "inspect", "supervisor port");
  assertPort(contextProjector, "project", "context projector port");
  assertPort(dosagePolicy, "decide", "dosage policy port");
}
