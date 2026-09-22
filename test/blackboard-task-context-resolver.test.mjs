import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deriveTaskContext, deriveTaskContextSummary } from "../scripts/blackboard-task-context-resolver.mjs";
import { readWorkGraph, readComponentRegistry } from "../scripts/blackboard-work-graph.mjs";

test("task context is deterministically derived from one task and its components",()=>{
  const ctx=deriveTaskContext("BB-052");
  assert.equal(ctx.itemId,"BB-052");
  assert.equal(ctx.taskId,"BB-052");
  assert.equal(ctx.topicId,"TOPIC-INTEGRATION");
  assert.equal(ctx.featureId,"FEATURE-INTEGRATION-C");
  assert.deepEqual(ctx.components,[
    "agentic/organization-work",
    "agentic/domain-execution-control",
    "agentic/product-lineage"
  ]);
  const task=readWorkGraph().tasks.find(item=>item.id==="BB-052");
  assert.equal(ctx.lane,task.lane);
  assert.equal(ctx.phase,task.phase);
  assert.equal(
    ctx.semanticArtifactRef,
    task.lane==="RESEARCH_SA" ? task.contract.objectiveRef : task.contract.planRef
  );
  assert.equal(ctx.planRef,task.contract.planRef);
});

test("DONE dependency contributes consolidated Living truth, not historical delivery transcript",()=>{
  const ctx=deriveTaskContext("BB-052");
  const dep=ctx.dependencyContext.find(d=>d.taskId==="BB-048");
  assert.equal(dep.source,"LIVING_CONSOLIDATED");
  assert.ok(dep.refs.includes("docs/living/system/agentic-application/capabilities.md"));
  assert.ok(ctx.requiredCurrentSystemRefs.includes("docs/living/system/agentic-application/contracts.md"));
  assert.ok(!ctx.requiredInputRefs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-048.implementation-result.json"));
  assert.ok(!ctx.requiredInputRefs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-048.judgment.json"));
});

test("repository-wide discovery is progressive only and absent from deterministic required refs",()=>{
  const summary=deriveTaskContextSummary("BB-052");
  assert.ok(summary.progressiveSearchRoots.includes("packages/agentic-system/src/**"));
  assert.ok(!summary.requiredCurrentSystemRefs.includes("packages/agentic-system/src/**"));
  assert.ok(!summary.requiredInputRefs.includes("packages/agentic-system/src/**"));
});

test("blocked worker cannot materialize execution context before direct dependencies are done",()=>{
  assert.throws(()=>deriveTaskContext("BB-053"),/DEPENDENCIES_NOT_DONE/);
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
