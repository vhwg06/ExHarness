import test from "node:test";
import assert from "node:assert/strict";
import {
  EvaluationValidity,
  EvaluationVerdict,
  createAVOHarness,
  createInMemorySessionStore
} from "../src/index.js";

test("new observation invalidates a previous PASS before promotion", async () => {
  const harness = createAVOHarness({
    strategy: { async run() { return null; } },
    environment: {
      async observe({ request }) { return { request }; },
      async act({ candidate, action }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: null
        };
      }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    sessionStore: createInMemorySessionStore(),
    contextProjector: { async project() { return null; } },
    supervisor: { async inspect() { return null; } },
    dosagePolicy: {
      async decide() {
        return { enabled: false, reason: "not needed for input freshness test" };
      }
    }
  });

  await harness.start({
    sessionId: "observation-freshness",
    work: { objective: "re-evaluate when evidence changes" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  await harness.act("observation-freshness", { nextVersion: "v1" });
  await harness.observe("observation-freshness", { check: "before-evaluation" });

  const evaluation = await harness.evaluate("observation-freshness");
  assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
  assert.equal(evaluation.metadata.inputSnapshot.observationIds.length, 1);

  await harness.observe("observation-freshness", { check: "new-evidence" });

  await assert.rejects(
    () => harness.promote("observation-freshness"),
    /observations changed since evaluation; re-evaluate before promotion/
  );

  const reevaluation = await harness.evaluate("observation-freshness");
  assert.equal(reevaluation.metadata.inputSnapshot.observationIds.length, 2);
  const promotion = await harness.promote("observation-freshness");
  assert.equal(promotion.candidate.version, "v1");
});
