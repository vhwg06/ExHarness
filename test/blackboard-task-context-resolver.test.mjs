import test from "node:test";
import assert from "node:assert/strict";
import { deriveTaskContext, deriveTaskContextSummary } from "../scripts/blackboard-task-context-resolver.mjs";
import { readWorkGraph } from "../scripts/blackboard-work-graph.mjs";

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
  const ctx=deriveTaskContext("BB-054");
  const dep=ctx.dependencyContext.find(d=>d.taskId==="BB-053");
  assert.equal(ctx.lane,"RESEARCH_SA");
  assert.equal(dep.source,"PLANNED_DEPENDENCY");
  assert.ok(dep.refs.includes("docs/blackboard/artifacts/objective/BB-053.json"));
  assert.ok(dep.refs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-053.json"));
  assert.ok(ctx.requiredInputRefs.includes("docs/blackboard/artifacts/ready-implement-plan/BB-053.json"));
  assert.ok(!ctx.requiredCurrentSystemRefs.some(ref=>ref===dep.refs[0]||ref===dep.refs[1]));
});
