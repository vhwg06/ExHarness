import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  SearchInvestmentAction,
  SearchInvestmentState,
  VariationTermination,
  VerificationSourceKind,
  VerificationStatus,
  createHarness,
  createMarginalImprovementPolicy,
  defineSearchInvestmentPolicy
} from "../src/index.js";

function baseEnvironment() {
  return {
    async observe({ request }) {
      return { request: request ?? null };
    },
    async act({ candidate }) {
      return { mutated: false, candidate, result: null };
    }
  };
}

async function start(harness, sessionId = "s1") {
  await harness.start({
    sessionId,
    work: { objective: "exercise adaptive useful range" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

function qualityObjective(values) {
  let index = 0;
  return {
    async evaluate() {
      const quality = values[Math.min(index, values.length - 1)];
      index += 1;
      return {
        validity: EvaluationValidity.VALID,
        verdict: EvaluationVerdict.GAP,
        metadata: { quality }
      };
    }
  };
}

function qualityPolicy(options = {}) {
  return createMarginalImprovementPolicy({
    selectQuality(evaluation) {
      return evaluation.metadata?.quality;
    },
    ...options
  });
}

test("agent self-reported progress does not become a grounded range sample", async () => {
  const harness = createHarness({
    strategy: {
      async run() {
        return { progress: "99%", almostThere: true };
      }
    },
    environment: baseEnvironment(),
    objective: qualityObjective([0.1]),
    searchInvestmentPolicy: defineSearchInvestmentPolicy({
      minEvaluations: 2,
      async decide() {
        throw new Error("policy should remain in warm-up without grounded evaluations");
      }
    })
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.deepEqual(result.result, { progress: "99%", almostThere: true });
  assert.equal(result.searchInvestment.state, SearchInvestmentState.WARMUP);
  assert.equal(result.searchInvestment.action, SearchInvestmentAction.CONTINUE);
  assert.equal(result.searchInvestment.metrics.observedEvaluations, 0);
  const state = await harness.workState("s1");
  assert.equal(state.persistentMemory.searchInvestmentDecisions.length, 1);
  assert.equal(state.persistentMemory.evaluations.length, 0);
});

test("diminishing grounded improvement stops the next variation without changing correctness", async () => {
  const harness = createHarness({
    strategy: {
      async run({ invoke }) {
        return invoke(AVOCapability.EVALUATE);
      }
    },
    environment: baseEnvironment(),
    objective: qualityObjective([0.10, 0.11, 0.115]),
    searchInvestmentPolicy: qualityPolicy({
      minEvaluations: 3,
      window: 2,
      minimumImprovement: 0.02
    })
  });
  await start(harness);

  await harness.vary("s1");
  await harness.vary("s1");
  const third = await harness.vary("s1");

  assert.equal(third.searchInvestment.state, SearchInvestmentState.DIMINISHING_RETURNS);
  assert.equal(third.searchInvestment.action, SearchInvestmentAction.STOP);
  const evaluations = await harness.evaluations("s1");
  assert.equal(evaluations.at(-1).verdict, EvaluationVerdict.GAP);

  await assert.rejects(
    () => harness.vary("s1"),
    (error) => error.code === ExHarnessErrorCode.SEARCH_INVESTMENT_STOPPED
  );

  const variations = await harness.variations("s1");
  assert.equal(variations.length, 3, "STOP must gate before a fourth variation is opened");
});

test("new grounded artifacts stale the range decision until objective evaluation is refreshed", async () => {
  const policy = defineSearchInvestmentPolicy({
    minEvaluations: 1,
    async decide({ history }) {
      return history.verifications.length > 0
        ? {
            state: SearchInvestmentState.IN_RANGE,
            action: SearchInvestmentAction.CONTINUE,
            rationale: "fresh evaluation plus independent verification changed the investment picture"
          }
        : {
            state: SearchInvestmentState.DIMINISHING_RETURNS,
            action: SearchInvestmentAction.STOP,
            rationale: "no verification signal justifies more search"
          };
    }
  });
  const harness = createHarness({
    strategy: {
      async run({ invoke }) {
        return invoke(AVOCapability.EVALUATE);
      }
    },
    environment: baseEnvironment(),
    objective: qualityObjective([0.1, 0.2]),
    searchInvestmentPolicy: policy
  });
  await start(harness);

  const first = await harness.vary("s1");
  assert.equal(first.searchInvestment.action, SearchInvestmentAction.STOP);
  const oldDecisionId = first.searchInvestment.id;

  const snapshot = await harness.resume("s1");
  await harness.recordVerification("s1", {
    candidate: snapshot.candidate,
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: [{ check: "independent" }],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.independent" }
  });

  const staleEvaluationDecision = await harness.searchInvestmentStatus("s1");
  assert.notEqual(staleEvaluationDecision.id, oldDecisionId);
  assert.equal(staleEvaluationDecision.state, SearchInvestmentState.INSUFFICIENT_DATA);
  assert.equal(staleEvaluationDecision.action, SearchInvestmentAction.CONTINUE);
  assert.match(staleEvaluationDecision.metrics.evaluationFreshnessError, /re-evaluate before search investment/);

  await harness.evaluate("s1");
  const refreshed = await harness.searchInvestmentStatus("s1");
  assert.notEqual(refreshed.id, staleEvaluationDecision.id);
  assert.equal(refreshed.action, SearchInvestmentAction.CONTINUE);
  assert.equal(refreshed.inputSnapshot.verificationIds.length, 1);
});

test("anomalously large positive movement escalates instead of self-certifying", async () => {
  const harness = createHarness({
    strategy: {
      async run({ invoke }) {
        return invoke(AVOCapability.EVALUATE);
      }
    },
    environment: baseEnvironment(),
    objective: qualityObjective([0.10, 0.12, 0.90]),
    searchInvestmentPolicy: qualityPolicy({
      minEvaluations: 3,
      window: 2,
      minimumImprovement: 0,
      anomalyImprovement: 0.5
    })
  });
  await start(harness);

  await harness.vary("s1");
  await harness.vary("s1");
  const third = await harness.vary("s1");

  assert.equal(third.searchInvestment.state, SearchInvestmentState.ANOMALOUS);
  assert.equal(third.searchInvestment.action, SearchInvestmentAction.ESCALATE);
  const evaluations = await harness.evaluations("s1");
  assert.equal(evaluations.at(-1).verdict, EvaluationVerdict.GAP);

  await assert.rejects(
    () => harness.vary("s1"),
    (error) => error.code === ExHarnessErrorCode.SEARCH_INVESTMENT_ESCALATION_REQUIRED
  );
});

test("missing quality metrics remain explicit insufficient data rather than invented progress", async () => {
  const harness = createHarness({
    strategy: {
      async run({ invoke }) {
        return invoke(AVOCapability.EVALUATE);
      }
    },
    environment: baseEnvironment(),
    objective: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.GAP,
          metadata: { note: "no numeric quality emitted" }
        };
      }
    },
    searchInvestmentPolicy: qualityPolicy({ minEvaluations: 2, window: 1 })
  });
  await start(harness);

  await harness.vary("s1");
  const second = await harness.vary("s1");

  assert.equal(second.searchInvestment.state, SearchInvestmentState.INSUFFICIENT_DATA);
  assert.equal(second.searchInvestment.action, SearchInvestmentAction.CONTINUE);
  assert.equal(second.searchInvestment.metrics.missingEvaluationId != null, true);
});

test("recovery requirement has precedence over a previous range STOP", async () => {
  const harness = createHarness({
    strategy: { async run() { return null; } },
    environment: baseEnvironment(),
    objective: qualityObjective([0.1]),
    searchInvestmentPolicy: defineSearchInvestmentPolicy({
      minEvaluations: 1,
      async decide() {
        return {
          state: SearchInvestmentState.DIMINISHING_RETURNS,
          action: SearchInvestmentAction.STOP,
          rationale: "stop for test"
        };
      }
    })
  });
  await start(harness);
  await harness.evaluate("s1");
  await harness.assessSearchInvestment("s1");
  await harness.beginVariation("s1", { problem: "simulate interrupted work" });

  await assert.rejects(
    () => harness.vary("s1"),
    (error) => error.code === ExHarnessErrorCode.RECOVERY_REQUIRED
  );
});

test("hard capability ceiling remains authoritative when useful-range policy says CONTINUE", async () => {
  const harness = createHarness({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.EVALUATE);
        await invoke(AVOCapability.OBSERVE, { shouldHitHardCap: true });
      }
    },
    environment: baseEnvironment(),
    objective: qualityObjective([0.1]),
    variationPolicy: { maxCapabilityCalls: 1 },
    searchInvestmentPolicy: defineSearchInvestmentPolicy({
      minEvaluations: 1,
      async decide() {
        return {
          state: SearchInvestmentState.IN_RANGE,
          action: SearchInvestmentAction.CONTINUE,
          rationale: "more search would be useful if the hard boundary allowed it"
        };
      }
    })
  });
  await start(harness);

  const result = await harness.vary("s1");

  assert.equal(result.variation.termination, VariationTermination.BUDGET_EXHAUSTED);
  assert.equal(result.searchInvestment.action, SearchInvestmentAction.CONTINUE);
  assert.equal(result.variation.capabilityCalls, 1);
});
