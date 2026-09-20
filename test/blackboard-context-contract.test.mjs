import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext, requiredRefs } from "../scripts/blackboard-context-contract.mjs";
import { parseCurrentContext, parseItemRef, assertBoardBinding } from "../scripts/blackboard-context-board.mjs";

const base={kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:2,action:{kind:"REVIEW"},reviewTarget:{repository:"r",candidateHeadSha:"abc",allowedPostTargetEnvelopePaths:[]},sourceScope:{read:[],write:[],forbiddenWrite:["packages/**"]},requiredCurrentSystemRefs:["a"],requiredInputRefs:["b"],auditRefs:["history"]};

test("review context is read-only and audit refs stay lazy",()=>{
  assertWorkContext(base);
  assert.deepEqual(requiredRefs(base),["a","b"]);
});
test("review cannot authorize writes",()=>{
  assert.throws(()=>assertWorkContext({...base,sourceScope:{...base.sourceScope,write:["x"]}}),/REVIEW may not write/);
});
test("write forbidden overlap fails closed",()=>{
  assert.throws(()=>assertWorkContext({...base,action:{kind:"IMPLEMENT"},parentContextRef:"g1",authority:{implementationDecisionRef:"d"},sourceScope:{read:[],write:["x"],forbiddenWrite:["x"]}}),/overlap/);
});
test("board binding is exact",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  generation: 2\n  ref: x.json\nremaining-work:\n";
  const b=parseCurrentContext(board,"BB-X");
  assert.deepEqual(b,{generation:2,ref:"x.json"});
  assert.equal(assertBoardBinding(b,base,"x.json"),true);
  assert.throws(()=>assertBoardBinding({...b,generation:1},base,"x.json"),/mismatch/);
});

test("duplicate item binding fails closed",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  generation: 2\n  ref: x.json\n\nBB-X\nstatus: READY\ncurrent-context:\n  generation: 2\n  ref: x.json\n";
  assert.throws(()=>parseCurrentContext(board,"BB-X"),/ambiguous|expected one/);
});

test("glob-covered forbidden writes fail closed",()=>{
  const impl={...base,action:{kind:"IMPLEMENT"},parentContextRef:"g1",authority:{implementationDecisionRef:"d",subjectContextRef:"g1",subjectCandidateHeadSha:"abc"},sourceScope:{read:[],write:["packages/x.js"],forbiddenWrite:["packages/**"]}};
  assert.throws(()=>assertWorkContext(impl),/overlap/);
});
test("implementation decision subject must bind parent",()=>{
  const impl={...base,action:{kind:"IMPLEMENT"},parentContextRef:"g1",authority:{implementationDecisionRef:"d",subjectContextRef:"other",subjectCandidateHeadSha:"abc"},sourceScope:{read:[],write:[],forbiddenWrite:[]}};
  assert.throws(()=>assertWorkContext(impl),/parent context/);
});

test("current-context parser ignores refs from later sibling fields",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  generation: 2\n  ref: x.json\nimplementation-input:\n  ref: input.md\nremaining-work:\n";
  assert.deepEqual(parseCurrentContext(board,"BB-X"),{generation:2,ref:"x.json"});
});

test("implementation worker context requires exact semantic JSON input",()=>{
  const impl={...base,pipeline:"IMPLEMENTATION_WORKER",action:{kind:"REVIEW"},reviewTarget:base.reviewTarget};
  assert.throws(()=>assertWorkContext(impl),/semanticArtifactRef/);
  assert.doesNotThrow(()=>assertWorkContext({...impl,semanticArtifactRef:"artifact.json",requiredInputRefs:["b","artifact.json"]}));
});
test("board implementation input ref parses independently from current context",()=>{
  const board="BB-X\ncurrent-context:\n  generation: 2\n  ref: x.json\nimplementation-input:\n  ref: artifact.json\n";
  assert.equal(parseItemRef(board,"BB-X","implementation-input"),"artifact.json");
});
