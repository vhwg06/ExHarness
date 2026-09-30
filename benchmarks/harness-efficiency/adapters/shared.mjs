// Shared fixed-factor contract for both arm adapters. The two arms differ only
// in `orchestration`; every fixed factor is byte-identical by construction.
// Both arms also share the exact per-(task, repeat) execution script: the
// scripted model decides the producer outcome, while quality always comes
// later from the independent evaluator step over the artifact.
import {
  CAPABILITY_SURFACE,
  EVALUATOR_IDENTITY,
  EXECUTOR_ID,
  MODEL_PROFILE,
  RESOURCE_BUDGET,
  STRATEGY_CONFIG,
  environmentIdentityFor,
  fixedFactorDigest,
  instructionDigestFor
} from '../constants.mjs';

export function sharedFixedFactors({ taskId, bundleDigest }) {
  return Object.freeze({
    modelRoute: `${MODEL_PROFILE.transport}/${MODEL_PROFILE.model}`,
    modelVersion: MODEL_PROFILE.model,
    provider: MODEL_PROFILE.provider,
    fallback: MODEL_PROFILE.fallback,
    taskId,
    bundleDigest,
    workspace: environmentIdentityFor(),
    instructionDigest: instructionDigestFor(bundleDigest),
    strategyConfig: { ...STRATEGY_CONFIG },
    executor: EXECUTOR_ID,
    capabilities: [...CAPABILITY_SURFACE],
    evaluator: EVALUATOR_IDENTITY,
    budget: { ...RESOURCE_BUDGET }
  });
}

export function fixedDigest({ taskId, bundleDigest }) {
  return fixedFactorDigest({ taskId, bundleDigest });
}

// Same instruction text and call context for both arms: the only allowed
// varying factor is the harness orchestration path.
export function runInputFor({ taskId, bundleDigest }) {
  return `Solve the benchmark task ${taskId} (bundle ${bundleDigest}). Inspect the workspace, apply a minimal patch, then return the result.`;
}

export function runContextFor({ taskId }) {
  return { taskId, surface: 'benchmark-fixture' };
}

// Deterministic per-(task, repeat) execution script shared by both arms.
// `marker` selects the artifact the producer writes; the independent
// evaluator later maps marker good->PASS, bad->FAIL. `fault` simulates a
// provider-level failure before any candidate exists.
export function buildTaskScript({ taskId, taskIndex, repeatIndex }) {
  const note = (text) => ({ capability: 'record_note', input: { text } });
  const read = { capability: 'fetch_note', input: null };
  switch ((taskIndex + repeatIndex) % 4) {
    case 0:
      return {
        kind: 'solve',
        marker: 'good',
        usage: { inputTokens: 1200, outputTokens: 300 },
        cells: {
          'explore': { toolCalls: [note(`survey:${taskId}`), read], stdout: 'surveyed' },
          'verify': { toolCalls: [read], stdout: 'verified' }
        },
        terminalCode: 'finish',
        terminalValue: { ok: true, marker: 'good', taskId }
      };
    case 1:
      return {
        kind: 'fail',
        marker: 'bad',
        usage: null,
        cells: {
          'explore': { toolCalls: [note(`survey:${taskId}`)], stdout: 'surveyed' }
        },
        terminalCode: 'finish',
        terminalValue: { ok: false, marker: 'bad', taskId }
      };
    case 2:
      return {
        kind: 'solve',
        marker: 'good',
        usage: { inputTokens: 900, providerCostUsd: 0.004 },
        cells: {
          'explore': { toolCalls: [note(`survey:${taskId}`)], stdout: 'surveyed' },
          'double-check': { toolCalls: [read, note(`confirm:${taskId}`)], stdout: 'confirmed' }
        },
        terminalCode: 'finish',
        terminalValue: { ok: true, marker: 'good', taskId }
      };
    default:
      return { kind: 'timeout', marker: null, usage: null, fault: 'PROVIDER_TIMEOUT' };
  }
}

export function modelActionsFor(taskScript) {
  if (taskScript.fault) return [];
  return [
    ...Object.keys(taskScript.cells).map((code) => ({ type: 'execute_javascript', code })),
    { type: 'execute_javascript', code: taskScript.terminalCode }
  ];
}

// Strategy limits shared by both arms (part of the fixed strategy config).
export const STRATEGY_LIMITS = Object.freeze({
  maxTurns: 8,
  maxCells: 8,
  maxHostCalls: 32,
  maxDurationMs: 120000,
  maxOutputChars: 16000,
  maxObservationChars: 64000
});
