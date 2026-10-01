import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildGroundedFindingInput } from "../src/grounded-observation.js";
import { createFeedbackLifecycleController } from "../src/feedback-lifecycle-controller.js";

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function memoryArtifactStore() {
  const artifacts = new Map();
  return Object.freeze({
    async put(kind, value) {
      const artifact = structuredClone(value);
      const ref = `${kind}:sha256:${digestOf(artifact)}`;
      const existing = artifacts.get(ref);
      if (existing !== undefined) assert.deepEqual(existing, artifact);
      artifacts.set(ref, artifact);
      return ref;
    },
    async resolve(ref) {
      const found = artifacts.get(ref) ?? null;
      return found === null ? null : structuredClone(found);
    },
  });
}

function memoryHeadStore() {
  const heads = new Map();
  const revisionFor = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return Object.freeze({
    async current(key) {
      const entry = heads.get(key) ?? null;
      return entry === null ? null : structuredClone(entry);
    },
    async compareAndSwap(key, expectedRevision, nextValue) {
      const current = heads.get(key) ?? null;
      if ((current?.revision ?? null) !== expectedRevision) return false;
      const value = structuredClone(nextValue);
      heads.set(key, { revision: revisionFor(value), value });
      return true;
    },
  });
}

function stubAuthority({ verify = null } = {}) {
  return Object.freeze({
    async verifyFeedbackPrincipal({ principal }) {
      if (typeof verify === "function") return verify({ principal });
      if (principal?.id === "unverified") throw new Error("unknown principal");
      return { authorityRef: `authority:${principal?.id ?? "app"}` };
    },
  });
}

let nonce = 0;
function hex(n) {
  return createHash("sha256").update(`feedback-lifecycle:${n}:${nonce++}`).digest("hex");
}

async function putGroundedInput(store, { groundingStatus = "GROUNDED", attemptId = null, boundaryAt = null } = {}) {
  const id = hex(nonce);
  const attempt = attemptId ?? `execution-attempt-id:${id.slice(0, 12)}`;
  const at = boundaryAt ?? "2026-01-01T00:00:00.000Z";
  const receipt = { receiptId: hex(nonce), requirementId: `req-${id.slice(0, 8)}`, resolutionId: `res-${id.slice(0, 8)}` };
  const receiptRef = await store.put("context-resolution-receipt", receipt);
  const binding = {
    requirementId: receipt.requirementId,
    resolutionId: receipt.resolutionId,
    receiptRef,
    receiptDigest: receipt.receiptId,
  };
  const bindingRef = await store.put("observation-context-binding", binding);
  const observation = {
    kind: "GROUNDED_OBSERVATION_V1",
    execution: { executionAttemptId: attempt },
    executionAttemptId: attempt,
    observedAtBoundaries: [{ boundaryKind: "RUNTIME_INVOCATION", at, ref: receiptRef }],
  };
  const observationRef = await store.put("grounded-observation", observation);
  const digest = observationRef.match(/:sha256:([a-f0-9]{64})$/)?.[1];
  const { input, inputRef } = await buildGroundedFindingInput(
    {
      observationRefs: [{ ref: observationRef, digest }],
      contextBindingRef: bindingRef,
      groundingStatus,
      unresolvedReasons: groundingStatus === "GROUNDED" ? [] : ["STALE_CONTEXT"],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: store },
  );
  return { input, inputRef, observation, observationRef, binding, bindingRef, receipt, receiptRef, attempt, at };
}

function controllerFor(store, heads, { currentnessStatus = "CURRENT", authority = null } = {}) {
  return createFeedbackLifecycleController({
    artifactStore: store,
    headStore: heads ?? memoryHeadStore(),
    principalAuthority: authority ?? stubAuthority(),
    receiptCurrentness: async () => ({ status: currentnessStatus, changedEvidenceIds: [], evaluatorIdentity: "test" }),
  });
}

