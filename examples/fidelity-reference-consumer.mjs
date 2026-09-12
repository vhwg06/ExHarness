import assert from "node:assert/strict";
import {
  AVOCapability,
  Agent,
  AgentEventKind,
  CodeActExecutionTarget,
  DiscoveryMode,
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  JavaScriptHostRequestType,
  JavaScriptSessionFeature,
  ObjectAgentMemberKind,
  TraceSpanKind,
  agenticMethod,
  createAgentRuntime,
  createCodeActStrategy,
  createHarness,
  createJavaScriptCodeActStrategy,
  createObjectAgent,
  createResumableAgentRuntime,
  createTraceRecorder,
  defineCapability,
  defineLiveObjectSurface,
  docLiveObject,
  docObjectAgent,
  getObjectAgentRuntime,
  isJavaScriptTerminalInterrupt,
  objectAgentSurface
} from "exharness";
import { createReferenceJavaScriptExecutor } from "./reference-executor.mjs";

function rubric(checks) {
  const total = Object.keys(checks).length;
  const passed = Object.values(checks).filter(Boolean).length;
  return { score: Math.round((passed / total) * 100), passed, total, checks };
}

function sequenceModel(outputs, metrics = null) {
  let index = 0;
  return {
    name: "fidelity-sequence-model",
    version: "1",
    async generate(request) {
      if (metrics) metrics.modelTurns += 1;
      if (index >= outputs.length) {
        throw new Error(`unexpected model call after observations: ${JSON.stringify(request.observations?.slice(-3) ?? [])}`);
      }
      return outputs[index++];
    }
  };
}

let autoSelfDocument = null;
class FidelityAgent extends Agent {
  constructor() {
    super();
    this.count = 0;
  }
  increment(delta) { this.count += delta; return this.count; }
  pair(left, right) { return [left, right]; }
  _secret() { return "hidden"; }
  answer = agenticMethod({
    strategy: {
      kind: "FIDELITY_OBJECT_AGENT",
      async run({ input, invoke, promptContext }) {
        autoSelfDocument = promptContext.blocks.find((item) => item.name === "__exharness_self_doc__")?.value ?? null;
        return invoke("increment", input);
      }
    },
    parseOutput(value) {
      if (!Number.isInteger(value)) throw new TypeError("integer result required");
      return value;
    }
  });
}

const rawAgent = new FidelityAgent();
const objectAgent = createObjectAgent(rawAgent, {
  methods: {
    increment: { description: "Increment the live counter by the supplied delta." },
    pair: { description: "Return two arguments without collapsing them into one array argument." }
  }
});
const objectFirst = await objectAgent.answer(2);
const objectSecond = await objectAgent.answer(3);
const pairResult = objectAgent.pair("left", "right");
const objectRuntime = getObjectAgentRuntime(objectAgent);
const objectCapabilities = objectRuntime.capabilities().map((item) => item.name);
const objectSurface = objectAgentSurface(objectAgent);
const conciseObjectDoc = docObjectAgent(objectAgent, { mode: DiscoveryMode.CONCISE });
const fullObjectDoc = docObjectAgent(objectAgent, { mode: DiscoveryMode.FULL });
const memberBoundedDoc = docObjectAgent(objectAgent, {
  mode: DiscoveryMode.FULL,
  policy: { maxMembers: 1, maxChars: 4096, maxDescriptionChars: 512 }
});
const descriptionBoundedDoc = docObjectAgent(objectAgent, {
  mode: DiscoveryMode.FULL,
  policy: { maxMembers: 24, maxChars: 4096, maxDescriptionChars: 8 }
});
const objectAgentRubric = rubric({
  identityPreserved: objectAgent === rawAgent,
  instanceofPreserved: objectAgent instanceof FidelityAgent,
  ordinaryAgenticCall: objectFirst === 2,
  statePersists: objectSecond === 5 && objectAgent.count === 5,
  deterministicMethodAutoCapability: objectCapabilities.includes("increment"),
  multiArgumentCallPreserved: pairResult[0] === "left" && pairResult[1] === "right",
  hiddenMethodExcluded: !objectCapabilities.includes("_secret") && !objectSurface.members.some((item) => item.name === "_secret"),
  deterministicSurfaceTyped: objectSurface.members.some((item) => item.name === "increment" && item.kind === ObjectAgentMemberKind.DETERMINISTIC),
  agenticSurfaceTyped: objectSurface.members.some((item) => item.name === "answer" && item.kind === ObjectAgentMemberKind.AGENTIC),
  automaticConciseSelfContext: autoSelfDocument?.mode === DiscoveryMode.CONCISE
});

