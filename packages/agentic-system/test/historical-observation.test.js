import test from "node:test";
import assert from "node:assert/strict";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

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
