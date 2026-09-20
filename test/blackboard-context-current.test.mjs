import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext, verifyCurrentContexts, assertCandidateJudgmentBinding } from "../scripts/blackboard-context-verify.mjs";

test("repository current contexts follow exact Board refs",()=>{
  const out=verifyCurrentContexts();
  for(const item of out){
    assert.equal(item.binding.ref.endsWith("/current.json"),true);
    assert.ok(["REVIEW","IMPLEMENT","RESEARCH","SYNTHESIZE"].includes(item.pack.action));
    assert.ok(item.pack.resolved.length>0);
  }
});

test("singular verifier requires explicit selection when multiple active items exist",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard/context/A"),{recursive:true});
  mkdirSync(join(root,"docs/blackboard/context/B"),{recursive:true});
  const base=id=>({kind:"WORK_CONTEXT_SPEC",version:1,itemId:id,pipeline:"RESEARCH_SA",stage:"RESEARCH",action:{kind:"RESEARCH"},sourceScope:{read:[],write:[],forbiddenWrite:["packages/**"]},requiredCurrentSystemRefs:[],requiredInputRefs:[]});
  writeFileSync(join(root,"docs/blackboard/context/A/current.json"),JSON.stringify(base("BB-901")));
  writeFileSync(join(root,"docs/blackboard/context/B/current.json"),JSON.stringify(base("BB-902")));
  writeFileSync(join(root,"docs/blackboard/state.md"),"# Outer Blackboard\n\n## Active work\n\nBB-901\npipeline: RESEARCH_SA\nstage: RESEARCH\nstatus: READY\ncurrent-context:\n  ref: docs/blackboard/context/A/current.json\n\nBB-902\npipeline: RESEARCH_SA\nstage: RESEARCH\nstatus: READY\ncurrent-context:\n  ref: docs/blackboard/context/B/current.json\n\n## Allocation rules\n");
  assert.throws(()=>verifyCurrentContext({root}),/multiple active items/);
  assert.equal(verifyCurrentContexts({root}).length,2);
});

test("active Board item without current-context fails closed",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard"),{recursive:true});
  writeFileSync(join(root,"docs/blackboard/state.md"),"# Outer Blackboard\n\n## Active work\n\nBB-999\nstatus: READY\n\n## Allocation rules\n");
  assert.throws(()=>verifyCurrentContexts({root}),/active item\(s\) missing current-context: BB-999/);
});

test("candidate judgment binds exact semantic/result/candidate subject without helper-context identity",()=>{
  const spec={
    sourceBaseline:{revision:"base-sha"},
    semanticArtifactRef:"input.json",
    reviewTarget:{candidateHeadSha:"candidate-sha"}
  };
  const result={
    artifactType:"IMPLEMENTATION_RESULT",
    subject:{itemId:"BB-X",semanticArtifactRef:"input.json",sourceBaseline:"base-sha",candidateRef:"candidate-sha",executionAuthorityRef:"readiness.json"}
  };
  assert.equal(assertCandidateJudgmentBinding({spec,result,itemId:"BB-X"}),true);
  assert.throws(()=>assertCandidateJudgmentBinding({spec,result:{...result,subject:{...result.subject,candidateRef:"other"}},itemId:"BB-X"}),/subject mismatch/);
});
