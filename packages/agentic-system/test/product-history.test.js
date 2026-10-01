import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import {
  createProductMutationGuard,
  createProductHistoryController,
  productHistorySubjectKey,
} from "../src/product-history.js";
import {
  createProductMutationGuard as createGuardFromIndex,
  createProductHistoryController as createHistoryFromIndex,
} from "../src/index.js";

async function newWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-history-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const headStore = createJsonCasHeadStore({ path: join(dir, "heads.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore, mutationGuard: guard });
  return { dir, artifactStore, headStore, guard, history };
}

test("monotonic CAS chain is immutable and ordered", async (t) => {
  const w = await newWorld(t);
  const a = await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: ["semantic-claim:sha256:" + "a".repeat(64)], authorityHeads: { lineage: "j1" } });
  assert.equal(a.generation, 1);
  const b = await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: ["deployment-release:sha256:" + "b".repeat(64)], authorityHeads: { lineage: "j1", release: "r1" } });
  assert.equal(b.generation, 2);
  assert.equal(b.commit.previousCommitRef, a.commitRef);
  assert.equal(b.commit.previousDigest, a.historyDigest);
  const cur = await w.history.current({ productId: "product-1" });
  assert.equal(cur.generation, 2);
  assert.equal(cur.commitRef, b.commitRef);
  assert.equal(cur.historyDigest, b.historyDigest);
  // Immutable bytes still resolve to the original content.
  assert.deepEqual(await w.artifactStore.resolve(a.commitRef), a.commit);
  // Subject key is deterministic per product.
  assert.equal(w.history.subjectKey("product-1"), productHistorySubjectKey("product-1"));
  assert.equal(cur.subjectKey, productHistorySubjectKey("product-1"));
});

test("Historical artifact overwrite is rejected.", async (t) => {
  const w = await newWorld(t);
  const first = await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: ["semantic-claim:sha256:" + "c".repeat(64)], authorityHeads: {} });
  const before = await w.artifactStore.resolve(first.commitRef);
  // A correction is a new immutable transition; the old commit bytes are unchanged.
  const second = await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: ["semantic-claim:sha256:" + "d".repeat(64)], authorityHeads: {} });
  assert.equal(second.generation, 2);
  assert.deepEqual(await w.artifactStore.resolve(first.commitRef), before);
  // Stale CAS on the head is rejected (returns false, no overwrite).
  const ok = await w.headStore.compareAndSwap(productHistorySubjectKey("product-1"), "stale-revision", { generation: 99, commitRef: first.commitRef, historyDigest: first.historyDigest });
  assert.equal(ok, false);
  assert.equal((await w.history.current({ productId: "product-1" })).commitRef, second.commitRef);
});

test("Strategy-only change does not advance product history.", async (t) => {
  const w = await newWorld(t);
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: {} });
  const headBefore = await w.history.current({ productId: "product-1" });
  await assert.rejects(
    w.history.appendTransition({ productId: "product-1", transitionKind: "EXECUTION_STRATEGY", transitionRefs: [], authorityHeads: {} }),
    /not closure-relevant/
  );
  await assert.rejects(
    w.history.appendTransition({ productId: "product-1", transitionKind: "STRATEGY_ONLY", transitionRefs: [], authorityHeads: {} }),
    /not closure-relevant/
  );
  const headAfter = await w.history.current({ productId: "product-1" });
  assert.deepEqual(headAfter, headBefore);
});

test("history exposes no scheduling or dispatch authority", async (t) => {
  const w = await newWorld(t);
  assert.deepEqual(Object.keys(w.history).sort(), ["appendTransition", "current", "readChain", "reconcile", "subjectKey", "withCurrentHistoryGuard", "withProductGuard"]);
  for (const forbidden of ["schedule", "dispatch", "claim", "nextDomain", "execute"]) {
    assert.equal(w.history[forbidden], undefined);
  }
  // Index exports resolve to the same controllers.
  assert.equal(typeof createGuardFromIndex, "function");
  assert.equal(typeof createHistoryFromIndex, "function");
});
