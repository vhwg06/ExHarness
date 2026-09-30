// Adversarial execution recovery: kill before publication, stale-generation
// fencing, duplicate convergence and no second semantic attempt (AC-1, AC-3,
// AC-7, AC-8). Every barrier is an explicit rendezvous; no sleeps, no
// test-only locks around production commits.
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionAttemptStatus } from "../src/index.js";
import {
  openClaimCell,
  openExecutionCell,
  reopenExecutionCell,
  rendezvous,
  withScratch,
} from "./helpers/recovery-harness.js";

test("crash after domain output before publication reuses the same semantic attempt and binding and publishes at most once", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-execution-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { beforePublicationCommits: 1 } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill after domain output/);
  const headAfterCrash = await crashed.readAttemptHead(work.contract);
  assert.equal(headAfterCrash.value.status, ExecutionAttemptStatus.ACTIVE, "killed run leaves the attempt durable but unterminated");
  // Fresh process: new controllers over the same durable files, no shared memory.
  const fresh = await reopenExecutionCell(dir, "w1");
  const recovered = await fresh.controller.execute(args);
  assert.equal(recovered.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(recovered.executionAttemptId, headAfterCrash.value.executionAttemptId, "recovery reuses the same semantic attempt");
  assert.equal(recovered.bindingRef, headAfterCrash.value.bindingRef, "recovery reuses the immutable binding");
  assert.equal(crashed.counts.dispatch, 1, "crashed run dispatched once before the kill");
  assert.equal(crashed.counts.lineagePublications, 0, "killed run committed no publication");
  assert.equal(fresh.counts.recover, 1, "fresh recovery reuses the attempt through recover, not a new dispatch");
  assert.equal(fresh.counts.lineagePublications, 1, "recovery publishes exactly once");
  assert.equal(
    Object.keys((await fresh.lineage.snapshot()).publications).length,
    1,
    "at most one canonical publication exists after kill plus recovery",
  );
  const packet = await fresh.resolveBundle(recovered);
  assert.equal(packet.binding.executionAttemptId, recovered.executionAttemptId);
  assert.ok(packet.publicationReceipt, "recovery commits a publication receipt");
  const storedReceipt = await fresh.domain.resolveDomainPublicationReceipt(recovered.publicationReceiptRef);
  assert.equal(storedReceipt.publicationKey, packet.publicationReceipt.publicationKey);
  assert.deepEqual(storedReceipt.publishedClaimRefs, [work.record.ref], "the recovered output record is the published claim");
  assert.equal((await fresh.lineage.assertCurrent(work.record.ref)).revisionRef, work.record.ref);
});