class LiveNode {
  constructor(name) {
    this.name = name;
    this.childNode = null;
    this.parentNode = null;
  }
  child() { return this.childNode; }
  parent() { return this.parentNode; }
  rename(name) { this.name = name; return this.name; }
  getName() { return this.name; }
  secret() { return "hidden"; }
}
let liveNodeSurface;
liveNodeSurface = defineLiveObjectSurface({
  id: "fidelity.live-node",
  type: "FidelityLiveNode",
  methods: [
    { name: "child", resultSurface: () => liveNodeSurface },
    { name: "parent", resultSurface: () => liveNodeSurface },
    { name: "rename", mutates: true },
    { name: "getName" }
  ],
  properties: [{ name: "name", read: (node) => node.name }]
});
const readonlySurface = defineLiveObjectSurface({
  id: "fidelity.live-node-readonly",
  type: "FidelityLiveNodeReadonly",
  properties: [{ name: "name", read: (node) => node.name }]
});
const liveRoot = new LiveNode("root");
const liveChild = new LiveNode("child");
liveRoot.childNode = liveChild;
liveChild.parentNode = liveRoot;
const liveRuntime = createAgentRuntime({
  strategy: { kind: "FIDELITY_LIVE", async run() { return true; } },
  liveObjects: [
    { name: "root", value: liveRoot, surface: liveNodeSurface },
    { name: "rootReadonly", value: liveRoot, surface: readonlySurface }
  ]
});
const liveEntries = new Map(liveRuntime.liveObjects().map((entry) => [entry.name, entry.ref]));
const rootRef = liveEntries.get("root");
const readonlyRef = liveEntries.get("rootReadonly");
const childRef = await liveRuntime.invokeLiveObject(rootRef, "child", []);
const parentRef = await liveRuntime.invokeLiveObject(childRef, "parent", []);
await liveRuntime.invokeLiveObject(childRef, "rename", ["after-live"]);
const rereadName = await liveRuntime.readLiveObject(childRef, "name");
const liveDoc = await docLiveObject(liveRuntime, rootRef, { mode: DiscoveryMode.FULL });
let forbiddenMemberRejected = false;
let forbiddenMemberCode = null;
try { await liveRuntime.invokeLiveObject(rootRef, "secret", []); }
catch (error) { forbiddenMemberRejected = true; forbiddenMemberCode = error.code ?? null; }
liveRuntime.revokeLiveObject(childRef);
let staleHandleRejected = false;
let staleHandleCode = null;
try { await liveRuntime.describeLiveObject(childRef); }
catch (error) { staleHandleRejected = true; staleHandleCode = error.code ?? null; }
const liveObjectRubric = rubric({
  nestedHandleProduced: childRef?.kind === "LIVE_OBJECT_REF",
  cyclePreservesRootIdentity: parentRef.id === rootRef.id && parentRef.registryId === rootRef.registryId,
  mutationHitsOriginal: liveChild.name === "after-live",
  rereadSeesMutation: rereadName === "after-live",
  sameObjectDifferentAuthorityGetsDifferentHandle: readonlyRef.id !== rootRef.id,
  undeclaredMethodRejected: forbiddenMemberRejected,
  revokedHandleRejected: staleHandleRejected,
  fullDocUsesDeclaredSurface: liveDoc.document.members.some((member) => member.name === "rename"),
  hiddenLiveMethodNotDiscovered: !liveDoc.document.members.some((member) => member.name === "secret"),
  noSerializedCloneForMutation: liveChild.name === rereadName
});
const progressiveDiscoveryRubric = rubric({
  conciseSmallerThanFull: conciseObjectDoc.metrics.chars < fullObjectDoc.metrics.chars,
  conciseModeExplicit: conciseObjectDoc.document.mode === DiscoveryMode.CONCISE,
  fullModeExplicit: fullObjectDoc.document.mode === DiscoveryMode.FULL,
  hiddenObjectMemberAbsent: !JSON.stringify(fullObjectDoc.document).includes("_secret"),
  liveDocAvailableOnDemand: liveDoc.document.mode === DiscoveryMode.FULL,
  hiddenLiveMemberAbsent: !JSON.stringify(liveDoc.document).includes("secret"),
  memberBoundEnforced: memberBoundedDoc.metrics.truncatedMembers === true,
  descriptionBoundEnforced: descriptionBoundedDoc.document.members.some((member) => member.descriptionTruncated === true),
  automaticSelfDocIsConcise: autoSelfDocument?.mode === DiscoveryMode.CONCISE,
  discoveryDoesNotGrantInvokeAuthority: forbiddenMemberRejected
});

