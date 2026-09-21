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
  assert.equal(ctx.semanticArtifactRef,"docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage.json");
  assert.equal(ctx.implementationSpecRef,"docs/blackboard/artifacts/implementation-spec/integration-c-cross-domain-obligation-lineage.json");
});

test("DONE dependency contributes consolidated Living truth, not historical delivery transcript",()=>{
  const ctx=deriveTaskContext("BB-052");
  const dep=ctx.dependencyContext.find(d=>d.taskId==="BB-048");
  assert.equal(dep.source,"LIVING_CONSOLIDATED");
  assert.ok(dep.refs.includes("docs/living/system/agentic-application/capabilities.md"));
  assert.ok(ctx.requiredCurrentSystemRefs.includes("docs/living/system/agentic-application/contracts.md"));
  assert.ok(!ctx.requiredInputRefs.includes("docs/blackboard/artifacts/implementation-result/BB-048.json"));
  assert.ok(!ctx.requiredInputRefs.includes("docs/blackboard/artifacts/judgment/BB-048.json"));
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
