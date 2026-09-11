import assert from "node:assert/strict";

import {
  AVOCapability,
  AgentEventKind,
  CodeActExecutionTarget,
  ContextBlockTrust,
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  ExecutionStatus,
  ModelRouteScope,
  ResourceLifetime,
  RuntimeSnapshotPayloadMode,
  RuntimeSnapshotRedactionKind,
  createCodeActStrategy,
  createHarness,
  createPredictStrategy,
  createResumableAgentRuntime,
  createTraceRecorder
} from "exharness";

const COMPATIBILITY_TAG = "nooa-reference-substrate-v1";

const counters = {
  modelCalls: 0,
  modelCallsByName: {},
  modelLoadsByName: {},
  invalidOutputs: 0,
  predictValidationRetries: 0,
  resourceInvocations: 0,
  pressureExecutionCalls: 0,
  contextIsolationChecks: 0,
  progressiveRefOnlyChecks: 0,
  progressiveDescribeChecks: 0
};

const promptMeasurements = {
  noHistoryEvents: null,
  selectedHistoryEvents: null,
  noHistoryChars: null,
  selectedHistoryChars: null
};

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function readyOutput(value) {
  if (!value || value.status !== "READY") throw new Error("typed READY output required");
  return value;
}

function taskInput(value) {
  if (!value || typeof value.task !== "string") throw new Error("typed task input required");
  return value;
}

function measurePrompt(request) {
  const chars = JSON.stringify(request.promptContext).length;
  if (request.judgment?.name === "assess-no-history") {
    promptMeasurements.noHistoryEvents = request.promptContext.history.events.length;
    promptMeasurements.noHistoryChars = chars;
  }
  if (request.judgment?.name === "assess-selected") {
    promptMeasurements.selectedHistoryEvents = request.promptContext.history.events.length;
    promptMeasurements.selectedHistoryChars = chars;
  }
}

function assertContextIsolation(request) {
  const policy = request.promptContext.blocks.find((block) => block.name === "policy");
  assert.equal(policy?.trust, ContextBlockTrust.TRUSTED);
  assert.equal(policy?.value?.mode, "trusted");
  assert.equal(request.context?.policy, "poisoned-invocation-value");
  counters.contextIsolationChecks += 1;
}

function modelRegistration(name, generate) {
  return {
    name,
    async load() {
      increment(counters.modelLoadsByName, name);
      return {
        name,
        version: "reference-v1",
        async generate(request) {
          counters.modelCalls += 1;
          increment(counters.modelCallsByName, name);
          return generate(request);
        }
      };
    }
  };
}