test("recover and repair of the same semantic work cannot mint a second semantic attempt", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-no-second-attempt-");
  const cell = await openExecutionCell(dir, "w1");
  const work = await cell.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  const first = await cell.controller.execute(args);
  const replay = await cell.controller.execute(args);
  assert.equal(first.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(replay.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(replay.executionAttemptId, first.executionAttemptId, "terminal replay reuses the attempt");
  assert.equal(replay.bindingRef, first.bindingRef, "terminal replay reuses the immutable binding");
  assert.equal(cell.counts.dispatch, 1, "no second semantic attempt was dispatched");
  // Same-work repair after an interrupted run keeps the one attempt/binding.
  const dir2 = await withScratch(t, "exharness-bb057-repair-");
  const interrupted = await openExecutionCell(dir2, "w1", { kill: { beforePublicationCommits: 1 } });
  const work2 = await interrupted.addWork({ key: "BA-1" });
  const args2 = { itemId: "BA-1", claimGeneration: 1, receiptRef: work2.receiptRef };
  await assert.rejects(interrupted.controller.execute(args2), /simulated kill/);
  const fresh = await reopenExecutionCell(dir2, "w1");
  const repaired = await fresh.controller.execute(args2);
  const rerepaired = await fresh.controller.execute(args2);
  assert.equal(repaired.executionAttemptId, rerepaired.executionAttemptId);
  assert.equal(repaired.bindingRef, rerepaired.bindingRef);
  const heads = await fresh.lineage.snapshot();
  assert.equal(Object.keys(heads.publications).length, 1);
  const binding = await fresh.domain.resolveExecutionAttemptBinding(repaired.bindingRef);
  assert.equal(binding.executionAttemptId, repaired.executionAttemptId);
  assert.equal(binding.workContractRef, work2.contract.contractRef, "binding still pins the original work");
});

test("duplicate recovery workers converge on one attempt publication and continuation", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-duplicate-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { beforePublicationCommits: 1 } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill/);

  // Force true overlap: both fresh workers must enter recovery before either
  // proceeds. The production attempt CAS and publication key decide the
  // winner; the barrier only guarantees the race happens.
  const gate = rendezvous(2);
  const hooks = { beforeRuntime: async () => { gate.arrive(); await gate.released; } };
  const workerA = await reopenExecutionCell(dir, "w1", { hooks });
  const workerB = await reopenExecutionCell(dir, "w1", { hooks });
  const [resultA, resultB] = await Promise.all([
    workerA.controller.execute(args),
    workerB.controller.execute(args),
  ]);
  assert.equal(resultA.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(resultB.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(resultA.executionAttemptId, resultB.executionAttemptId, "one logical attempt");
  assert.equal(resultA.bindingRef, resultB.bindingRef, "one immutable binding");
  assert.equal(resultA.publicationReceiptRef, resultB.publicationReceiptRef, "one canonical publication");
  const convergedReceipt = await workerA.domain.resolveDomainPublicationReceipt(resultA.publicationReceiptRef);
  assert.deepEqual(convergedReceipt.publishedClaimRefs, [work.record.ref]);
  assert.equal((await workerA.lineage.assertCurrent(work.record.ref)).revisionRef, work.record.ref);
  assert.equal(
    Object.keys((await workerA.lineage.snapshot()).publications).length,
    1,
    "duplicate recoverers create no duplicate logical output",
  );
});

test("stale claim generation cannot dispatch or publish after takeover", async (t) => {
  const cell = await openClaimCell(t);
  const work = await cell.addWork({ key: "be-api" });
  const claimed = await cell.claimController.claim({ itemId: work.item.id, principalContext: cell.principalContext });
  assert.equal(claimed.item.claimGeneration, 1);
  const stale = await cell.claimController.release({
    itemId: work.item.id,
    claimGeneration: 1,
    principalContext: cell.principalContext,
  });
  assert.ok(stale.receiptRef, "generation-1 release receipt exists");
  const taken = await cell.claimController.recoverClaim({
    itemId: work.item.id,
    principalContext: cell.principalContext,
    reason: "takeover after worker loss",
  });
  assert.equal(taken.item.claimGeneration, 2, "takeover advances the claim generation");

  await assert.rejects(
    cell.executionController.execute({ itemId: work.item.id, claimGeneration: 1, receiptRef: stale.receiptRef }),
    /./,
    "stale generation must be fenced before dispatch",
  );
  assert.equal(cell.counts.dispatches, 0, "stale worker dispatched nothing");
  await assert.rejects(
    cell.claimController.assertExecutable({ itemId: work.item.id, claimGeneration: 1, receiptRef: stale.receiptRef }),
    /./,
    "stale generation must fail the execution-entry check",
  );
  await assert.rejects(
    cell.claimController.withExecutablePublicationGuard(
      { itemId: work.item.id, claimGeneration: 1, receiptRef: stale.receiptRef },
      async () => {},
    ),
    /./,
    "stale generation must be fenced before publication",
  );
  // The new generation is unaffected: it can still release and execute.
  const current = await cell.claimController.release({
    itemId: work.item.id,
    claimGeneration: 2,
    principalContext: cell.principalContext,
  });
  const executed = await cell.executionController.execute({
    itemId: work.item.id,
    claimGeneration: 2,
    receiptRef: current.receiptRef,
  });
  assert.equal(executed.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(cell.counts.dispatches, 1, "only the current generation dispatched");
});
