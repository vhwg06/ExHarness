import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext, requiredRefs } from "../scripts/blackboard-context-contract.mjs";
import { parseCurrentContext, parseItemRef, parseItemScalar, assertBoardBinding } from "../scripts/blackboard-context-board.mjs";

const base={
  kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",
  action:{kind:"REVIEW"},
  sourceScope:{read:[],write:[],forbiddenWrite:["packages/**"]},
  requiredCurrentSystemRefs:["a"],requiredInputRefs:["b"]
};

test("review context is read-only and loads only explicit refs",()=>{
  assertWorkContext(base);
  assert.deepEqual(requiredRefs(base),["a","b"]);
});
test("review cannot authorize writes",()=>{
  assert.throws(()=>assertWorkContext({...base,sourceScope:{...base.sourceScope,write:["x"]}}),/REVIEW may not write/);
});
test("write forbidden overlap fails closed",()=>{
  assert.throws(()=>assertWorkContext({...base,action:{kind:"IMPLEMENT"},authority:{ref:"d.json"},sourceScope:{read:[],write:["x"],forbiddenWrite:["x"]}}),/overlap/);
});
test("board binding is exact ref only",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  ref: docs/blackboard/context/BB-X/current.json\nremaining-work:\n";
  const b=parseCurrentContext(board,"BB-X");
  assert.deepEqual(b,{ref:"docs/blackboard/context/BB-X/current.json"});
  assert.equal(assertBoardBinding(b,base,"docs/blackboard/context/BB-X/current.json"),true);
  assert.throws(()=>assertBoardBinding({ref:"other.json"},base,"docs/blackboard/context/BB-X/current.json"),/mismatch/);
});
test("generation in current-context is rejected",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  generation: 2\n  ref: x.json\n";
  assert.throws(()=>parseCurrentContext(board,"BB-X"),/generation is not allowed/);
});
test("duplicate item binding fails closed",()=>{
  const board="BB-X\nstatus: READY\ncurrent-context:\n  ref: x.json\n\nBB-X\nstatus: READY\ncurrent-context:\n  ref: x.json\n";
  assert.throws(()=>parseCurrentContext(board,"BB-X"),/expected one/);
});
test("helper context rejects history/stale fields",()=>{
  assert.throws(()=>assertWorkContext({...base,generation:2}),/generation is not allowed/);
  assert.throws(()=>assertWorkContext({...base,parentContextRef:"old.json"}),/parentContextRef is not allowed/);
  assert.throws(()=>assertWorkContext({...base,staleWhen:["repo changed"]}),/staleWhen is not allowed/);
  assert.throws(()=>assertWorkContext({...base,auditRefs:["history"]}),/auditRefs are not allowed/);
});
test("implementation worker context requires exact semantic JSON input",()=>{
  const impl={...base,pipeline:"IMPLEMENTATION_WORKER",action:{kind:"REVIEW"},lane:"JUDGMENT",judgmentKind:"READINESS"};
  assert.throws(()=>assertWorkContext(impl),/semanticArtifactRef/);
  assert.doesNotThrow(()=>assertWorkContext({...impl,semanticArtifactRef:"artifact.json",requiredInputRefs:["b","artifact.json"]}));
});
test("board implementation input ref parses independently from current context",()=>{
  const board="BB-X\ncurrent-context:\n  ref: x.json\nimplementation-input:\n  ref: artifact.json\n";
  assert.equal(parseItemRef(board,"BB-X","implementation-input"),"artifact.json");
});
test("implementation worker lane and action must agree",()=>{
  const common={...base,pipeline:"IMPLEMENTATION_WORKER",semanticArtifactRef:"artifact.json",requiredInputRefs:["b","artifact.json"]};
  assert.throws(()=>assertWorkContext({...common,lane:"EXECUTION",executionMode:"INITIAL",action:{kind:"REVIEW"},authority:{ref:"decision.json"}}),/EXECUTION lane requires IMPLEMENT/);
  assert.throws(()=>assertWorkContext({...common,lane:"JUDGMENT",judgmentKind:"READINESS",action:{kind:"IMPLEMENT"}}),/JUDGMENT lane requires REVIEW/);
});
test("execution context requires exact authority ref",()=>{
  const ctx={...base,pipeline:"IMPLEMENTATION_WORKER",semanticArtifactRef:"artifact.json",requiredInputRefs:["b","artifact.json"],lane:"EXECUTION",executionMode:"INITIAL",action:{kind:"IMPLEMENT"}};
  assert.throws(()=>assertWorkContext(ctx),/authority.ref/);
  assert.doesNotThrow(()=>assertWorkContext({...ctx,authority:{ref:"decision.json"}}));
});
test("candidate judgment requires exact implementation result and candidate",()=>{
  const ctx={...base,pipeline:"IMPLEMENTATION_WORKER",lane:"JUDGMENT",judgmentKind:"CANDIDATE",semanticArtifactRef:"artifact.json",requiredInputRefs:["b","artifact.json"],action:{kind:"REVIEW"}};
  assert.throws(()=>assertWorkContext(ctx),/implementationResultRef|review target/);
  assert.doesNotThrow(()=>assertWorkContext({...ctx,implementationResultRef:"result.json",requiredInputRefs:["b","artifact.json","result.json"],reviewTarget:{repository:"r",candidateHeadSha:"candidate"}}));
});
test("board lane parses as an exact scalar",()=>{
  const board="BB-X\npipeline: IMPLEMENTATION_WORKER\nlane: EXECUTION\ncurrent-context:\n  ref: x.json\n";
  assert.equal(parseItemScalar(board,"BB-X","lane"),"EXECUTION");
});

test("implementation worker may bind canonical implementation spec as explicit input",()=>{
  const ctx={...base,pipeline:"IMPLEMENTATION_WORKER",lane:"EXECUTION",executionMode:"INITIAL",action:{kind:"IMPLEMENT"},authority:{ref:"decision.json"},semanticArtifactRef:"input.json",implementationSpecRef:"spec.json",requiredInputRefs:["b","input.json","spec.json"]};
  assert.doesNotThrow(()=>assertWorkContext(ctx));
  assert.throws(()=>assertWorkContext({...ctx,requiredInputRefs:["b","input.json"]}),/implementationSpecRef must be a required input/);
});
