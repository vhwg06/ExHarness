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

function barrier() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  let arrive;
  const arrived = new Promise((resolve) => { arrive = resolve; });
  return { open, opened, arrive, arrived };
}

async function newWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-closurerace-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const historyHeads = createJsonCasHeadStore({ path: join(dir, "history.json") });
  const policyHeads = createJsonCasHeadStore({ path: join(dir, "policy.json") });
  const history = createProductHistoryController({ artifactStore, headStore: historyHeads, mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: policyHeads, mutationGuard: guard });
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
  return { dir, artifactStore, history, historyHeads, acceptance, policyHeads, builder, closure, releases, qualities };
}

async function seedEligible(w) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  w.releases.set("product-1", { releaseRef: "deployment-release:sha256:" + "a".repeat(64), release: {} });
  w.qualities.set("product-1", { acceptanceRef: "quality-acceptance:sha256:" + "b".repeat(64), acceptance: {}, current: true });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [], authorityHeads: {} });
}

test("Hn projection cannot close after Hn+1.", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });

  // Barrier inside the guarded freshness re-read: pause close just before its
  // final currentness check, land Hn+1, then let close resume. It must reject.
  const gate = barrier();
  const originalCurrent = w.history.current.bind(w.history);
  let calls = 0;
  const patchedHistory = Object.freeze({ ...w.history, current: async (args) => {
    calls += 1;
    if (calls === 2) {
      gate.arrive();
      await gate.opened;
    }
    return originalCurrent(args);
  } });
  const { createProductClosureController: createClosure } = await import("../src/product-closure.js");
  const { createJsonCasHeadStore: openHeads } = await import("../src/organization-authority-store.js");
  const racingClosure = createClosure({
    projectionBuilder: w.builder,
    productHistory: patchedHistory,
    acceptanceAuthority: w.acceptance,
    artifactStore: w.artifactStore,
    outcomeHeadStore: openHeads({ path: join(w.dir, "outcomes.json") }),
  });
  const closing = assert.rejects(racingClosure.close({ projectionRef: atHn.projectionRef }), /stale|advanced/i);
  await gate.arrived;
  // Land Hn+1 through an independent writer guard on the same durable stores
  // (a crash-window authority commit that does not wait on close's guard).
  const writer = createProductHistoryController({ artifactStore: w.artifactStore, headStore: w.historyHeads, mutationGuard: createProductMutationGuard() });
  await writer.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: ["semantic-claim:sha256:" + "c".repeat(64)], authorityHeads: {} });
  gate.open();
  await closing;
  const current = await w.closure.currentOutcome({ productId: "product-1" });
  assert.notEqual(current.status, "CURRENT");
});

test("policy drift before the final commit yields no current outcome", async (t) => {
  const w = await newWorld(t);
  await seedEligible(w);
  const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });

  const gate = barrier();
  const originalResolve = w.acceptance.resolveCurrent.bind(w.acceptance);
  let calls = 0;
  const patchedAcceptance = Object.freeze({ ...w.acceptance, resolveCurrent: async (args) => {
    calls += 1;
    if (calls === 2) {
      gate.arrive();
      await gate.opened;
    }
    return originalResolve(args);
  } });
  const { createProductClosureController: createClosure2 } = await import("../src/product-closure.js");
  const { createJsonCasHeadStore: openHeads2 } = await import("../src/organization-authority-store.js");
  const racingClosure = createClosure2({
    projectionBuilder: w.builder,
    productHistory: w.history,
    acceptanceAuthority: patchedAcceptance,
    artifactStore: w.artifactStore,
    outcomeHeadStore: openHeads2({ path: join(w.dir, "outcomes.json") }),
  });
  const closing = assert.rejects(racingClosure.close({ projectionRef: atHn.projectionRef }), /non-current|drift|advanced/i);
  await gate.arrived;
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login", "criterion:checkout"] } });
  gate.open();
  await closing;
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "NO_OUTCOME");
});
