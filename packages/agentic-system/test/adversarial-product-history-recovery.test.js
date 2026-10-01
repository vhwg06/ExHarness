// Adversarial product-history recovery: authority ahead of the history head
// is NOT_READY until deterministic reconciliation, fresh processes rebuild
// the same verdict from durable refs alone, and reconciliation converges
// without mutating history (AC-9, INV-2, INV-7). No sleeps, no extra locks.
import test from "node:test";
import assert from "node:assert/strict";
import { openHistoryWorld, seedHistoryEligible } from "./helpers/recovery-history-world.js";

test("authority ahead of ProductHistoryHead is NOT_READY until deterministic reconciliation", async (t) => {
  const w = await openHistoryWorld(t);
  await seedHistoryEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(built.projection.readiness, "ELIGIBLE_FOR_CLOSURE");
  const closed = await w.closure.close({ projectionRef: built.projectionRef });
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");

  // Crash window: closure-relevant authority advanced to r2, history still Hn.
  await w.advanceAuthority({ release: "r2", quality: "q1" });
  await assert.rejects(w.history.current({ productId: "product-1" }), /drift|RECOVERY/i);
  await assert.rejects(w.history.readChain({ productId: "product-1" }), /drift|RECOVERY/i);
  await assert.rejects(w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" }), /drift|RECOVERY/i);
  const drifted = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(drifted.status, "NOT_READY");
  assert.equal(drifted.reason, "RECOVERY_REQUIRED");
  assert.equal(drifted.outcomeRef, closed.outcomeRef, "historical evidence is preserved, not rewritten");
  await assert.rejects(
    w.closure.close({ projectionRef: built.projectionRef }),
    /drift|RECOVERY|STALE/i,
    "no eligible closure is exposed before reconciliation",
  );

  // Wrong observations cannot reconcile; only the exact live heads append.
  await assert.rejects(
    w.history.reconcile({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [], authorityHeads: { release: "r1", quality: "q1" } }),
    /exact live/,
  );
  const reconciled = await w.history.reconcile({
    productId: "product-1",
    transitionKind: "RELEASE_PUBLICATION",
    transitionRefs: [],
    authorityHeads: { release: "r2", quality: "q1" },
  });
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.generation, 3);
  assert.equal((await w.history.current({ productId: "product-1" })).generation, 3);
  const after = await w.closure.currentOutcome({ productId: "product-1" });
  assert.equal(after.status, "HISTORICAL", "the pre-drift outcome never reads current after supersession");
  const rebuilt = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const reclosed = await w.closure.close({ projectionRef: rebuilt.projectionRef });
  assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
  assert.notEqual(reclosed.outcomeRef, closed.outcomeRef, "currentness moves by new transition, not mutation");
});

test("a fresh process reconstructs NOT_READY from durable refs alone", async (t) => {
  const w = await openHistoryWorld(t);
  await seedHistoryEligible(w);
  const built = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.closure.close({ projectionRef: built.projectionRef });
  await w.advanceAuthority({ release: "r2", quality: "q1" });

  // Brand-new controllers over the same durable directory: no shared memory.
  const fresh = await openHistoryWorld(t, w.dir);
  await assert.rejects(fresh.history.current({ productId: "product-1" }), /drift|RECOVERY/i);
  const drifted = await fresh.closure.currentOutcome({ productId: "product-1" });
  assert.equal(drifted.status, "NOT_READY");
  assert.equal(drifted.reason, "RECOVERY_REQUIRED");
  const reconciled = await fresh.history.reconcile({
    productId: "product-1",
    transitionKind: "RELEASE_PUBLICATION",
    transitionRefs: [],
    authorityHeads: { release: "r2", quality: "q1" },
  });
  assert.equal(reconciled.reconciled, true);
  assert.equal((await fresh.history.current({ productId: "product-1" })).generation, 3);
});

test("reconciliation converges when already current and historical bytes never change", async (t) => {
  const w = await openHistoryWorld(t);
  await seedHistoryEligible(w);
  const before = await w.history.current({ productId: "product-1" });
  const beforeBytes = await w.artifactStore.resolve(before.commitRef);
  await w.advanceAuthority({ release: "r2", quality: "q1" });
  const first = await w.history.reconcile({
    productId: "product-1",
    transitionKind: "RELEASE_PUBLICATION",
    transitionRefs: [],
    authorityHeads: { release: "r2", quality: "q1" },
  });
  assert.equal(first.reconciled, true);
  const again = await w.history.reconcile({
    productId: "product-1",
    transitionKind: "RELEASE_PUBLICATION",
    transitionRefs: [],
    authorityHeads: { release: "r2", quality: "q1" },
  });
  assert.equal(again.reconciled, false, "reconciliation converges when already current");
  assert.equal(again.generation, first.generation);
  assert.equal(again.commitRef, first.commitRef);
  assert.deepEqual(await w.artifactStore.resolve(before.commitRef), beforeBytes, "historical commits are immutable");
});
