import test from "node:test";
import assert from "node:assert/strict";
import { NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT } from "../src/causal-reconstruction.js";
import { MISSING_PROVENANCE } from "../src/causal-provenance.js";
import { productPublicationWriter, productRevision } from "../src/product-lineage.js";
import { defineOrganizationWorkContract } from "../src/organization-work.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

function semanticRecord(subjectKey, productId = "product-1") {
  return productRevision({ kind: "SEMANTIC_CLAIM", projectId: productId, rootIntentId: "intent:root-1", domain: "SA", semanticKind: "architecture", subjectKey, content: { rev: subjectKey } });
}

async function publishLineage(w, record, key) {
  const receiptRef = await w.artifactStore.put("domain-publication-receipt", {
    kind: "DOMAIN_PUBLICATION_RECEIPT", version: 1, publicationKey: key,
    completionDecisionRef: "decision:seed", publishedClaimRefs: [record.ref],
    publishedArtifactRefs: [], acceptedDerivationEdges: [], publicationStoreRevision: "rev:seed",
  });
  await productPublicationWriter(w.lineage)({ receiptRef, publicationKey: key, records: [record], edges: [], observations: [] });
  return receiptRef;
}

test("HISTORICAL queries exclude newer board, lineage and outcome state", async (t) => {
  const w = await newObserverWorld(t, "historical-frozen");
  await seedEligibleProduct(w);
  // Lineage evidence before the pin: one record for this product (committed
  // to product history, so it is pinned-reachable) and one for another.
  const own = semanticRecord("pinned-design");
  const other = semanticRecord("other-design", "product-2");
  const ownReceipt = await publishLineage(w, own, "publication:pinned");
  await publishLineage(w, other, "publication:other");
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [own.ref], authorityHeads: {} });
  const pinned = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(pinned.readiness, "ELIGIBLE_FOR_CLOSURE");
  const closedOwn = await w.closureController.close({ projectionRef: pinned.subject.projectionRef });
  void closedOwn;
  // Newer live state after the pin: an eligible revision plus outcome, then a
  // blocker, a new board item and a newer lineage publication for this product.
  const later = semanticRecord("later-design");
  await publishLineage(w, later, "publication:later");
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [later.ref], authorityHeads: {} });
  const atHn1 = await w.projectionBuilder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const closedLater = await w.closureController.close({ projectionRef: atHn1.projectionRef });
  const blockingRef = await w.artifactStore.put("cross-domain-obligation", { kind: "CROSS_DOMAIN_OBLIGATION", version: 1, productId: "product-1", obligationKey: "design-1", status: "BLOCKING" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "OBLIGATION_TRANSITION", transitionRefs: [blockingRef], authorityHeads: {} });
  const newContract = defineOrganizationWorkContract({
    projectId: "product-1", rootItemId: "ROOT-1", rootIntentId: "intent:root-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + "b".repeat(64),
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: "implementation-input:seed", sliceId: "slice-1", obligationKey: "work-new",
    obligationSubjectKey: "obligation-subject-new", materializationKey: "materialization-new", boardItemId: "WORK-NEW",
    owningDomain: "SA", workloadType: "solution-design", summary: "Later work",
    dependencyIds: [], requiredArtifactRefs: [], expectedArtifactKind: "DESIGN_DOC",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design-v1"],
  });
  await w.organizationArtifactRegistry.putWorkContract(newContract);
  w.board.items.push({ id: "WORK-NEW", status: "READY", owner: null, claimGeneration: null, origin: { kind: "ORGANIZATION_MATERIALIZATION", workContractRef: newContract.contractRef, owningDomain: "SA", workloadType: "solution-design" } });

  const historicalSubject = { ...pinned.subject, mode: "HISTORICAL" };
  const historical = await w.observer.queryHistorical({ subject: historicalSubject });
  assert.equal(historical.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.deepEqual(historical.blockers, []);
  // Remaining work is live truth: the explicit marker, never the live board.
  assert.equal(historical.remainingWork.status, NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT);
  assert.deepEqual(historical.remainingWork.items, []);
  // Evidence holds the pinned publication only: no other-product records, no
  // later revision, and no newer closure outcome.
  const refs = historical.evidence.map((f) => f.ref);
  assert.ok(refs.includes(own.ref), "pinned publication record is reported");
  const ownFact = historical.evidence.find((f) => f.ref === own.ref);
  assert.equal(ownFact.publicationReceiptRef, ownReceipt);
  assert.ok(!refs.includes(other.ref), "another product's publication is excluded");
  assert.ok(!refs.includes(later.ref), "a newer live publication is excluded");
  assert.ok(!refs.includes(closedLater.outcomeRef), "the newer closure outcome is excluded");
  const outcomeFact = historical.evidence.find((f) => f.factKind === "PRODUCT_OUTCOME_CLAIM");
  assert.equal(outcomeFact.status, MISSING_PROVENANCE, "the outcome head moved on; history reports MISSING, not the live outcome");
  // The current query follows the newer canonical heads instead.
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(current.readiness, "NOT_READY");
  assert.ok(current.blockers.some((b) => b.ref === blockingRef));
});

