import {
  FEEDBACK_RESPONSE_KIND,
  FEEDBACK_RESPONSE_VERSION,
  FEEDBACK_OUTCOME_KIND,
  FEEDBACK_OUTCOME_VERSION,
  FeedbackDisposition,
  FeedbackOutcomeValue,
  defineFeedbackResponse,
  defineFeedbackOutcome,
  defineApplicationPrincipal,
  feedbackResponseIdFor,
  feedbackOutcomeIdFor,
} from "./feedback-contracts.js";

// BB-083 S4 — Application-owned feedback response lifecycle controller.
//
// In-memory owner of the FeedbackResponse lifecycle: create (revision 1),
// compare-and-swap revise (expectedRevision must equal current, never
// silently rebase), idempotent recovery, and fresh outcome binding against
// the latest revision. Only the application principal may create or revise;
// observer/evaluator/provider/GEPA/model authority is rejected by the
// foundation contracts. Missing fresh outcome evidence stays UNKNOWN,
// never coerced to success.
//
// Dependency-free: imports only ../src/feedback-contracts.js. Never imports
// how-evolution.js, oracle or benchmark packages.

export { FeedbackDisposition, FeedbackOutcomeValue };

export const FEEDBACK_CONTROLLER_JOURNAL_TYPES = Object.freeze({
  RESPONSE_CREATED: "response.created",
  RESPONSE_REVISED: "response.revised",
  RESPONSE_RECOVERED: "response.recovered",
  OUTCOME_RECORDED: "outcome.recorded",
});

const REF_PATTERN = /^[A-Za-z0-9_.-]+:sha256:[a-f0-9]{64}$/;

function fail(message) {
  throw new TypeError(`FEEDBACK_CONTROLLER_INVALID: ${message}`);
}
function reqText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
}
function reqRef(value, label) {
  reqText(value, label);
  if (!REF_PATTERN.test(value)) fail(`${label} must be a content-addressed ref (<kind>:sha256:<hex>)`);
  return value;
}
function reqEnum(value, allowed, label) {
  if (!Object.values(allowed).includes(value)) {
    fail(`${label} must be one of ${Object.values(allowed).join(", ")}`);
  }
  return value;
}
function reqPositiveInt(value, label) {
  if (!Number.isInteger(value) || value < 1) fail(`${label} must be a positive integer`);
  return value;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createFeedbackController({ clock } = {}) {
  if (clock !== undefined && typeof clock !== "function") fail("clock must be a function");
  const now = typeof clock === "function" ? clock : () => new Date().toISOString();

  const records = []; // one lifecycle record per response lineage
  const byId = new Map(); // every revision id -> its lineage record
  const journal = [];
  const recoveredRevisions = new Set();
  let seq = 0;

  function appendJournal(type, payload) {
    const entry = freeze({ seq: seq++, type, at: now(), payload: freeze({ ...payload }) });
    journal.push(entry);
    return entry;
  }

  function lookupRecord(responseId) {
    const id = reqRef(responseId, "responseId");
    const record = byId.get(id);
    if (!record) fail(`unknown responseId: ${id}`);
    return record;
  }

  function currentRevision(record) {
    return record.revisions[record.revisions.length - 1];
  }

  function createResponse({ episodeRef, principal, disposition, rationale } = {}) {
    const appPrincipal = defineApplicationPrincipal(principal);
    const response = defineFeedbackResponse({
      kind: FEEDBACK_RESPONSE_KIND,
      version: FEEDBACK_RESPONSE_VERSION,
      episodeRef: reqRef(episodeRef, "episodeRef"),
      principal: appPrincipal,
      disposition,
      revision: 1,
      rationale,
    });
    const id = feedbackResponseIdFor(response);
    if (byId.has(id)) fail(`response already exists: ${id}`);
    const record = { episodeRef: response.episodeRef, revisions: [response], outcomes: [] };
    records.push(record);
    byId.set(id, record);
    appendJournal(FEEDBACK_CONTROLLER_JOURNAL_TYPES.RESPONSE_CREATED, {
      responseId: id,
      episodeRef: response.episodeRef,
      disposition: response.disposition,
      principalId: response.principal.id,
      revision: 1,
    });
    return response;
  }

  function reviseResponse({ responseId, principal, disposition, rationale, expectedRevision } = {}) {
    const record = lookupRecord(responseId);
    const current = currentRevision(record);
    reqPositiveInt(expectedRevision, "expectedRevision");
    if (expectedRevision !== current.revision) {
      fail(
        `stale expectedRevision ${expectedRevision}; current revision is ${current.revision} (never silently rebase)`,
      );
    }
    const appPrincipal = defineApplicationPrincipal(principal);
    const response = defineFeedbackResponse({
      kind: FEEDBACK_RESPONSE_KIND,
      version: FEEDBACK_RESPONSE_VERSION,
      episodeRef: record.episodeRef,
      principal: appPrincipal,
      disposition,
      revision: current.revision + 1,
      rationale,
    });
    const id = feedbackResponseIdFor(response);
    if (byId.has(id)) fail(`response revision already exists: ${id}`);
    record.revisions.push(response);
    byId.set(id, record);
    appendJournal(FEEDBACK_CONTROLLER_JOURNAL_TYPES.RESPONSE_REVISED, {
      responseId: id,
      priorResponseId: feedbackResponseIdFor(current),
      revision: response.revision,
      expectedRevision,
      disposition: response.disposition,
      principalId: response.principal.id,
    });
    return response;
  }

  function recoverResponse({ responseId } = {}) {
    const record = lookupRecord(responseId);
    const current = currentRevision(record);
    const id = feedbackResponseIdFor(current);
    // Idempotent: replaying recovery returns the same current revision and
    // appends no new journal entry; recovery is never a mutation.
    if (!recoveredRevisions.has(id)) {
      recoveredRevisions.add(id);
      appendJournal(FEEDBACK_CONTROLLER_JOURNAL_TYPES.RESPONSE_RECOVERED, {
        responseId: id,
        revision: current.revision,
      });
    }
    return current;
  }

  function recordOutcome({ responseId, outcome, evidenceRef } = {}) {
    const record = lookupRecord(responseId);
    const current = currentRevision(record);
    // The outcome binds the latest revision; a missing outcome value is
    // never coerced to UNKNOWN by the controller.
    reqEnum(outcome, FeedbackOutcomeValue, "outcome");
    const responseRef = feedbackResponseIdFor(current);
    const validated = defineFeedbackOutcome({
      kind: FEEDBACK_OUTCOME_KIND,
      version: FEEDBACK_OUTCOME_VERSION,
      responseRef,
      outcome,
      evidenceRef,
      measuredAt: now(),
    });
    const outcomeId = feedbackOutcomeIdFor(validated);
    record.outcomes.push(validated);
    appendJournal(FEEDBACK_CONTROLLER_JOURNAL_TYPES.OUTCOME_RECORDED, {
      outcomeId,
      responseId: responseRef,
      outcome: validated.outcome,
      evidenceRef: validated.evidenceRef,
    });
    return validated;
  }

  function getResponse(responseId) {
    return currentRevision(lookupRecord(responseId));
  }

  function getOutcome(responseId) {
    const record = lookupRecord(responseId);
    return record.outcomes.length === 0 ? null : record.outcomes[record.outcomes.length - 1];
  }

  function listResponses() {
    return freeze(records.map((record) => currentRevision(record)));
  }

  function getJournal() {
    return freeze([...journal]);
  }

  return freeze({
    createResponse,
    reviseResponse,
    recoverResponse,
    recordOutcome,
    getResponse,
    getOutcome,
    listResponses,
    getJournal,
  });
}
