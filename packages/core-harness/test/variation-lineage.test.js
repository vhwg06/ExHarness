import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  createAVOHarness,
  createAgentRuntime,
  createInMemorySessionStore
} from "../src/index.js";

function baseHarness(agent) {
  return createAVOHarness({
    agent,
    environment: {
      async observe() {
        return null;
      },
      async act({ candidate, action }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion }
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
        return { enabled: false, reason: "not needed for variation lineage tests" };
      }
    }
  });
}

test("variation exposes P_t -> P_t+1 when the agent commits a candidate", async () => {
  const agent = createAgentRuntime({
    strategy: {
      async run({ input, invoke }) {
        assert.equal(input.lineageHead.candidate.version, "v0");
        await invoke(AVOCapability.ACT, { nextVersion: "v1" });
        await invoke(AVOCapability.EVALUATE);
        await invoke(AVOCapability.PROMOTE);
        return "done";
      }
    }
  });

  const harness = baseHarness(agent);
  await harness.start({
    sessionId: "s1",
    work: { objective: "advance lineage" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("s1");

  assert.equal(variation.lineage.advanced, true);
  assert.equal(variation.lineage.before.candidate.version, "v0");
  assert.equal(variation.lineage.after.candidate.version, "v1");
  assert.deepEqual(variation.lineage.after.parent, { id: "candidate", version: "v0" });
});

test("variation can search without advancing committed lineage", async () => {
  const agent = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.ACT, { nextVersion: "v1" });
        return "searching";
      }
    }
  });

  const harness = baseHarness(agent);
  await harness.start({
    sessionId: "s1",
    work: { objective: "keep searching" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("s1");

  assert.equal(variation.after.version, "v1");
  assert.equal(variation.lineage.advanced, false);
  assert.equal(variation.lineage.before.candidate.version, "v0");
  assert.equal(variation.lineage.after.candidate.version, "v0");
});