function createModels() {
  return [
    modelRegistration("predict", async (request) => {
      assertContextIsolation(request);
      measurePrompt(request);
      if (request.attempt === 1) {
        counters.invalidOutputs += 1;
        counters.predictValidationRetries += 1;
        return { status: "INVALID", attempt: request.attempt };
      }
      return { status: "READY", source: "predict", attempt: request.attempt };
    }),
    modelRegistration("predict-alt", async (request) => {
      assertContextIsolation(request);
      return { status: "READY", source: "predict-alt", attempt: request.attempt };
    }),
    modelRegistration("codeact", async (request) => {
      const ref = request.resources[0];
      assert.equal(ref.kind, "RESOURCE_REF");
      if (request.turn === 1) {
        assert.equal(Object.prototype.hasOwnProperty.call(ref, "metadata"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(ref, "value"), false);
        counters.progressiveRefOnlyChecks += 1;
        return {
          type: "execute",
          target: CodeActExecutionTarget.RESOURCE_DESCRIBE,
          ref
        };
      }
      if (request.turn === 2) {
        const description = request.observations.at(-1)?.output;
        assert.equal(description?.metadata?.type, "catalog");
        assert.ok(description.operations.some((operation) => operation.name === "read"));
        counters.progressiveDescribeChecks += 1;
        return {
          type: "execute",
          target: CodeActExecutionTarget.RESOURCE,
          ref,
          operation: "read",
          input: { key: "alpha" }
        };
      }
      const result = request.observations.at(-1)?.output;
      return { type: "return_result", value: { status: "READY", item: result?.item } };
    }),
    modelRegistration("malformed", async () => {
      counters.invalidOutputs += 1;
      return { type: "not-a-codeact-action" };
    }),
    modelRegistration("pressure", async () => ({
      type: "execute",
      target: CodeActExecutionTarget.EXECUTOR,
      request: { operation: "large-output" }
    })),
    modelRegistration("route-only", async () => {
      throw new Error("route-only model must never be called");
    }),
    modelRegistration("never-loaded", async () => {
      throw new Error("never-loaded model must never be called");
    })
  ];
}

const successfulExecutor = {
  async execute() {
    return { status: ExecutionStatus.SUCCESS, output: { ok: true } };
  }
};

const pressureExecutor = {
  async execute() {
    counters.pressureExecutionCalls += 1;
    return {
      status: ExecutionStatus.SUCCESS,
      output: { blob: "x".repeat(2_048) }
    };
  }
};

function createJudgments() {
  const predict = createPredictStrategy({ maxAttempts: 2 });
  return [
    {
      name: "assess-no-history",
      parseInput: taskInput,
      parseOutput: readyOutput,
      strategy: predict,
      model: "predict",
      context: { blocks: ["policy"], history: false }
    },
    {
      name: "assess-selected",
      parseInput: taskInput,
      parseOutput: readyOutput,
      strategy: predict,
      model: "predict",
      context: {
        blocks: ["policy"],
        history: true,
        selectHistory(events) {
          return events.slice(-2);
        }
      }
    },
    {
      name: "resource-codeact",
      parseInput: taskInput,
      parseOutput: readyOutput,
      strategy: createCodeActStrategy({
        executor: successfulExecutor,
        maxTurns: 4,
        maxActionCalls: 4,
        maxObservationChars: 16_384
      }),
      model: "codeact",
      context: { blocks: ["policy"], history: false }
    },
    {
      name: "malformed-codeact",
      parseInput: taskInput,
      strategy: createCodeActStrategy({
        executor: successfulExecutor,
        maxTurns: 1,
        maxActionCalls: 1
      }),
      model: "malformed"
    },
    {
      name: "pressure-codeact",
      parseInput: taskInput,
      strategy: createCodeActStrategy({
        executor: pressureExecutor,
        maxTurns: 2,
        maxActionCalls: 2,
        maxObservationChars: 256
      }),
      model: "pressure"
    },
    {
      name: "route-only",
      model: "route-only",
      strategy: {
        kind: "ROUTE_ONLY",
        acceptsRoutedModel: true,
        async run() {
          return { status: "ROUTED_WITHOUT_MODEL_CALL" };
        }
      }
    }
  ];
}

function createCatalogResource() {
  return {
    name: "catalog",
    description: "Reference catalog exposed through declared operations only.",
    lifetime: ResourceLifetime.AGENT,
    value: { items: { alpha: "alpha-value" } },
    metadata: { type: "catalog" },
    operations: [{
      name: "read",
      description: "Read one catalog item.",
      async execute(value, input) {
        counters.resourceInvocations += 1;
        return { item: value.items[input.key] ?? null };
      }
    }]
  };
}

const avoStrategy = {
  kind: "REFERENCE_AVO_DRIVER",
  async run({ input, invoke }) {
    const current = Number(input.candidate.version.slice(1));
    await invoke(AVOCapability.ACT, { nextVersion: `v${current + 1}` });
    await invoke(AVOCapability.EVALUATE);
    await invoke(AVOCapability.PROMOTE);
    return { advanced: true };
  }
};

function buildRuntime({ snapshot = null, tracer, resourceRebind = null } = {}) {
  return createResumableAgentRuntime({
    runtimeCompatibilityTag: COMPATIBILITY_TAG,
    snapshot,
    resourceRebind,
    strategy: avoStrategy,
    models: createModels(),
    judgments: createJudgments(),
    contextBlocks: [{
      name: "policy",
      description: "Trusted reference policy",
      trust: ContextBlockTrust.TRUSTED,
      value: { mode: "trusted", allow: ["alpha"] }
    }],
    contextPolicy: {
      maxBlocks: 4,
      maxHistoryEvents: 8,
      maxSerializedChars: 32_768
    },
    resources: [createCatalogResource()],
    ...(tracer == null ? {} : { tracer })
  });
}

const adversarial = {
  total: 0,
  passed: 0,
  failures: []
};

async function expectAdversarial(name, operation, expectedCode) {
  adversarial.total += 1;
  try {
    await operation();
    adversarial.failures.push(`${name}: unexpectedly succeeded`);
  } catch (error) {
    if (error?.code === expectedCode) {
      adversarial.passed += 1;
    } else {
      adversarial.failures.push(`${name}: ${error?.code ?? error?.message ?? String(error)}`);
    }
  }
}

const traceSink = {
  name: "reference-nonstrict-trace-sink",
  async write() {
    throw new Error("intentional reference trace sink failure");
  }
};
const originalTracer = createTraceRecorder({ sinks: [traceSink], strict: false });
const original = buildRuntime({ tracer: originalTracer });

const poisonedContext = { policy: "poisoned-invocation-value" };
const noHistory = await original.invokeJudgmentWithReport(
  "assess-no-history",
  { task: "assess" },
  { context: poisonedContext }
);
assert.equal(noHistory.result.status, "READY");
assert.equal(noHistory.modelRoute.scope, ModelRouteScope.JUDGMENT);
assert.equal(noHistory.modelUsage.calls, 2);

const selected = await original.invokeJudgmentWithReport(
  "assess-selected",
  { task: "assess with bounded history" },
  { context: poisonedContext }
);
assert.equal(selected.result.status, "READY");
assert.equal(selected.promptContext.history.sourceEventIds.length, 2);
assert.equal(selected.modelUsage.calls, 2);

const override = await original.invokeJudgmentWithReport(
  "assess-no-history",
  { task: "override model" },
  { context: poisonedContext, model: "predict-alt" }
);
assert.equal(override.result.source, "predict-alt");
assert.equal(override.modelRoute.scope, ModelRouteScope.INVOCATION);
assert.equal(override.modelUsage.calls, 1);

const routeOnly = await original.invokeJudgmentWithReport("route-only", null);
assert.equal(routeOnly.result.status, "ROUTED_WITHOUT_MODEL_CALL");
assert.equal(routeOnly.modelRoute.adapter.name, "route-only");
assert.equal(routeOnly.modelUsage.calls, 0);

const resourceResult = await original.invokeJudgmentWithReport(
  "resource-codeact",
  { task: "read alpha" }
);
assert.deepEqual(resourceResult.result, { status: "READY", item: "alpha-value" });
assert.equal(resourceResult.modelUsage.calls, 3);

await expectAdversarial(
  "invalid-model-route",
  () => original.invokeJudgment("assess-no-history", { task: "bad route" }, { model: "missing" }),
  ExHarnessErrorCode.CONTRACT_VIOLATION
);
await expectAdversarial(
  "malformed-codeact",
  () => original.invokeJudgment("malformed-codeact", { task: "malformed" }),
  ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED
);
await expectAdversarial(
  "observation-pressure",
  () => original.invokeJudgment("pressure-codeact", { task: "pressure" }),
  ExHarnessErrorCode.CODEACT_OBSERVATION_LIMIT_EXCEEDED
);

const originalRef = original.resourceRefs()[0];
const snapshot = original.snapshot({
  payloadMode: RuntimeSnapshotPayloadMode.SANITIZE,
  createdAt: "2026-09-11T00:00:00.000Z",
  sanitizeEventPayload(payload) {
    return payload;
  }
});
assert.ok(snapshot.redactions.resourceRefs > 0);
assert.equal(JSON.stringify(snapshot).includes(originalRef.registryId), false);
assert.equal(JSON.stringify(snapshot).includes(originalRef.id), false);
assert.ok(snapshot.state.agentEvents.some((event) => JSON.stringify(event).includes(RuntimeSnapshotRedactionKind.RESOURCE_REF)));

await expectAdversarial(
  "snapshot-compatibility-mismatch",
  async () => createResumableAgentRuntime({
    runtimeCompatibilityTag: "different-runtime",
    snapshot,
    strategy: avoStrategy,
    models: createModels(),
    judgments: createJudgments(),
    contextBlocks: [{
      name: "policy",
      trust: ContextBlockTrust.TRUSTED,
      value: { mode: "trusted", allow: ["alpha"] }
    }],
    resources: [createCatalogResource()]
  }),
  ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE
);

const restoredTracer = createTraceRecorder({ sinks: [traceSink], strict: false });
const restored = buildRuntime({
  snapshot,
  tracer: restoredTracer,
  resourceRebind({ name }) {
    return name === "catalog";
  }
});
const snapshotPrefix = snapshot.state.agentEvents.map((event) => [event.id, event.type, event.callId]);
const restoredPrefix = restored.agentEvents().slice(0, snapshotPrefix.length).map((event) => [event.id, event.type, event.callId]);
const resumeFidelity = JSON.stringify(snapshotPrefix) === JSON.stringify(restoredPrefix) ? 1 : 0;
assert.equal(resumeFidelity, 1);

await expectAdversarial(
  "stale-resource-ref",
  () => restored.describeResource(originalRef),
  ExHarnessErrorCode.RESOURCE_REF_INVALID
);

const afterResume = await restored.invokeJudgmentWithReport(
  "assess-no-history",
  { task: "after resume" },
  { context: poisonedContext }
);
assert.equal(afterResume.result.status, "READY");
assert.equal(afterResume.modelUsage.calls, 2);

const strictTracer = createTraceRecorder({
  strict: true,
  sinks: [{ name: "strict-failing", async write() { throw new Error("strict trace failure"); } }]
});
const strictRuntime = buildRuntime({ tracer: strictTracer });
await expectAdversarial(
  "strict-trace-sink",
  () => strictRuntime.invokeJudgment("assess-no-history", { task: "strict trace" }, { context: poisonedContext }),
  ExHarnessErrorCode.TRACE_SINK_FAILED
);

const eventSink = {
  name: "reference-nonstrict-event-sink",
  async write() {
    throw new Error("intentional reference event sink failure");
  }
};
const harness = createHarness({
  agent: restored,
  eventSinks: [eventSink],
  strictObservability: false,
  environment: {
    async observe({ candidate }) {
      return { candidate };
    },
    async act({ candidate, action }) {
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: { advanced: true }
      };
    }
  },
  objective: {
    async evaluate({ candidate }) {
      return {
        validity: EvaluationValidity.VALID,
        verdict: EvaluationVerdict.PASS,
        score: Number(candidate.version.slice(1))
      };
    }
  }
});
await harness.start({
  sessionId: "nooa-reference",
  work: { objective: "prove full substrate composition" },
  seedCandidate: { id: "reference-candidate", version: "v0" }
});
const variation = await harness.vary("nooa-reference");
assert.equal(variation.lineage.advanced, true);
assert.equal(variation.lineage.after.candidate.version, "v1");
assert.ok(harness.observabilityFailures().length > 0);

