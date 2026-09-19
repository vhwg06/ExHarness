import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext } from "../scripts/blackboard-context-verify.mjs";

test("repository current migrated context follows Board binding without hard-coded item/lifecycle state",()=>{
  const out=verifyCurrentContext();
  assert.equal(out.binding.generation,out.pack.generation);
  assert.equal(out.pack.itemId,out.pack.itemId);
  assert.ok(["REVIEW","IMPLEMENT"].includes(out.pack.action));
  if(out.pack.itemId){
    assert.ok(out.pack.resolved.length>0);
    assert.ok(out.pack.auditRefs.length>0);
    assert.ok(!out.pack.resolved.some(x=>out.pack.auditRefs.includes(x.ref)));
  }
});
