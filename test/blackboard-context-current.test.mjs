import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext } from "../scripts/blackboard-context-verify.mjs";

test("repository current BB-046 context resolves without audit loading",()=>{
  const out=verifyCurrentContext();
  assert.equal(out.binding.generation,3);
  assert.equal(out.pack.action,"IMPLEMENT");
  assert.ok(out.pack.resolved.length>0);
  assert.ok(out.pack.auditRefs.length>0);
  assert.ok(!out.pack.resolved.some(x=>out.pack.auditRefs.includes(x.ref)));
});
