import test from "node:test";
import assert from "node:assert/strict";

import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  createAVOHarness,
  createAgentRuntime,
  createInMemorySessionStore,
  createTraceRecorder
} from "../src/index.js";

function alwaysOffDosage() {
  return {
    async decide() {
      return { enabled: false, reason: "not needed for observation provenance test" };
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

function createHarnessOptions(overrides = {}) {
  return {
    strategy: {
      async run() {
        return null;
      }
    },
    environment: {
      async observe({ candidate, request }) {
        return { candidate: candidate.version, request };
      },
      async act({ candidate }) {
        return { mutated: false, candidate, result: null };
      }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.GAP };
      }
    },
    sessionStore: createInMemorySessionStore(),
    contextProjector: nullProjector(),
    supervisor: quietSupervisor(),
    dosagePolicy: alwaysOffDosage(),
    ...overrides
  };
}

test("direct observations remain compatible while gaining durable artifact identity", async () => {
  const harness = createAVOHarness(createHarnessOptions());

  await harness.start({
    sessionId: "observation-direct",
    work: { objective: "inspect candidate" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const observation = await harness.observe("observation-direct", { probe: true });

  assert.deepEqual(observation.artifactRef, {
    kind: "OBSERVATION",
    id: observation.id
  });
  assert.equal(observation.candidate.version, "v0");
  assert.equal(observation.provenance.sessionId, "observation-direct");
  assert.equal(observation.provenance.variationId, null);
  assert.equal(observation.provenance.runtime, null);
  assert.deepEqual(observation.provenance.source, {
    kind: "ENVIRONMENT",
    name: "environment.observe"
  });
});

test("capability-triggered observations use runtime-owned call and turn provenance", async () => {
  const tracer = createTraceRecorder();
  const agent = createAgentRuntime({
    tracer,
    strategy: {
      turnAwareContext: true,
      async run({ prepareTurn, invoke }) {
        await prepareTurn({ reportedTurn: 999 });
        return invoke(AVOCapability.OBSERVE, {
          probe: "runtime-owned-provenance",
          callId: "forged-call",
          turn: 999
        });
      }
    }
  });
  const harness = createAVOHarness(createHarnessOptions({ agent }));

  await harness.start({
    sessionId: "observation-runtime",
    work: { objective: "prove provenance ownership" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("observation-runtime");
  const observation = variation.result;
  const stored = (await harness.observations("observation-runtime")).at(-1);

  assert.equal(observation.id, stored.id);
  assert.deepEqual(observation.artifactRef, stored.artifactRef);
  assert.equal(observation.provenance.sessionId, "observation-runtime");
  assert.equal(observation.provenance.variationId, variation.variation.id);
  assert.equal(observation.provenance.runtime.turn, 1);
  assert.notEqual(observation.provenance.runtime.callId, "forged-call");
  assert.equal(typeof observation.provenance.runtime.callId, "string");
  assert.equal(typeof observation.provenance.runtime.trace.traceId, "string");
  assert.equal(typeof observation.provenance.runtime.trace.spanId, "string");
  assert.notEqual(observation.provenance.runtime.trace.spanId, observation.provenance.runtime.trace.traceId);
  assert.equal(observation.request.callId, "forged-call");
  assert.equal(observation.request.turn, 999);

  const capabilitySpan = tracer.spans().find(
    (span) => span.kind === "CAPABILITY" && span.name === AVOCapability.OBSERVE
  );
  assert(capabilitySpan);
  assert.equal(observation.provenance.runtime.trace.traceId, capabilitySpan.traceId);
  assert.equal(observation.provenance.runtime.trace.spanId, capabilitySpan.spanId);
});