test("A CURRENT subject used after the history head advanced is rejected", async (t) => {
  const w = await newObserverWorld(t, "historical-stale");
  await seedEligibleProduct(w);
  const pinned = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  await assert.rejects(w.observer.listRemainingWork({ subject: pinned.subject }), /newer head requires a new subject/);
  await assert.rejects(w.observer.traceObligation({ subject: pinned.subject, obligationSubjectKey: "cross-domain-obligation:absent" }), /newer head requires a new subject/);
  await assert.rejects(w.observer.chainEvidence({ subject: pinned.subject }), /newer head requires a new subject/);
  // A freshly pinned CURRENT subject works again.
  const fresh = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.ok(Array.isArray(fresh.remainingWork));
});

test("Historical queries stay pinned while current queries advance", async (t) => {
  const w = await newObserverWorld(t, "historical");
  await seedEligibleProduct(w);
  const atHn = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(atHn.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.deepEqual(atHn.blockers, []);
  // A newer closure-relevant transition lands.
  const blockingRef = await w.artifactStore.put("cross-domain-obligation", { kind: "CROSS_DOMAIN_OBLIGATION", version: 1, productId: "product-1", obligationKey: "design-1", status: "BLOCKING" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "OBLIGATION_TRANSITION", transitionRefs: [blockingRef], authorityHeads: {} });
  // The historical subject reconstructs the old truth verbatim.
  const historical = await w.observer.queryHistorical({ subject: { ...atHn.subject, mode: "HISTORICAL" } });
  assert.equal(historical.mode, "HISTORICAL");
  assert.equal(historical.readiness, "ELIGIBLE_FOR_CLOSURE");
  assert.deepEqual(historical.blockers, []);
  assert.deepEqual(historical.subject, { ...atHn.subject, mode: "HISTORICAL" });
  // The current query follows the newer canonical head.
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(current.mode, "CURRENT");
  assert.equal(current.readiness, "NOT_READY");
  assert.ok(current.blockers.some((b) => b.code === "BLOCKING_OBLIGATION" && b.ref === blockingRef));
  assert.notEqual(current.subject.historyCommitRef, atHn.subject.historyCommitRef);
});

test("Historical and current subjects cannot be silently mixed", async (t) => {
  const w = await newObserverWorld(t, "historical-mix");
  await seedEligibleProduct(w);
  const atHn = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const blockingRef = await w.artifactStore.put("cross-domain-obligation", { kind: "CROSS_DOMAIN_OBLIGATION", version: 1, productId: "product-1", obligationKey: "design-1", status: "BLOCKING" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "OBLIGATION_TRANSITION", transitionRefs: [blockingRef], authorityHeads: {} });
  const atHn1 = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // Mixing the old generation/digest with the newer commit ref is rejected.
  const mixed = { ...atHn.subject, mode: "HISTORICAL", historyCommitRef: atHn1.subject.historyCommitRef };
  await assert.rejects(w.observer.queryHistorical({ subject: mixed }), /generation mismatch|digest mismatch|drifted/i);
  // Mixing the newer generation with the old commit ref is rejected too.
  const mixedBack = { ...atHn1.subject, mode: "HISTORICAL", historyCommitRef: atHn.subject.historyCommitRef };
  await assert.rejects(w.observer.queryHistorical({ subject: mixedBack }), /generation mismatch|digest mismatch|drifted|not in the canonical chain/i);
});
