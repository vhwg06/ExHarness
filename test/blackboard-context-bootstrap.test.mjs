import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapImplementationSession } from "../scripts/blackboard-implementation-bootstrap.mjs";

test("fresh implementation bootstrap obeys current Board lane",()=>{
  const session=bootstrapImplementationSession();
  assert.equal(session.workId,"BB-048");
  assert.equal(session.pipeline,"IMPLEMENTATION_WORKER");
  assert.ok(["EXECUTION","JUDGMENT"].includes(session.lane));
  assert.equal(session.lane,"JUDGMENT");
  assert.equal(session.mode,"READINESS");
  assert.equal(session.intent,"INDEPENDENTLY_JUDGE_IMPLEMENTATION_READINESS");
  assert.equal(session.context.semanticArtifactRef,"docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json");
  assert.equal(session.context.claimPolicy,"INDEPENDENT_JUDGMENT_NO_SOURCE_MUTATION");
});
