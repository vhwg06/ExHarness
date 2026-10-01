import test from "node:test";
import assert from "node:assert/strict";
import { createFeedbackController } from "../src/feedback-controller.js";
import {
  FeedbackDisposition,
  FeedbackOutcomeValue,
  feedbackResponseIdFor,
} from "../src/feedback-contracts.js";

const D = "a".repeat(64);
const E = "b".repeat(64);
const F = "c".repeat(64);
const EPISODE_REF = `episode:sha256:${D}`;
const EVIDENCE_REF = `experiment:sha256:${E}`;
const EVIDENCE_REF_2 = `experiment:sha256:${F}`;

const appPrincipal = (id = "app-controller-1") => ({ id, role: "application" });

function makeController(clock) {
  return createFeedbackController(clock ? { clock } : {});
}

function createArgs(overrides = {}) {
  return {
    episodeRef: EPISODE_REF,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.ACTED,
    rationale: "acting on the finding with fresh evidence",
    ...overrides,
  };
}

function tickingClock() {
  let n = 0;
  return () => `2026-10-01T22:00:${String(n++).padStart(2, "0")}Z`;
}

function journalTypes(controller) {
  return controller.getJournal().map((e) => e.type);
}

test("createResponse creates a frozen revision-1 response and stores it", () => {
  const controller = makeController(tickingClock());
  const response = controller.createResponse(createArgs());
  assert.equal(response.revision, 1);
  assert.equal(response.episodeRef, EPISODE_REF);
  assert.equal(response.disposition, FeedbackDisposition.ACTED);
  assert.deepEqual(response.principal, { id: "app-controller-1", role: "application" });
  assert.ok(Object.isFrozen(response));
  const id = feedbackResponseIdFor(response);
  assert.deepEqual(controller.getResponse(id), response);
  assert.deepEqual(journalTypes(controller), ["response.created"]);
  const [entry] = controller.getJournal();
  assert.equal(entry.seq, 0);
  assert.equal(entry.at, "2026-10-01T22:00:00Z");
  assert.equal(entry.payload.responseId, id);
  assert.equal(entry.payload.revision, 1);
});

test("createResponse rejects evaluator/observer/provider/gepa/model principals", () => {
  for (const role of ["evaluator", "observer", "provider", "gepa", "model", "MODEL"]) {
    const controller = makeController();
    assert.throws(
      () => controller.createResponse(createArgs({ principal: { id: `${role}-x`, role } })),
      TypeError,
      `role ${role} must be rejected`,
    );
    assert.equal(controller.getJournal().length, 0);
    assert.equal(controller.listResponses().length, 0);
  }
});

test("createResponse rejects a missing principal and a duplicate create", () => {
  const controller = makeController();
  assert.throws(() => controller.createResponse(createArgs({ principal: undefined })), TypeError);
  controller.createResponse(createArgs());
  assert.throws(
    () => controller.createResponse(createArgs()),
    /FEEDBACK_CONTROLLER_INVALID: response already exists/,
  );
  assert.equal(controller.getJournal().length, 1);
});

test("reviseResponse with the current expectedRevision creates the next revision", () => {
  const controller = makeController(tickingClock());
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  const rev2 = controller.reviseResponse({
    responseId: rev1Id,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.DEFERRED,
    rationale: "deferring pending more evidence",
    expectedRevision: 1,
  });
  assert.equal(rev2.revision, 2);
  assert.equal(rev2.disposition, FeedbackDisposition.DEFERRED);
  assert.equal(rev2.episodeRef, EPISODE_REF);
  assert.ok(Object.isFrozen(rev2));
  assert.deepEqual(controller.getResponse(rev1Id), rev2);
  assert.deepEqual(controller.getResponse(feedbackResponseIdFor(rev2)), rev2);
  assert.deepEqual(journalTypes(controller), ["response.created", "response.revised"]);
  const revised = controller.getJournal()[1];
  assert.equal(revised.payload.priorResponseId, rev1Id);
  assert.equal(revised.payload.expectedRevision, 1);
});

test("revisions increment by exactly one across multiple revises", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  let current = rev1;
  for (const expected of [1, 2, 3, 4]) {
    current = controller.reviseResponse({
      responseId: feedbackResponseIdFor(current),
      principal: appPrincipal(),
      disposition: FeedbackDisposition.SUPERSEDED,
      rationale: `revise ${expected}`,
      expectedRevision: expected,
    });
    assert.equal(current.revision, expected + 1);
  }
  assert.equal(controller.getResponse(feedbackResponseIdFor(rev1)).revision, 5);
});

test("reviseResponse rejects non-application principals", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  for (const role of ["evaluator", "observer", "provider", "gepa", "model"]) {
    assert.throws(
      () =>
        controller.reviseResponse({
          responseId: rev1Id,
          principal: { id: `${role}-x`, role },
          disposition: FeedbackDisposition.REJECTED,
          rationale: "forged revise",
          expectedRevision: 1,
        }),
      TypeError,
      `role ${role} must be rejected on revise`,
    );
  }
  assert.equal(controller.getResponse(rev1Id).revision, 1);
  assert.deepEqual(journalTypes(controller), ["response.created"]);
});

