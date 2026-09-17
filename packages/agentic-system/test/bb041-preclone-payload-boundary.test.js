import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  createApplicationOrchestrator,
  createJsonBlackboardStore
} from "../src/index.js";

function reviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function workItem(overrides = {}) {
  return {
    id: "BB-041-PRECLONE",
    work: "Reject lossy persisted payloads before normalization clones can erase them.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    ...overrides
  };
}

function hiddenPayload() {
  const value = { visible: "preserved" };
  Object.defineProperty(value, "hidden", {
    value: "must-not-disappear",
    enumerable: false,
    configurable: true,
    writable: true
  });
  return value;
}

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb041-preclone-"));
  try {
    await run(join(directory, "blackboard.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-041 seed rejects hidden origin data before item normalization can erase it", async () => {
  await withStore(async (path) => {
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });

    await assert.rejects(
      () => orchestrator.seed([workItem({ origin: hiddenPayload() })]),
      /items\[0\]\.origin\.hidden: non-enumerable properties are not preserved/
    );
    assert.deepEqual((await store.load()).items, []);
  });
});

test("BB-041 submit rejects hidden submission data while preserving the active claim", async () => {
  await withStore(async (path) => {
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });
    await orchestrator.seed([workItem()]);
    const claimed = await orchestrator.claim({ itemId: "BB-041-PRECLONE", owner: "session-1" });

    await assert.rejects(
      () => orchestrator.submit({
        itemId: "BB-041-PRECLONE",
        owner: "session-1",
        generation: claimed.result.claimGeneration,
        submission: hiddenPayload()
      }),
      /submission\.hidden: non-enumerable properties are not preserved/
    );

    const item = (await orchestrator.readBlackboard()).items[0];
    assert.equal(item.status, BlackboardStatus.CLAIMED);
    assert.equal(item.owner, "session-1");
    assert.equal(item.submission, null);
  });
});
