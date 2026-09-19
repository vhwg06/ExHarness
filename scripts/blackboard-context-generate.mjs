import { assertWorkContext } from "./blackboard-context-contract.mjs";

export function nextImplementationContext({ parent, decisionRef, sourceBaseline, sourceScope, verification }) {
  assertWorkContext(parent);
  if (parent.action.kind !== "REVIEW") throw new Error("CONTEXT_GENERATION_INVALID: parent must be REVIEW");
  if (!decisionRef) throw new Error("CONTEXT_GENERATION_INVALID: decision required");
  return {
    ...parent,
    status: "ACCEPTED_IMPLEMENTATION_CONTEXT",
    generation: parent.generation + 1,
    parentContextRef: parent.__ref,
    transitionReasonRef: decisionRef,
    action: { kind: "IMPLEMENT", summary: "Implement accepted bounded slice.", allowedMutations: [], forbiddenActions: [] },
    authority: { implementationDecisionRef: decisionRef },
    sourceBaseline,
    sourceScope,
    verification
  };
}