test("stale expectedRevision fails and leaves the current revision unchanged", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  controller.reviseResponse({
    responseId: rev1Id,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.DEFERRED,
    rationale: "first revise",
    expectedRevision: 1,
  });
  assert.throws(
    () =>
      controller.reviseResponse({
        responseId: rev1Id,
        principal: appPrincipal(),
        disposition: FeedbackDisposition.ACTED,
        rationale: "stale attempt",
        expectedRevision: 1,
      }),
    /FEEDBACK_CONTROLLER_INVALID: stale expectedRevision 1; current revision is 2/,
  );
  assert.equal(controller.getResponse(rev1Id).revision, 2);
  assert.equal(journalTypes(controller).filter((t) => t === "response.revised").length, 1);
});

test("replaying revise with the same expectedRevision twice: second fails, no duplicate mutation", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  const reviseOnce = () =>
    controller.reviseResponse({
      responseId: rev1Id,
      principal: appPrincipal(),
      disposition: FeedbackDisposition.REJECTED,
      rationale: "rejecting",
      expectedRevision: 1,
    });
  const rev2 = reviseOnce();
  assert.equal(rev2.revision, 2);
  assert.throws(reviseOnce, /FEEDBACK_CONTROLLER_INVALID: stale expectedRevision/);
  assert.equal(controller.getResponse(rev1Id).revision, 2);
  assert.equal(journalTypes(controller).filter((t) => t === "response.revised").length, 1);
  assert.equal(controller.listResponses().length, 1);
});

test("reviseResponse rejects non-positive-integer expectedRevision", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  for (const bad of [0, -1, 1.5, "1", undefined]) {
    assert.throws(
      () =>
        controller.reviseResponse({
          responseId: rev1Id,
          principal: appPrincipal(),
          disposition: FeedbackDisposition.ACTED,
          rationale: "bad expected",
          expectedRevision: bad,
        }),
      /FEEDBACK_CONTROLLER_INVALID: expectedRevision must be a positive integer/,
    );
  }
  assert.equal(controller.getResponse(rev1Id).revision, 1);
});

test("recoverResponse is idempotent: identical result, exactly one recovery entry", () => {
  const controller = makeController(tickingClock());
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  controller.reviseResponse({
    responseId: rev1Id,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.DEFERRED,
    rationale: "deferring",
    expectedRevision: 1,
  });
  const first = controller.recoverResponse({ responseId: rev1Id });
  const second = controller.recoverResponse({ responseId: rev1Id });
  assert.deepEqual(first, second);
  assert.equal(first.revision, 2);
  assert.deepEqual(first, controller.getResponse(rev1Id));
  const recovered = controller.getJournal().filter((e) => e.type === "response.recovered");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].payload.revision, 2);
  // Recovery is not a mutation: no new response.revised/response.created entries.
  assert.deepEqual(journalTypes(controller), ["response.created", "response.revised", "response.recovered"]);
});

test("recoverResponse on an older revision id returns the current revision", () => {
  const controller = makeController();
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  const rev2 = controller.reviseResponse({
    responseId: rev1Id,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.ACTED,
    rationale: "acting",
    expectedRevision: 1,
  });
  assert.deepEqual(controller.recoverResponse({ responseId: rev1Id }), rev2);
});

test("recordOutcome IMPROVED with evidence binds the latest revision", () => {
  const controller = makeController(tickingClock());
  const rev1 = controller.createResponse(createArgs());
  const rev1Id = feedbackResponseIdFor(rev1);
  const rev2 = controller.reviseResponse({
    responseId: rev1Id,
    principal: appPrincipal(),
    disposition: FeedbackDisposition.ACTED,
    rationale: "acting",
    expectedRevision: 1,
  });
  const outcome = controller.recordOutcome({
    responseId: rev1Id,
    outcome: FeedbackOutcomeValue.IMPROVED,
    evidenceRef: EVIDENCE_REF,
  });
  assert.equal(outcome.outcome, FeedbackOutcomeValue.IMPROVED);
  assert.equal(outcome.evidenceRef, EVIDENCE_REF);
  assert.equal(outcome.responseRef, feedbackResponseIdFor(rev2));
  assert.equal(outcome.measuredAt, "2026-10-01T22:00:02Z");
  assert.ok(Object.isFrozen(outcome));
  assert.deepEqual(controller.getOutcome(rev1Id), outcome);
  assert.deepEqual(journalTypes(controller), [
    "response.created",
    "response.revised",
    "outcome.recorded",
  ]);
});

test("recordOutcome IMPROVED/NO_CHANGE/REGRESSED without evidenceRef throws", () => {
  for (const outcome of [
    FeedbackOutcomeValue.IMPROVED,
    FeedbackOutcomeValue.NO_CHANGE,
    FeedbackOutcomeValue.REGRESSED,
  ]) {
    const controller = makeController();
    const response = controller.createResponse(createArgs());
    assert.throws(
      () => controller.recordOutcome({ responseId: feedbackResponseIdFor(response), outcome }),
      TypeError,
      `${outcome} without evidence must fail`,
    );
    assert.equal(controller.getOutcome(feedbackResponseIdFor(response)), null);
    assert.ok(!journalTypes(controller).includes("outcome.recorded"));
  }
});

