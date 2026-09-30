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
import { createProductLineageStore } from "../src/product-lineage.js";
import { createOrganizationArtifactRegistry } from "../src/organization-artifact-store.js";
import { createDomainExecutionArtifactRegistry, createJsonExecutionAttemptStore } from "../src/domain-execution-store.js";
import { createCausalLifecycleEvidenceSink } from "../src/causal-provenance.js";
import { createCausalReconstruction } from "../src/causal-reconstruction.js";
import { createOrganizationObserver } from "../src/organization-observer.js";

export async function newObserverWorld(t, tag) {
  const dir = await mkdtemp(join(tmpdir(), `exharness-obs-${tag}-`));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const productHistory = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history-heads.json") }), mutationGuard: guard });
  const acceptanceAuthority = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy-heads.json") }), mutationGuard: guard });
  const projectionBuilder = createProductStateProjectionBuilder({ productHistory, acceptanceAuthority, artifactStore, mutationGuard: guard });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(dir, "outcomes.json") });
  const closureController = createProductClosureController({ projectionBuilder, productHistory, acceptanceAuthority, artifactStore, outcomeHeadStore, mutationGuard: guard });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore });
  const organizationArtifactRegistry = createOrganizationArtifactRegistry({ store: artifactStore });
  const domainArtifactRegistry = createDomainExecutionArtifactRegistry({ store: artifactStore });
  const executionAttemptStore = createJsonExecutionAttemptStore({ path: join(dir, "attempts.json") });
  const evidenceHeadStore = createJsonCasHeadStore({ path: join(dir, "causal-heads.json") });
  const sink = createCausalLifecycleEvidenceSink({ artifactStore, evidenceHeadStore });
  const board = { items: [] };
  const boardReader = { async readBlackboard() { return structuredClone({ items: board.items }); } };
  const deps = { productHistory, acceptanceAuthority, projectionBuilder, artifactStore, lineage, boardReader, organizationArtifactRegistry, domainArtifactRegistry, executionAttemptStore, evidenceHeadStore, closureController };
  const observer = createOrganizationObserver(deps);
  const reconstruction = createCausalReconstruction(deps);
  return { dir, artifactStore, guard, productHistory, acceptanceAuthority, projectionBuilder, closureController, lineage, organizationArtifactRegistry, domainArtifactRegistry, executionAttemptStore, evidenceHeadStore, sink, board, boardReader, observer, reconstruction };
}

export async function seedEligibleProduct(w, productId = "product-1") {
  await w.acceptanceAuthority.publishPolicy({ productId, policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.productHistory.appendTransition({ productId, transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.productHistory.appendTransition({ productId, transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
  return { relRef, qaRef };
}

test("For a NOT_READY product a fresh observer identifies the exact blocker reason and evidence refs", async (t) => {
  const w = await newObserverWorld(t, "recon");
  await seedEligibleProduct(w);
  const rejectedRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "req-1", status: "QUALITY_REJECTED" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [rejectedRef], authorityHeads: {} });
  // Fresh observer: rebuilt only from durable files, no caller blocker refs.
  const fresh = createOrganizationObserver({
    productHistory: w.productHistory, acceptanceAuthority: w.acceptanceAuthority, projectionBuilder: w.projectionBuilder,
    artifactStore: w.artifactStore, lineage: w.lineage, boardReader: w.boardReader,
    organizationArtifactRegistry: w.organizationArtifactRegistry, domainArtifactRegistry: w.domainArtifactRegistry,
    executionAttemptStore: w.executionAttemptStore, evidenceHeadStore: w.evidenceHeadStore, closureController: w.closureController,
  });
  const explained = await fresh.explainWhyNotDone({ productId: "product-1", rootIntentRef: "intent:root-1" }).catch(() => null);
  assert.equal(explained, null, "explainWhyNotDone takes a pinned subject, not live ids");
  const current = await fresh.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(current.readiness, "NOT_READY");
  const blocker = current.blockers.find((b) => b.code === "REJECTED_CLAIM");
  assert.ok(blocker, "canonical REJECTED_CLAIM blocker is reported");
  assert.equal(blocker.ref, rejectedRef);
  assert.ok(blocker.evidenceRefs.includes(rejectedRef));
  assert.ok(blocker.evidenceRefs.includes(current.subject.projectionRef));
  const resolved = await w.artifactStore.resolve(blocker.ref);
  assert.equal(resolved.status, "QUALITY_REJECTED");
});

test("Observer fabricates nothing: a tampered projection binding is rejected, not explained", async (t) => {
  const w = await newObserverWorld(t, "recon-tamper");
  await seedEligibleProduct(w);
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const tampered = structuredClone(current.subject);
  tampered.projectionRef = current.subject.projectionRef.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
  await assert.rejects(w.reconstruction.explainBlockers({ subject: tampered }), /pinned projection|unavailable|mismatch|digest/i);
});

test("Caller-selected subsets cannot hide a blocker or change the result", async (t) => {
  const w = await newObserverWorld(t, "recon-subset");
  await seedEligibleProduct(w);
  const rejectedRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "req-1", status: "QUALITY_REJECTED" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [rejectedRef], authorityHeads: {} });
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // Any caller-supplied completeness subset is rejected instead of narrowing the subject.
  await assert.rejects(w.reconstruction.explainBlockers({ subject: current.subject, blockerRefs: [] }), /no caller-selected/);
  await assert.rejects(w.reconstruction.explainBlockers({ subject: current.subject, claimRefs: [rejectedRef] }), /no caller-selected/);
  await assert.rejects(w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1", claimRefs: [] }), /no caller-selected/);
  const explained = await w.reconstruction.explainBlockers({ subject: current.subject });
  assert.ok(explained.blockers.some((b) => b.ref === rejectedRef), "canonical blocker survives without caller refs");
});

test("Same pinned subject reconstructs identical facts", async (t) => {
  const w = await newObserverWorld(t, "recon-det");
  await seedEligibleProduct(w);
  const first = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const second = await w.observer.queryHistorical({ subject: { ...first.subject, mode: "HISTORICAL" } });
  assert.deepEqual(second.blockers, first.blockers);
  assert.deepEqual(second.evidenceRefs, first.evidenceRefs);
  assert.equal(second.readiness, first.readiness);
});
