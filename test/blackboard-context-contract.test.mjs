import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext, requiredRefs } from "../scripts/blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "../scripts/blackboard-context-board.mjs";

const base={kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:2,action:{kind:"REVIEW"},sourceScope:{read:[],write:[],forbiddenWrite:["packages/**"]},requiredCurrentSystemRefs:["a"],requiredInputRefs:["b"],auditRefs:["history"]};

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