test("recordOutcome UNKNOWN without evidenceRef is allowed and keeps evidenceRef null", () => {
  const controller = makeController();
  const response = controller.createResponse(createArgs());
  const outcome = controller.recordOutcome({
    responseId: feedbackResponseIdFor(response),
    outcome: FeedbackOutcomeValue.UNKNOWN,
  });
  assert.equal(outcome.outcome, FeedbackOutcomeValue.UNKNOWN);
  assert.equal(outcome.evidenceRef, null);
  assert.deepEqual(controller.getOutcome(feedbackResponseIdFor(response)), outcome);
});

test("recordOutcome never coerces a missing outcome to UNKNOWN", () => {
  const controller = makeController();
  const response = controller.createResponse(createArgs());
  assert.throws(
    () =>
      controller.recordOutcome({
        responseId: feedbackResponseIdFor(response),
        evidenceRef: EVIDENCE_REF,
      }),
    /FEEDBACK_CONTROLLER_INVALID: outcome must be one of/,
  );
});

test("getOutcome returns the latest recorded outcome", () => {
  const controller = makeController();
  const response = controller.createResponse(createArgs());
  const id = feedbackResponseIdFor(response);
  assert.equal(controller.getOutcome(id), null);
  controller.recordOutcome({ responseId: id, outcome: FeedbackOutcomeValue.UNKNOWN });
  const improved = controller.recordOutcome({
    responseId: id,
    outcome: FeedbackOutcomeValue.IMPROVED,
    evidenceRef: EVIDENCE_REF,
  });
  assert.deepEqual(controller.getOutcome(id), improved);
  const noChange = controller.recordOutcome({
    responseId: id,
    outcome: FeedbackOutcomeValue.NO_CHANGE,
    evidenceRef: EVIDENCE_REF_2,
  });
  assert.deepEqual(controller.getOutcome(id), noChange);
});

test("listResponses returns frozen current revisions for every lineage", () => {
  const controller = makeController();
  const a = controller.createResponse(createArgs());
  const b = controller.createResponse(
    createArgs({ principal: appPrincipal("app-controller-2"), disposition: FeedbackDisposition.REJECTED }),
  );
  controller.reviseResponse({
    responseId: feedbackResponseIdFor(a),
    principal: appPrincipal(),
    disposition: FeedbackDisposition.DEFERRED,
    rationale: "deferring a",
    expectedRevision: 1,
  });
  const listed = controller.listResponses();
  assert.equal(listed.length, 2);
  assert.ok(Object.isFrozen(listed));
  const revisions = listed.map((r) => r.revision).sort();
  assert.deepEqual(revisions, [1, 2]);
  assert.ok(listed.every((r) => Object.isFrozen(r)));
  const bId = feedbackResponseIdFor(b);
  assert.ok(listed.some((r) => feedbackResponseIdFor(r) === bId));
});

test("unknown responseId fails on every lookup and mutation", () => {
  const controller = makeController();
  const unknown = `feedback-response:sha256:${"0".repeat(64)}`;
  assert.throws(() => controller.getResponse(unknown), /FEEDBACK_CONTROLLER_INVALID: unknown responseId/);
  assert.throws(() => controller.getOutcome(unknown), /FEEDBACK_CONTROLLER_INVALID: unknown responseId/);
  assert.throws(() => controller.recoverResponse({ responseId: unknown }), /unknown responseId/);
  assert.throws(
    () =>
      controller.reviseResponse({
        responseId: unknown,
        principal: appPrincipal(),
        disposition: FeedbackDisposition.ACTED,
        rationale: "x",
        expectedRevision: 1,
      }),
    /unknown responseId/,
  );
  assert.throws(
    () =>
      controller.recordOutcome({
        responseId: unknown,
        outcome: FeedbackOutcomeValue.UNKNOWN,
      }),
    /unknown responseId/,
  );
});

test("journal is an append-only frozen sequence with the injected clock", () => {
  const controller = makeController(tickingClock());
  const response = controller.createResponse(createArgs());
  const id = feedbackResponseIdFor(response);
  controller.recoverResponse({ responseId: id });
  const journal = controller.getJournal();
  assert.ok(Object.isFrozen(journal));
  assert.ok(journal.every((e) => Object.isFrozen(e)));
  assert.deepEqual(
    journal.map((e) => e.seq),
    [0, 1],
  );
  assert.deepEqual(
    journal.map((e) => e.at),
    ["2026-10-01T22:00:00Z", "2026-10-01T22:00:01Z"],
  );
  assert.throws(() => journal.push({}), TypeError);
});

test("createFeedbackController rejects a non-function clock", () => {
  assert.throws(
    () => createFeedbackController({ clock: "not-a-clock" }),
    /FEEDBACK_CONTROLLER_INVALID: clock must be a function/,
  );
});
