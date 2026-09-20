import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapImplementationSession } from "../scripts/blackboard-implementation-bootstrap.mjs";
import { parseCurrentContext, parseItemScalar } from "../scripts/blackboard-context-board.mjs";

test("fresh implementation bootstrap obeys current Board lane",()=>{
  const board=fs.readFileSync("docs/blackboard/state.md","utf8");
  const binding=parseCurrentContext(board,"BB-048");
  const spec=JSON.parse(fs.readFileSync(binding.ref,"utf8"));
  const session=bootstrapImplementationSession();

  assert.equal(session.workId,"BB-048");
  assert.equal(session.pipeline,"IMPLEMENTATION_WORKER");
  assert.equal(session.lane,parseItemScalar(board,"BB-048","lane"));
  assert.equal(session.lane,spec.lane);
  assert.equal(session.mode,spec.executionMode??spec.judgmentKind);
  assert.equal(session.context.semanticArtifactRef,"docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json");

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
