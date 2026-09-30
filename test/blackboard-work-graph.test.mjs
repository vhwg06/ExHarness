import test from "node:test";
import assert from "node:assert/strict";
import { readWorkGraph, readComponentRegistry, assertWorkGraph, schedulableTasks, taskReadiness, directDependentIds, assertResearchReset, RESEARCH_RESET_CONTRACT_KEYS } from "../scripts/blackboard-work-graph.mjs";

test("outer Blackboard is a typed dependency graph with task scheduling and component context routing",()=>{
  const graph=readWorkGraph();
  const registry=readComponentRegistry();
  assert.equal(assertWorkGraph(graph,registry),graph);
  assert.equal(graph.allocation.executionUnit,"TASK");
  assert.equal(graph.allocation.contextRoutingUnit,"COMPONENT");
  assert.equal(graph.allocation.workerOwnership,"ONE_TASK_PER_CLAIM");
  const ready=schedulableTasks(graph);
  for(const task of graph.tasks){
    assert.equal(ready.includes(task.id),taskReadiness(graph,task.id).ready);
  }
  const directDependency=structuredClone(graph);
  directDependency.tasks.find(task=>task.id==="BB-052").status="DONE";
  directDependency.tasks.find(task=>task.id==="BB-053").status="PLANNED";
  directDependency.tasks.find(task=>task.id==="BB-053").phase="EXECUTION";
  assert.deepEqual(taskReadiness(directDependency,"BB-053"),{taskId:"BB-053",ready:true,reason:"DIRECT_DEPENDENCIES_DONE",blockedBy:[]});
  directDependency.tasks.find(task=>task.id==="BB-052").status="PLANNED";
  assert.deepEqual(taskReadiness(directDependency,"BB-053"),{taskId:"BB-053",ready:false,reason:"DEPENDENCIES_NOT_DONE",blockedBy:["BB-052"]});

  const runAhead=structuredClone(graph);
  runAhead.tasks.find(task=>task.id==="BB-053").status="PLANNED";
  const future=runAhead.tasks.find(task=>task.id==="BB-054");
  future.status="PLANNED";
  future.lane="RESEARCH_SA";
  future.phase="RESEARCH";
  assert.deepEqual(taskReadiness(runAhead,"BB-054"),{taskId:"BB-054",ready:true,reason:"RESEARCH_CAN_RUN_AHEAD",blockedBy:[]});
});

test("accepted worker cannot be claimed again while awaiting merge",()=>{
  const graph=readWorkGraph();
  const task=graph.tasks.find(task=>task.id==="BB-056");
  if(task.phase!=="MERGE_PENDING")return;
  assert.deepEqual(taskReadiness(graph,"BB-056"),{taskId:"BB-056",ready:false,reason:"PHASE_MERGE_PENDING"});
});

test("task may span multiple components without creating multiple execution owners",()=>{
  const graph=readWorkGraph();
  const task=graph.tasks.find(t=>t.id==="BB-052");
  assert.equal(task.components.length,3);
  assert.equal(task.claim,null);
  assert.equal(task.currentContextRef,null);
  assert.equal(graph.allocation.workerOwnership,"ONE_TASK_PER_CLAIM");
});

test("work graph rejects unknown component and dependency cycles",()=>{
  const graph=readWorkGraph();
  const registry=readComponentRegistry();
  const badComponent=structuredClone(graph);
  badComponent.tasks.find(t=>t.id==="BB-052").components.push("missing/component");
  assert.throws(()=>assertWorkGraph(badComponent,registry),/unknown component/);

  const cyclic=structuredClone(graph);
  cyclic.tasks.find(t=>t.id==="BB-048").dependencies=[{taskId:"BB-055",requires:["TASK_OUTPUT"]}];
  assert.throws(()=>assertWorkGraph(cyclic,registry),/dependency cycle/);
});

test("non-active tasks cannot carry worker claim or current context",()=>{
  const graph=readWorkGraph();
  const registry=readComponentRegistry();
  const bad=structuredClone(graph);
  const task=bad.tasks.find(t=>t.id==="BB-052");
  task.claim={workerId:"W7"};
  assert.throws(()=>assertWorkGraph(bad,registry),/non-ACTIVE task cannot have claim/);
});

