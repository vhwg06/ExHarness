import test from "node:test";
import assert from "node:assert/strict";
import {fixture,claim} from "./cross-domain-obligation.test.js";
import {productRevision} from "../src/product-lineage.js";

test("supersession between consumed-head observation and receipt commit leaves dependent stale",async t=>{
  const f=await fixture(t),upstream=claim("detail"),dependent=claim("architecture","design","SA");
  await f.publish([upstream]);
  let entered,release;
  const barrier=new Promise(r=>{entered=r;}),resume=new Promise(r=>{release=r;});
  f.setReceiptHook(async receipt=>{if(receipt.domain==="SA"){entered();await resume;}});
  const publishing=f.publish([dependent],{domain:"SA",inputs:[productRevision(upstream).ref]});
  await barrier;
  await f.publish([claim("detail","v2")]);
  release();await publishing;
  const state=await f.lineage.snapshot();
  assert.equal(state.heads[productRevision(dependent).subjectKey].status,"STALE");
  await assert.rejects(f.lineage.assertCurrent(productRevision(dependent).ref),/not ACTIVE/);
  assert.deepEqual(await f.lineage.snapshotAt(await f.lineage.journalRef()),state);
});
