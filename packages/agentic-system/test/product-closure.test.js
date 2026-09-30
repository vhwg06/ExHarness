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
import { createProductClosureController, ProductClosureStaleError } from "../src/product-closure.js";

async function newWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-closure-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(dir, "outcomes.json") });
  const closure = createProductClosureController({ projectionBuilder: builder, productHistory: history, acceptanceAuthority: acceptance, artifactStore, outcomeHeadStore, mutationGuard: guard });
  return { dir, artifactStore, guard, history, acceptance, builder, closure, outcomeHeadStore };
}

async function seedEligible(w) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
}

test("eligible projection closes and becomes CURRENT", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  const closed = await w.closure.close({ projectionRef: built.projectionRef });
  assert.match(closed.outcomeRef, /^product-outcome-claim:sha256:/);
  const current = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(current.status, "CURRENT");
  assert.equal(current.outcomeRef, closed.outcomeRef);
});

test("NOT_READY projection cannot close", async (t) => {
  const w = await newWorld(t);
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  // No release/quality commits: the folded projection is NOT_READY.
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: {} });
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "NOT_READY");
  await assert.rejects(w.closure.close({ projectionRef: built.projectionRef }), /NOT_READY/);
  const current = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(current.status, "NO_OUTCOME");
});

test("Hn projection cannot close after Hn+1.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // A closure-relevant Hn+1 transition lands before the final commit.
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  await assert.rejects(w.closure.close({ projectionRef: atHn.projectionRef }), (e) => {
    assert.ok(e instanceof ProductClosureStaleError);
    assert.equal(e.code, "STALE_PROJECTION");
    return true;
  });
  const current = await w.closure.currentOutcome({ productId: "product-1" });
  assert.notEqual(current.status, "CURRENT");
});

test("a newer outcome head rejects a superseded close without blind retry", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: atHn.projectionRef });
  // A later closure at Hn+1 advances the outcome head: closing the old
  // subject must reject instead of retrying over it.
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  const atHn1 = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: atHn1.projectionRef });
  await assert.rejects(w.closure.close({ projectionRef: atHn.projectionRef }), (e) => {
    assert.equal(e.code, "STALE_PROJECTION");
    return true;
  });
});
