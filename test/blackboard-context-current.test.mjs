import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext } from "../scripts/blackboard-context-verify.mjs";

test("repository current BB-046 context follows Board binding without hard-coded lifecycle state",()=>{
  const out=verifyCurrentContext();
  assert.equal(out.binding.generation,out.pack.generation);
  assert.equal(out.pack.itemId,"BB-046");
  assert.ok(["REVIEW","IMPLEMENT"].includes(out.pack.action));
  assert.ok(out.pack.resolved.length>0);
  assert.ok(out.pack.auditRefs.length>0);
  assert.ok(!out.pack.resolved.some(x=>out.pack.auditRefs.includes(x.ref)));
});
