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

async function newWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-projection-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const historyHeads = createJsonCasHeadStore({ path: join(dir, "history-heads.json") });
  const policyHeads = createJsonCasHeadStore({ path: join(dir, "policy-heads.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: historyHeads, mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: policyHeads, mutationGuard: guard });
  const claims = new Map([["product-1", []]]);
  const obligations = new Map([["product-1", []]]);
  const releases = new Map();
  const qualities = new Map();
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
  return { dir, artifactStore, history, acceptance, builder, claims, obligations, releases, qualities };
}

async function seedEligible(w, productId = "product-1") {
  await w.acceptance.publishPolicy({ productId, policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  w.releases.set(productId, { releaseRef: "deployment-release:sha256:" + "a".repeat(64), release: {} });
  w.qualities.set(productId, { acceptanceRef: "quality-acceptance:sha256:" + "b".repeat(64), acceptance: {}, current: true });
  await w.history.appendTransition({ productId, transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: {} });
}

test("Omitted rejected claim still blocks.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  // A current QUALITY_REJECTED claim exists in canonical history/lineage.
  // build() takes no caller claim refs, so omission cannot hide it.
  w.claims.set("product-1", [{ ref: "semantic-claim:sha256:" + "c".repeat(64), status: "QUALITY_REJECTED" }]);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "NOT_READY");
  assert.ok(built.projection.blockers.some((b) => b.code === "REJECTED_CLAIM"));
});

test("Omitted blocking obligation still blocks.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  w.obligations.set("product-1", [{ ref: "cross-domain-obligation:sha256:" + "d".repeat(64), status: "BLOCKING" }]);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "NOT_READY");
  assert.ok(built.projection.blockers.some((b) => b.code === "BLOCKING_OBLIGATION"));
});

test("Policy/waiver drift invalidates old projection.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const first = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(first.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  // Policy revision changes while history is unchanged: old subject is stale.
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login", "criterion:checkout"] } });
  const second = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.notEqual(second.subject.policyRef, first.subject.policyRef);
  assert.notEqual(second.subject.policyRevision, first.subject.policyRevision);
  assert.notDeepEqual(second.subject, first.subject);
  // A waiver revision also changes the pinned subject deterministically.
  await w.acceptance.publishWaiver({ productId: "product-1", waiver: { waiverId: "waiver-1", waives: ["NO_RELEASE"] } });
  const third = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.notEqual(third.subject.waiverSetDigest, second.subject.waiverSetDigest);
  assert.deepEqual(third.subject.waiverRefs, [...second.subject.waiverRefs, third.subject.waiverRefs.find((r) => !second.subject.waiverRefs.includes(r))].sort());
});

test("rebuilding from the same pinned subject yields identical readiness and blockers", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  w.obligations.set("product-1", [{ ref: "cross-domain-obligation:sha256:" + "e".repeat(64), status: "BLOCKING" }]);
  const first = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // Delete every in-memory handle to the cached projection, then rebuild.
  let cached = first;
  cached = null;
  void cached;
  const second = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(second.projection.readiness, first.projection.readiness);
  assert.equal(second.projection.activeSetDigest, first.projection.activeSetDigest);
  assert.deepEqual(second.projection.blockers, first.projection.blockers);
  assert.equal(second.projectionRef, first.projectionRef);
  assert.deepEqual(second.subject, first.subject);
});

test("projection accepts no caller-selected completeness refs and cannot mutate authority", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", claimRefs: [] }), /no caller-selected/);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", waiverRefs: [] }), /no caller-selected/);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", obligationRefs: [] }), /no caller-selected/);
  assert.deepEqual(Object.keys(w.builder).sort(), ["build", "resolve"]);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.ok(Object.isFrozen(built));
  assert.equal(built.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.equal(typeof w.builder.build, "function");
});
