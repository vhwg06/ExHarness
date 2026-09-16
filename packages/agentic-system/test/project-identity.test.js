import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BlackboardStatus,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createSessionHandoffSurface,
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

function workItem() {
  return {
    id: "BB-PROJECT-1",
    work: "Continue one project safely across sessions.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

const USER_INTENT = Object.freeze({
  id: "shared-intent-id",
  objective: "Preserve project-scoped continuation.",
  bullets: ["Do not confuse one project Board with another."],
  constraints: ["Project identity is explicit rather than inferred from intent or path."]
});

async function withBoard(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-project-identity-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    await run({ path, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("project-bound session handoff persists and exposes explicit project identity", async () => {
  await withBoard(async ({ makeOrchestrator }) => {
    const orchestrator = makeOrchestrator();
    const handoff = createSessionHandoffSurface({
      orchestrator,
      projectId: "project-alpha"
    });

    const initialized = await handoff.initialize({
      userIntent: USER_INTENT,
      items: [workItem()]
    });

    assert.equal(initialized.projectId, "project-alpha");
    const board = await orchestrator.readBlackboard();
    const root = board.items.find((item) => item.origin?.kind === "USER_INTENT_ROOT");
    assert.equal(root.origin.projectId, "project-alpha");
    assert.equal(root.origin.userIntent.id, USER_INTENT.id);
    assert.equal(board.items.find((item) => item.id === "BB-PROJECT-1").origin.projectId, undefined);
  });
});

test("fresh session bound to the same project resumes the same Board", async () => {
  await withBoard(async ({ makeOrchestrator }) => {
    const sessionA = createSessionHandoffSurface({
      orchestrator: makeOrchestrator(),
      projectId: "project-alpha"
    });
    await sessionA.initialize({ userIntent: USER_INTENT, items: [workItem()] });

    const sessionB = createSessionHandoffSurface({
      orchestrator: makeOrchestrator(),
      projectId: "project-alpha"
    });
    const resumed = await sessionB.read();

    assert.equal(resumed.projectId, "project-alpha");
    assert.deepEqual(resumed.lifecycle.eligibleWork.map((item) => item.id), ["BB-PROJECT-1"]);
  });
});

test("fresh session fails closed when it expects another project", async () => {
  await withBoard(async ({ makeOrchestrator }) => {
    const sessionA = createSessionHandoffSurface({
      orchestrator: makeOrchestrator(),
      projectId: "project-alpha"
    });
    await sessionA.initialize({ userIntent: USER_INTENT, items: [workItem()] });

    const wrongProject = createSessionHandoffSurface({
      orchestrator: makeOrchestrator(),
      projectId: "project-beta"
    });

    await assert.rejects(
      () => wrongProject.read(),
      /session handoff project mismatch: expected project-beta; found project-alpha/
    );
  });
});

test("unbound legacy reader cannot silently open a project-bound Board", async () => {
  await withBoard(async ({ makeOrchestrator }) => {
    const projectBound = createSessionHandoffSurface({
      orchestrator: makeOrchestrator(),
      projectId: "project-alpha"
    });
    await projectBound.initialize({ userIntent: USER_INTENT, items: [workItem()] });

    const unbound = createSessionHandoffSurface({ orchestrator: makeOrchestrator() });
    await assert.rejects(
      () => unbound.read(),
      /session handoff project-bound Board requires expected projectId/
    );
  });
});

test("project-bound reader rejects a legacy Board with no project identity", async () => {
  await withBoard(async ({ makeOrchestrator }) => {
    const legacy = createSessionHandoffSurface({ orchestrator: makeOrchestrator() });
    await legacy.initialize({ userIntent: USER_INTENT, items: [workItem()] });
    const board = await makeOrchestrator().readBlackboard();

    assert.equal(sessionHandoffFromBlackboard(board).projectId, null);
    assert.throws(
      () => sessionHandoffFromBlackboard(board, { projectId: "project-alpha" }),
      /user-intent root projectId must be a non-empty string/
    );
  });
});
