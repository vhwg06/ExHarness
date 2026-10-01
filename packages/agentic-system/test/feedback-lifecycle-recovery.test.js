// Delivery rebuild 2026-10-01: re-validated on current main.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { buildGroundedFindingInput } from "../src/grounded-observation.js";
import {
  createFeedbackLifecycleController,
  createJsonFeedbackEpisodeHeadStore,
  feedbackEpisodeHeadKeyFor,
} from "../src/feedback-lifecycle-controller.js";

const execFileAsync = promisify(execFile);
const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let nonce = 1000;
function hex() {
  return createHash("sha256").update(`recovery:${nonce++}`).digest("hex");
}

function stubAuthority() {
  return Object.freeze({
    async verifyFeedbackPrincipal() {
      return { authorityRef: "authority:app-1" };
    },
  });
}
const APP = Object.freeze({ kind: "APPLICATION", id: "app-1" });
const currentness = async () => ({ status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test" });

async function groundedInput(store, { attemptId, at }) {
  const receipt = { receiptId: hex(), requirementId: `req-${hex().slice(0, 8)}`, resolutionId: `res-${hex().slice(0, 8)}` };
  const receiptRef = await store.put("context-resolution-receipt", receipt);
  const binding = { requirementId: receipt.requirementId, resolutionId: receipt.resolutionId, receiptRef, receiptDigest: receipt.receiptId };
  const bindingRef = await store.put("observation-context-binding", binding);
  const observation = {
    execution: { executionAttemptId: attemptId },
    observedAtBoundaries: [{ boundaryKind: "RUNTIME_INVOCATION", at, ref: receiptRef }],
  };
  const observationRef = await store.put("grounded-observation", observation);
  const digest = observationRef.match(/:sha256:([a-f0-9]{64})$/)?.[1];
  const { input, inputRef } = await buildGroundedFindingInput(
    {
      observationRefs: [{ ref: observationRef, digest }],
      contextBindingRef: bindingRef,
      groundingStatus: "GROUNDED",
      unresolvedReasons: [],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: store },
  );
  return { input, inputRef };
}
function policy() {
  return {
    kind: "FEEDBACK_OUTCOME_POLICY_V1",
    version: 1,
    metricKey: "p99_ms",
    direction: "LOWER_IS_BETTER",
    minEffect: 50,
    noChangeBand: 10,
    requiredMeasurementKeys: ["p99_ms"],
  };
}

test("crash between put and CAS leaves one transition after retry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-feedback-crash-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const store = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const heads = createJsonFeedbackEpisodeHeadStore({ path: join(dir, "heads.json") });
  const controller = createFeedbackLifecycleController({ artifactStore: store, headStore: heads, principalAuthority: stubAuthority(), receiptCurrentness: currentness });

  const base = await groundedInput(store, { attemptId: "execution-attempt-id:base-1", at: "2026-01-01T00:00:00.000Z" });
  const opened = await controller.openEpisode({
    groundedInputRefs: [{ ref: base.inputRef, digest: digestOf(await store.resolve(base.inputRef)) && base.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] }],
    finding: {
      kind: "LATENCY",
      statement: "latency regressed",
      evidenceRefs: [{ ref: base.inputRef, digest: base.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] }],
      producer: { kind: "OBSERVER", id: "observer-1" },
    },
    impact: { basis: "HYPOTHESIZED", measurements: [] },
    scopeKey: "checkout",
    contraryEvidenceRefs: [],
  });
  // Simulate a crash after the response artifact put but before CAS: write
  // the artifact directly, then drop the head update.
  const before = await heads.current(feedbackEpisodeHeadKeyFor(opened.episodeId));
  const episodeDigest = before.value.episodeRef.match(/:sha256:([a-f0-9]{64})$/)?.[1];
  const { defineFeedbackResponse } = await import("../src/feedback-lifecycle-contracts.js");
  const orphanResponse = defineFeedbackResponse({
    kind: "FEEDBACK_RESPONSE_V1",
    version: 1,
    episodeRef: before.value.episodeRef,
    episodeDigest,
    previousResponseRef: null,
    principalAuthorityRef: "authority:app-1",
    disposition: "DEFERRED",
    rationaleRef: null,
    actionRefs: [],
    successorEpisodeRef: null,
    revisitCondition: { kind: "MANUAL", ref: null },
    outcomePolicy: null,
  });
  const orphanRef = await store.put("feedback-response", structuredClone(orphanResponse));
  const crashed = await heads.current(feedbackEpisodeHeadKeyFor(opened.episodeId));
  assert.equal(crashed.revision, before.revision);
  assert.equal(crashed.value.responseRef, null);

  // Retry through the controller produces the same ref and exactly one
  // transition; the orphan put above is the same content so no duplicate.
  const retried = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: before.revision,
    principal: APP,
    disposition: "DEFERRED",
    revisitCondition: { kind: "MANUAL", ref: null },
  });
  assert.equal(retried.status, "OK");
  assert.equal(retried.responseRef, orphanRef);
  const after = await heads.current(feedbackEpisodeHeadKeyFor(opened.episodeId));
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.value.responseRef, orphanRef);

  // A second identical retry converges with no further mutation.
  const again = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: before.revision,
    principal: APP,
    disposition: "DEFERRED",
    revisitCondition: { kind: "MANUAL", ref: null },
  });
  assert.equal(again.status, "CONVERGED");
  assert.equal(again.head.revision, after.revision);

  // Recover ignores the orphan outcome artifact left by a crashed outcome put.
  const orphanOutcomeRef = await store.put("feedback-outcome", {
    kind: "FEEDBACK_OUTCOME_V1",
    version: 1,
    responseRef: "feedback-response:sha256:0000000000000000000000000000000000000000000000000000000000000000",
    responseDigest: "0".repeat(64),
    freshInputRef: base.inputRef,
    freshInputDigest: base.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1],
    freshness: { freshExecutionAttemptIds: ["execution-attempt-id:orphan"], effectiveAfterBoundary: "2026-01-02T00:00:00.000Z" },
    policyDigest: "f".repeat(64),
    baselineMeasurements: [],
    freshMeasurements: [],
    outcome: "UNKNOWN",
    reasons: ["ORPHAN"],
  });
  void orphanOutcomeRef;
  const recovered = await controller.recover(opened.episodeId);
  assert.equal(recovered.status, "RECOVERED");
  assert.equal(recovered.head.value.responseRef, orphanRef);
  assert.equal(recovered.outcome, null);
});