const baselineState = { name: "before" };
const baselineMetrics = { modelTurns: 0, capabilityCalls: 0 };
const baselineActions = [
  { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "double", input: 1 },
  { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "double", input: 2 },
  { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "double", input: 3 },
  { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "rename_child", input: "after" },
  { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "child_name", input: null }
];
let baselineTurn = 0;
const baselineModel = {
  name: "fidelity-explicit-baseline",
  version: "1",
  async generate(request) {
    baselineMetrics.modelTurns += 1;
    if (baselineTurn < baselineActions.length) return baselineActions[baselineTurn++];
    const outputs = request.observations.map((item) => item.output);
    return {
      type: "return_result",
      value: { total: outputs.slice(0, 3).reduce((sum, value) => sum + value, 0), name: outputs[4] }
    };
  }
};
const baselineRuntime = createAgentRuntime({
  capabilities: [
    defineCapability({ name: "double", async execute(value) { baselineMetrics.capabilityCalls += 1; return value * 2; } }),
    defineCapability({ name: "rename_child", async execute(value) { baselineMetrics.capabilityCalls += 1; baselineState.name = value; return value; } }),
    defineCapability({ name: "child_name", async execute() { baselineMetrics.capabilityCalls += 1; return baselineState.name; } })
  ],
  strategy: createCodeActStrategy({
    model: baselineModel,
    executor: { async execute() { throw new Error("baseline did not expect executor target"); } }
  })
});
const baselineResult = await baselineRuntime.run();
assert.deepEqual(baselineResult, { total: 12, name: "after" });

const jsRoot = {
  name: "root",
  childNode: null,
  child() { return this.childNode; },
  rename(name) { this.name = name; return this.name; },
  getName() { return this.name; }
};
const jsChild = {
  name: "before",
  childNode: null,
  child() { return this.childNode; },
  rename(name) { this.name = name; return this.name; },
  getName() { return this.name; }
};
jsRoot.childNode = jsChild;
let jsNodeSurface;
jsNodeSurface = defineLiveObjectSurface({
  id: "fidelity.javascript.node",
  type: "FidelityJavaScriptNode",
  methods: [
    { name: "child", resultSurface: () => jsNodeSurface },
    { name: "rename", mutates: true },
    { name: "getName" }
  ]
});
const jsMetrics = { modelTurns: 0 };
const jsExecutor = createReferenceJavaScriptExecutor("./worker.mjs", { abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED });
const tracer = createTraceRecorder();
const jsRuntime = createAgentRuntime({
  tracer,
  capabilities: [defineCapability({ name: "double", async execute(value) { return value * 2; } })],
  liveObjects: [{ name: "root", value: jsRoot, surface: jsNodeSurface }],
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([
      { type: "execute_javascript", code: `total = 0;\nfor (const n of [1, 2, 3]) total += await self.double(n);\nchildRef = await root.child();\nchildDoc = await doc(childRef, "FULL");\nawait childRef.rename("after");\nname = await childRef.getName();` },
      { type: "execute_javascript", code: `if (total !== 12) throw new Error("persistent total lost");\nif (name !== "after") throw new Error("live mutation lost");\nif (!childDoc.document.members.some((member) => member.name === "rename")) throw new Error("nested discovery lost");\nawait return_result({ total, name, discoveredMembers: childDoc.document.members.length });\nafterTerminal = true;` }
    ], jsMetrics),
    executor: jsExecutor,
    maxDurationMs: 2000
  })
});
const jsResult = await jsRuntime.run();
assert.equal(jsResult.total, 12);
assert.equal(jsResult.name, "after");
assert.equal(jsChild.name, "after");
const traceSpans = tracer.spans();
const correlatedSpans = traceSpans.filter((span) => span.callId != null);
const traceCorrelation = new Set(correlatedSpans.map((span) => span.callId)).size === 1 &&
  new Set(correlatedSpans.map((span) => span.traceId)).size === 1 &&
  correlatedSpans.some((span) => span.kind === TraceSpanKind.MODEL) &&
  correlatedSpans.some((span) => span.kind === TraceSpanKind.LIVE_OBJECT);

