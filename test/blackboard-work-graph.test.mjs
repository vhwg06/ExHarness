import test from "node:test";
import assert from "node:assert/strict";
import { readWorkGraph, readComponentRegistry, assertWorkGraph, schedulableTasks, taskReadiness } from "../scripts/blackboard-work-graph.mjs";

test("outer Blackboard is a typed dependency graph with task scheduling and component context routing",()=>{
  const graph=readWorkGraph();
  const registry=readComponentRegistry();
  assert.equal(assertWorkGraph(graph,registry),graph);
  assert.equal(graph.allocation.executionUnit,"TASK");
  assert.equal(graph.allocation.contextRoutingUnit,"COMPONENT");
  assert.equal(graph.allocation.workerOwnership,"ONE_TASK_PER_CLAIM");
  const bb056=graph.tasks.find(task=>task.id==="BB-056");
  const expectedSchedulable=bb056.status==="ACTIVE" || bb056.status==="DONE" || bb056.phase==="MERGE_PENDING"
    ? ["BB-052","BB-054","BB-055"]
    : ["BB-052","BB-054","BB-055","BB-056"];
  assert.deepEqual(schedulableTasks(graph),expectedSchedulable);
  assert.deepEqual(taskReadiness(graph,"BB-053"),{taskId:"BB-053",ready:false,reason:"DEPENDENCIES_NOT_DONE",blockedBy:["BB-052"]});
  assert.deepEqual(taskReadiness(graph,"BB-054"),{taskId:"BB-054",ready:true,reason:"RESEARCH_CAN_RUN_AHEAD",blockedBy:[]});
  assert.deepEqual(taskReadiness(graph,"BB-055"),{taskId:"BB-055",ready:true,reason:"RESEARCH_CAN_RUN_AHEAD",blockedBy:[]});
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
