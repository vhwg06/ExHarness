import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  CorePractice,
  EvaluationValidity,
  EvaluationVerdict,
  createAVOHarness,
  createAgentRuntime,
  createInMemorySessionStore,
  defineCapability
} from "../src/index.js";

function alwaysOnDosage() {
  return {
    async decide({ practice }) {
      return { enabled: true, dose: { mode: "test" }, reason: `test dose for ${practice}` };
    }
  };
}

function quietSupervisor() {
  return {
    async inspect() {
      return null;
    }
  };
}

function nullProjector() {
  return {
    async project() {
      return null;
    }
  };
}

test("NOOA-style runtime exposes typed capability boundaries to a strategy", async () => {
  const seen = [];
  const runtime = createAgentRuntime({
    capabilities: [
      defineCapability({
        name: "math.double",
        parseInput(value) {
          assert.equal(typeof value, "number");
          return value;
        },
        parseOutput(value) {
          assert.equal(typeof value, "number");
          return value;
        },
        async execute(value) {
          return value * 2;
        }
      })
    ],
    strategy: {
      async run({ capabilities, invoke }) {
        seen.push(...capabilities.map((item) => item.name));
        return invoke("math.double", 21);
      }
    }
  });

  assert.equal(await runtime.run(), 42);
  assert.deepEqual(seen, ["math.double"]);
});

test("AVO variation is an autonomous agent run over session-scoped capabilities", async () => {
  let ids = 0;
  let ticks = 0;
  const store = createInMemorySessionStore();

  const agent = createAgentRuntime({
    strategy: {
      async run({ capabilities, invoke }) {
        const names = capabilities.map((item) => item.name);
        assert.ok(names.includes(AVOCapability.OBSERVE));
        assert.ok(names.includes(AVOCapability.ACT));
        assert.ok(names.includes(AVOCapability.EVALUATE));
        assert.ok(names.includes(AVOCapability.PROMOTE));

        await invoke(AVOCapability.OBSERVE, { kind: "inspect" });
        await invoke(AVOCapability.ACT, { mutate: true, nextVersion: "v1" });
        const evaluation = await invoke(AVOCapability.EVALUATE);
        assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
        await invoke(AVOCapability.PROMOTE);
        return { status: "COMMITTED" };
      }
    }
  });

  const harness = createAVOHarness({
    agent,
    environment: {
      async observe({ candidate, request }) {
        return { candidate: candidate.version, request };
      },
      async act({ candidate, action }) {
        if (!action.mutate) return { mutated: false, result: null };
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: { from: candidate.version, to: action.nextVersion }
        };
      }
    },
    objective: {
      async evaluate({ candidate }) {
        return {
          validity: EvaluationValidity.VALID,
          verdict: candidate.version === "v1" ? EvaluationVerdict.PASS : EvaluationVerdict.GAP
        };
      }
    },
    sessionStore: store,
    contextProjector: nullProjector(),
    supervisor: quietSupervisor(),
    dosagePolicy: alwaysOnDosage(),
    idFactory: () => `id-${++ids}`,
    clock: () => `2026-09-11T00:00:${String(++ticks).padStart(2, "0")}Z`
  });

  await harness.start({
    sessionId: "variation-1",
    work: { objective: "reach candidate v1" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("variation-1", { problem: "improve candidate" });
  assert.equal(variation.before.version, "v0");
  assert.equal(variation.after.version, "v1");
  assert.equal(variation.result.status, "COMMITTED");

  const lineage = await harness.lineage("variation-1");
  assert.equal(lineage.length, 2);
  assert.equal(lineage.at(-1).candidate.version, "v1");
});

test("AVO facade keeps core promotion authority outside the agent strategy", async () => {
  const store = createInMemorySessionStore();
  const agent = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.ACT, { mutate: true, nextVersion: "v1" });
        await assert.rejects(() => invoke(AVOCapability.PROMOTE), /has not been evaluated/);
        return { status: "SEARCHING" };
      }
    }
  });

  const harness = createAVOHarness({
    agent,
    environment: {
      async observe() {
        return null;
      },
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
    sessionStore: store,
    contextProjector: nullProjector(),
    supervisor: quietSupervisor(),
    dosagePolicy: {
      async decide({ practice }) {
        if (practice === CorePractice.CONTEXT_PROJECTION) {
          return { enabled: false, reason: "base context is sufficient" };
        }
        return { enabled: false, reason: "supervision not needed" };
      }
    }
  });

  await harness.start({
    sessionId: "authority-1",
    work: { objective: "promotion stays deterministic" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("authority-1");
  assert.equal(variation.after.version, "v1");
  assert.equal((await harness.lineage("authority-1")).length, 1);
});
