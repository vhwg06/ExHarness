import { createApplicationOrchestrator as createBaseApplicationOrchestrator } from "./application-orchestrator.js";
import { validateBlackboardPersistedPayload } from "./blackboard-json-payload.js";

function guardPersistedPayloadInputs(orchestrator) {
  return Object.freeze({
    ...orchestrator,

    async seed(rawItems) {
      if (Array.isArray(rawItems)) {
        validateBlackboardPersistedPayload(rawItems, { path: "$.items" });
      }
      return orchestrator.seed(rawItems);
    },

    async checkpoint(input) {
      if (input?.checkpoint != null) {
        validateBlackboardPersistedPayload(input.checkpoint, { path: "$.checkpoint" });
      }
      return orchestrator.checkpoint(input);
    },

    async submit(input) {
      if (input?.submission != null) {
        validateBlackboardPersistedPayload(input.submission, { path: "$.submission" });
      }
      return orchestrator.submit(input);
    }
  });
}

export function createApplicationOrchestrator(options) {
  return guardPersistedPayloadInputs(createBaseApplicationOrchestrator(options));
}
