// CORE_SYNC arm adapter. Invokes the same JavaScript CodeAct strategy through
// the synchronous Core path (createAgentRuntime). Returns raw producer
// observations only; registration, ledger, evidence, accounting and audit stay
// with the shared kernel.
import { createHash } from 'node:crypto';
import { fixedDigest, sharedFixedFactors } from './shared.mjs';

export const ARM = 'CORE_SYNC';
export const ORCHESTRATION = 'createAgentRuntime-sync';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

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
    // Deterministic, model-free producer simulation. `script` selects the
    // fixture outcome; interval/timing shapes stay arm-characteristic.
    run({ taskId, bundleDigest, attemptId, script = {} }) {
      const turns = script.modelTurns ?? 5;
      const calls = script.toolCalls ?? 7;
      const modelIntervals = script.modelIntervals ?? [150, 170, 160, 180, 155].slice(0, turns);
      while (modelIntervals.length < turns) modelIntervals.push(160);
      const callIntervals = script.callIntervals ?? [45, 40, 50, 35, 55, 45, 38].slice(0, calls);
      while (callIntervals.length < calls) callIntervals.push(45);
      const stablePrefix = `core-prefix:${taskId}:${bundleDigest}`;
      return Object.freeze({
        arm: ARM,
        orchestration: ORCHESTRATION,
        attemptId,
        modelTurns: turns,
        toolCalls: calls,
        modelIntervals: Object.freeze([...modelIntervals]),
        callIntervals: Object.freeze([...callIntervals]),
        stablePrefixHash: sha(stablePrefix),
        stablePrefixBytes: Buffer.byteLength(stablePrefix, 'utf8'),
        dynamicSuffixHash: sha(`core-suffix:${attemptId}:${turns}:${calls}`),
        script: Object.freeze({ ...script })
      });
    }
  });
}