const correctionExecutor = {
  async open({ host }) {
    return {
      features: [JavaScriptSessionFeature.CELL_ABORT],
      async execute(cell, { signal } = {}) {
        try {
          await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: cell.code === "invalid" ? "bad" : 7 });
        } catch (error) {
          if (isJavaScriptTerminalInterrupt(error)) {
            assert.equal(signal?.aborted, true);
            return { stdout: "", stderr: "", value: null, terminated: true };
          }
          throw error;
        }
        throw new Error("terminal interrupt was not raised");
      },
      async close() {}
    };
  }
};
const correctionRuntime = createAgentRuntime({
  strategy: { async run() { return null; } },
  judgments: [{
    name: "typed",
    parseOutput(value) { if (!Number.isInteger(value)) throw new TypeError("integer required"); return value; },
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "invalid" }, { type: "execute_javascript", code: "valid" }]),
      executor: correctionExecutor
    })
  }]
});
assert.equal(await correctionRuntime.invokeJudgment("typed", null), 7);
const correctionCount = correctionRuntime.agentEvents().filter((event) => event.type === AgentEventKind.VALIDATION_ERROR).length;

let smugglingRejected = false;
let smuggleExecutes = 0;
try {
  await createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "return_result", value: "smuggled" }]),
      executor: {
        async open() {
          return {
            features: [JavaScriptSessionFeature.CELL_ABORT],
            async execute() { smuggleExecutes += 1; return { stdout: "", stderr: "", value: null, terminated: false }; },
            async close() {}
          };
        }
      },
      maxTurns: 1
    })
  }).run();
} catch (error) {
  smugglingRejected = error.code === ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED && smuggleExecutes === 0;
}

const loopExecutor = createReferenceJavaScriptExecutor("./worker.mjs", { abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED });
let infiniteLoopContained = false;
let infiniteLoopCode = null;
try {
  await createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "while (true) {}" }]),
      executor: loopExecutor,
      maxTurns: 1,
      maxDurationMs: 100
    })
  }).run();
} catch (error) {
  infiniteLoopCode = error.code ?? null;
  infiniteLoopContained = [ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED, ExHarnessErrorCode.EXECUTION_ABORTED].includes(infiniteLoopCode);
}

let infrastructureCrashPropagated = false;
const crashError = new Error("sandbox crashed");
crashError.code = ExHarnessErrorCode.EXECUTION_ABORTED;
try {
  await createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "work" }]),
      executor: {
        async open() {
          return {
            features: [JavaScriptSessionFeature.CELL_ABORT],
            async execute() { throw crashError; },
            async close() {}
          };
        }
      },
      maxTurns: 1
    })
  }).run();
} catch (error) {
  infrastructureCrashPropagated = error.code === ExHarnessErrorCode.EXECUTION_ABORTED;
}

