import test from "node:test";
import assert from "node:assert/strict";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";
import { createProductClosureController } from "../src/product-closure.js";
import { productPublicationWriter, productRevision } from "../src/product-lineage.js";
import { listCausalLifecycleEvidence } from "../src/causal-provenance.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

test("Each accepted product/quality claim carries its exact supporting refs", async (t) => {
  const w = await newObserverWorld(t, "evidence");
  const { relRef, qaRef } = await seedEligibleProduct(w);
  const closed = await w.closureController.close({ projectionRef: (await w.projectionBuilder.build({ productId: "product-1", rootIntentRef: "intent:root-1" })).projectionRef });
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const facts = await w.observer.chainEvidence({ subject: current.subject });
  const byRef = new Map(facts.map((f) => [f.ref, f]));
  const releaseFact = byRef.get(relRef);
  assert.ok(releaseFact, "release fact is surfaced");
  assert.equal(releaseFact.factKind, "DEPLOYMENT_RELEASE");
  assert.ok(releaseFact.evidenceRefs.includes(relRef));
  assert.ok(releaseFact.evidenceRefs.includes(current.subject.historyCommitRef));
  const qualityFact = byRef.get(qaRef);
  assert.ok(qualityFact, "quality fact is surfaced");
  assert.equal(qualityFact.factKind, "QUALITY_ACCEPTANCE");
  assert.ok(qualityFact.evidenceRefs.includes(qaRef));
  const outcomeFact = facts.find((f) => f.factKind === "PRODUCT_OUTCOME_CLAIM");
  assert.ok(outcomeFact, "outcome fact is surfaced");
  assert.equal(outcomeFact.ref, closed.outcomeRef);
  assert.equal(outcomeFact.status, "CURRENT");
  assert.ok(outcomeFact.evidenceRefs.includes(closed.outcomeRef));
  // Every supporting ref resolves to durable bytes.
  for (const fact of facts) {
    for (const ref of fact.evidenceRefs) {
      if (ref === current.subject.historyCommitRef || ref === current.subject.projectionRef || ref === current.subject.policyRef) continue;
      const raw = await w.artifactStore.resolve(ref);
      assert.ok(raw, `evidence ref resolves: ${ref}`);
    }
  }
});

test("CURRENT chainEvidence excludes another product's lineage publications", async (t) => {
  const w = await newObserverWorld(t, "evidence-scope");
  await seedEligibleProduct(w);
  const own = productRevision({ kind: "SEMANTIC_CLAIM", projectId: "product-1", rootIntentId: "intent:root-1", domain: "SA", semanticKind: "architecture", subjectKey: "scoped", content: { rev: 1 } });
  const other = productRevision({ kind: "SEMANTIC_CLAIM", projectId: "product-2", rootIntentId: "intent:other", domain: "SA", semanticKind: "architecture", subjectKey: "foreign", content: { rev: 1 } });
  for (const [record, key] of [[own, "publication:scoped"], [other, "publication:foreign"]]) {
    const receiptRef = await w.artifactStore.put("domain-publication-receipt", {
      kind: "DOMAIN_PUBLICATION_RECEIPT", version: 1, publicationKey: key,
      completionDecisionRef: "decision:seed", publishedClaimRefs: [record.ref],
      publishedArtifactRefs: [], acceptedDerivationEdges: [], publicationStoreRevision: "rev:seed",
    });
    await productPublicationWriter(w.lineage)({ receiptRef, publicationKey: key, records: [record], edges: [], observations: [] });
  }
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [own.ref], authorityHeads: {} });
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const facts = await w.observer.chainEvidence({ subject: current.subject });
  const refs = facts.map((f) => f.ref);
  assert.ok(refs.includes(own.ref), "reachable publication records are reported");
  assert.ok(!refs.includes(other.ref), "another product's publication is never listed");
});

test("An injected closure clock appears verbatim as the ACCEPTED boundary timestamp", async (t) => {
  const w = await newObserverWorld(t, "evidence-clock");
  await seedEligibleProduct(w);
  const observedAt = "2026-08-01T00:00:00.000Z";
  const closing = createProductClosureController({
    projectionBuilder: w.projectionBuilder, productHistory: w.productHistory, acceptanceAuthority: w.acceptanceAuthority,
    artifactStore: w.artifactStore, outcomeHeadStore: w.outcomeHeadStore,
    mutationGuard: w.guard, causalSink: w.sink, causalNow: () => observedAt,
  });
  const built = await w.projectionBuilder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const closed = await closing.close({ projectionRef: built.projectionRef });
  const entries = await listCausalLifecycleEvidence({ artifactStore: w.artifactStore, evidenceHeadStore: w.evidenceHeadStore }, { workId: "product:product-1" });
  const accepted = entries.find((e) => e.evidence.eventKind === "ACCEPTED");
  assert.ok(accepted, "closure emitted ACCEPTED evidence through the real controller");
  assert.equal(accepted.evidence.observedAt, observedAt);
  assert.equal(accepted.evidence.boundaryRef, closed.outcomeRef);
});

test("Evidence follows the pinned subject, not newer live state", async (t) => {
  const w = await newObserverWorld(t, "evidence-pinned");
  await seedEligibleProduct(w);
  const before = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const factsBefore = await w.observer.chainEvidence({ subject: before.subject });
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  // The CURRENT subject is stale after Hn+1 and must be rejected, not mixed.
  await assert.rejects(w.reconstruction.chainEvidence({ subject: before.subject }), /newer head requires a new subject/);
  // The HISTORICAL pin replays exactly the facts bound at pin time.
  const factsPinned = await w.reconstruction.chainEvidence({ subject: { ...before.subject, mode: "HISTORICAL" } });
  const pinnedRefs = factsPinned.map((f) => f.ref).filter((r) => r != null).sort();
  assert.deepEqual(pinnedRefs, factsBefore.map((f) => f.ref).sort());
  assert.ok(!factsPinned.some((f) => f.ref === lateRef), "unpinned live refs never leak into pinned evidence");
});
