// Shared fixed-factor constants for the synchronous harness-economics comparison.
// Everything here is preregistered experiment metadata. Nothing here executes a
// model, touches the network, or reimplements benchmark-kernel truth.
import { createHash } from 'node:crypto';

export const ARMS = Object.freeze(['DIRECT_CODEACT', 'CORE_SYNC']);
export const REPEATS = 3;
export const PAIR_ORDER = Object.freeze([
  'DIRECT_CODEACT->CORE_SYNC',
  'CORE_SYNC->DIRECT_CODEACT',
  'DIRECT_CODEACT->CORE_SYNC'
]);

export const EXPERIMENT_ID = 'BB077-HARNESS-ECONOMICS-SYNC';
export const PROTOCOL_ID = 'BB077-FIXED-FACTOR-SYNC-V1';
export const PROTOCOL_VERSION = '1';
export const COHORT_ID = 'BB077-DEV-COHORT-V1';

// Frozen first live model route (prior research). Benchmark runs in this repo are
// deterministic fixtures; no live provider call is made by this experiment.
export const MODEL_PROFILE = Object.freeze({
  transport: 'OpenRouter',
  model: 'anthropic/claude-sonnet-4.6',
  provider: 'Anthropic',
  fallback: 'disabled'
});

// Frozen 2026-09-27 normalization table. Experiment metadata only: provider-observed
// charged cost stays primary when present, and this table never becomes kernel policy.
export const NORMALIZATION_TABLE = Object.freeze({
  checked: '2026-09-27',
  freshInputPerMTokenUsd: 3.0,
  outputPerMTokenUsd: 15.0,
  cacheReadPerMTokenUsd: 0.3,
  cacheWrite5MinPerMTokenUsd: 3.75
});

// The JavaScript CodeAct strategy configuration shared by both arms.
export const STRATEGY_CONFIG = Object.freeze({
  strategy: 'javascript-codeact',
  actionType: 'execute_javascript',
  sessionFeatures: [],
  maxDurationMs: null
});

export const EXECUTOR_ID = 'reference-javascript-session-executor@1';
export const CAPABILITY_SURFACE = Object.freeze(['execute_javascript', 'read_file', 'write_file']);
export const EVALUATOR_IDENTITY = 'harbor-task-verifier@0.23.0';

export const RESOURCE_BUDGET = Object.freeze({
  wallMs: 600000,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  toolCalls: 200
});

export const SUBSTRATE_MANIFEST_REF = 'benchmarks/substrate/manifests/terminal-bench-2.1.json';
export const SUBSTRATE_MANIFEST_KIND = 'BENCHMARK_SUBSTRATE_MANIFEST_V1';
export const SUBSTRATE_PIN = Object.freeze({
  substrate: 'harbor',
  version: '0.23.0',
  commit: '1e5c5c6db929a10a140d05e606882c671ae20729'
});
export const SOURCE_COMMIT = '7131e4375048a0e408a8fb404b5f499d726b695b';

// Pinned Terminal-Bench 2.1 bundle digests sealed in the delivered substrate
// manifest reservation. Short task ids are the experiment-facing names.
export const DEVELOPMENT_TASKS = Object.freeze([
  { id: 'fix-git', bundle: 'terminal-bench/fix-git', bundleDigest: 'sha256:16948b980df9d96de616a205f5acca1c5d395de83ff4f8ffabcafacb93226f2e' },
  { id: 'cancel-async-tasks', bundle: 'terminal-bench/cancel-async-tasks', bundleDigest: 'sha256:a3d048d351136e48070696cda8bb79660dfd74db1fea3b6da88559f0332699c1' },
  { id: 'query-optimize', bundle: 'terminal-bench/query-optimize', bundleDigest: 'sha256:169496ea6843cb403b0860132675baf7aa0df0ac8b86221068e27d86395260f4' },
  { id: 'nginx-request-logging', bundle: 'terminal-bench/nginx-request-logging', bundleDigest: 'sha256:9d1b8bebd989ea0bc8080c3b159480068caf183c5fd61385868b2574b206e097' },
  { id: 'fix-code-vulnerability', bundle: 'terminal-bench/fix-code-vulnerability', bundleDigest: 'sha256:d31348aa16b533a15f013420e4d9726dc529e6086adc7d6d48067d22cc18fe71' },
  { id: 'sqlite-db-truncate', bundle: 'terminal-bench/sqlite-db-truncate', bundleDigest: 'sha256:956f038b479cc3b9b493553b57a60a8ff4154526386c3914c0b99e93e1ab6e87' }
]);

