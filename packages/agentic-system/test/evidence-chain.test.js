import test from "node:test";
import assert from "node:assert/strict";
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

test("Evidence follows the pinned subject, not newer live state", async (t) => {
  const w = await newObserverWorld(t, "evidence-pinned");
  await seedEligibleProduct(w);
  const before = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const factsBefore = await w.observer.chainEvidence({ subject: before.subject });
  const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late", status: "ACTIVE" });
  await w.productHistory.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
  const factsPinned = await w.reconstruction.chainEvidence({ subject: before.subject });
  assert.deepEqual(factsPinned.map((f) => f.ref), factsBefore.map((f) => f.ref));
  assert.ok(!factsPinned.some((f) => f.ref === lateRef), "unpinned live refs never leak into pinned evidence");
});
