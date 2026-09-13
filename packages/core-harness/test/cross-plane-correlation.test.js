import test from "node:test";
import assert from "node:assert/strict";

import {
  AVOCapability,
  AgentEventKind,
  CodeActActionType,
  CodeActExecutionTarget,
  EvaluationValidity,
  EvaluationVerdict,
  createAVOHarness,
  createAgentEventStore,
  createAgentRuntime,
  createCodeActStrategy,
  createFakeExecutor,
  createInMemorySessionStore,
  createTraceRecorder
} from "../src/index.js";

function quietSupervisor() {
  return { async inspect() { return null; } };
}

function nullProjector() {
  return { async project() { return null; } };
}

function alwaysOffDosage() {
  return {
    async decide() {
      return { enabled: false, reason: "not needed for correlation test" };
    }
  };
}

function harnessOptions(agent) {
  return {
    agent,
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
    dosagePolicy: alwaysOffDosage()
  };
}

test("CodeAct links AgentEvent -> Observation -> capability TraceSpan without collapsing authority planes", async () => {
  const tracer = createTraceRecorder();
  const model = {
    name: "correlation-model",
    version: "1",
    async generate({ turn }) {
      if (turn === 1) {
        return {
          type: CodeActActionType.EXECUTE,
          target: CodeActExecutionTarget.CAPABILITY,
          name: AVOCapability.OBSERVE,
          input: { probe: "cross-plane" }
        };
      }
      return {
        type: CodeActActionType.RETURN_RESULT,
        value: { status: "DONE" }
      };
    }
  };
  const strategy = createCodeActStrategy({
    model,
    executor: createFakeExecutor(),
    maxTurns: 2
  });
  const agent = createAgentRuntime({ strategy, tracer });
  const harness = createAVOHarness(harnessOptions(agent));

  await harness.start({
    sessionId: "correlation-session",
    work: { objective: "prove causal refs" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("correlation-session");
  assert.deepEqual(variation.result, { status: "DONE" });

  const observation = (await harness.observations("correlation-session")).at(-1);
  assert(observation);

  const actionEvent = agent.agentEvents().find((event) => event.type === AgentEventKind.ACTION_OUTPUT);
  assert(actionEvent);
  assert.deepEqual(actionEvent.eventRef, {
    kind: "AGENT_EVENT",
    id: actionEvent.id
  });
  assert.deepEqual(actionEvent.links, [
    {
      kind: "PRODUCED_ARTIFACT",
      target: observation.artifactRef
    }
  ]);
  assert.deepEqual(actionEvent.payload.output.artifactRef, observation.artifactRef);

  const capabilitySpan = tracer.spans().find(
    (span) => span.kind === "CAPABILITY" && span.name === AVOCapability.OBSERVE
  );
  assert(capabilitySpan);
  assert.equal(observation.provenance.runtime.callId, actionEvent.callId);
  assert.equal(observation.provenance.runtime.turn, 1);
  assert.equal(observation.provenance.runtime.trace.traceId, capabilitySpan.traceId);
  assert.equal(observation.provenance.runtime.trace.spanId, capabilitySpan.spanId);
});

test("AgentEventStore rejects cross-call artifact laundering in ACTION_OUTPUT correlation", () => {
  let id = 0;
  const store = createAgentEventStore({
    idFactory: () => `event-${++id}`,
    clock: () => "2026-09-13T00:00:00.000Z"
  });

  assert.throws(
    () => store.record(AgentEventKind.ACTION_OUTPUT, {
      callId: "call-a",
      payload: {
        turn: 1,
        output: {
          artifactRef: { kind: "OBSERVATION", id: "observation-1" },
          provenance: {
            runtime: {
              callId: "call-b",
              turn: 1,
              trace: { traceId: "trace-1", spanId: "span-1" }
            }
          }
        }
      }
    }),
    /cannot link an artifact from another runtime call/
  );

  assert.equal(store.events().length, 0);
});