// Reserved for the future held-out decision. BB-077 must hard-reject execution.
export const HELD_OUT_TASKS = Object.freeze([
  { id: 'git-leak-recovery', bundle: 'terminal-bench/git-leak-recovery', bundleDigest: 'sha256:22a9ec10dbd4cd8b99477b70e1944103775ca41de9b9e0025ec4898cd17bd334' },
  { id: 'pypi-server', bundle: 'terminal-bench/pypi-server', bundleDigest: 'sha256:1a1e0542f58e2d3362fec17a9bbb98667717d9a4a3e9a4c8413d3150a4fa0ff1' },
  { id: 'kv-store-grpc', bundle: 'terminal-bench/kv-store-grpc', bundleDigest: 'sha256:973c5d4c111fb61a344457936f1c36400acd2d9e44389e7b319586fe23a7a307' },
  { id: 'sanitize-git-repo', bundle: 'terminal-bench/sanitize-git-repo', bundleDigest: 'sha256:73c94a21ebe370bae843adbeeaaa9e991374867b18483aaf56c7cd470dcddea7' }
]);

export const HELD_OUT_SET_ID = 'BB081-HELD-OUT-V1';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

// Deterministic instruction digest derived from the sealed bundle digest.
// The substrate owns the real bundle; this binds the cohort entry to it.
export function instructionDigestFor(bundleDigest) {
  return sha(`BB-077-instruction:${bundleDigest}`);
}

export function environmentIdentityFor() {
  return `terminal-bench-2-1@${SOURCE_COMMIT}`;
}

// Digest over the fixed-factor descriptor shared by a matched pair.
export function fixedFactorDescriptor({ taskId, bundleDigest }) {
  return {
    model: `${MODEL_PROFILE.transport}/${MODEL_PROFILE.model}`,
    provider: MODEL_PROFILE.provider,
    fallback: MODEL_PROFILE.fallback,
    taskId,
    bundleDigest,
    workspace: environmentIdentityFor(),
    instructionDigest: instructionDigestFor(bundleDigest),
    strategy: STRATEGY_CONFIG,
    executor: EXECUTOR_ID,
    capabilities: [...CAPABILITY_SURFACE],
    evaluator: EVALUATOR_IDENTITY,
    budget: { ...RESOURCE_BUDGET }
  };
}

export function fixedFactorDigest({ taskId, bundleDigest }) {
  return sha(JSON.stringify(fixedFactorDescriptor({ taskId, bundleDigest })));
}

export function protocolHash() {
  return sha(JSON.stringify({
    protocol: `${PROTOCOL_ID}@${PROTOCOL_VERSION}`,
    arms: [...ARMS],
    repeats: REPEATS,
    order: [...PAIR_ORDER],
    development: DEVELOPMENT_TASKS.map((task) => task.bundleDigest),
    heldOut: HELD_OUT_TASKS.map((task) => task.bundleDigest),
    model: MODEL_PROFILE,
    strategy: STRATEGY_CONFIG,
    executor: EXECUTOR_ID,
    capabilities: [...CAPABILITY_SURFACE],
    evaluator: EVALUATOR_IDENTITY,
    budget: { ...RESOURCE_BUDGET }
  }));
}
