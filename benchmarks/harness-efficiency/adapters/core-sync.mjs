// CORE_SYNC arm adapter. Drives the SAME JavaScript CodeAct strategy through
// the synchronous Core path: createAgentRuntime with the shared scripted model
// client, the shared scripted session executor and the shared capability
// surface, executed via runtime.runWithReport(). Core owns turn/context
// rendering, capability dispatch, tracing and agent/turn events; this adapter
// only observes. Every reported number is DERIVED from the real run, exactly
// like the DIRECT arm. Raw producer observations only; registration, ledger,
// evidence, accounting and audit stay with the shared kernel.
import {
  AgentEventKind,
  TraceSpanKind,
  createAgentRuntime,
  createJavaScriptCodeActStrategy,
  createTraceRecorder
} from '../../../packages/core-harness/src/index.js';
import { createFixtureClock } from '../fixtures/fixture-clock.mjs';
import { createScriptedModelClient, stablePrefixSummary } from '../fixtures/scripted-model.mjs';
import { createScriptedExecutor } from '../fixtures/scripted-executor.mjs';
import { createSharedCapabilities } from '../fixtures/capabilities.mjs';
import {
  STRATEGY_LIMITS,
  fixedDigest,
  modelActionsFor,
  runContextFor,
  runInputFor,
  sharedFixedFactors
} from './shared.mjs';

export const ARM = 'CORE_SYNC';
export const ORCHESTRATION = 'createAgentRuntime-sync';

export function createCoreSyncAdapter() {
  return Object.freeze({
    arm: ARM,
    orchestration: ORCHESTRATION,
    fixedFactors({ taskId, bundleDigest }) {
      return sharedFixedFactors({ taskId, bundleDigest });
    },
    fixedDigest({ taskId, bundleDigest }) {
      return fixedDigest({ taskId, bundleDigest });
    },
    async run({ taskId, bundleDigest, attemptId, script }) {
      const clock = createFixtureClock();
      const callLog = [];
      const capabilities = createSharedCapabilities({ clock, callLog });
      const model = createScriptedModelClient({
        script: { actions: modelActionsFor(script), fault: script.fault ?? null },
        clock
      });
      const executor = createScriptedExecutor({ script });
      const strategy = createJavaScriptCodeActStrategy({
        model: model.adapter,
        executor,
        ...STRATEGY_LIMITS,
        clock: () => clock.now()
      });
      const tracer = createTraceRecorder();
      const runtime = createAgentRuntime({ strategy, capabilities, tracer });
      const startedMs = clock.now();
      let result;
      let error = null;
      try {
        result = (await runtime.runWithReport({
          input: runInputFor({ taskId, bundleDigest }),
          context: runContextFor({ taskId })
        })).result;
      } catch (thrown) {
        error = thrown;
      }
      const prefix = stablePrefixSummary(model.calls);
      const spans = runtime.traces();
      return Object.freeze({
        arm: ARM,
        orchestration: ORCHESTRATION,
        attemptId,
        status: error ? 'ERROR' : 'COMPLETED',
        errorCode: error?.code ?? null,
        result: result ?? null,
        modelTurns: model.calls.length,
        toolCalls: callLog.length,
        modelCalls: model.calls.map((call) => ({
          turn: call.turn,
          stablePrefixHash: call.stablePrefixHash,
          dynamicSuffixHash: call.dynamicSuffixHash
        })),
        modelIntervals: Object.freeze([...model.modelIntervals]),
        callIntervals: Object.freeze(callLog.map((call) => call.intervalMs)),
        stablePrefixHash: prefix.hash,
        stablePrefixBytes: prefix.bytes,
        stablePrefixRepeats: prefix.repeats,
        dynamicSuffixHash: model.calls.length
          ? model.calls[model.calls.length - 1].dynamicSuffixHash
          : null,
        cellsExecuted: executor.metrics.executes,
        elapsedMs: clock.now() - startedMs,
        coreEvidence: Object.freeze({
          traceKinds: Object.freeze([...new Set(spans.map((span) => span.kind))].sort()),
          modelSpans: spans.filter((span) => span.kind === TraceSpanKind.MODEL).length,
          agentEventTypes: Object.freeze([...new Set(runtime.agentEvents().map((event) => event.type))].sort()),
          modelOutputs: runtime.agentEvents().filter((event) => event.type === AgentEventKind.MODEL_OUTPUT).length,
          turnEvents: runtime.turnEvents().length
        }),
        shimAgentEvents: []
      });
    }
  });
}
