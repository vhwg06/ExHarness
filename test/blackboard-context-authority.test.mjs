import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext } from "../scripts/blackboard-context-contract.mjs";
import { nextImplementationContext, nextCandidateJudgmentContext, nextRepairContext } from "../scripts/blackboard-context-generate.mjs";

const review={
  kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:1,__ref:"g1.json",
  action:{kind:"REVIEW"},
  reviewTarget:{repository:"r",candidateHeadSha:"abc",allowedPostTargetEnvelopePaths:[]},
  sourceScope:{read:[],write:[],forbiddenWrite:[]},
  requiredCurrentSystemRefs:[],requiredInputRefs:[],auditRefs:[]
};
const workerReview={
  ...review,
  pipeline:"IMPLEMENTATION_WORKER",
  lane:"JUDGMENT",
  judgmentKind:"READINESS",
  semanticArtifactRef:"artifact.json",
  requiredInputRefs:["artifact.json"]
};

test("generator cannot turn review into implementation without decision",()=>assert.throws(
  ()=>nextImplementationContext({parent:review,sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),
  /decision required/
));
test("generator requires exact accepted decision subject",()=>assert.throws(
  ()=>nextImplementationContext({parent:review,decisionRef:"d",sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),
  /exact decision subject/
));
test("generic generator output passes its own implementation contract",()=>{
 const out=nextImplementationContext({
   parent:review,decisionRef:"d",
   decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},
   sourceBaseline:{repository:"r",revision:"x"},
   sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},
   verification:[]
 });
 assert.equal(assertWorkContext(out),out);
 assert.deepEqual(out.authority,{implementationDecisionRef:"d",subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"});
});
test("implementation context requires parent and decision",()=>assert.throws(
  ()=>assertWorkContext({...review,action:{kind:"IMPLEMENT"},authority:{implementationDecisionRef:"d"}}),
  /exact authority subject|parent context/
));

test("readiness judgment transitions to initial execution and preserves semantic input",()=>{
 const out=nextImplementationContext({
   parent:workerReview,decisionRef:"d",
   decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},
   sourceBaseline:{repository:"r",revision:"x"},
   sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
   verification:["npm test"]
 });
 assert.equal(out.semanticArtifactRef,"artifact.json");
 assert.equal(out.lane,"EXECUTION");
 assert.equal(out.executionMode,"INITIAL");
 assert.equal(out.action.kind,"IMPLEMENT");
});

test("execution transitions to independent candidate judgment",()=>{
 const execution=nextImplementationContext({
   parent:workerReview,decisionRef:"d",
   decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},
   sourceBaseline:{repository:"r",revision:"x"},
   sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
   verification:["npm test"]
 });
 execution.__ref="g2.json";
 const judgment=nextCandidateJudgmentContext({
   parent:execution,
   implementationResultRef:"result.json",
   candidateHeadSha:"candidate-sha",
   allowedPostTargetEnvelopePaths:["result.json","g3.json"]
 });
 assert.equal(judgment.lane,"JUDGMENT");
 assert.equal(judgment.judgmentKind,"CANDIDATE");
 assert.equal(judgment.action.kind,"REVIEW");
 assert.equal(judgment.implementationResultRef,"result.json");
 assert.deepEqual(judgment.sourceScope.write,[]);
 assert.ok(judgment.requiredInputRefs.includes("result.json"));
});

test("FINDINGS judgment alone can open bounded repair execution",()=>{
 const execution=nextImplementationContext({
   parent:workerReview,decisionRef:"d",
   decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},
   sourceBaseline:{repository:"r",revision:"x"},
   sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
   verification:["npm test"]
 });
 execution.__ref="g2.json";
 const candidateJudgment=nextCandidateJudgmentContext({
   parent:execution,implementationResultRef:"result.json",candidateHeadSha:"candidate-sha"
 });
 candidateJudgment.__ref="g3.json";
 const judgmentArtifact={
   kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
   subject:{itemId:"BB-X",semanticArtifactRef:"artifact.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"x",judgmentContextRef:"g3.json"},
   assessments:{
     criteria:[{id:"AC-1",status:"FINDING",reason:"Behavior mismatch.",evidenceRefs:["e"]}],
     invariants:[{id:"INV-1",status:"SATISFIED",reason:"Boundary preserved.",evidenceRefs:["e"]}]
   },
   findings:[{id:"F-1",type:"IMPLEMENTATION_FINDING",severity:"P1",statement:"Repair the exact behavior mismatch.",evidenceRefs:["e"]}],
   verdict:"FINDINGS",
   provenance:{evidenceRefs:["e"]}
 };
 const repair=nextRepairContext({
   parent:candidateJudgment,judgmentRef:"judgment.json",judgment:judgmentArtifact,
   sourceBaseline:{repository:"r",revision:"candidate-sha"},
   sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
   verification:["npm test"]
 });
 assert.equal(repair.lane,"EXECUTION");
 assert.equal(repair.executionMode,"REPAIR");
 assert.equal(repair.authority.repairJudgmentRef,"judgment.json");
 assert.ok(repair.requiredInputRefs.includes("judgment.json"));
});

test("ACCEPT judgment cannot authorize repair",()=>{
 const parent={
   ...workerReview,generation:3,__ref:"g3.json",judgmentKind:"CANDIDATE",
   implementationResultRef:"result.json",requiredInputRefs:["artifact.json","result.json"],
   reviewTarget:{repository:"r",candidateHeadSha:"candidate-sha",allowedPostTargetEnvelopePaths:[]}
 };
 const accept={
   kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
   subject:{itemId:"BB-X",semanticArtifactRef:"artifact.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"x",judgmentContextRef:"g3.json"},
   assessments:{
     criteria:[{id:"AC-1",status:"SATISFIED",reason:"Satisfied.",evidenceRefs:["e"]}],
     invariants:[{id:"INV-1",status:"SATISFIED",reason:"Preserved.",evidenceRefs:["e"]}]
   },
   findings:[],verdict:"ACCEPT",provenance:{evidenceRefs:["e"]}
 };
 assert.throws(()=>nextRepairContext({
   parent,judgmentRef:"j.json",judgment:accept,
   sourceBaseline:{repository:"r",revision:"candidate-sha"},
   sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]
 }),/requires FINDINGS judgment/);
});

test("implementation worker generation fails without semantic artifact",()=>{
 const parent={...review,pipeline:"IMPLEMENTATION_WORKER",lane:"JUDGMENT",judgmentKind:"READINESS",requiredInputRefs:[]};
 assert.throws(()=>nextImplementationContext({
   parent,decisionRef:"d",decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},
   sourceBaseline:{repository:"r",revision:"x"},
   sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},verification:[]
 }),/semanticArtifactRef|semantic artifact|WORK_CONTEXT_INVALID/);
});