const APP = Object.freeze({ kind: "APPLICATION", id: "app-1" });
function episodeArgs(inputs, overrides = {}) {
  return {
    groundedInputRefs: inputs.map((w) => ({ ref: w.inputRef, digest: w.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] })),
    finding: {
      kind: "LATENCY",
      statement: "latency regressed",
      evidenceRefs: inputs.slice(0, 1).map((w) => ({ ref: w.inputRef, digest: w.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] })),
      producer: { kind: "OBSERVER", id: "observer-1" },
    },
    impact: { basis: "HYPOTHESIZED", measurements: [] },
    scopeKey: "checkout",
    contraryEvidenceRefs: [],
    ...overrides,
  };
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

test("openEpisode binds exact refs and rejects digest mismatch or non-finding input", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const w = await putGroundedInput(store);
  const opened = await controller.openEpisode(episodeArgs([w]));
  assert.equal(opened.status, "OK");
  assert.equal(opened.head.value.state, "OPEN");

  await assert.rejects(
    () =>
      controller.openEpisode(
        episodeArgs([w], { groundedInputRefs: [{ ref: w.inputRef, digest: "0".repeat(64) }] }),
      ),
    /digest mismatch|pin digest/,
  );
  const otherRef = await store.put("other-kind", { hello: "world" });
  await assert.rejects(
    () =>
      controller.openEpisode(
        episodeArgs([w], {
          groundedInputRefs: [{ ref: otherRef, digest: otherRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] }],
        }),
      ),
    /GROUNDED_FINDING_INPUT|not a GROUNDED/,
  );
});

test("MEASURED impact and ACTED are refused on UNRESOLVED or STALE input", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const bad = await putGroundedInput(store, { groundingStatus: "UNRESOLVED" });
  await assert.rejects(
    () =>
      controller.openEpisode(
        episodeArgs([bad], { impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 100 }] } }),
      ),
    /MEASURED.*GROUNDED|UNRESOLVED/,
  );
  const good = await putGroundedInput(store);
  const staleController = controllerFor(store, memoryHeadStore(), { currentnessStatus: "STALE" });
  await assert.rejects(
    () =>
      staleController.openEpisode(
        episodeArgs([good], { impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 100 }] } }),
      ),
    /CURRENT|STALE/,
  );
  // HYPOTHESIZED with UNRESOLVED opens, but ACTED is still refused.
  const opened = await controller.openEpisode(episodeArgs([bad]));
  assert.equal(opened.status, "OK");
  await assert.rejects(
    () =>
      controller.respond({
        episodeId: opened.episodeId,
        expectedRevision: opened.head.revision,
        principal: APP,
        disposition: "ACTED",
        actionRefs: ["work:1"],
        outcomePolicy: policy(),
      }),
    /ACTED.*GROUNDED|CURRENT/,
  );
});

test("response disposition rules are enforced", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const w = await putGroundedInput(store);
  const opened = await controller.openEpisode(episodeArgs([w]));
  const rev = opened.head.revision;
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: rev, principal: APP, disposition: "ACTED", actionRefs: [], outcomePolicy: policy() }),
    /ACTED.*actionRefs/,
  );
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: rev, principal: APP, disposition: "ACTED", actionRefs: ["w:1"], outcomePolicy: null }),
    /ACTED.*outcomePolicy/,
  );
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: rev, principal: APP, disposition: "REJECTED", actionRefs: [] }),
    /REJECTED.*rationaleRef/,
  );
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: rev, principal: APP, disposition: "DEFERRED", actionRefs: [] }),
    /DEFERRED.*revisitCondition/,
  );
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: rev, principal: APP, disposition: "SUPERSEDED", actionRefs: [] }),
    /SUPERSEDED.*successorEpisodeRef/,
  );
});

