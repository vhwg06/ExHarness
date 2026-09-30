// DIRECT_CODEACT arm adapter. Invokes the JavaScript CodeAct strategy through a
// benchmark-owned minimal orchestration shim (no Core runtime). Returns raw
// producer observations only; registration, ledger, evidence, accounting and
// audit stay with the shared kernel.
import { createHash } from 'node:crypto';
import { fixedDigest, sharedFixedFactors } from './shared.mjs';

export const ARM = 'DIRECT_CODEACT';
export const ORCHESTRATION = 'direct-minimal-shim';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

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
    // Deterministic, model-free producer simulation. `script` selects the
    // fixture outcome; interval/timing shapes stay arm-characteristic.
    run({ taskId, bundleDigest, attemptId, script = {} }) {
      const turns = script.modelTurns ?? 4;
      const calls = script.toolCalls ?? 6;
      const modelIntervals = script.modelIntervals ?? [140, 160, 150, 170].slice(0, turns);
      while (modelIntervals.length < turns) modelIntervals.push(150);
      const callIntervals = script.callIntervals ?? [40, 35, 45, 30, 50, 40].slice(0, calls);
      while (callIntervals.length < calls) callIntervals.push(40);
      const stablePrefix = `direct-prefix:${taskId}:${bundleDigest}`;
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
        dynamicSuffixHash: sha(`direct-suffix:${attemptId}:${turns}:${calls}`),
        script: Object.freeze({ ...script })
      });
    }
  });
}
