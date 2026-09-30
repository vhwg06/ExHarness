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
import { createProductLineageStore, productRevision } from "../src/product-lineage.js";

// Full Integration G chain on durable JSON stores: canonical C lineage plus
// release/quality inputs, fresh-process restart, one identical projection,
// closure, independent history/policy advances, historical revalidation and
// immutable-conflict on in-place mutation attempts.
function claim(key, content = "v1") {
  return { kind: "SEMANTIC_CLAIM", projectId: "product-1", rootIntentId: "intent:root-1", domain: "BACKEND", semanticKind: "requirement", subjectKey: key, content };
}

async function openWorld(dir, { claims, obligations, releases, qualities } = {}) {
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore, projectGuard: guard, projectId: "product-1" });
  const builder = createProductStateProjectionBuilder({
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactResolvers: {
      listSemanticClaims: async () => [...(claims?.get("product-1") ?? [])],
      listObligations: async () => [...(obligations?.get("product-1") ?? [])],
      currentRelease: async () => releases?.get("product-1") ?? null,
      currentQuality: async () => qualities?.get("product-1") ?? null,
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
  return { dir, artifactStore, guard, history, acceptance, lineage, builder, closure };
}

test("canonical completeness chain closes, revalidates and rejects in-place mutation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-chain-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const claims = new Map([["product-1", []]]);
  const obligations = new Map([["product-1", []]]);
  const releases = new Map();
  const qualities = new Map();
  const w = await openWorld(dir, { claims, obligations, releases, qualities });

  // Canonical C lineage input: one accepted backend claim recorded immutably.
  const backend = claim("backend-requirement");
  const record = productRevision(backend);
  const storedRef = await w.artifactStore.put("semantic-claim", record.value);
  assert.equal(storedRef, record.ref);
  claims.set("product-1", [{ ref: record.ref, status: "ACTIVE" }]);

  // E/F quality inputs: one current release plus one current acceptance.
  releases.set("product-1", { releaseRef: "deployment-release:sha256:" + "a".repeat(64), release: {} });
  qualities.set("product-1", { acceptanceRef: "quality-acceptance:sha256:" + "b".repeat(64), acceptance: {}, current: true });

  // Canonical policy authority + history head.
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [record.ref], authorityHeads: { lineage: "j1" } });

  // Restart: fresh controllers from disk rebuild one identical projection.
  const fresh = await openWorld(dir, { claims, obligations, releases, qualities });
  const first = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const rebuilt = await fresh.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(first.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.deepEqual(rebuilt.subject, first.subject);
  assert.equal(rebuilt.projectionRef, first.projectionRef);

  // Close the identical projection.
  const closed = await fresh.closure.close({ projectionRef: rebuilt.projectionRef });
  assert.equal((await fresh.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");

  // Advance history and policy independently: the old outcome stays stored but non-current.
  await fresh.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: ["semantic-claim:sha256:" + "c".repeat(64)], authorityHeads: { lineage: "j2" } });
  await fresh.acceptance.publishWaiver({ productId: "product-1", waiver: { waiverId: "w1", waives: ["NO_RELEASE"] } });
  const revalidated = await fresh.closure.currentOutcome({ productId: "product-1" });
  assert.equal(revalidated.status, "HISTORICAL");
  assert.equal(revalidated.outcomeRef, closed.outcomeRef);
  assert.deepEqual(await fresh.artifactStore.resolve(closed.outcomeRef), closed.outcome);

  // In-place mutation attempts fail: stale CAS is rejected and historical
  // bytes still resolve to the original content.
  const { productHistorySubjectKey } = await import("../src/product-history.js");
  const stale = await fresh.artifactStore.resolve(closed.outcomeRef);
  assert.equal(stale.readiness, "ELIGIBLE_FOR_CLOSURE");
  const headKey = productHistorySubjectKey("product-1");
  const { createJsonCasHeadStore: openHeads } = await import("../src/organization-authority-store.js");
  const heads = openHeads({ path: join(dir, "history.json") });
  assert.equal(await heads.compareAndSwap(headKey, "bogus-revision", { generation: 99, commitRef: "x", historyDigest: "y" }), false);
  assert.deepEqual(await fresh.artifactStore.resolve(record.ref), record.value);
  assert.deepEqual(await fresh.artifactStore.resolve(closed.outcomeRef), closed.outcome);
});
