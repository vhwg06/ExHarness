// S1 — BB-081 dependency binding: exact DONE BB-077/078/079/080 outputs.
// Fails PLAN_INPUT_CONTRADICTION on missing/incompatible/non-composable seams.
// Consumes @exharness/benchmark only through its package root; Core only
// through its public entry. No second ledger, no Harbor spawn.
import { createHash } from 'node:crypto';

export const DEPENDENCY_CONTRACT = 'BB081_DEPENDENCY_MANIFEST_V1';
export const DEPENDENCY_SCHEMA_VERSION = 1;

export class DependencyContradictionError extends Error {
  constructor(message, { taskId = null } = {}) {
    super(`PLAN_INPUT_CONTRADICTION: ${message}`);
    this.name = 'DependencyContradictionError';
    this.code = 'PLAN_INPUT_CONTRADICTION';
    this.taskId = taskId;
  }
}

const LIVING_REFS = Object.freeze([
  'docs/living/system/core-harness/state.md',
  'docs/living/system/core-harness/workflow.md'
]);

// Exact DONE refs frozen by BB-078/079/080 delivery manifests. Worker must bind
// to these exact refs; any mismatch is a contradiction, never an approximation.
export function getDependencyManifest() {
  return Object.freeze({
    schemaVersion: DEPENDENCY_SCHEMA_VERSION,
    contract: DEPENDENCY_CONTRACT,
    requires: Object.freeze([
      Object.freeze({
        taskId: 'BB-077',
        status: 'DONE',
        implementationResultRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-077.implementation-result.json',
        judgmentRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-077.candidate-jev-evaluation.json',
        deliveredRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-077.delivered-feature.json',
        livingRefs: LIVING_REFS,
        accountingVocabulary: Object.freeze(['stable-prefix', 'dynamic-suffix', 'CONFIRMED', 'MISS', 'ELIGIBLE', 'UNKNOWN']),
        telemetryRule: 'missing provider cache fields stay null/unknown, never zero'
      }),
      Object.freeze({
        taskId: 'BB-078',
        status: 'DONE',
        implementationResultRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-078.implementation-result.json',
        judgmentRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-078.candidate-jev-evaluation.json',
        deliveredRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-078.delivered-feature.json',
        livingRefs: LIVING_REFS,
        transitionEnvelope: Object.freeze([
          'transitionId', 'operationId', 'scopeId', 'status', 'generation',
          'sequence', 'result', 'error', 'evidence', 'reason', 'at'
        ]),
        storeApi: Object.freeze([
          'createSessionDetachedOperationStore',
          'createInMemoryDetachedOperationStore',
          'createDetachedOperationManager'
        ])
      }),
      Object.freeze({
        taskId: 'BB-079',
        status: 'DONE',
        implementationResultRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-079.implementation-result.json',
        judgmentRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-079.candidate-jev-evaluation.json',
        deliveredRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-079.delivered-feature.json',
        livingRefs: LIVING_REFS,
        checkpointApi: Object.freeze([
          'createAsyncResultContextState',
          'stageAsyncResultTransitions',
          'commitAsyncResultContext',
          'restoreAsyncResultContextState',
          'projectAsyncResultRequest'
        ]),
        providerModes: Object.freeze(['NATIVE_PENDING_CALL', 'HANDLE_THEN_EVENT', 'SYNCHRONOUS'])
      }),
      Object.freeze({
        taskId: 'BB-080',
        status: 'DONE',
        implementationResultRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-080.implementation-result.json',
        judgmentRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-080.candidate-jev-evaluation.json',
        deliveredRef: 'docs/blackboard/artifacts/ready-implement-plan/BB-080.delivered-feature.json',
        livingRefs: LIVING_REFS,
        coordinatorApi: Object.freeze([
          'createAsyncAgentCoordinator',
          'getAsyncCoordinatorDependencyManifest',
          'assertDependencyContract'
        ]),
        checkpointApi: Object.freeze([
          'createAsyncResultContextState',
          'stageAsyncResultTransitions',
          'commitAsyncResultContext',
          'restoreAsyncResultContextState',
          'projectAsyncResultRequest'
        ]),
        profileDefaults: Object.freeze({
          completionIdleMs: 1,
          maxCoalescedTransitions: 100,
          quickCompletionGraceMs: 1000
        })
      })
    ])
  });
}

// Canonical valid descriptors for tests and offline runs. They match the
// manifest exactly; any mutation must fail assertDependencyContract.
export function defaultDescriptors() {
  const manifest = getDependencyManifest();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const [r077, r078, r079, r080] = manifest.requires;
  return Object.freeze({
    bb077: Object.freeze({
      status: r077.status,
      implementationResultRef: r077.implementationResultRef,
      judgmentRef: r077.judgmentRef,
      deliveredRef: r077.deliveredRef,
      livingRefs: [...r077.livingRefs],
      accountingVocabulary: [...r077.accountingVocabulary],
      telemetryRule: r077.telemetryRule
    }),
    bb078: Object.freeze({
      status: r078.status,
      implementationResultRef: r078.implementationResultRef,
      judgmentRef: r078.judgmentRef,
      deliveredRef: r078.deliveredRef,
      livingRefs: [...r078.livingRefs],
      transitionEnvelope: [...r078.transitionEnvelope],
      storeApi: [...r078.storeApi]
    }),
    bb079: Object.freeze({
      status: r079.status,
      implementationResultRef: r079.implementationResultRef,
      judgmentRef: r079.judgmentRef,
      deliveredRef: r079.deliveredRef,
      livingRefs: [...r079.livingRefs],
      checkpointApi: [...r079.checkpointApi],
      providerModes: [...r079.providerModes]
    }),
    bb080: Object.freeze({
      status: r080.status,
      implementationResultRef: r080.implementationResultRef,
      judgmentRef: r080.judgmentRef,
      deliveredRef: r080.deliveredRef,
      livingRefs: [...r080.livingRefs],
      coordinatorApi: [...r080.coordinatorApi],
      checkpointApi: [...r080.checkpointApi],
      profileDefaults: clone(r080.profileDefaults)
    })
  });
}

