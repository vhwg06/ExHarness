import { assertWorkContext } from "./blackboard-context-contract.mjs";
import { assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";

export function nextImplementationContext({ parent, decisionRef, sourceBaseline, sourceScope, verification }) {
  assertWorkContext(parent);
  if (parent.action.kind !== "REVIEW") throw new Error("CONTEXT_GENERATION_INVALID: current context must be REVIEW");
  if (parent.pipeline === "IMPLEMENTATION_WORKER" && parent.lane !== "JUDGMENT")
    throw new Error("CONTEXT_GENERATION_INVALID: implementation current context must be JUDGMENT lane");
  if (!decisionRef) throw new Error("CONTEXT_GENERATION_INVALID: decision required");
  if (parent.pipeline === "IMPLEMENTATION_WORKER" && !parent.semanticArtifactRef)
    throw new Error("CONTEXT_GENERATION_INVALID: implementation current context requires semantic artifact");

  const candidate={
    ...parent,
    status:"EXECUTION_CONTEXT",
    action:{kind:"IMPLEMENT",summary:"Implement accepted bounded slice.",allowedMutations:[],forbiddenActions:[]},
    authority:{ref:decisionRef},
    sourceBaseline,sourceScope,verification,
    requiredInputRefs:[...new Set([...parent.requiredInputRefs,decisionRef])]
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
  sourceBaseline=parent?.sourceBaseline
}) {
  assertWorkContext(parent);
  if(parent.pipeline!=="IMPLEMENTATION_WORKER"||parent.lane!=="EXECUTION"||parent.action.kind!=="IMPLEMENT")
    throw new Error("CONTEXT_GENERATION_INVALID: current context must be IMPLEMENTATION_WORKER EXECUTION");
  if(typeof implementationResultRef!=="string"||!implementationResultRef.endsWith(".json"))
    throw new Error("CONTEXT_GENERATION_INVALID: implementation result ref required");
  if(!candidateHeadSha)throw new Error("CONTEXT_GENERATION_INVALID: candidate head required");

  const candidate={
    ...parent,
    status:"JUDGMENT_CONTEXT",
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
      candidateHeadSha
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
    throw new Error("CONTEXT_GENERATION_INVALID: current context must be candidate JUDGMENT");
  assertBlackboardArtifact(judgment);
  if(judgment.artifactType!=="JUDGMENT"||judgment.verdict!=="FINDINGS")
    throw new Error("CONTEXT_GENERATION_INVALID: repair requires FINDINGS judgment");
  if(judgment.subject.itemId!==parent.itemId ||
     judgment.subject.semanticArtifactRef!==parent.semanticArtifactRef ||
     judgment.subject.implementationResultRef!==parent.implementationResultRef ||
     judgment.subject.candidateRef!==parent.reviewTarget.candidateHeadSha)
    throw new Error("CONTEXT_GENERATION_INVALID: repair judgment subject mismatch");

  const candidate={
    ...parent,
    status:"REPAIR_CONTEXT",
    lane:"EXECUTION",
    executionMode:"REPAIR",
    action:{
      kind:"IMPLEMENT",
      summary:"Repair only grounded findings from the current judgment.",
      allowedMutations:[],
      forbiddenActions:["claim acceptance","widen semantic input","repair outside grounded findings"]
    },
    authority:{ref:judgmentRef},
    sourceBaseline,
    sourceScope,
    verification,
    requiredInputRefs:[...new Set([...parent.requiredInputRefs,judgmentRef])]
  };
  delete candidate.reviewTarget;
  delete candidate.judgmentKind;
  return assertWorkContext(candidate);
}
