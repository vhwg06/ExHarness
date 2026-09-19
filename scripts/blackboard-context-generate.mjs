import { assertWorkContext } from "./blackboard-context-contract.mjs";

export function nextImplementationContext({ parent, decisionRef, decisionSubject, sourceBaseline, sourceScope, verification }) {
  assertWorkContext(parent);
  if (parent.action.kind !== "REVIEW") throw new Error("CONTEXT_GENERATION_INVALID: parent must be REVIEW");
  if (!parent.__ref) throw new Error("CONTEXT_GENERATION_INVALID: parent ref required");
  if (!decisionRef) throw new Error("CONTEXT_GENERATION_INVALID: decision required");
  if (!decisionSubject?.subjectContextRef || !decisionSubject?.subjectCandidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: exact decision subject required");
  if (decisionSubject.subjectContextRef !== parent.__ref ||
      decisionSubject.subjectCandidateHeadSha !== parent.reviewTarget.candidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: decision subject mismatch");

  const candidate={
    ...parent,
    status:"ACCEPTED_IMPLEMENTATION_CONTEXT",
    generation:parent.generation+1,
    parentContextRef:parent.__ref,
    transitionReasonRef:decisionRef,
    action:{kind:"IMPLEMENT",summary:"Implement accepted bounded slice.",allowedMutations:[],forbiddenActions:[]},
    authority:{
      implementationDecisionRef:decisionRef,
      subjectContextRef:decisionSubject.subjectContextRef,
      subjectCandidateHeadSha:decisionSubject.subjectCandidateHeadSha
    },
    sourceBaseline,sourceScope,verification
  };
  delete candidate.reviewTarget;
  return assertWorkContext(candidate);
}
