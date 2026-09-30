// End-to-end adversarial recovery matrix: crash windows, duplicate
// recovery, stale fencing and history drift composed in one run while
// unaffected work continues, everything reconstructs from durable stores,
// and no central scheduler or global reset exists (AC-1..AC-10, INV-1,
// INV-2). Barriers are explicit rendezvous only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExecutionAttemptStatus } from "../src/index.js";
import {
  assertNoCentralRecoveryAuthority,
  openClaimCell,
  openExecutionCell,
  reopenExecutionCell,
  rendezvous,
  withScratch,
} from "./helpers/recovery-harness.js";

test("recovery matrix stays local: failures recover, unaffected work continues, fresh processes rebuild the same truth", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-e2e-");
  const productDir = join(dir, "product");
  await mkdir(productDir, { recursive: true });

  // --- Execution domain: victim A crashes before publication, B is unaffected.
  const cell = await openExecutionCell(dir, "wA", { kill: { beforePublicationCommits: 1 } });
  const workA = await cell.addWork({ key: "BA-A" });
  const workB = await cell.addWork({ key: "BA-B" });
  const argsA = { itemId: "BA-A", claimGeneration: 1, receiptRef: workA.receiptRef };
  const argsB = { itemId: "BA-B", claimGeneration: 1, receiptRef: workB.receiptRef };
  await assert.rejects(cell.controller.execute(argsA), /simulated kill after domain output/);
  assert.equal((await cell.readAttemptHead(workA.contract)).value.status, ExecutionAttemptStatus.ACTIVE);

  // Unaffected work continues with no global reset and no manual ordering.
  const doneB = await cell.controller.execute(argsB);
  assert.equal(doneB.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal((await cell.readAttemptHead(workA.contract)).value.status, ExecutionAttemptStatus.ACTIVE, "B's success does not disturb A's recovery state");

  // Duplicate fresh-process recovery converges on A's one attempt/publication.
  const gate = rendezvous(2);
  const hooks = { beforeRuntime: async () => { gate.arrive(); await gate.released; } };
  const workerA1 = await reopenExecutionCell(dir, "wA", { hooks });
  const workerA2 = await reopenExecutionCell(dir, "wA", { hooks });
  const [recoveredA1, recoveredA2] = await Promise.all([
    workerA1.controller.execute(argsA),
    workerA2.controller.execute(argsA),
  ]);
  assert.equal(recoveredA1.executionAttemptId, recoveredA2.executionAttemptId);
  assert.equal(recoveredA1.bindingRef, recoveredA2.bindingRef);
  assert.equal(recoveredA1.publicationReceiptRef, recoveredA2.publicationReceiptRef);
  const publications = Object.keys((await workerA1.lineage.snapshot()).publications);
  assert.equal(publications.length, 2, "exactly one publication per logical work item (A and B), no duplicates");
  assert.equal((await workerA1.lineage.assertCurrent(workA.record.ref)).revisionRef, workA.record.ref);
  assert.equal((await workerA1.lineage.assertCurrent(workB.record.ref)).revisionRef, workB.record.ref);

  // Fresh processes rebuild the same truth from durable refs only.
  const fresh = await reopenExecutionCell(dir, "wA");
  const replayA = await fresh.controller.execute(argsA);
  const replayB = await fresh.controller.execute(argsB);
  assert.equal(replayA.executionAttemptId, recoveredA1.executionAttemptId, "same semantic attempt after restart");
  assert.equal(replayA.bindingRef, recoveredA1.bindingRef, "same immutable binding after restart");
  assert.equal(replayB.executionAttemptId, doneB.executionAttemptId);
  assert.equal(fresh.counts.dispatch + fresh.counts.recover, 0, "reconstruction performs no new semantic work");
  assert.equal(Object.keys((await fresh.lineage.snapshot()).publications).length, 2);

  // --- Claim domain: takeover fences the stale worker, the new generation proceeds.
  const claimCell = await openClaimCell(t, "exharness-bb057-e2e-claim-");
  const workC = await claimCell.addWork({ key: "be-c" });
  await claimCell.claimController.claim({ itemId: workC.item.id, principalContext: claimCell.principalContext });
  const staleC = await claimCell.claimController.release({ itemId: workC.item.id, claimGeneration: 1, principalContext: claimCell.principalContext });
  await claimCell.claimController.recoverClaim({ itemId: workC.item.id, principalContext: claimCell.principalContext, reason: "e2e takeover" });
  await assert.rejects(
    claimCell.executionController.execute({ itemId: workC.item.id, claimGeneration: 1, receiptRef: staleC.receiptRef }),
    /./,
    "stale generation fenced inside the matrix run",
  );
  assert.equal(claimCell.counts.dispatches, 0);
  const currentC = await claimCell.claimController.release({ itemId: workC.item.id, claimGeneration: 2, principalContext: claimCell.principalContext });
  const doneC = await claimCell.executionController.execute({ itemId: workC.item.id, claimGeneration: 2, receiptRef: currentC.receiptRef });
  assert.equal(doneC.state, ExecutionAttemptStatus.TERMINAL);

  // --- Product domain: authority drift is NOT_READY until local reconciliation.
  const { openHistoryWorld, seedHistoryEligible } = await import("./helpers/recovery-history-world.js");
  const historyWorld = await openHistoryWorld(t, productDir);
  await seedHistoryEligible(historyWorld);
  const projected = await historyWorld.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await historyWorld.closure.close({ projectionRef: projected.projectionRef });
  await historyWorld.advanceAuthority({ release: "r2", quality: "q1" });
  const drifted = await historyWorld.closure.currentOutcome({ productId: "product-1" });
  assert.equal(drifted.status, "NOT_READY");
  assert.equal(drifted.reason, "RECOVERY_REQUIRED");
  const reconciled = await historyWorld.history.reconcile({
    productId: "product-1",
    transitionKind: "RELEASE_PUBLICATION",
    transitionRefs: [],
    authorityHeads: { release: "r2", quality: "q1" },
  });
  assert.equal(reconciled.reconciled, true);
  const rebuilt = await historyWorld.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await historyWorld.closure.close({ projectionRef: rebuilt.projectionRef });
  assert.equal((await historyWorld.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");

  // --- No central recovery/scheduling authority anywhere in the loop.
  assertNoCentralRecoveryAuthority({
    claimController: claimCell.claimController,
    executionController: claimCell.executionController,
    recoveryExecutionController: fresh.controller,
    lineage: fresh.lineage,
    publicationGate: fresh.gate,
    productHistory: historyWorld.history,
    projectionBuilder: historyWorld.builder,
    closure: historyWorld.closure,
  });
});