function supersessionGraph(registry){
  const component=registry.components[0].id;
  const sha="a".repeat(40);
  const contract=id=>({objectiveRef:`docs/blackboard/artifacts/objective/${id}.json`,planRef:`docs/blackboard/artifacts/ready-implement-plan/${id}.json`,researchBaselineSha:sha});
  const task=(id,fields)=>({id,featureId:null,title:id,kind:"IMPLEMENTATION",complexity:"S",status:"PLANNED",components:[component],dependencies:[],
    artifacts:{inputRefs:[],outputRefs:[],consolidatedRefs:[]},expectedOutputs:["OUT"],claim:null,currentContextRef:null,...fields});
  return {kind:"OUTER_BLACKBOARD_WORK_GRAPH",version:1,phase:"FIXTURE",topics:[{id:"T",title:"T",featureIds:[],artifactRefs:[]}],features:[],
    allocation:{executionUnit:"TASK",contextRoutingUnit:"COMPONENT",workerOwnership:"ONE_TASK_PER_CLAIM",nextWorkId:"BB-10"},
    tasks:[
      task("BB-1",{lane:"RESEARCH_SA",phase:"RESEARCH",contract:contract("BB-1")}),
      task("BB-2",{lane:"WORKER",phase:"EXECUTION",dependencies:[{taskId:"BB-1",requires:["TASK_OUTPUT"]}],contract:{...contract("BB-2"),evaluationRef:"e.json",lastEvaluatedInput:"b".repeat(64),baselineSha:sha,evidenceRef:"r.json"}}),
      task("BB-3",{lane:"RESEARCH_SA",phase:"RESEARCH",dependencies:[{taskId:"BB-1",requires:["TASK_OUTPUT"]},{taskId:"BB-2",requires:["TASK_OUTPUT"]}],contract:contract("BB-3")}),
      task("BB-4",{lane:"RESEARCH_SA",phase:"RESEARCH",contract:contract("BB-4")})
    ]};
}

test("supersession direct dependents are exactly the tasks with an edge to the target",()=>{
  const registry=readComponentRegistry();
  const graph=assertWorkGraph(supersessionGraph(registry),registry);
  assert.deepEqual(directDependentIds(graph,"BB-1"),["BB-2","BB-3"]);
  assert.deepEqual(directDependentIds(graph,"BB-2"),["BB-3"]);
  assert.deepEqual(directDependentIds(graph,"BB-4"),[]);
  // Live Board: the helper matches a direct scan and never includes transitive dependents.
  const live=readWorkGraph();
  for(const t of live.tasks)assert.deepEqual(directDependentIds(live,t.id),live.tasks.filter(x=>x.dependencies.some(d=>d.taskId===t.id)).map(x=>x.id).sort());
});

test("supersession reset leaves non-active research with no stale readiness or worker authority",()=>{
  const registry=readComponentRegistry();
  const graph=supersessionGraph(registry);
  const worker=graph.tasks.find(t=>t.id==="BB-2");
  assert.throws(()=>assertResearchReset(worker),/PLANNED RESEARCH_SA\/RESEARCH/);
  Object.assign(worker,{lane:"RESEARCH_SA",phase:"RESEARCH"});
  assert.throws(()=>assertResearchReset(worker),/stale authority: BB-2 evaluationRef,lastEvaluatedInput,baselineSha,evidenceRef/);
  worker.contract=Object.fromEntries(Object.entries(worker.contract).filter(([k])=>RESEARCH_RESET_CONTRACT_KEYS.includes(k)));
  assert.equal(assertResearchReset(worker),worker);
  // Reset topology and identity stay valid, and the reset task is schedulable only as research.
  assert.equal(assertWorkGraph(graph,registry),graph);
  assert.deepEqual(taskReadiness(graph,"BB-2"),{taskId:"BB-2",ready:true,reason:"RESEARCH_CAN_RUN_AHEAD",blockedBy:[]});
  for(const bad of [{claim:{workerId:"W"}},{currentContextRef:"docs/blackboard/context/BB-2/current.json"}])
    assert.throws(()=>assertResearchReset({...worker,...bad}),/claim or active context/);
  assert.throws(()=>assertResearchReset({...worker,status:"ACTIVE"}),/PLANNED RESEARCH_SA/);
  assert.throws(()=>assertResearchReset({...worker,status:"DONE"}),/PLANNED RESEARCH_SA/);
});
