import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deriveTaskContext, deriveTaskContextSummary } from "../scripts/blackboard-task-context-resolver.mjs";
import { readWorkGraph, readComponentRegistry, taskReadiness } from "../scripts/blackboard-work-graph.mjs";

function runnableWorkerWithDeliveredDependency(){
  const graph=readWorkGraph();
  const task=graph.tasks.find(item=>
    item.lane==="WORKER" && item.status!=="DONE" && item.components.length>1 &&
    item.dependencies.some(dep=>graph.tasks.find(source=>source.id===dep.taskId)?.status==="DONE") &&
    taskReadiness(graph,item.id).ready
  );
  assert.ok(task,"expected a runnable worker with delivered dependency");
  return {graph,task};
}

test("task context is deterministically derived from one task and its components",()=>{
  const {graph,task}=runnableWorkerWithDeliveredDependency();
  const ctx=deriveTaskContext(task.id);
  assert.equal(ctx.itemId,task.id);
  assert.equal(ctx.taskId,task.id);
  assert.equal(ctx.featureId,task.featureId);
  assert.equal(ctx.topicId,graph.features.find(feature=>feature.id===task.featureId)?.topicId);
  assert.deepEqual(ctx.components,task.components);
  assert.equal(ctx.lane,task.lane);
  assert.equal(ctx.phase,task.phase);
  assert.equal(
    ctx.semanticArtifactRef,
    task.lane==="RESEARCH_SA" ? task.contract.objectiveRef : task.contract.planRef
  );
  assert.equal(ctx.planRef,task.contract.planRef);
});

test("DONE dependency contributes consolidated Living truth, not historical delivery transcript",()=>{
  const {graph,task}=runnableWorkerWithDeliveredDependency();
  const ctx=deriveTaskContext(task.id);
  const dep=ctx.dependencyContext.find(d=>graph.tasks.find(source=>source.id===d.taskId)?.status==="DONE");
  assert.ok(dep);
  assert.equal(dep.source,"LIVING_CONSOLIDATED");
  assert.ok(dep.refs.length>0);
  for(const ref of dep.refs)assert.ok(ctx.requiredCurrentSystemRefs.includes(ref));
  const delivered=graph.tasks.find(source=>source.id===dep.taskId);
  for(const ref of delivered.artifacts.outputRefs)assert.ok(!ctx.requiredInputRefs.includes(ref));
});

test("repository-wide discovery is progressive only and absent from deterministic required refs",()=>{
  const {task}=runnableWorkerWithDeliveredDependency();
  const summary=deriveTaskContextSummary(task.id);
  assert.ok(summary.progressiveSearchRoots.length>0);
  for(const root of summary.progressiveSearchRoots){
    assert.ok(!summary.requiredCurrentSystemRefs.includes(root));
    assert.ok(!summary.requiredInputRefs.includes(root));
  }
});

test("blocked worker cannot materialize execution context before direct dependencies are done",()=>{
  const graph=readWorkGraph();
  const task=graph.tasks.find(item=>item.lane==="WORKER" && item.status!=="DONE" &&
    item.dependencies.some(dep=>graph.tasks.find(source=>source.id===dep.taskId)?.status!=="DONE"));
  assert.ok(task,"expected a worker blocked by direct dependency");
  assert.throws(()=>deriveTaskContext(task.id),/DEPENDENCIES_NOT_DONE/);
});

test("research may materialize ahead of an unfinished execution dependency without treating it as delivered truth",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-research-context-"));
  const graph=structuredClone(readWorkGraph());
  const registry=readComponentRegistry();
  const task=graph.tasks.find(item=>item.id==="BB-054");
  task.status="PLANNED";
  task.lane="RESEARCH_SA";
  task.phase="RESEARCH";
  delete task.contract.evaluationRef;
  delete task.contract.evidenceRef;
  delete task.contract.lastEvaluatedInput;

  const objectiveRef=task.contract.objectiveRef;
  const planRef=task.contract.planRef;
  const plan=JSON.parse(readFileSync(planRef,"utf8"));
  plan.status="DRAFT";
  delete plan.readinessRef;

  for(const [ref,body] of [
    ["docs/blackboard/work-graph.json",JSON.stringify(graph,null,2)+"\n"],
    [objectiveRef,readFileSync(objectiveRef,"utf8")],
    [planRef,JSON.stringify(plan,null,2)+"\n"]
  ]){
    const target=join(root,ref);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,body);
  }

  const ctx=deriveTaskContext("BB-054",{root,graph,registry});
  const dep=ctx.dependencyContext.find(d=>d.taskId==="BB-053");
  assert.equal(ctx.lane,"RESEARCH_SA");
  assert.equal(dep.source,"PLANNED_DEPENDENCY");
  assert.ok(dep.refs.includes("docs/blackboard/artifacts/objective/BB-053.json"));
  assert.ok(dep.refs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-053.json"));
  assert.ok(ctx.requiredInputRefs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-053.json"));
  assert.ok(!ctx.requiredCurrentSystemRefs.some(ref=>dep.refs.includes(ref)));
});
