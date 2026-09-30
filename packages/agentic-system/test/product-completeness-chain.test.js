import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createJsonCasHeadStore as openHeads } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController, productHistorySubjectKey } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";
import { createProductClosureController } from "../src/product-closure.js";
import { createProductLineageStore, productRevision } from "../src/product-lineage.js";

// Full Integration G chain on durable JSON stores: a canonical claim plus
// release/quality inputs committed to history, fresh-process restart, one
// identical projection, closure, independent history/policy advances,
// historical revalidation and immutable-conflict on in-place mutation attempts.
function claim(key, content = "v1") {
  return { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: key, status: "ACTIVE", content };
}

async function openWorld(dir, guard) {
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore, projectGuard: guard, projectId: "product-1" });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  const closure = createProductClosureController({
    projectionBuilder: builder, productHistory: history, acceptanceAuthority: acceptance,
    artifactStore, outcomeHeadStore: createJsonCasHeadStore({ path: join(dir, "outcomes.json") }), mutationGuard: guard,
  });
  return { dir, artifactStore, guard, history, acceptance, lineage, builder, closure };
}

test("canonical completeness chain closes, revalidates and rejects in-place mutation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb055-chain-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const guard = createProductMutationGuard();
  const w = await openWorld(dir, guard);

  // Canonical claim input recorded immutably and committed to history.
  const record = claim("backend-requirement");
  const storedRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: record.subjectKey, status: "ACTIVE", content: record.content });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [storedRef], authorityHeads: { lineage: "j1" } });
  assert.ok((await w.lineage.snapshot()).heads !== undefined);

  // Release/quality inputs committed to history (folded, never enumerated).
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: { lineage: "j1" } });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: { lineage: "j1" } });

  // Canonical policy authority.
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });

  // Restart: fresh controllers from disk rebuild one identical projection.
  const fresh = await openWorld(dir, createProductMutationGuard());
  const first = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const rebuilt = await fresh.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(first.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.deepEqual(rebuilt.subject, first.subject);
  assert.equal(rebuilt.projectionRef, first.projectionRef);
  assert.ok(productRevision({ kind: "SEMANTIC_CLAIM", projectId: "p", rootIntentId: "i", domain: "BACKEND", semanticKind: "requirement", subjectKey: "k", content: "c" }).ref.startsWith("semantic-claim:sha256:"));

  // Close the identical projection.
  const closed = await fresh.closure.close({ projectionRef: rebuilt.projectionRef });
  assert.equal((await fresh.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");

  // Advance history and policy independently: the old outcome stays stored but non-current.
  const lateRef = await fresh.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE", content: "v2" });
  await fresh.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: { lineage: "j2" } });
  await fresh.acceptance.publishWaiver({ productId: "product-1", waiver: { waiverId: "w1", waives: ["NO_RELEASE"] } });
  const revalidated = await fresh.closure.currentOutcome({ productId: "product-1" });
  assert.equal(revalidated.status, "HISTORICAL");
  assert.equal(revalidated.outcomeRef, closed.outcomeRef);
  assert.deepEqual(await fresh.artifactStore.resolve(closed.outcomeRef), closed.outcome);

  // In-place mutation attempts fail: stale CAS is rejected and historical
  // bytes still resolve to the original content.
  const stale = await fresh.artifactStore.resolve(closed.outcomeRef);
  assert.equal(stale.readiness, "ELIGIBLE_FOR_CLOSURE");
  const heads = openHeads({ path: join(dir, "history.json") });
  assert.equal(await heads.compareAndSwap(productHistorySubjectKey("product-1"), "bogus-revision", { generation: 99, commitRef: "x", historyDigest: "y" }), false);
  assert.deepEqual((await fresh.artifactStore.resolve(storedRef)).status, "ACTIVE");
  assert.deepEqual(await fresh.artifactStore.resolve(closed.outcomeRef), closed.outcome);
});