test("only a verified application principal can respond or resolve", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const w = await putGroundedInput(store);
  const opened = await controller.openEpisode(episodeArgs([w]));
  for (const kind of ["OBSERVER", "EVALUATOR", "PROVIDER", "OPTIMIZER"]) {
    await assert.rejects(
      () =>
        controller.respond({
          episodeId: opened.episodeId,
          expectedRevision: opened.head.revision,
          principal: { kind, id: "x" },
          disposition: "REJECTED",
          rationaleRef: "rationale:1",
        }),
      new RegExp(kind),
    );
  }
  await assert.rejects(
    () =>
      controller.respond({
        episodeId: opened.episodeId,
        expectedRevision: opened.head.revision,
        principal: { kind: "APPLICATION", id: "unverified" },
        disposition: "REJECTED",
        rationaleRef: "rationale:1",
      }),
    /not verified|unknown principal/,
  );
  // A payload-embedded application producer grants nothing: an explicit
  // principal argument is still required.
  const smuggled = await controller.openEpisode(
    episodeArgs([w], {
      finding: {
        kind: "LATENCY",
        statement: "x",
        evidenceRefs: [{ ref: w.inputRef, digest: w.inputRef.match(/:sha256:([a-f0-9]{64})$/)?.[1] }],
        producer: { kind: "APPLICATION", id: "app-smuggled" },
      },
    }),
  );
  await assert.rejects(
    () =>
      controller.respond({
        episodeId: smuggled.episodeId,
        expectedRevision: smuggled.head.revision,
        disposition: "REJECTED",
        rationaleRef: "rationale:1",
      }),
    /explicit application principal/,
  );
  const ok = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "REJECTED",
    rationaleRef: "rationale:1",
  });
  assert.equal(ok.status, "OK");
  await assert.rejects(
    () => controller.resolve({ episodeId: opened.episodeId, expectedRevision: ok.head.revision, principal: { kind: "OBSERVER", id: "o" } }),
    /OBSERVER/,
  );
});

test("exact replay converges; stale revision fails without rebase", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const w = await putGroundedInput(store);
  const opened = await controller.openEpisode(episodeArgs([w]));
  const first = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "DEFERRED",
    revisitCondition: { kind: "MANUAL", ref: null },
  });
  assert.equal(first.status, "OK");
  const replay = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "DEFERRED",
    revisitCondition: { kind: "MANUAL", ref: null },
  });
  // The replay uses a stale expectedRevision but identical content: the head
  // already equals the intended next value, so it converges.
  assert.equal(replay.status, "CONVERGED");
  assert.equal(replay.head.revision, first.head.revision);
  const stale = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "REJECTED",
    rationaleRef: "different-content",
  });
  // Same stale revision with different content cannot converge.
  // From DEFERRED a REJECTED with a fresh revision would be allowed, but the
  // stale revision here targets the pre-DEFERRED head, so it must not rebase.
  assert.equal(stale.status, "STALE_REVISION");
  assert.equal(stale.head.revision, first.head.revision);
});

