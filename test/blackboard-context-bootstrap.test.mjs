import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapImplementationSession } from "../scripts/blackboard-implementation-bootstrap.mjs";
import { parseCurrentContext, parseItemScalar } from "../scripts/blackboard-context-board.mjs";

test("fresh implementation bootstrap obeys current Board lane or fails closed with no active implementation work",()=>{
  const board=fs.readFileSync("docs/blackboard/state.md","utf8");
  const active=board.match(/IMPLEMENTATION_WORKER\s*\n\s+active:\s+(BB-\d+|NONE)/)?.[1];
  assert.ok(active,"Board must declare IMPLEMENTATION_WORKER active state");

  if(active==="NONE"){
    assert.throws(()=>bootstrapImplementationSession(),/no active IMPLEMENTATION_WORKER item/);
    return;
  }

  const binding=parseCurrentContext(board,active);
  const spec=JSON.parse(fs.readFileSync(binding.ref,"utf8"));
  const session=bootstrapImplementationSession();

  assert.equal(session.workId,active);
  assert.equal(session.pipeline,"IMPLEMENTATION_WORKER");
  assert.equal(session.lane,parseItemScalar(board,active,"lane"));
  assert.equal(session.lane,spec.lane);
  assert.equal(session.mode,spec.executionMode??spec.judgmentKind);
  assert.equal(session.context.semanticArtifactRef,spec.semanticArtifactRef);

  if(session.lane==="EXECUTION"){
    assert.equal(session.intent,spec.executionMode==="REPAIR"
      ?"REPAIR_GROUNDED_FINDINGS_AND_PUBLISH_IMPLEMENTATION_RESULT"
      :"EXECUTE_AND_PUBLISH_IMPLEMENTATION_RESULT");
    assert.equal(session.context.claimPolicy,"OBSERVATIONS_ONLY_NO_CORRECTNESS_CLAIM");
  }else{
    assert.equal(session.intent,spec.judgmentKind==="CANDIDATE"
      ?"INDEPENDENTLY_JUDGE_EXACT_CANDIDATE"
      :"INDEPENDENTLY_JUDGE_IMPLEMENTATION_READINESS");
    assert.equal(session.context.claimPolicy,"INDEPENDENT_JUDGMENT_NO_SOURCE_MUTATION");
  }
});