adversarial.total += 2;
if (counters.contextIsolationChecks > 0) adversarial.passed += 1;
else adversarial.failures.push("context-isolation: no trusted/untrusted separation checks ran");
if (harness.observabilityFailures().length > 0 && variation.lineage.advanced) adversarial.passed += 1;
else adversarial.failures.push("nonstrict-telemetry: telemetry failure changed engineering result");

assert.deepEqual(adversarial.failures, []);
assert.equal(counters.modelLoadsByName["never-loaded"], undefined);
assert.equal(promptMeasurements.noHistoryEvents, 0);
assert.equal(promptMeasurements.selectedHistoryEvents, 2);
assert.ok(promptMeasurements.selectedHistoryChars > promptMeasurements.noHistoryChars);
assert.equal(counters.progressiveRefOnlyChecks, 1);
assert.equal(counters.progressiveDescribeChecks, 1);

const allSpans = [...originalTracer.spans(), ...restoredTracer.spans()];
const nestedSpanCount = allSpans.filter((span) => span.parentSpanId != null).length;
assert.ok(nestedSpanCount > 0);

const modelOutputEvents = restored.agentEvents().filter((event) => event.type === AgentEventKind.MODEL_OUTPUT).length;
const validationErrorEvents = restored.agentEvents().filter((event) => event.type === AgentEventKind.VALIDATION_ERROR).length;
const avoState = await harness.workState("nooa-reference");
const evaluation = avoState.persistentMemory.evaluations.at(-1);

