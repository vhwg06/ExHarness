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

async function newWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-revalidation-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  const closure = createProductClosureController({ projectionBuilder: builder, productHistory: history, acceptanceAuthority: acceptance, artifactStore, outcomeHeadStore: createJsonCasHeadStore({ path: join(dir, "outcomes.json") }), mutationGuard: guard });
  return { dir, artifactStore, guard, history, acceptance, builder, closure };
}

async function seedEligible(w) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
}

test("Old outcome stays historical but non-current after product drift.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const closed = await w.closure.close({ projectionRef: built.projectionRef });
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
  // A new accepted closure-relevant revision advances history to Hn+1.
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  const revalidated = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(revalidated.status, "HISTORICAL");
  assert.equal(revalidated.outcomeRef, closed.outcomeRef);
  // The old immutable claim artifact still resolves unchanged.
  assert.deepEqual(await w.artifactStore.resolve(closed.outcomeRef), closed.outcome);
});

test("Policy/waiver drift invalidates old projection.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: built.projectionRef });
  await w.acceptance.publishWaiver({ productId: "product-1", waiver: { waiverId: "w1", waives: ["NO_RELEASE"] } });
  const revalidated = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(revalidated.status, "HISTORICAL");
});

test("Strategy-only change does not advance product history.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: built.projectionRef });
  const headBefore = await w.history.current({ productId: "product-1" });
  // Strategy-only revisions are rejected from history; accepted lineage is unchanged.
  await assert.rejects(w.history.appendTransition({ productId: "product-1", transitionKind: "EXECUTION_POLICY", transitionRefs: [], authorityHeads: {} }), /not closure-relevant/);
  const headAfter = await w.history.current({ productId: "product-1" });
  assert.deepEqual(headAfter, headBefore);
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
});

test("Historical artifact overwrite is rejected.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const closed = await w.closure.close({ projectionRef: built.projectionRef });
  const before = await w.artifactStore.resolve(closed.outcomeRef);
  // Correction is a new immutable claim; the historical bytes never change.
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  const fresh = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const closed2 = await w.closure.close({ projectionRef: fresh.projectionRef });
  assert.notEqual(closed2.outcomeRef, closed.outcomeRef);
  assert.deepEqual(await w.artifactStore.resolve(closed.outcomeRef), before);
});