test("recordOutcome freshness negatives stay UNKNOWN and keep ACTED state", async () => {
  async function actedWorld() {
    const store = memoryArtifactStore();
    const heads = memoryHeadStore();
    const controller = controllerFor(store, heads);
    const base = await putGroundedInput(store, { attemptId: "execution-attempt-id:base-1", boundaryAt: "2026-01-01T00:00:00.000Z" });
    const opened = await controller.openEpisode(
      episodeArgs([base], { impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 200 }] } }),
    );
    const responded = await controller.respond({
      episodeId: opened.episodeId,
      expectedRevision: opened.head.revision,
      principal: APP,
      disposition: "ACTED",
      actionRefs: ["work:1"],
      outcomePolicy: policy(),
    });
    return { store, heads, controller, base, opened, responded };
  }
  // Non-current response.
  {
    const { controller, opened, responded } = await actedWorld();
    const fresh = await putGroundedInput(controller === null ? null : (await actedWorld()).store).catch(() => null);
    void fresh;
    const store2 = memoryArtifactStore();
    void store2;
    const ctx = await actedWorld();
    const freshInput = await putGroundedInput(ctx.store, { attemptId: "execution-attempt-id:fresh-1", boundaryAt: "2026-01-02T00:00:00.000Z" });
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: freshInput.inputRef,
      freshMeasurements: [{ key: "p99_ms", value: 100 }],
      responseRef: "feedback-response:sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.head.value.state, "RESPONDED_ACTED");
  }
  // Fresh input already in the episode.
  {
    const ctx = await actedWorld();
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: ctx.base.inputRef,
      freshMeasurements: [{ key: "p99_ms", value: 100 }],
    });
    assert.equal(result.status, "UNKNOWN");
  }
  // Reused execution attempt.
  {
    const ctx = await actedWorld();
    const freshInput = await putGroundedInput(ctx.store, { attemptId: "execution-attempt-id:base-1", boundaryAt: "2026-01-02T00:00:00.000Z" });
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: freshInput.inputRef,
      freshMeasurements: [{ key: "p99_ms", value: 100 }],
    });
    assert.equal(result.status, "UNKNOWN");
  }
  // Boundary not strictly after the episode boundary.
  {
    const ctx = await actedWorld();
    const freshInput = await putGroundedInput(ctx.store, { attemptId: "execution-attempt-id:fresh-2", boundaryAt: "2026-01-01T00:00:00.000Z" });
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: freshInput.inputRef,
      freshMeasurements: [{ key: "p99_ms", value: 100 }],
    });
    assert.equal(result.status, "UNKNOWN");
  }
  // Missing measurement.
  {
    const ctx = await actedWorld();
    const freshInput = await putGroundedInput(ctx.store, { attemptId: "execution-attempt-id:fresh-3", boundaryAt: "2026-01-02T00:00:00.000Z" });
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: freshInput.inputRef,
      freshMeasurements: [],
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.outcome.outcome, "UNKNOWN");
  }
  // Happy path still works after UNKNOWNs.
  {
    const ctx = await actedWorld();
    const freshInput = await putGroundedInput(ctx.store, { attemptId: "execution-attempt-id:fresh-9", boundaryAt: "2026-01-02T00:00:00.000Z" });
    const result = await ctx.controller.recordOutcome({
      episodeId: ctx.opened.episodeId,
      expectedRevision: ctx.responded.head.revision,
      freshInputRef: freshInput.inputRef,
      freshMeasurements: [{ key: "p99_ms", value: 100 }],
    });
    assert.equal(result.status, "OK");
    assert.equal(result.outcome.outcome, "IMPROVED");
    assert.equal(result.head.value.state, "OUTCOME_RECORDED");
  }
});

test("recordOutcome uses only the frozen policy", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const base = await putGroundedInput(store, { attemptId: "execution-attempt-id:base-1", boundaryAt: "2026-01-01T00:00:00.000Z" });
  const opened = await controller.openEpisode(
    episodeArgs([base], { impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 200 }] } }),
  );
  const responded = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "ACTED",
    actionRefs: ["work:1"],
    outcomePolicy: policy(),
  });
  const freshInput = await putGroundedInput(store, { attemptId: "execution-attempt-id:fresh-1", boundaryAt: "2026-01-02T00:00:00.000Z" });
  // A delta of 30 is NO_CHANGE under the frozen minEffect 50. Even if a
  // caller wished for a smaller threshold, the frozen policy decides.
  const result = await controller.recordOutcome({
    episodeId: opened.episodeId,
    expectedRevision: responded.head.revision,
    freshInputRef: freshInput.inputRef,
    freshMeasurements: [{ key: "p99_ms", value: 170 }],
  });
  assert.equal(result.outcome.outcome, "NO_CHANGE");
  assert.equal(result.outcome.policyDigest, responded.response.outcomePolicyDigest);
});

