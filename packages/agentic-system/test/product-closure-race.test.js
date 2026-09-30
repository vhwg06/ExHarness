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
import { createProductClosureController } from "../src/product-closure.js";

async function newWorld(t, { live = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-closurerace-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard, authorityReaders: live });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(dir, "outcomes.json") });
  const closure = createProductClosureController({ projectionBuilder: builder, productHistory: history, acceptanceAuthority: acceptance, artifactStore, outcomeHeadStore, mutationGuard: guard });
  return { dir, artifactStore, guard, history, acceptance, builder, closure, outcomeHeadStore };
}

async function seedEligible(w, heads = {}) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: heads });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: heads });
}

test("Hn projection cannot close after Hn+1.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // Ordering (a): Hn+1 lands first through the SAME shared guard, then the
  // stale close must reject.
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  await assert.rejects(w.closure.close({ projectionRef: atHn.projectionRef }), (e) => {
    assert.equal(e.code, "STALE_PROJECTION");
    return true;
  });
  assert.notEqual((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
});

test("close first holds the guard: Hn+1 waits, lands after the outcome, outcome turns HISTORICAL", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });

  // Pause the outcome-head CAS inside the guard-spanning close. A competing
  // Hn+1 append through the SAME shared guard must wait for the commit.
  let releaseCas;
  const casGate = new Promise((resolve) => { releaseCas = resolve; });
  let arrived;
  const arrivedGate = new Promise((resolve) => { arrived = resolve; });
  const rawHeads = w.outcomeHeadStore;
  const gatedHeads = Object.freeze({
    current: (...args) => rawHeads.current(...args),
    async compareAndSwap(...args) {
      arrived();
      await casGate;
      return rawHeads.compareAndSwap(...args);
    },
  });
  const gatedClosure = createProductClosureController({
    projectionBuilder: w.builder,
    productHistory: w.history,
    acceptanceAuthority: w.acceptance,
    artifactStore: w.artifactStore,
    outcomeHeadStore: gatedHeads,
    mutationGuard: w.guard,
  });
  const closing = gatedClosure.close({ projectionRef: atHn.projectionRef });
  await arrivedGate;
  let appended = false;
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  const appending = w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} })
    .then((result) => { appended = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(appended, false, "Hn+1 append waits while close holds the guard across check and commit");
  releaseCas();
  const closed = await closing;
  assert.equal(closed.head.value.historyGeneration, atHn.subject.historyGeneration);
  await appending;
  assert.equal((await w.history.current({ productId: "product-1" })).generation, atHn.subject.historyGeneration + 1);
  const revalidated = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(revalidated.status, "HISTORICAL");
  assert.equal(revalidated.reason, "PRODUCT_DRIFT");
  assert.equal(revalidated.outcomeRef, closed.outcomeRef);
});

test("a writer that bypasses the guard leaves NOT_READY until reconcile", async (t) => {
  const liveState = { release: "r1", quality: "q1" };
  const live = (productId) => {
    assert.equal(productId, "product-1");
    return structuredClone(liveState);
  };
  const w = await newWorld(t, { live });
  await seedEligible(w, { release: "r1", quality: "q1" });
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: built.projectionRef });
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
  // Crash window: the authority moved to r2 but the writer bypassed the
  // shared guard and never committed history. Reads fail closed.
  liveState.release = "r2";
  const drifted = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(drifted.status, "NOT_READY");
  assert.equal(drifted.reason, "RECOVERY_REQUIRED");
  // Deterministic reconciliation restores a committable head; the old outcome
  // is then historical under the newer generation.
  const reconciled = await w.history.reconcile({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r2", quality: "q1" } });
  assert.equal(reconciled.reconciled, true);
  const after = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(after.status, "HISTORICAL");
});
