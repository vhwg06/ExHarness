import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCurrentContext } from "../scripts/blackboard-context-verify.mjs";

test("repository current migrated context follows Board binding without hard-coded item/lifecycle state",()=>{
  const out=verifyCurrentContext();
  if(out.pack.itemId){
    assert.equal(out.binding.generation,out.pack.generation);
    assert.ok(["REVIEW","IMPLEMENT"].includes(out.pack.action));
    assert.ok(out.pack.resolved.length>0);
    assert.ok(out.pack.auditRefs.length>0);
    assert.ok(!out.pack.resolved.some(x=>out.pack.auditRefs.includes(x.ref)));
  }
});


test("active Board item without current-context fails closed",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-context-"));
  mkdirSync(join(root,"docs/living"),{recursive:true});
  writeFileSync(join(root,"docs/living/blackboard.md"),"# Blackboard\n\n## Active work\n\n\`\`\`text\nBB-999\nstatus: READY\n\`\`\`\n\n## Integration entry rule\n");
  assert.throws(()=>verifyCurrentContext({root}),/BOARD_BINDING_INVALID: active item\(s\) missing current-context: BB-999/);
});
