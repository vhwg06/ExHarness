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
    },

    async submitWithRequiredReviews(input) {
      if (input?.submission != null) {
        validateBlackboardPersistedPayload(input.submission, { path: "$.submission" });
      }
      return orchestrator.submitWithRequiredReviews(input);
    },

    async extendWorkGraph(input) {
      if (Array.isArray(input?.newItems)) {
        validateBlackboardPersistedPayload(input.newItems, { path: "$.newItems" });
      }
      return orchestrator.extendWorkGraph(input);
    }
  });
}

export function createApplicationOrchestrator(options) {
  return guardPersistedPayloadInputs(createBaseApplicationOrchestrator(options));
}
