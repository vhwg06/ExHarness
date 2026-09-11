import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  AgentRunErrorCode,
  EvaluationValidity,
  EvaluationVerdict,
  KnowledgeKind,
  VariationOutcome,
  VariationStatus,
  VariationTermination,
  createAVOHarness,
  createInMemorySessionStore
} from "../src/index.js";

function createHarness(strategy, { variationPolicy = {} } = {}) {
  return createAVOHarness({
    strategy,
    variationPolicy,
    environment: {
      async observe({ request }) {
        return { inspected: request ?? null };
      },
      async act({ candidate, action }) {
        if (action?.mutated === false) {
          return { mutated: false, candidate, result: { noop: true } };
        }
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: { applied: true }
        };
      }
    },
    objective: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.PASS
        };
      }
    },
    sessionStore: createInMemorySessionStore(),
    contextProjector: {
      async project() {
        return null;
      }
    },
    supervisor: {
      async inspect() {
        return null;
      }
    },
    dosagePolicy: {
      async decide() {
        return { enabled: false, reason: "disabled for variation operator tests" };
      }
    }
  });
}

async function start(harness, sessionId = "s1") {
  await harness.start({
    sessionId,
    work: { objective: "exercise variation semantics" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

test("agent-reported progress cannot fake grounded variation activity", async () => {
  const harness = createHarness({
    async run() {
      return { progress: "100%", claimedSuccess: true };
    }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.deepEqual(result.result, { progress: "100%", claimedSuccess: true });
  assert.equal(result.variation.status, VariationStatus.COMPLETED);
  assert.equal(result.variation.outcome, VariationOutcome.NO_CHANGE);
  assert.equal(result.variation.termination, VariationTermination.RETURNED);
  assert.equal(result.variation.activity.candidateChanged, false);
  assert.equal(result.variation.activity.lineageAdvanced, false);

  const history = await harness.variations("s1");
  assert.equal(history.length, 1);
  assert.equal(history[0].outcome, VariationOutcome.NO_CHANGE);
});

test("candidate mutation is visible without pretending committed lineage advanced", async () => {
  const harness = createHarness({
    async run({ invoke }) {
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      return "keep-searching";
    }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.variation.outcome, VariationOutcome.CANDIDATE_CHANGED);
  assert.equal(result.variation.termination, VariationTermination.RETURNED);
  assert.equal(result.variation.activity.implementationsAdded, 1);
  assert.equal(result.lineage.advanced, false);
  assert.equal(result.after.version, "v1");
});

test("capability budget stops an unbounded harness-mediated loop and persists the exhausted run", async () => {
  const harness = createHarness({
    async run({ invoke }) {
      for (let index = 0; index < 10; index += 1) {
        await invoke(AVOCapability.OBSERVE, { index });
      }
      return "unreachable";
    }
  }, {
    variationPolicy: { maxCapabilityCalls: 2 }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.variation.termination, VariationTermination.BUDGET_EXHAUSTED);
  assert.equal(result.variation.outcome, VariationOutcome.SEARCH_STATE_CHANGED);
  assert.equal(result.variation.capabilityCalls, 2);
  assert.equal(result.variation.activity.observationsAdded, 2);
  assert.equal(result.failure.code, AgentRunErrorCode.CAPABILITY_BUDGET_EXHAUSTED);
});

test("strategy cannot hide budget exhaustion by catching the budget error", async () => {
  const harness = createHarness({
    async run({ invoke }) {
      try {
        for (let index = 0; index < 5; index += 1) {
          await invoke(AVOCapability.OBSERVE, { index });
        }
      } catch {
        return "caught-budget-error";
      }
      return "unexpected";
    }
  }, {
    variationPolicy: { maxCapabilityCalls: 1 }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.result, "caught-budget-error");
  assert.equal(result.variation.termination, VariationTermination.BUDGET_EXHAUSTED);
  assert.equal(result.variation.capabilityCalls, 1);
  assert.equal(result.variation.activity.observationsAdded, 1);
});

test("commit is terminal for variation capability activity", async () => {
  const harness = createHarness({
    async run({ invoke }) {
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
      await invoke(AVOCapability.OBSERVE, { shouldNotRun: true });
      return "unreachable";
    }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.variation.outcome, VariationOutcome.COMMITTED);
  assert.equal(result.variation.termination, VariationTermination.FAILED);
  assert.equal(result.failure.code, AgentRunErrorCode.VARIATION_CLOSED_AFTER_COMMIT);
  assert.equal(result.lineage.advanced, true);
  assert.equal(result.lineage.after.candidate.version, "v1");

  const observations = await harness.observations("s1");
  assert.equal(observations.length, 0);
});

test("failed directions remain grounded search state rather than being mislabeled as candidate progress", async () => {
  const harness = createHarness({
    async run({ invoke }) {
      await invoke(AVOCapability.RECORD_KNOWLEDGE, {
        kind: KnowledgeKind.FAILED_DIRECTION,
        statement: "rewrite the whole candidate",
        evidence: ["attempt-1 regressed"]
      });
      await invoke(AVOCapability.RECORD_KNOWLEDGE, {
        kind: KnowledgeKind.FAILED_DIRECTION,
        statement: "repeat the same rewrite with a larger patch",
        evidence: ["attempt-2 regressed"]
      });
      return "recorded failures";
    }
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.variation.outcome, VariationOutcome.SEARCH_STATE_CHANGED);
  assert.equal(result.variation.activity.failedDirectionsAdded, 2);
  assert.equal(result.variation.activity.candidateChanged, false);
  assert.equal(result.variation.activity.lineageAdvanced, false);
});
