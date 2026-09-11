import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  SearchInvestmentAction,
  SearchInvestmentState,
  createHarness,
  createInMemorySessionStore,
  defineSearchInvestmentPolicy
} from "../src/index.js";

function makeHarness(store, policy) {
  return createHarness({
    sessionStore: store,
    strategy: {
      async run({ invoke }) {
        return invoke(AVOCapability.EVALUATE);
      }
    },
    environment: {
      async observe() { return null; },
      async act({ candidate }) { return { mutated: false, candidate }; }
    },
    objective: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.GAP,
          metadata: { quality: 0.1 }
        };
      }
    },
    searchInvestmentPolicy: policy
  });
}

test("policy revision change invalidates an otherwise artifact-fresh search decision", async () => {
  const store = createInMemorySessionStore();
  const firstHarness = makeHarness(store, defineSearchInvestmentPolicy({
    name: "roi-gate",
    revision: "v1",
    minEvaluations: 1,
    async decide() {
      return {
        state: SearchInvestmentState.DIMINISHING_RETURNS,
        action: SearchInvestmentAction.STOP,
        rationale: "v1 stops this trajectory"
      };
    }
  }));
  await firstHarness.start({
    sessionId: "policy-refresh",
    work: { objective: "policy freshness" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  const first = await firstHarness.vary("policy-refresh");
  assert.equal(first.searchInvestment.action, SearchInvestmentAction.STOP);

  const secondHarness = makeHarness(store, defineSearchInvestmentPolicy({
    name: "roi-gate",
    revision: "v2",
    minEvaluations: 1,
    async decide() {
      return {
        state: SearchInvestmentState.IN_RANGE,
        action: SearchInvestmentAction.CONTINUE,
        rationale: "v2 allows continued search"
      };
    }
  }));

  const refreshed = await secondHarness.searchInvestmentStatus("policy-refresh");
  assert.notEqual(refreshed.id, first.searchInvestment.id);
  assert.equal(refreshed.policy.revision, "v2");
  assert.equal(refreshed.action, SearchInvestmentAction.CONTINUE);
});