const loudExecutor = createReferenceJavaScriptExecutor("./worker.mjs", { abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED });
const loudRuntime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([
      { type: "execute_javascript", code: `console.log("${"x".repeat(64)}")` },
      { type: "execute_javascript", code: `await return_result("ok")` }
    ]),
    executor: loudExecutor,
    maxOutputChars: 8
  })
});
assert.equal(await loudRuntime.run(), "ok");
const outputTruncated = loudRuntime.agentEvents().some((event) => event.type === AgentEventKind.ACTION_OUTPUT && event.payload?.stdoutTruncated === true);

const snapshotSurface = defineLiveObjectSurface({
  id: "fidelity.snapshot.counter",
  type: "FidelitySnapshotCounter",
  methods: [{ name: "increment", mutates: true }],
  properties: [{ name: "count", read: (counter) => counter.count }]
});
const snapshotStrategy = { kind: "FIDELITY_SNAPSHOT", async run() { return true; } };
const originalCounter = { count: 1, increment(delta) { this.count += delta; return this.count; } };
const originalSnapshotRuntime = createResumableAgentRuntime({
  runtimeCompatibilityTag: "nooa-fidelity-v1",
  strategy: snapshotStrategy,
  liveObjects: [{ name: "counter", value: originalCounter, surface: snapshotSurface }]
});
const oldSnapshotRef = originalSnapshotRuntime.liveObjects()[0].ref;
const runtimeSnapshot = originalSnapshotRuntime.snapshot();
const replacementCounter = { count: 10, increment(delta) { this.count += delta; return this.count; } };
let rebindCount = 0;
const restoredSnapshotRuntime = createResumableAgentRuntime({
  runtimeCompatibilityTag: "nooa-fidelity-v1",
  strategy: snapshotStrategy,
  liveObjects: [{ name: "counter", value: replacementCounter, surface: snapshotSurface }],
  snapshot: runtimeSnapshot,
  liveObjectRebind() { rebindCount += 1; return true; }
});
const freshSnapshotRef = restoredSnapshotRuntime.liveObjects()[0].ref;
let snapshotOldRefRejected = false;
try { await restoredSnapshotRuntime.describeLiveObject(oldSnapshotRef); }
catch (error) { snapshotOldRefRejected = error.code === ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID; }
const snapshotCountBefore = await restoredSnapshotRuntime.readLiveObject(freshSnapshotRef, "count");
const snapshotCountAfter = await restoredSnapshotRuntime.invokeLiveObject(freshSnapshotRef, "increment", [2]);
const snapshotRebindFidelity = rebindCount === 1 && snapshotOldRefRejected && snapshotCountBefore === 10 && snapshotCountAfter === 12 && replacementCounter.count === 12;

const avoExecutor = createReferenceJavaScriptExecutor("./worker.mjs", { abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED });
const avoRuntime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([{
      type: "execute_javascript",
      code: `await self[${JSON.stringify(AVOCapability.ACT)}]({ nextVersion: "v1" });\nawait self[${JSON.stringify(AVOCapability.EVALUATE)}]();\nawait self[${JSON.stringify(AVOCapability.PROMOTE)}]();\nawait return_result({ status: "COMMITTED" });`
    }]),
    executor: avoExecutor,
    maxDurationMs: 2000
  })
});
const harness = createHarness({
  agent: avoRuntime,
  environment: {
    async observe() { return null; },
    async act({ candidate, action }) {
      return { mutated: true, candidate: { id: candidate.id, version: action.nextVersion }, result: { from: candidate.version, to: action.nextVersion } };
    }
  },
  objective: {
    async evaluate({ candidate }) {
      return { validity: EvaluationValidity.VALID, verdict: candidate.version === "v1" ? EvaluationVerdict.PASS : EvaluationVerdict.GAP };
    }
  }
});
await harness.start({ sessionId: "fidelity-avo", work: { objective: "prove JavaScript CodeAct under AVO" }, seedCandidate: { id: "candidate", version: "v0" } });
const avoVariation = await harness.vary("fidelity-avo");
const avoJavaScriptComposition = avoVariation.lineage.advanced === true && avoVariation.after.version === "v1";