test("resolve derives values, rejects UNKNOWN/DEFERRED and caller mismatch, and is terminal", async () => {
  const store = memoryArtifactStore();
  const heads = memoryHeadStore();
  const controller = controllerFor(store, heads);
  const base = await putGroundedInput(store, { attemptId: "execution-attempt-id:base-1", boundaryAt: "2026-01-01T00:00:00.000Z" });
  const opened = await controller.openEpisode(
    episodeArgs([base], { impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 200 }] } }),
  );
  const acted = await controller.respond({
    episodeId: opened.episodeId,
    expectedRevision: opened.head.revision,
    principal: APP,
    disposition: "ACTED",
    actionRefs: ["work:1"],
    outcomePolicy: policy(),
  });
  // DEFERRED-like resolve from ACTED without outcome fails.
  await assert.rejects(() => controller.resolve({ episodeId: opened.episodeId, expectedRevision: acted.head.revision, principal: APP }), /cannot resolve|UNKNOWN/);
  const freshInput = await putGroundedInput(store, { attemptId: "execution-attempt-id:fresh-1", boundaryAt: "2026-01-02T00:00:00.000Z" });
  const recorded = await controller.recordOutcome({
    episodeId: opened.episodeId,
    expectedRevision: acted.head.revision,
    freshInputRef: freshInput.inputRef,
    freshMeasurements: [{ key: "p99_ms", value: 100 }],
  });
  assert.equal(recorded.outcome.outcome, "IMPROVED");
  await assert.rejects(
    () => controller.resolve({ episodeId: opened.episodeId, expectedRevision: recorded.head.revision, principal: APP, resolution: "REGRESSED" }),
    /differs from derived/,
  );
  const resolved = await controller.resolve({ episodeId: opened.episodeId, expectedRevision: recorded.head.revision, principal: APP });
  assert.equal(resolved.status, "OK");
  assert.equal(resolved.resolution.resolution, "IMPROVED");
  assert.equal(resolved.head.value.state, "RESOLVED");
  await assert.rejects(
    () => controller.respond({ episodeId: opened.episodeId, expectedRevision: resolved.head.revision, principal: APP, disposition: "DEFERRED", revisitCondition: { kind: "MANUAL", ref: null } }),
    /RESOLVED/,
  );
  const replayResolve = await controller.resolve({ episodeId: opened.episodeId, expectedRevision: resolved.head.revision, principal: APP });
  assert.equal(replayResolve.status, "CONVERGED");
  assert.equal(replayResolve.head.revision, resolved.head.revision);
  await assert.rejects(
    () => controller.resolve({ episodeId: opened.episodeId, expectedRevision: replayResolve.head.revision, principal: APP, resolution: "REGRESSED" }),
    /differs from derived/,
  );

  // REJECTED resolves to acknowledged without an outcome.
  const store2 = memoryArtifactStore();
  const heads2 = memoryHeadStore();
  const c2 = controllerFor(store2, heads2);
  const w2 = await putGroundedInput(store2);
  const o2 = await c2.openEpisode(episodeArgs([w2]));
  const r2 = await c2.respond({ episodeId: o2.episodeId, expectedRevision: o2.head.revision, principal: APP, disposition: "REJECTED", rationaleRef: "rationale:1" });
  const done2 = await c2.resolve({ episodeId: o2.episodeId, expectedRevision: r2.head.revision, principal: APP });
  assert.equal(done2.resolution.resolution, "REJECTED_ACKNOWLEDGED");

  // SUPERSEDED resolves to superseded.
  const store3 = memoryArtifactStore();
  const heads3 = memoryHeadStore();
  const c3 = controllerFor(store3, heads3);
  const w3 = await putGroundedInput(store3);
  const o3 = await c3.openEpisode(episodeArgs([w3]));
  const r3 = await c3.respond({ episodeId: o3.episodeId, expectedRevision: o3.head.revision, principal: APP, disposition: "SUPERSEDED", successorEpisodeRef: "feedback-episode:next" });
  const done3 = await c3.resolve({ episodeId: o3.episodeId, expectedRevision: r3.head.revision, principal: APP });
  assert.equal(done3.resolution.resolution, "SUPERSEDED");
});
