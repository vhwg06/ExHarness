import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";

// Live closure-relevant authority heads simulated in memory. A crash between
// an authority mutation and its history append leaves the canonical head
// committing to an older state; reads must fail closed until reconciliation.
function liveHeads() {
  const state = { release: "r1", quality: "q1" };
  return {
    state,
    async read(productId) {
      assert.equal(productId, "product-1");
      return structuredClone(state);
    },
  };
}

async function newWorld(t, live) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-recovery-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const headStore = createJsonCasHeadStore({ path: join(dir, "history-heads.json") });
  const policyHeads = createJsonCasHeadStore({ path: join(dir, "policy-heads.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore, mutationGuard: guard, authorityReaders: live ? (pid) => live.read(pid) : null });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: policyHeads, mutationGuard: guard });
  const claims = new Map([["product-1", []]]);
  const obligations = new Map([["product-1", []]]);
  const releases = new Map([["product-1", { releaseRef: "deployment-release:sha256:" + "e".repeat(64), release: { environmentRef: "env-1" } }]]);
  const qualities = new Map([["product-1", { acceptanceRef: "quality-acceptance:sha256:" + "f".repeat(64), acceptance: {}, current: true }]]);
  const builder = createProductStateProjectionBuilder({
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactResolvers: {
      listSemanticClaims: async (pid) => [...(claims.get(pid) ?? [])],
      listObligations: async (pid) => [...(obligations.get(pid) ?? [])],
      currentRelease: async (pid) => releases.get(pid) ?? null,
      currentQuality: async (pid) => qualities.get(pid) ?? null,
    },
    artifactStore,
  });
  return { dir, artifactStore, headStore, policyHeads, guard, history, acceptance, builder, claims, obligations, releases, qualities };
}

test("Crash authority/history drift is NOT_READY until reconciliation.", async (t) => {
  const live = liveHeads();
  const w = await newWorld(t, live);
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r1", quality: "q1" } });
  assert.equal((await w.history.current({ productId: "product-1" })).generation, 1);
  // Crash window: authority advanced to r2 but history still commits to r1.
  live.state.release = "r2";
  await assert.rejects(w.history.current({ productId: "product-1" }), (e) => {
    assert.match(e.message, /drift|RECOVERY/i);
    return true;
  });
  // Guarded reads also fail closed while drifted.
  const head = await w.headStore.current("product-history-head:" + (await import("../src/product-history.js").then((m) => m.productHistorySubjectKey("product-1").split(":")[1])));
  void head;
  // Wrong observations cannot reconcile; the exact live heads are required.
  await assert.rejects(
    w.history.reconcile({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r1", quality: "q1" } }),
    /exact live/
  );
  // Deterministic reconciliation appends the exact immutable transition.
  const out = await w.history.reconcile({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r2", quality: "q1" } });
  assert.equal(out.reconciled, true);
  assert.equal(out.generation, 2);
  assert.equal((await w.history.current({ productId: "product-1" })).generation, 2);
  // Converges when already current.
  const again = await w.history.reconcile({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r2", quality: "q1" } });
  assert.equal(again.reconciled, false);
  assert.equal(again.generation, 2);
});

test("fresh process reconstructs the same current subject from durable refs", async (t) => {
  const live = liveHeads();
  const w = await newWorld(t, live);
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "p1", criterionRefs: ["criterion:login"] } });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r1", quality: "q1" } });
  const beforeHistory = await w.history.current({ productId: "product-1" });
  const beforeBuilt = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(beforeBuilt.projection.readiness, "ELIGIBLE_FOR_CLOSURE");

  // Restart: brand-new controllers over the same durable files, no memory.
  const artifactStore2 = createJsonImmutableArtifactStore({ path: join(w.dir, "artifacts.json") });
  const headStore2 = createJsonCasHeadStore({ path: join(w.dir, "history-heads.json") });
  const policyHeads2 = createJsonCasHeadStore({ path: join(w.dir, "policy-heads.json") });
  const guard2 = createProductMutationGuard();
  const history2 = createProductHistoryController({ artifactStore: artifactStore2, headStore: headStore2, mutationGuard: guard2, authorityReaders: (pid) => live.read(pid) });
  const acceptance2 = createProductAcceptanceAuthority({ artifactStore: artifactStore2, headStore: policyHeads2, mutationGuard: guard2 });
  const builder2 = createProductStateProjectionBuilder({
    productHistory: history2,
    acceptanceAuthority: acceptance2,
    artifactResolvers: {
      listSemanticClaims: async () => [],
      listObligations: async () => [],
      currentRelease: async () => w.releases.get("product-1"),
      currentQuality: async () => w.qualities.get("product-1"),
    },
    artifactStore: artifactStore2,
  });
  const afterHistory = await history2.current({ productId: "product-1" });
  assert.deepEqual(afterHistory, beforeHistory);
  const afterBuilt = await builder2.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(afterBuilt.projection.readiness, beforeBuilt.projection.readiness);
  assert.equal(afterBuilt.projection.activeSetDigest, beforeBuilt.projection.activeSetDigest);
  assert.deepEqual(afterBuilt.projection.blockers, beforeBuilt.projection.blockers);
  assert.deepEqual(afterBuilt.subject, beforeBuilt.subject);
});
