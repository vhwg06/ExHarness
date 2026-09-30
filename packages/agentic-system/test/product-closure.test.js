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
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-closure-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const releases = new Map();
  const qualities = new Map();
  const builder = createProductStateProjectionBuilder({
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactResolvers: {
      listSemanticClaims: async () => [],
      listObligations: async () => [],
      currentRelease: async (pid) => releases.get(pid) ?? null,
      currentQuality: async (pid) => qualities.get(pid) ?? null,
    },
    artifactStore,
  });
  const closure = createProductClosureController({
    projectionBuilder: builder,
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactStore,
    outcomeHeadStore: createJsonCasHeadStore({ path: join(dir, "outcomes.json") }),
  });
  return { dir, artifactStore, history, acceptance, builder, closure, releases, qualities };
}

async function seedEligible(w) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  w.releases.set("product-1", { releaseRef: "deployment-release:sha256:" + "a".repeat(64), release: {} });
  w.qualities.set("product-1", { acceptanceRef: "quality-acceptance:sha256:" + "b".repeat(64), acceptance: {}, current: true });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: {} });
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
  // No release/quality: projection is NOT_READY.
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
  await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: ["semantic-claim:sha256:" + "c".repeat(64)], authorityHeads: {} });
  await assert.rejects(w.closure.close({ projectionRef: atHn.projectionRef }), (e) => {
    assert.match(e.message, /stale|Hn\+1|advanced/i);
    return true;
  });
  const current = await w.closure.currentOutcome({ productId: "product-1" });
  assert.notEqual(current.status, "CURRENT");
});
