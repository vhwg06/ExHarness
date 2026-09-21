import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext, verifyCurrentContexts, assertCandidateJudgmentBinding } from "../scripts/blackboard-context-verify.mjs";
import { readWorkGraph } from "../scripts/blackboard-work-graph.mjs";

test("repository active contexts are selected from canonical work graph",()=>{
  const graph=readWorkGraph();
  const active=graph.tasks.filter(t=>t.status==="ACTIVE");
  const out=verifyCurrentContexts();
  assert.equal(out.length,active.length);
  for(const item of out){
    assert.equal(item.binding.ref.endsWith("/current.json"),true);
    assert.ok(["REVIEW","IMPLEMENT","RESEARCH","SYNTHESIZE"].includes(item.pack.action));
    assert.ok(item.pack.resolved.length>0);
  }
});

test("singular verifier requires explicit selection when multiple graph tasks are active",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard"),{recursive:true});
  const registry={kind:"OUTER_BLACKBOARD_COMPONENT_REGISTRY",version:1,components:[{
    id:"c",contextOwner:"c-owner",
    contextProfile:{currentSystemRefs:[],sourceRoots:[],testRoots:[],contractRefs:[],progressiveSearchRoots:[]}
  }]};
  const task=id=>({
    id,featureId:null,title:id,kind:"IMPLEMENTATION",status:"ACTIVE",complexity:"S",components:["c"],dependencies:[],
    artifacts:{inputRefs:["input.json"],outputRefs:[],consolidatedRefs:[]},expectedOutputs:[],
    currentContextRef:`docs/blackboard/context/${id}/current.json`,claim:{workerId:`worker-${id}`}
  });
  const graph={
    kind:"OUTER_BLACKBOARD_WORK_GRAPH",version:1,phase:"X",
    topics:[{id:"T",title:"T",status:"ACTIVE",featureIds:[],artifactRefs:[]}],
    features:[],tasks:[task("BB-901"),task("BB-902")],
    allocation:{nextWorkId:"BB-903",executionUnit:"TASK",contextRoutingUnit:"COMPONENT",workerOwnership:"ONE_TASK_PER_CLAIM"}
  };
  writeFileSync(join(root,"docs/blackboard/work-graph.json"),JSON.stringify(graph));
  writeFileSync(join(root,"docs/blackboard/component-registry.json"),JSON.stringify(registry));
  assert.throws(()=>verifyCurrentContext({root}),/multiple active tasks/);
});

test("ACTIVE task without graph-bound current context fails closed at graph validation",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/blackboard"),{recursive:true});
  const registry={kind:"OUTER_BLACKBOARD_COMPONENT_REGISTRY",version:1,components:[{
    id:"c",contextOwner:"c-owner",
    contextProfile:{currentSystemRefs:[],sourceRoots:[],testRoots:[],contractRefs:[],progressiveSearchRoots:[]}
  }]};
  const graph={
    kind:"OUTER_BLACKBOARD_WORK_GRAPH",version:1,phase:"X",
    topics:[{id:"T",title:"T",status:"ACTIVE",featureIds:[],artifactRefs:[]}],features:[],
    tasks:[{id:"BB-999",featureId:null,title:"x",kind:"IMPLEMENTATION",status:"ACTIVE",complexity:"S",components:["c"],dependencies:[],artifacts:{inputRefs:[],outputRefs:[],consolidatedRefs:[]},expectedOutputs:[],currentContextRef:null,claim:{workerId:"w"}}],
    allocation:{nextWorkId:"BB-1000",executionUnit:"TASK",contextRoutingUnit:"COMPONENT",workerOwnership:"ONE_TASK_PER_CLAIM"}
  };
  writeFileSync(join(root,"docs/blackboard/work-graph.json"),JSON.stringify(graph));
  writeFileSync(join(root,"docs/blackboard/component-registry.json"),JSON.stringify(registry));
  assert.throws(()=>verifyCurrentContexts({root}),/ACTIVE task requires currentContextRef/);
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
