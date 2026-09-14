import {
  BackendCompletionAction,
  BackendCompletionReason
} from "./backend-completion.js";
import { BackendWorkResultSchema } from "./contracts.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

export const BackendAdvisorAction = Object.freeze({
  RETRY_IMPLEMENTATION: "RETRY_IMPLEMENTATION",
  REQUEST_CONTEXT: "REQUEST_CONTEXT",
  ESCALATE: "ESCALATE"
});

function parseBackendAdvisorProposal(raw, result) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "BackendAdvisor proposal must be an object");
  invariant(Object.values(BackendAdvisorAction).includes(raw.action), "BackendAdvisor proposal action is invalid");
  invariant(Array.isArray(raw.gapIds) && raw.gapIds.length > 0, "BackendAdvisor proposal must reference at least one gap");

  const knownGaps = new Set(result.gaps.map((gap) => gap.id));
  const gapIds = [...new Set(raw.gapIds.map((gapId, index) => {
    const id = requireText(gapId, `BackendAdvisor proposal.gapIds[${index}]`);
    invariant(knownGaps.has(id), `BackendAdvisor proposal references unknown gap: ${id}`);
    return id;
  }))];

  const contextNeeds = raw.contextNeeds == null
    ? []
    : (() => {
        invariant(Array.isArray(raw.contextNeeds), "BackendAdvisor proposal.contextNeeds must be an array");
        return raw.contextNeeds.map((need, index) => requireText(need, `BackendAdvisor proposal.contextNeeds[${index}]`));
      })();

  if (raw.action === BackendAdvisorAction.REQUEST_CONTEXT) {
    invariant(contextNeeds.length > 0, "REQUEST_CONTEXT proposal requires contextNeeds");
  }

  return Object.freeze({
    action: raw.action,
    gapIds: Object.freeze(gapIds),
    rationale: requireText(raw.rationale, "BackendAdvisor proposal.rationale"),
    contextNeeds: Object.freeze(contextNeeds)
  });
}

export function createBackendAdvisor({ assess }) {
  invariant(typeof assess === "function", "BackendAdvisor requires assess()");
  return Object.freeze({ assess });
}

export async function assessBackendContinuation({ advisor, objective, order, result: rawResult, completion }) {
  const result = BackendWorkResultSchema.parse(rawResult);
  const ambiguous = completion?.action === BackendCompletionAction.CONTINUE &&
    completion.reasons?.includes(BackendCompletionReason.UNRESOLVED_GAPS);

  if (!ambiguous) return null;
  invariant(advisor && typeof advisor.assess === "function", "Backend unresolved gaps require BackendAdvisor.assess()");

  const rawProposal = await advisor.assess({
    objective: structuredClone(objective),
    order: structuredClone(order),
    result: structuredClone(result),
    completion: structuredClone(completion)
  });

  return parseBackendAdvisorProposal(rawProposal, result);
}
