import test from "node:test";
import assert from "node:assert/strict";
import {fixture,claim,obligation} from "./cross-domain-obligation.test.js";
import {productRevision,reverseSemanticClosure} from "../src/product-lineage.js";

test("exact reverse-transitive invalidation leaves unrelated sibling current and preserves history",async t=>{
  const f=await fixture(t),detail=claim("detail"),list=claim("list");
  await f.publish([detail,list]);
  const design=claim("detail-design","v1","SA"),sibling=claim("list-design","v1","SA");
  await f.publish([design],{domain:"SA",inputs:[productRevision(detail).ref]});
  await f.publish([sibling],{domain:"SA",inputs:[productRevision(list).ref]});
  const o=obligation(design);await f.publish([o],{domain:"SA",inputs:[productRevision(design).ref]});
  const before=await f.lineage.snapshot(),keys=[detail,design,o].map(v=>productRevision(v).subjectKey).sort();
  assert.deepEqual(reverseSemanticClosure(before,[productRevision(detail).subjectKey]),keys);
  await f.publish([claim("detail","v2")]);
  const after=await f.lineage.snapshot();
  for(const value of [design,o])assert.equal(after.heads[productRevision(value).subjectKey].status,"STALE");
  for(const value of [list,sibling])assert.equal((await f.lineage.assertCurrent(productRevision(value).ref)).head.status,"ACTIVE");
  assert.deepEqual(await f.lineage.resolve(productRevision(detail).ref),productRevision(detail).value);
  assert.deepEqual(reverseSemanticClosure(await f.lineage.snapshotAt(await f.lineage.journalRef()),[productRevision(detail).subjectKey]),keys);
  assert.deepEqual(after.edges,before.edges);
});
