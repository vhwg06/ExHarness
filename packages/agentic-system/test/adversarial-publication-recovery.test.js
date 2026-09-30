// Adversarial publication recovery: kill after publication, duplicate
// recoverers over a committed publication, and downstream-continuation
// singularity (AC-2, AC-7). Barriers are explicit rendezvous only.
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionAttemptStatus } from "../src/index.js";
import {
  deferred,
  openExecutionCell,
  reopenExecutionCell,
  withScratch,
} from "./helpers/recovery-harness.js";

test("crash after publication before continuation reuses the committed publication without rerunning accepted work", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-pubrec-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { terminalCommits: true } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill after publication/);
  assert.equal(crashed.counts.lineagePublications, 1, "the crashed run committed its publication");
  assert.equal(crashed.counts.reconciliations, 1, "the crashed run derived its continuation once");
  const publicationsAfterCrash = Object.keys((await crashed.lineage.snapshot()).publications);
  assert.equal(publicationsAfterCrash.length, 1);

  const fresh = await reopenExecutionCell(dir, "w1");
  const recovered = await fresh.controller.execute(args);
  assert.equal(recovered.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(recovered.replayed, true, "recovery replays the committed publication instead of republishing");
  assert.equal(fresh.counts.recover, 0, "accepted domain work is not rerun after its publication committed");
  assert.equal(fresh.counts.dispatch, 0);
  const publicationsAfterRecovery = Object.keys((await fresh.lineage.snapshot()).publications);
  assert.deepEqual(publicationsAfterRecovery, publicationsAfterCrash, "restart reuses the publication, not a duplicate");
  const committed = await fresh.gate.resolveCommittedPublication({ publicationKey: publicationsAfterCrash[0] });
  assert.equal(committed.receiptRef, recovered.publicationReceiptRef, "terminal commit reuses the committed receipt");
  const packet = await fresh.resolveBundle(recovered);
  assert.equal(packet.publicationReceipt.publicationKey, publicationsAfterCrash[0]);
  assert.equal(packet.completionDecision.verdict, "ACCEPT");
  assert.equal((await fresh.lineage.assertCurrent(work.record.ref)).revisionRef, work.record.ref);
});

test("duplicate recoverers after a committed publication converge on the same receipt", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-pubdup-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { terminalCommits: true } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill after publication/);

  const workerA = await reopenExecutionCell(dir, "w1");
  const workerB = await reopenExecutionCell(dir, "w1");
  const [resultA, resultB] = await Promise.all([
    workerA.controller.execute(args),
    workerB.controller.execute(args),
  ]);
  assert.equal(resultA.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(resultB.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(resultA.executionAttemptId, resultB.executionAttemptId, "one logical attempt");
  assert.equal(resultA.publicationReceiptRef, resultB.publicationReceiptRef, "one committed publication");
  assert.equal(workerA.counts.recover + workerB.counts.recover, 0, "no duplicate semantic output is produced");
  assert.equal(
    Object.keys((await workerA.lineage.snapshot()).publications).length,
    1,
    "duplicate recoverers create no duplicate logical output",
  );
  await workerA.resolveBundle(resultA);
  await workerB.resolveBundle(resultB);
});

test("a late duplicate recovery reuses the committed terminal head without a second transition", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-publate-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { terminalCommits: true } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill after publication/);

  // Worker B enters recovery first and pauses at its downstream-continuation
  // step; worker A then runs to full TERMINAL; B resumes and must reuse the
  // committed terminal head instead of appending a second terminal transition.
  const arrived = deferred();
  const release = deferred();
  const workerB = await reopenExecutionCell(dir, "w1", {
    hooks: { reconcileWork: async () => { arrived.resolve(); await release.promise; } },
  });
  const workerA = await reopenExecutionCell(dir, "wA-late");
  const pendingB = workerB.controller.execute(args);
  await arrived.promise;
  const resultA = await workerA.controller.execute(args);
  assert.equal(resultA.state, ExecutionAttemptStatus.TERMINAL);
  release.resolve();
  const resultB = await pendingB;
  assert.equal(resultB.state, ExecutionAttemptStatus.TERMINAL);
  assert.equal(resultB.executionAttemptId, resultA.executionAttemptId);
  assert.equal(resultB.publicationReceiptRef, resultA.publicationReceiptRef);
  assert.equal(resultB.judgmentBundleRef, resultA.judgmentBundleRef, "late recovery reuses the committed terminal bundle");
  await workerB.resolveBundle(resultB);
});

test("restarted continuation stays idempotent: one lineage record set, no duplicate downstream effects", async (t) => {
  const dir = await withScratch(t, "exharness-bb057-continuation-");
  const crashed = await openExecutionCell(dir, "w1", { kill: { terminalCommits: true } });
  const work = await crashed.addWork({ key: "BA-1" });
  const args = { itemId: "BA-1", claimGeneration: 1, receiptRef: work.receiptRef };
  await assert.rejects(crashed.controller.execute(args), /simulated kill after publication/);

  for (let round = 0; round < 3; round += 1) {
    const worker = await reopenExecutionCell(dir, "w1");
    const result = await worker.controller.execute(args);
    assert.equal(result.state, ExecutionAttemptStatus.TERMINAL);
    assert.equal(result.publicationReceiptRef, (await worker.gate.resolveCommittedPublication({
      publicationKey: Object.keys((await worker.lineage.snapshot()).publications)[0],
    })).receiptRef);
  }
  const fresh = await reopenExecutionCell(dir, "w1");
  const snapshot = await fresh.lineage.snapshot();
  assert.equal(Object.keys(snapshot.publications).length, 1, "one downstream continuation, not one per restart");
  const publication = snapshot.publications[Object.keys(snapshot.publications)[0]];
  assert.deepEqual(publication.recordRefs, [work.record.ref], "the committed record set never duplicates");
  assert.equal(snapshot.heads[work.record.subjectKey].status, "ACTIVE");
});