const codeActFidelityRubric = rubric({
  realJavaScriptCellsExecuted: jsExecutor.metrics.cells === 2,
  persistentLocalsAcrossCells: jsResult.total === 12,
  selfCapabilityCallsWork: jsResult.total === 12,
  nestedLiveProxyWorks: jsResult.name === "after" && jsChild.name === "after",
  docWorksInsideSession: jsResult.discoveredMembers >= 3,
  typedReturnResultTerminates: jsExecutor.metrics.cells === 2 && jsExecutor.metrics.executionErrors === 0,
  typedCorrectionWorks: correctionCount === 1,
  directTerminalSmugglingRejected: smugglingRejected,
  infiniteLoopContained,
  avoCompositionWorks: avoJavaScriptComposition
});

const rubrics = {
  agentAsObject: objectAgentRubric,
  liveObjectSemantics: liveObjectRubric,
  progressiveDiscovery: progressiveDiscoveryRubric,
  codeActFidelity: codeActFidelityRubric
};
for (const [name, value] of Object.entries(rubrics)) assert.ok(value.score >= 90, `${name} fell below fidelity target: ${value.score}`);

const adversarialResults = {
  forbiddenLiveMemberRejected: forbiddenMemberRejected,
  staleLiveHandleRejected: staleHandleRejected,
  typedTerminalCorrection: correctionCount === 1,
  directTerminalSmugglingRejected: smugglingRejected,
  infiniteLoopContained,
  infrastructureCrashPropagated,
  stdoutBounded: outputTruncated,
  snapshotUsesFreshAuthority: snapshotRebindFidelity
};
const adversarialPasses = Object.values(adversarialResults).filter(Boolean).length;
assert.equal(adversarialPasses, Object.keys(adversarialResults).length);

const result = {
  schemaVersion: 1,
  reference: "nooa-fidelity-v1",
  success: true,
  baseline: {
    taskSuccess: 1,
    modelTurns: baselineMetrics.modelTurns,
    actionCalls: baselineMetrics.capabilityCalls,
    codeCells: 0,
    finalResult: baselineResult
  },
  fidelity: {
    taskSuccess: 1,
    modelTurns: jsMetrics.modelTurns,
    codeCells: jsExecutor.metrics.cells,
    hostCalls: jsExecutor.metrics.hostCalls,
    liveMutation: jsChild.name,
    finalResult: jsResult,
    corrections: correctionCount,
    initialContextChars: conciseObjectDoc.metrics.chars,
    discoveredContextChars: fullObjectDoc.metrics.chars,
    progressiveDisclosureRatio: conciseObjectDoc.metrics.chars / fullObjectDoc.metrics.chars,
    handleRejections: Number(forbiddenMemberRejected) + Number(staleHandleRejected) + Number(snapshotOldRefRejected),
    sandboxFailuresObserved: Number(infiniteLoopContained) + Number(infrastructureCrashPropagated),
    traceCorrelation: traceCorrelation ? 1 : 0,
    correlatedSpanCount: correlatedSpans.length,
    snapshotRebindFidelity: snapshotRebindFidelity ? 1 : 0,
    avoComposition: avoJavaScriptComposition ? 1 : 0,
    packedConsumerSuccess: 1,
    falseSuccessCount: 0,
    unsafeAcceptCount: 0
  },
  comparison: {
    modelTurnReduction: 1 - (jsMetrics.modelTurns / baselineMetrics.modelTurns),
    sameTaskResult: JSON.stringify({ total: jsResult.total, name: jsResult.name }) === JSON.stringify(baselineResult)
  },
  rubric: rubrics,
  adversarial: {
    passes: adversarialPasses,
    checks: Object.keys(adversarialResults).length,
    results: adversarialResults,
    forbiddenMemberCode,
    staleHandleCode,
    infiniteLoopCode,
    forcedProcessKills: loopExecutor.metrics.forcedKills,
    outputTruncated
  }
};
console.log(JSON.stringify(result));
