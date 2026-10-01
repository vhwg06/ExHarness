// File-backed product-history world for adversarial recovery tests.
// Live closure-relevant authority is itself durable: a JSON file the reader
// re-reads on every call. A crash is modeled as advancing that file without
// appending history; a fresh process reopens the same files with no memory.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../../src/product-history.js";
import { createProductAcceptanceAuthority } from "../../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../../src/product-state-projection.js";
import { createProductClosureController } from "../../src/product-closure.js";
import { withScratch } from "./recovery-harness.js";

export async function openHistoryWorld(t, dir = null) {
  const root = dir ?? await withScratch(t, "exharness-bb057-history-");
  const livePath = join(root, "live-authority.json");
  try {
    await readFile(livePath, "utf8");
  } catch {
    await writeFile(livePath, JSON.stringify({ release: "r1", quality: "q1" }), "utf8");
  }
  const readLive = async (productId) => {
    assert.equal(productId, "product-1");
    return JSON.parse(await readFile(livePath, "utf8"));
  };
  const artifactStore = createJsonImmutableArtifactStore({ path: join(root, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({
    artifactStore,
    headStore: createJsonCasHeadStore({ path: join(root, "history-heads.json") }),
    mutationGuard: guard,
    authorityReaders: readLive,
  });
  const acceptance = createProductAcceptanceAuthority({
    artifactStore,
    headStore: createJsonCasHeadStore({ path: join(root, "policy-heads.json") }),
    mutationGuard: guard,
  });
  const builder = createProductStateProjectionBuilder({
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactStore,
    mutationGuard: guard,
  });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(root, "outcomes.json") });
  const closure = createProductClosureController({
    projectionBuilder: builder,
    productHistory: history,
    acceptanceAuthority: acceptance,
    artifactStore,
    outcomeHeadStore,
    mutationGuard: guard,
  });
  return {
    dir: root,
    livePath,
    artifactStore,
    guard,
    history,
    acceptance,
    builder,
    closure,
    outcomeHeadStore,
    async advanceAuthority(next) {
      await writeFile(livePath, JSON.stringify(next), "utf8");
    },
  };
}

export async function seedHistoryEligible(w) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: { release: "r1", quality: "q1" } });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: { release: "r1", quality: "q1" } });
}