test("fresh process reconstructs the same refs and converges", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-feedback-fresh-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const artifactPath = join(dir, "artifacts.json");
  const headPath = join(dir, "heads.json");
  const firstStore = createJsonImmutableArtifactStore({ path: artifactPath });
  const firstHeads = createJsonFeedbackEpisodeHeadStore({ path: headPath });
  const first = createFeedbackLifecycleController({
    artifactStore: firstStore,
    headStore: firstHeads,
    principalAuthority: stubAuthority(),
    receiptCurrentness: currentness,
  });
  const base = await groundedInput(firstStore, { attemptId: "execution-attempt-id:base-1", at: "2026-01-01T00:00:00.000Z" });
  const pin = { ref: base.inputRef, digest: base.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] };
  const opened = await first.openEpisode({
    groundedInputRefs: [pin],
    finding: { kind: "LATENCY", statement: "latency regressed", evidenceRefs: [pin], producer: { kind: "OBSERVER", id: "observer-1" } },
    impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 200 }] },
    scopeKey: "checkout",
    contraryEvidenceRefs: [],
  });
  const responded = await first.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "ACTED",
    actionRefs: ["work:1"],
    outcomePolicy: policy(),
  });
  const fresh = await groundedInput(firstStore, { attemptId: "execution-attempt-id:fresh-1", at: "2026-01-02T00:00:00.000Z" });
  const recorded = await first.recordOutcome({
    episodeId: opened.episodeId,
    expectedRevision: responded.head.revision,
    freshInputRef: fresh.inputRef,
    freshMeasurements: [{ key: "p99_ms", value: 100 }],
  });
  assert.equal(recorded.outcome.outcome, "IMPROVED");
  const resolved = await first.resolve({ episodeId: opened.episodeId, expectedRevision: recorded.head.revision, principal: APP });
  assert.equal(resolved.resolution.resolution, "IMPROVED");
  const before = {
    episodeRef: opened.episodeRef,
    responseRef: responded.responseRef,
    outcomeRef: recorded.outcomeRef,
    resolutionRef: resolved.resolutionRef,
    head: resolved.head,
  };

  // Fresh controller over the same durable files reconstructs every ref.
  const secondStore = createJsonImmutableArtifactStore({ path: artifactPath });
  const secondHeads = createJsonFeedbackEpisodeHeadStore({ path: headPath });
  const second = createFeedbackLifecycleController({
    artifactStore: secondStore,
    headStore: secondHeads,
    principalAuthority: stubAuthority(),
    receiptCurrentness: currentness,
  });
  const recovered = await second.recover(opened.episodeId);
  assert.equal(recovered.status, "RECOVERED");
  assert.equal(recovered.episode.episodeId, opened.episodeId);
  assert.equal(recovered.head.value.episodeRef, before.episodeRef);
  assert.equal(recovered.head.value.responseRef, before.responseRef);
  assert.equal(recovered.head.value.outcomeRef, before.outcomeRef);
  assert.equal(recovered.head.value.resolutionRef, before.resolutionRef);
  assert.equal(recovered.head.revision, before.head.revision);

  // Exact replays in the fresh process converge with no mutation.
  const replayResolve = await second.resolve({ episodeId: opened.episodeId, expectedRevision: before.head.revision, principal: APP });
  assert.equal(replayResolve.status, "CONVERGED");
  assert.equal(replayResolve.head.revision, before.head.revision);

  // A child node process over the same files sees the same head.
  const childScript = `
import { createJsonImmutableArtifactStore } from "${new URL("../src/organization-artifact-store.js", import.meta.url).pathname}";
import { createJsonFeedbackEpisodeHeadStore, feedbackEpisodeHeadKeyFor } from "${new URL("../src/feedback-lifecycle-controller.js", import.meta.url).pathname}";
const [artifactPath, headPath, episodeId] = process.argv.slice(2);
const store = createJsonImmutableArtifactStore({ path: artifactPath });
const heads = createJsonFeedbackEpisodeHeadStore({ path: headPath });
const head = await heads.current(feedbackEpisodeHeadKeyFor(episodeId));
const episode = await store.resolve(head.value.episodeRef);
console.log(JSON.stringify({ revision: head.revision, episodeRef: head.value.episodeRef, episodeId: episode.episodeId, state: head.value.state }));
`;
  const childPath = join(dir, "child.mjs");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(childPath, childScript);
  const { stdout } = await execFileAsync(process.execPath, [childPath, artifactPath, headPath, opened.episodeId]);
  const seen = JSON.parse(stdout.trim());
  assert.equal(seen.revision, before.head.revision);
  assert.equal(seen.episodeRef, before.episodeRef);
  assert.equal(seen.episodeId, opened.episodeId);
  assert.equal(seen.state, "RESOLVED");
});
