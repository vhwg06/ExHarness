// Benchmark-owned deterministic scripted model client. Replays a per-task
// script of model turns/actions through the real model-adapter contract
// ({ name, version, generate }). Every generate() invocation is recorded with
// the actual request the strategy built, so turn counts, MODEL intervals and
// stable-prefix/dynamic-suffix hashes are DERIVED from the real run.
//
// Stable prefix (fixed prelude): mode/input/context/capabilities/protocol.
// Dynamic suffix (per-turn state): turn/promptContext/history/observations and
// the last validation error. A repeated stable prefix proves ELIGIBLE, never a
// provider cache hit.
import { createHash } from 'node:crypto';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function stablePrefixOf(request) {
  return canonical({
    mode: request.mode,
    input: request.input,
    context: request.context,
    callContext: request.callContext,
    capabilities: request.capabilities,
    liveObjects: request.liveObjects,
    protocol: request.protocol,
    modelRoute: request.modelRoute,
    judgment: request.judgment
  });
}

function dynamicSuffixOf(request) {
  return canonical({
    turn: request.turn,
    promptContext: request.promptContext,
    events: request.events,
    agentEvents: request.agentEvents,
    history: request.history,
    observations: request.observations,
    lastValidationError: request.lastValidationError ?? null
  });
}

// script: { actions: [{ type: 'execute_javascript', code }] } or
// { fault: 'PROVIDER_TIMEOUT' } to simulate a provider-level failure before
// any candidate exists.
export function createScriptedModelClient({ script, clock }) {
  const actions = [...(script.actions ?? [])];
  const calls = [];
  const modelIntervals = [];
  const adapter = {
    name: 'bb077-scripted-model',
    version: '1',
    async generate(request) {
      const started = clock.now();
      if (script.fault) {
        const error = new Error(`scripted provider fault: ${script.fault}`);
        error.code = script.fault;
        throw error;
      }
      if (actions.length === 0) {
        const error = new Error('script exhausted: no further scripted model action');
        error.code = 'SCRIPT_EXHAUSTED';
        throw error;
      }
      const action = actions.shift();
      const prefixText = stablePrefixOf(request);
      const suffixText = dynamicSuffixOf(request);
      calls.push({
        turn: request.turn,
        stablePrefixHash: sha(prefixText),
        stablePrefixBytes: Buffer.byteLength(prefixText, 'utf8'),
        dynamicSuffixHash: sha(suffixText),
        action
      });
      const step = clock.tickModel();
      modelIntervals.push(step);
      void started;
      return { ...action };
    }
  };
  return {
    adapter,
    calls,
    modelIntervals,
    exhausted() {
      return actions.length === 0;
    }
  };
}

export function stablePrefixSummary(calls) {
  const hashes = calls.map((call) => call.stablePrefixHash);
  return {
    hashes,
    repeats: hashes.length > 1 && hashes.every((hash) => hash === hashes[0]),
    hash: hashes[0] ?? null,
    bytes: calls[0]?.stablePrefixBytes ?? 0
  };
}
