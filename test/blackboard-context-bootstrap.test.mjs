import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapImplementationSession } from "../scripts/blackboard-implementation-bootstrap.mjs";
import { readWorkGraph } from "../scripts/blackboard-work-graph.mjs";

test("fresh implementation bootstrap obeys canonical graph or fails closed with no active implementation task",()=>{
  const graph=readWorkGraph();
  const active=graph.tasks.filter(t=>t.status==="ACTIVE"&&["IMPLEMENTATION","BUGFIX"].includes(t.kind));

  if(!active.length){
    assert.throws(()=>bootstrapImplementationSession(),/no active implementation task/);
    return;
  }

  const session=bootstrapImplementationSession({itemId:active[0].id});
  assert.equal(session.taskId,active[0].id);
  assert.equal(session.workId,active[0].id);
  assert.equal(session.pipeline,"IMPLEMENTATION_WORKER");
  assert.equal(session.context.taskId,active[0].id);
  assert.deepEqual(session.context.components,active[0].components);

  if(session.lane==="WORKER"){
    assert.equal(session.phase,"EXECUTION");
    assert.equal(session.intent,"IMPLEMENT_EXACT_READY_PLAN");
    assert.equal(session.context.claimPolicy,null);
  }else if(session.lane==="EXECUTION"){
    assert.equal(session.intent,session.mode==="REPAIR"
      ?"REPAIR_GROUNDED_FINDINGS_AND_PUBLISH_IMPLEMENTATION_RESULT"
      :"EXECUTE_AND_PUBLISH_IMPLEMENTATION_RESULT");
    assert.equal(session.context.claimPolicy,"OBSERVATIONS_ONLY_NO_CORRECTNESS_CLAIM");
  }else{
    assert.equal(session.intent,session.mode==="CANDIDATE"
      ?"INDEPENDENTLY_JUDGE_EXACT_CANDIDATE"
      :"INDEPENDENTLY_JUDGE_IMPLEMENTATION_READINESS");
    assert.equal(session.context.claimPolicy,"INDEPENDENT_JUDGMENT_NO_SOURCE_MUTATION");
  }
});
