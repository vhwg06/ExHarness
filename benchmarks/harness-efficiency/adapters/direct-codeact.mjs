// DIRECT_CODEACT arm adapter. Drives the SAME JavaScript CodeAct strategy
// through a benchmark-owned minimal orchestration shim: strategy.run() is
// invoked directly with the shared scripted model client, the shared scripted
// session executor and the shared capability surface. No Core runtime is
// constructed here. Every reported number is DERIVED from the real run:
// modelTurns from recorded model-client invocations, toolCalls from recorded
// capability invocations, MODEL/CALL intervals from fixture-clock timestamps
// around each real call, and prefix/suffix hashes from the actual requests the
// model client received. Raw producer observations only; registration, ledger,
// evidence, accounting and audit stay with the shared kernel.
import {
  createJavaScriptCodeActStrategy
} from '../../../packages/core-harness/src/index.js';
import { createFixtureClock } from '../fixtures/fixture-clock.mjs';
import { createScriptedModelClient, stablePrefixSummary } from '../fixtures/scripted-model.mjs';
import { createScriptedExecutor } from '../fixtures/scripted-executor.mjs';
import { capabilityViews, createSharedCapabilities } from '../fixtures/capabilities.mjs';
import {
  STRATEGY_LIMITS,
  fixedDigest,
  modelActionsFor,
  runContextFor,
  runInputFor,
  sharedFixedFactors
} from './shared.mjs';

export const ARM = 'DIRECT_CODEACT';
export const ORCHESTRATION = 'direct-minimal-shim';

export function createDirectCodeactAdapter() {
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
      const byName = new Map(capabilities.map((capability) => [capability.name, capability]));
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
      const agentEvents = [];
      const startedMs = clock.now();
      const invoke = async (name, input) => {
        const capability = byName.get(name);
        if (!capability) throw new Error(`capability not found: ${name}`);
        return capability.execute(input);
      };
      const unsupported = (port) => async () => {
        throw new Error(`PRECONDITION: direct shim has no ${port}; fixture cells must not use it`);
      };
      let result;
      let error = null;
      try {
        result = await strategy.run({
          input: runInputFor({ taskId, bundleDigest }),
          context: runContextFor({ taskId }),
          capabilities: capabilityViews(),
          liveObjects: [],
          invoke,
          describeLiveObject: unsupported('live-object describe'),
          invokeLiveObject: unsupported('live-object invoke'),
          readLiveObject: unsupported('live-object read'),
          recordAgentEvent: (type, payload) => agentEvents.push({ type, payload }),
          trace: null,
          callId: `direct-${attemptId}`
        });
      } catch (thrown) {
        error = thrown;
      }
      const prefix = stablePrefixSummary(model.calls);
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
        coreEvidence: null,
        shimAgentEvents: agentEvents.map((event) => event.type)
      });
    }
  });
}
