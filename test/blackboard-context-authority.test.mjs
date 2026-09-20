import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext } from "../scripts/blackboard-context-contract.mjs";
import { nextImplementationContext } from "../scripts/blackboard-context-generate.mjs";
const review={kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:1,__ref:"g1.json",action:{kind:"REVIEW"},reviewTarget:{repository:"r",candidateHeadSha:"abc",allowedPostTargetEnvelopePaths:[]},sourceScope:{read:[],write:[],forbiddenWrite:[]},requiredCurrentSystemRefs:[],requiredInputRefs:[],auditRefs:[]};

test("generator cannot turn review into implementation without decision",()=>assert.throws(()=>nextImplementationContext({parent:review,sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),/decision required/));
test("generator requires exact accepted decision subject",()=>assert.throws(()=>nextImplementationContext({parent:review,decisionRef:"d",sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),/exact decision subject/));
test("generator output passes its own implementation contract",()=>{
 const out=nextImplementationContext({parent:review,decisionRef:"d",decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},sourceBaseline:{repository:"r",revision:"x"},sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},verification:[]});
 assert.equal(assertWorkContext(out),out);
 assert.deepEqual(out.authority,{implementationDecisionRef:"d",subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"});
});
test("implementation context requires parent and decision",()=>assert.throws(()=>assertWorkContext({...review,action:{kind:"IMPLEMENT"},authority:{implementationDecisionRef:"d"}}),/exact decision subject|parent context/));

test("implementation worker generation preserves semantic artifact binding",()=>{
 const parent={...review,pipeline:"IMPLEMENTATION_WORKER",semanticArtifactRef:"artifact.json",requiredInputRefs:["artifact.json"]};
 const out=nextImplementationContext({parent,decisionRef:"d",decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},sourceBaseline:{repository:"r",revision:"x"},sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},verification:[]});
 assert.equal(out.semanticArtifactRef,"artifact.json");
});
test("implementation worker generation fails without semantic artifact",()=>{
 const parent={...review,pipeline:"IMPLEMENTATION_WORKER",requiredInputRefs:[]};
 assert.throws(()=>nextImplementationContext({parent,decisionRef:"d",decisionSubject:{subjectContextRef:"g1.json",subjectCandidateHeadSha:"abc"},sourceBaseline:{repository:"r",revision:"x"},sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},verification:[]}),/semantic artifact|WORK_CONTEXT_INVALID/);
});