// Required Core composition surface for independent A/B/C/D construction.
// A needs sync runtime; B adds detached; C adds async-result context;
// D adds the coordinator. Checked against the public Core entry exports.
export const REQUIRED_CORE_API = Object.freeze({
  A: Object.freeze(['createAgentRuntime']),
  B: Object.freeze(['createAgentRuntime', 'createDetachedOperationManager', 'createInMemoryDetachedOperationStore']),
  C: Object.freeze(['createAgentRuntime', 'createDetachedOperationManager', 'createAsyncResultContextState', 'stageAsyncResultTransitions', 'commitAsyncResultContext']),
  D: Object.freeze(['createAgentRuntime', 'createDetachedOperationManager', 'createAsyncResultContextState', 'createAsyncAgentCoordinator'])
});

export function assertComposableCore({ core } = {}) {
  if (core == null || typeof core !== 'object') {
    throw new DependencyContradictionError('Core export surface is missing: cannot compose A/B/C/D independently', { taskId: 'BB-078' });
  }
  const union = new Set([...REQUIRED_CORE_API.A, ...REQUIRED_CORE_API.B, ...REQUIRED_CORE_API.C, ...REQUIRED_CORE_API.D]);
  const missing = [...union].filter((name) => typeof core[name] !== 'function');
  if (missing.length > 0) {
    throw new DependencyContradictionError(
      `Core surface is non-composable for independent A/B/C/D: missing ${missing.join(', ')}`,
      { taskId: 'BB-080' }
    );
  }
  // Per-arm composability: each arm must be constructible without approximating.
  for (const arm of ['A', 'B', 'C', 'D']) {
    const absent = REQUIRED_CORE_API[arm].filter((name) => typeof core[name] !== 'function');
    if (absent.length > 0) {
      throw new DependencyContradictionError(
        `Arm ${arm} is non-composable: missing ${absent.join(', ')}; refusing to approximate the ablation`,
        { taskId: arm === 'A' ? 'BB-077' : arm === 'B' ? 'BB-078' : arm === 'C' ? 'BB-079' : 'BB-080' }
      );
    }
  }
  return Object.freeze({ composable: true, arms: Object.freeze(['A', 'B', 'C', 'D']) });
}

export function assertDependencyContract({ bb077, bb078, bb079, bb080, core = null } = {}) {
  const manifest = getDependencyManifest();
  const [e077, e078, e079, e080] = manifest.requires;
  const pairs = [
    ['BB-077', bb077, e077],
    ['BB-078', bb078, e078],
    ['BB-079', bb079, e079],
    ['BB-080', bb080, e080]
  ];
  for (const [label, value, expected] of pairs) {
    if (value == null || typeof value !== 'object') {
      throw new DependencyContradictionError(
        `${label} dependency descriptor is missing: worker must bind to the exact DONE implementation-result/judgment/Living refs`,
        { taskId: label }
      );
    }
    if (value.status !== 'DONE') {
      throw new DependencyContradictionError(
        `${label} is not DONE (status=${value.status ?? 'unknown'}): BB-081 worker execution requires DONE dependencies`,
        { taskId: label }
      );
    }
    for (const field of ['implementationResultRef', 'judgmentRef', 'deliveredRef']) {
      if (value[field] !== expected[field]) {
        throw new DependencyContradictionError(
          `${label} ${field} mismatch: expected ${expected[field]}, received ${value[field] ?? 'missing'}`,
          { taskId: label }
        );
      }
    }
  }
  // Vocabulary / envelope / API compatibility (subset-tolerant only upward:
  // descriptor must cover every frozen field).
  if (bb077.accountingVocabulary != null) {
    const missing = e077.accountingVocabulary.filter((t) => !bb077.accountingVocabulary.includes(t));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-077 accounting vocabulary is incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-077' });
    }
  }
  if (bb078.transitionEnvelope != null) {
    const missing = e078.transitionEnvelope.filter((f) => !bb078.transitionEnvelope.includes(f));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-078 transition envelope is incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-078' });
    }
  }
  if (bb078.storeApi != null) {
    const missing = e078.storeApi.filter((n) => !bb078.storeApi.includes(n));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-078 store API is incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-078' });
    }
  }
  if (bb079.checkpointApi != null) {
    const missing = e079.checkpointApi.filter((n) => !bb079.checkpointApi.includes(n));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-079 checkpoint API is incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-079' });
    }
  }
  if (bb079.providerModes != null) {
    const missing = e079.providerModes.filter((m) => !bb079.providerModes.includes(m));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-079 provider modes are incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-079' });
    }
  }
  if (bb080.coordinatorApi != null) {
    const missing = e080.coordinatorApi.filter((n) => !bb080.coordinatorApi.includes(n));
    if (missing.length > 0) {
      throw new DependencyContradictionError(`BB-080 coordinator API is incompatible: missing ${missing.join(', ')}`, { taskId: 'BB-080' });
    }
  }
  if (core != null) assertComposableCore({ core });
  return Object.freeze({ satisfied: true, contract: manifest.contract });
}

export function computeDependencyDigest(manifest = getDependencyManifest()) {
  return `sha256:${createHash('sha256').update(JSON.stringify(manifest), 'utf8').digest('hex')}`;
}
