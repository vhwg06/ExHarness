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
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history-heads.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy-heads.json") }), mutationGuard: guard });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  return { dir, artifactStore, guard, history, acceptance, builder };
}

async function seedEligible(w, productId = "product-1") {
  await w.acceptance.publishPolicy({ productId, policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId, transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId, transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
  return { relRef, qaRef };
}

async function commitClaim(w, { subjectKey, status = "ACTIVE", productId = "product-1" }) {
  const ref = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId, subjectKey, status });
  await w.history.appendTransition({ productId, transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [ref], authorityHeads: {} });
  return ref;
}

async function commitObligation(w, { obligationKey, status = "BLOCKING", productId = "product-1" }) {
  const ref = await w.artifactStore.put("cross-domain-obligation", { kind: "CROSS_DOMAIN_OBLIGATION", version: 1, productId, obligationKey, status });
  await w.history.appendTransition({ productId, transitionKind: "OBLIGATION_TRANSITION", transitionRefs: [ref], authorityHeads: {} });
  return ref;
}

test("Omitted rejected claim still blocks.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  // The current QUALITY_REJECTED claim is committed to canonical history.
  // build() takes no caller claim refs, so omission cannot hide it.
  const rejectedRef = await commitClaim(w, { subjectKey: "req-1", status: "QUALITY_REJECTED" });
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "NOT_READY");
  assert.ok(built.projection.blockers.some((b) => b.code === "REJECTED_CLAIM" && b.ref === rejectedRef));
  assert.ok(built.projection.claimRefs.includes(rejectedRef));
});

test("Omitted blocking obligation still blocks.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const blockingRef = await commitObligation(w, { obligationKey: "design-1", status: "BLOCKING" });
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "NOT_READY");
  assert.ok(built.projection.blockers.some((b) => b.code === "BLOCKING_OBLIGATION" && b.ref === blockingRef));
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
});

test("rebuilding from the same pinned subject yields identical readiness and blockers", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  await commitObligation(w, { obligationKey: "design-1", status: "BLOCKING" });
  const first = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // Delete every in-memory handle to the cached projection, then rebuild pinned.
  let cached = first;
  cached = null;
  void cached;
  const second = await w.builder.rebuild({ subject: first.subject });
  assert.equal(second.projection.readiness, first.projection.readiness);
  assert.equal(second.projection.activeSetDigest, first.projection.activeSetDigest);
  assert.deepEqual(second.projection.blockers, first.projection.blockers);
  assert.equal(second.projectionRef, first.projectionRef);
  assert.deepEqual(second.subject, first.subject);
});

test("uncommitted store artifacts do not affect a pinned rebuild", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atN = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(atN.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  // An extra rejected claim exists in the immutable store but is never
  // committed to history: it must have no effect on the pinned rebuild.
  const strayRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "stray", status: "QUALITY_REJECTED" });
  const rebuilt = await w.builder.rebuild({ subject: atN.subject });
  assert.equal(rebuilt.projectionRef, atN.projectionRef);
  assert.equal(rebuilt.projection.readiness, atN.projection.readiness);
  assert.equal(rebuilt.projection.activeSetDigest, atN.projection.activeSetDigest);
  assert.deepEqual(rebuilt.projection.blockers, atN.projection.blockers);
  assert.ok(!rebuilt.projection.claimRefs.includes(strayRef));
  // The live build at the unchanged head is identical too.
  const live = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(live.projectionRef, atN.projectionRef);
});

test("later history commits supersede earlier state per kind", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const rejectedRef = await commitClaim(w, { subjectKey: "req-1", status: "QUALITY_REJECTED" });
  assert.equal((await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" })).projection.readiness, "NOT_READY");
  // A newer accepted revision for the same claim subject supersedes the rejection.
  const fixedRef = await commitClaim(w, { subjectKey: "req-1", status: "ACTIVE" });
  const afterClaim = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(afterClaim.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.ok(afterClaim.projection.claimRefs.includes(fixedRef));
  assert.ok(!afterClaim.projection.claimRefs.includes(rejectedRef));
  // A blocking obligation retired by a satisfied revision for the same key stops blocking.
  await commitObligation(w, { obligationKey: "design-1", status: "BLOCKING" });
  assert.equal((await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" })).projection.readiness, "NOT_READY");
  await commitObligation(w, { obligationKey: "design-1", status: "SATISFIED" });
  assert.equal((await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" })).projection.readiness, "ELIGIBLE_FOR_CLOSURE");
});

test("projection accepts no caller-selected completeness refs and no enumerating resolvers", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", claimRefs: [] }), /no caller-selected/);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", waiverRefs: [] }), /no caller-selected/);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1", obligationRefs: [] }), /no caller-selected/);
  assert.deepEqual(Object.keys(w.builder).sort(), ["build", "rebuild", "resolve"]);
  assert.throws(
    () => createProductStateProjectionBuilder({
      productHistory: w.history,
      acceptanceAuthority: w.acceptance,
      artifactStore: w.artifactStore,
      artifactResolvers: { listSemanticClaims: async () => [] },
      mutationGuard: w.guard,
    }),
    /never enumerates live state/
  );
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.ok(Object.isFrozen(built));
  assert.equal(built.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
});

test("an Hn+1 append during build waits for the guard and the projection pins Hn", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const headN = await w.history.current({ productId: "product-1" });

  // Pause the fold inside the held history guard; a same-guard Hn+1 append
  // must wait until the build releases it.
  let releaseFold;
  const foldGate = new Promise((resolve) => { releaseFold = resolve; });
  let arrived;
  const arrivedGate = new Promise((resolve) => { arrived = resolve; });
  const originalReadChain = w.history.readChain.bind(w.history);
  let calls = 0;
  const pausedHistory = Object.freeze({
    ...w.history,
    async readChain(args) {
      calls += 1;
      const result = await originalReadChain(args);
      if (calls === 1) {
        arrived();
        await foldGate;
      }
      return result;
    },
  });
  const pausedBuilder = createProductStateProjectionBuilder({
    productHistory: pausedHistory,
    acceptanceAuthority: w.acceptance,
    artifactStore: w.artifactStore,
    mutationGuard: w.guard,
  });
  const building = pausedBuilder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await arrivedGate;
  let appended = false;
  const appending = w.history.appendTransition({
    productId: "product-1",
    transitionKind: "SEMANTIC_PUBLICATION",
    transitionRefs: [await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "QUALITY_REJECTED" })],
    authorityHeads: {},
  }).then((result) => { appended = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(appended, false, "Hn+1 append waits while the build holds the guard");
  releaseFold();
  const pinned = await building;
  assert.equal(pinned.subject.historyGeneration, headN.generation);
  assert.equal(pinned.subject.historyDigest, headN.historyDigest);
  assert.equal(pinned.projection.readiness, "ELIGIBLE_FOR_CLOSURE", "the Hn projection reflects only Hn");
  await appending;
  assert.equal((await w.history.current({ productId: "product-1" })).generation, headN.generation + 1);
});