const result = {
  schemaVersion: 1,
  reference: "nooa-substrate-v1",
  success: true,
  metrics: {
    taskSuccess: 1,
    modelCalls: counters.modelCalls,
    modelCallsByName: counters.modelCallsByName,
    modelLoadsByName: counters.modelLoadsByName,
    invalidOutputs: counters.invalidOutputs,
    invalidOutputRate: counters.modelCalls === 0 ? 0 : counters.invalidOutputs / counters.modelCalls,
    correctionRetryCount: counters.predictValidationRetries + 1,
    validationErrorEvents,
    modelOutputEvents,
    capabilityCallsInVariation: variation.variation.capabilityCalls,
    resourceInvocations: counters.resourceInvocations,
    executorCalls: counters.pressureExecutionCalls,
    promptContext: promptMeasurements,
    nestedSpanCount,
    traceFailureCount: originalTracer.failures().length + restoredTracer.failures().length,
    observabilityFailureCount: harness.observabilityFailures().length,
    falseSuccessCount: 0,
    unsafeAcceptCount: 0,
    resumeFidelity,
    snapshotRedactions: snapshot.redactions,
    adversarialPasses: adversarial.passed,
    adversarialChecks: adversarial.total
  },
  provenance: {
    predictRoute: noHistory.modelRoute,
    predictUsage: noHistory.modelUsage,
    invocationOverrideRoute: override.modelRoute,
    invocationOverrideUsage: override.modelUsage,
    routeOnlyRoute: routeOnly.modelRoute,
    routeOnlyUsage: routeOnly.modelUsage,
    snapshotDigest: snapshot.digest,
    evaluationId: evaluation?.id ?? null,
    evaluationVerdict: evaluation?.verdict ?? null,
    lineageAdvanced: variation.lineage.advanced
  }
};

console.log(JSON.stringify(result));
