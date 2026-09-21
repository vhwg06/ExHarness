import test from "node:test";
import assert from "node:assert/strict";
import { deriveTaskContext, deriveTaskContextSummary } from "../scripts/blackboard-task-context-resolver.mjs";

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
  assert.equal(ctx.lane,"RESEARCH_SA");
  assert.equal(ctx.semanticArtifactRef,"docs/blackboard/artifacts/objective/BB-052.json");
  assert.equal(ctx.planRef,"docs/blackboard/artifacts/ready-implement-plan/BB-052.json");
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

test("blocked task cannot materialize execution context before direct dependencies are done",()=>{
  assert.throws(()=>deriveTaskContext("BB-053"),/DEPENDENCIES_NOT_DONE/);
});
