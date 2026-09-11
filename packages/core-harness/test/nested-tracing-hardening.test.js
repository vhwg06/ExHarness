import assert from "node:assert/strict";
import test from "node:test";

import {
  EvaluationValidity,
  EvaluationVerdict,
  ResourceLifetime,
  TraceSpanKind,
  createAgentRuntime,
  createHarness,
  createTraceRecorder,
  defineResource
} from "../src/index.js";

test("N7 preserves the pre-existing direct ResourceRef describe API shape", async () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return null; } },
    resources: [defineResource({
      name: "repo",
      lifetime: ResourceLifetime.AGENT,
      value: {},
      metadata: { kind: "repository" },
      operations: []
    })]
  });

  const ref = runtime.resourceRefs()[0];
  const descriptionPromise = runtime.describeResource(ref);
  assert.equal(typeof descriptionPromise?.then, "function");
  const description = await descriptionPromise;
  assert.equal(description.metadata.kind, "repository");
});

test("default runtime does not retain hidden trace history when tracing is not configured", async () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return "ok"; } }
  });

  assert.equal(await runtime.run(), "ok");
  assert.deepEqual(runtime.traces(), []);
  assert.deepEqual(runtime.traceFailures(), []);
});

test("strict trace sink failure never replaces an already-existing engineering error", async () => {
  const tracer = createTraceRecorder({
    sinks: [{ name: "broken", async write() { throw new Error("trace sink down"); } }],
    strict: true
  });
  const runtime = createAgentRuntime({
    tracer,
    strategy: {
      async run() {
        throw new Error("engineering failure");
      }
    }
  });

  await assert.rejects(runtime.run(), /engineering failure/);
  assert(runtime.traceFailures().length > 0);
});

test("production facade composes an injected tracer and exposes causal runtime spans", async () => {
  const tracer = createTraceRecorder();
  const harness = createHarness({
    tracer,
    strategy: { async run() { return { finished: true }; } },
    environment: {
      async observe({ request }) {
        return { request };
      },
      async act({ candidate }) {
        return { mutated: false, candidate, result: null };
      }
    },
    objective: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.FAIL
        };
      }
    }
  });

  await harness.start({
    sessionId: "trace-facade",
    work: { objective: "prove trace composition" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  await harness.vary("trace-facade");

  const spans = harness.traces();
  assert(spans.some((span) => span.kind === TraceSpanKind.AGENT_RUN));
  assert(spans.some((span) => span.kind === TraceSpanKind.STRATEGY));
  assert.equal(harness.traceFailures().length, 0);
});

test("production facade refuses to silently ignore tracer when a custom agent owns runtime observability", () => {
  const tracer = createTraceRecorder();
  assert.throws(
    () => createHarness({
      tracer,
      agent: {},
      environment: {
        async observe() { return {}; },
        async act({ candidate }) { return { mutated: false, candidate, result: null }; }
      },
      objective: {
        async evaluate() {
          return {
            validity: EvaluationValidity.VALID,
            verdict: EvaluationVerdict.FAIL
          };
        }
      }
    }),
    /custom agent must own its tracer/
  );
});
