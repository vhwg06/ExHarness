import test from "node:test";
import assert from "node:assert/strict";
import {
  EvaluationValidity,
  EvaluationVerdict,
  VariationStatus,
  createAVOHarness,
  createInMemorySessionStore
} from "../src/index.js";

function harness() {
  return createAVOHarness({
    strategy: {
      async run() {
        return null;
      }
    },
    environment: {
      async observe() {
        return null;
      },
      async act({ candidate }) {
        return { mutated: false, candidate };
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
        return { enabled: false, reason: "disabled for variation persistence test" };
      }
    }
  });
}

test("a started variation is persistent and blocks overlapping variation until recovery or completion", async () => {
  const subject = harness();
  await subject.start({
    sessionId: "s1",
    work: { objective: "persist running variation" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const started = await subject.beginVariation("s1", {
    problem: "simulate interruption",
    policy: { maxCapabilityCalls: 4 }
  });

  assert.equal(started.status, VariationStatus.RUNNING);
  assert.equal(started.baseCandidate.version, "v0");

  const resumed = await subject.resume("s1");
  assert.equal(resumed.progress.variations, 1);

  const history = await subject.variations("s1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, VariationStatus.RUNNING);

  await assert.rejects(
    () => subject.beginVariation("s1"),
    /variation already running/
  );
});
