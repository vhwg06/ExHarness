import { assertWorkContext } from "./blackboard-context-contract.mjs";
import { assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";

export function nextImplementationContext({ parent, decisionRef, decisionSubject, sourceBaseline, sourceScope, verification }) {
  assertWorkContext(parent);
  if (parent.action.kind !== "REVIEW") throw new Error("CONTEXT_GENERATION_INVALID: parent must be REVIEW");
  if (parent.pipeline === "IMPLEMENTATION_WORKER" && parent.lane !== "JUDGMENT")
    throw new Error("CONTEXT_GENERATION_INVALID: implementation parent must be JUDGMENT lane");
  if (!parent.__ref) throw new Error("CONTEXT_GENERATION_INVALID: parent ref required");
  if (!decisionRef) throw new Error("CONTEXT_GENERATION_INVALID: decision required");
  if (!decisionSubject?.subjectContextRef || !decisionSubject?.subjectCandidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: exact decision subject required");
  if (decisionSubject.subjectContextRef !== parent.__ref ||
      decisionSubject.subjectCandidateHeadSha !== parent.reviewTarget.candidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: decision subject mismatch");

  if (parent.pipeline === "IMPLEMENTATION_WORKER" && !parent.semanticArtifactRef)
    throw new Error("CONTEXT_GENERATION_INVALID: implementation parent requires semantic artifact");

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
  if(parent.pipeline==="IMPLEMENTATION_WORKER"){
    candidate.lane="EXECUTION";
    candidate.executionMode="INITIAL";
  }
  delete candidate.reviewTarget;
  delete candidate.judgmentKind;
  delete candidate.implementationResultRef;
  return assertWorkContext(candidate);
}

export function nextCandidateJudgmentContext({
  parent,
  implementationResultRef,
  candidateHeadSha,
  allowedPostTargetEnvelopePaths=[],
  sourceBaseline=parent?.sourceBaseline
}) {
  assertWorkContext(parent);
  if(parent.pipeline!=="IMPLEMENTATION_WORKER"||parent.lane!=="EXECUTION"||parent.action.kind!=="IMPLEMENT")
    throw new Error("CONTEXT_GENERATION_INVALID: candidate judgment parent must be IMPLEMENTATION_WORKER EXECUTION");
  if(!parent.__ref)throw new Error("CONTEXT_GENERATION_INVALID: parent ref required");
  if(typeof implementationResultRef!=="string"||!implementationResultRef.endsWith(".json"))
    throw new Error("CONTEXT_GENERATION_INVALID: implementation result ref required");
  if(!candidateHeadSha)throw new Error("CONTEXT_GENERATION_INVALID: candidate head required");

  const candidate={
    ...parent,
    status:"PENDING_JUDGMENT_CONTEXT",
    generation:parent.generation+1,
    parentContextRef:parent.__ref,
    lane:"JUDGMENT",
    judgmentKind:"CANDIDATE",
    implementationResultRef,
    action:{
      kind:"REVIEW",
      summary:"Independently judge the exact implementation candidate against the semantic input.",
      allowedMutations:[],
      forbiddenActions:["mutate product source","reuse producer correctness claims as judgment"]
    },
    reviewTarget:{
      repository:parent.sourceBaseline?.repository??"vhwg06/ExHarness",
      targetType:"git-commit",
      candidateHeadSha,
      allowedPostTargetEnvelopePaths
    },
    sourceBaseline,
    requiredInputRefs:[...new Set([...parent.requiredInputRefs,implementationResultRef])],
    sourceScope:{
      read:[...parent.sourceScope.read],
      write:[],
      forbiddenWrite:["**"]
    }
  };
  delete candidate.authority;
  delete candidate.executionMode;
  return assertWorkContext(candidate);
}

export function nextRepairContext({
  parent,
  judgmentRef,
  judgment,
  sourceBaseline,
  sourceScope,
  verification
}) {
  assertWorkContext(parent);
  if(parent.pipeline!=="IMPLEMENTATION_WORKER"||parent.lane!=="JUDGMENT"||parent.judgmentKind!=="CANDIDATE")
    throw new Error("CONTEXT_GENERATION_INVALID: repair parent must be candidate JUDGMENT");
  if(!parent.__ref)throw new Error("CONTEXT_GENERATION_INVALID: parent ref required");
  assertBlackboardArtifact(judgment);
  if(judgment.artifactType!=="JUDGMENT"||judgment.verdict!=="FINDINGS")
    throw new Error("CONTEXT_GENERATION_INVALID: repair requires FINDINGS judgment");
  if(judgment.subject.judgmentContextRef!==parent.__ref ||
     judgment.subject.semanticArtifactRef!==parent.semanticArtifactRef ||
     judgment.subject.implementationResultRef!==parent.implementationResultRef ||
     judgment.subject.candidateRef!==parent.reviewTarget.candidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: repair judgment subject mismatch");

  const candidate={
    ...parent,
    status:"REPAIR_IMPLEMENTATION_CONTEXT",
    generation:parent.generation+1,
    parentContextRef:parent.__ref,
    lane:"EXECUTION",
    executionMode:"REPAIR",
    action:{
      kind:"IMPLEMENT",
      summary:"Repair only grounded findings from the exact prior judgment.",
      allowedMutations:[],
      forbiddenActions:["claim acceptance","widen semantic input","repair outside grounded findings"]
    },
    authority:{
      repairJudgmentRef:judgmentRef,
      subjectContextRef:parent.__ref,
      subjectCandidateHeadSha:parent.reviewTarget.candidateHeadSha
    },
    sourceBaseline,
    sourceScope,
    verification,
    requiredInputRefs:[...new Set([...parent.requiredInputRefs,judgmentRef])]
  };
  delete candidate.reviewTarget;
  delete candidate.judgmentKind;
  delete candidate.implementationResultRef;
  return assertWorkContext(candidate);
}
