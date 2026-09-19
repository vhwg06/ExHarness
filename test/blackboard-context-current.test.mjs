import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext, verifyCurrentContexts } from "../scripts/blackboard-context-verify.mjs";

test("repository current migrated contexts follow exact Board bindings",()=>{
  const out=verifyCurrentContexts();
  for(const item of out){
    assert.equal(item.binding.generation,item.pack.generation);
    assert.ok(["REVIEW","IMPLEMENT","RESEARCH","SYNTHESIZE"].includes(item.pack.action));
    assert.ok(item.pack.resolved.length>0);
    assert.ok(!item.pack.resolved.some(x=>item.pack.auditRefs.includes(x.ref)));
  }
});

test("singular verifier requires explicit selection when multiple active items exist",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard/context/A"),{recursive:true});
  mkdirSync(join(root,"docs/blackboard/context/B"),{recursive:true});
  const base=id=>({kind:"WORK_CONTEXT_SPEC",version:1,itemId:id,generation:1,pipeline:"RESEARCH_SA",stage:"RESEARCH",action:{kind:"RESEARCH"},sourceScope:{read:[],write:[],forbiddenWrite:["packages/**"]},requiredCurrentSystemRefs:[],requiredInputRefs:[],auditRefs:[]});
  writeFileSync(join(root,"docs/blackboard/context/A/g1.json"),JSON.stringify(base("BB-901")));
  writeFileSync(join(root,"docs/blackboard/context/B/g1.json"),JSON.stringify(base("BB-902")));
  writeFileSync(join(root,"docs/blackboard/state.md"),"# Outer Blackboard\n\n## Active work\n\nBB-901\npipeline: RESEARCH_SA\nstage: RESEARCH\nstatus: READY\ncurrent-context:\n  generation: 1\n  ref: docs/blackboard/context/A/g1.json\n\nBB-902\npipeline: RESEARCH_SA\nstage: RESEARCH\nstatus: READY\ncurrent-context:\n  generation: 1\n  ref: docs/blackboard/context/B/g1.json\n\n## Allocation rules\n");
  assert.throws(()=>verifyCurrentContext({root}),/multiple active items/);
  assert.equal(verifyCurrentContexts({root}).length,2);
});

test("active Board item without current-context fails closed",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard"),{recursive:true});
  writeFileSync(join(root,"docs/blackboard/state.md"),"# Outer Blackboard\n\n## Active work\n\nBB-999\nstatus: READY\n\n## Allocation rules\n");
  assert.throws(()=>verifyCurrentContexts({root}),/BOARD_BINDING_INVALID: active item\(s\) missing current-context: BB-999/);
});
