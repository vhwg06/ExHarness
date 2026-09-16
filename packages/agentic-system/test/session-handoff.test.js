import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  UserIntentSource,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createSessionHandoffSurface,
  defineUserIntent,
  sessionHandoffFromBlackboard
} from "../src/index.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

async function withBoard(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-session-handoff-"));
  try {
    const path = join(directory, "blackboard.json");
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({
      store,
      reviewTrust: reviewTrustStub()
    });
    const handoff = createSessionHandoffSurface({ orchestrator });
    await run({ path, store, orchestrator, handoff });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function workItem(overrides = {}) {
  return {
    id: "BB-200",
    work: "Implement durable session handoff.",
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

const USER_INTENT = Object.freeze({
  id: "exharness-session-handoff",
  source: UserIntentSource.USER,
  objective: "Allow any fresh session to continue ExHarness work from the Blackboard.",
  bullets: [
    "Blackboard remains the canonical work tracker.",
    "Artifacts remain external and are carried by reference."
  ],
  constraints: [
    "Do not depend on previous conversation state."
  ]
});

test("user intent contract keeps user as the only semantic source", () => {
  assert.deepEqual(defineUserIntent({
    id: USER_INTENT.id,
    objective: USER_INTENT.objective,
    bullets: USER_INTENT.bullets,
    constraints: USER_INTENT.constraints
  }), USER_INTENT);

  assert.throws(
    () => defineUserIntent({ ...USER_INTENT, source: "PM" }),
    /userIntent.source must be USER/
  );
});

test("session handoff initializes durable user intent and exposes only runnable work as eligible", async () => {
  await withBoard(async ({ handoff }) => {
    const initialized = await handoff.initialize({
      userIntent: USER_INTENT,
      items: [
        workItem(),
        workItem({
          id: "BB-201",
          work: "Wait for an external prerequisite.",
          status: BlackboardStatus.BLOCKED,
          blockers: ["external prerequisite"]
        })
      ]
    });

    assert.deepEqual(initialized.intent, USER_INTENT);
    assert.equal(initialized.workGraph.length, 2);
    assert.deepEqual(initialized.lifecycle.eligibleWork.map((item) => item.id), ["BB-200"]);
    assert.deepEqual(initialized.lifecycle.blocked.map((item) => item.id), ["BB-201"]);
    assert.ok(initialized.workGraph.every((item) => item.dependsOn.includes(initialized.rootItemId)));
    assert.equal(initialized.workGraph.some((item) => item.id === initialized.rootItemId), false);
  });
});

test("a fresh process/session resumes pending work and artifact refs from Blackboard without conversation state", async () => {
  await withBoard(async ({ path, orchestrator, handoff }) => {
    await handoff.initialize({
      userIntent: USER_INTENT,
      items: [workItem()]
    });

    await orchestrator.claim({ itemId: "BB-200", owner: "session-a" });
    await orchestrator.submit({
      itemId: "BB-200",
      owner: "session-a",
      submission: {
        revision: "rev-session-a",
        artifactRefs: [
          { ref: "git://rev-session-a", path: "packages/agentic-system/src/session-handoff.js" }
        ],
        evidenceRefs: ["ci://session-a"]
      }
    });

    const sessionBOrchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    const sessionBHandoff = createSessionHandoffSurface({ orchestrator: sessionBOrchestrator });
    const resumed = await sessionBHandoff.read();

    assert.deepEqual(resumed.intent, USER_INTENT);
    assert.deepEqual(resumed.lifecycle.pendingReview.map((item) => item.id), ["BB-200"]);
    assert.deepEqual(resumed.references.artifacts, [
      { itemId: "BB-200", ref: "git://rev-session-a" }
    ]);
    assert.deepEqual(resumed.references.evidence, [
      { itemId: "BB-200", ref: "ci://session-a" }
    ]);
    assert.equal(resumed.lifecycle.pendingReview[0].submittedBy, "session-a");
    assert.equal(resumed.lifecycle.pendingReview[0].submission.revision, "rev-session-a");
  });
});

test("session handoff fails closed for a legacy Board that has no durable user-intent root", async () => {
  await withBoard(async ({ orchestrator, handoff }) => {
    await orchestrator.seed([workItem()]);

    await assert.rejects(
      () => handoff.read(),
      /session handoff requires exactly one durable user-intent root; found 0/
    );
  });
});

test("session handoff rejects work that cannot trace to the durable user intent", async () => {
  await withBoard(async ({ orchestrator, handoff }) => {
    await handoff.initialize({
      userIntent: USER_INTENT,
      items: [workItem()]
    });

    const board = structuredClone(await orchestrator.readBlackboard());
    board.items.push(workItem({
      id: "BB-rogue",
      work: "Unscoped work invented outside the user intent."
    }));

    assert.throws(
      () => sessionHandoffFromBlackboard(board),
      /Blackboard work item is not traceable to durable user intent/
    );
  });
});
