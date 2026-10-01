// S2 — BB-081 ablation contract: A/B/C/D arms, four held-out digests,
// two-repeat balanced schedule, frozen budgets and protocol hashes.
// Exactly the plan's ablationContract; no development/replacement tasks.
import { createHash } from 'node:crypto';

export const ABLATION_CONTRACT_VERSION = 1;
export const ARMS = Object.freeze(['A', 'B', 'C', 'D']);
export const REPEATS = 2;
export const REGISTERED_ARM_UNITS = 32;

export const ARM_DESCRIPTIONS = Object.freeze({
  A: 'CORE_SYNC control',
  B: 'A + BB-078 detached operations (diagnostic)',
  C: 'B + BB-079 async-result context (diagnostic)',
  D: 'C + BB-080 steering/wakeup/recovery (promotion candidate)'
});

export const EXPERIMENT_ID = 'BB081-HELD-OUT-ABLATION-V1';
export const PROTOCOL_ID = 'BB081-FIXED-FACTOR-HELDOUT-V1';
export const PROTOCOL_VERSION = '1';
export const COHORT_ID = 'BB081-HELD-OUT-V1';

export const HELDOUT = Object.freeze([
  Object.freeze(['terminal-bench/git-leak-recovery', 'sha256:22a9ec10dbd4cd8b99477b70e1944103775ca41de9b9e0025ec4898cd17bd334']),
  Object.freeze(['terminal-bench/pypi-server', 'sha256:1a1e0542f58e2d3362fec17a9bbb98667717d9a4a3e9a4c8413d3150a4fa0ff1']),
  Object.freeze(['terminal-bench/kv-store-grpc', 'sha256:973c5d4c111fb61a344457936f1c36400acd2d9e44389e7b319586fe23a7a307']),
  Object.freeze(['terminal-bench/sanitize-git-repo', 'sha256:73c94a21ebe370bae843adbeeaaa9e991374867b18483aaf56c7cd470dcddea7'])
]);

export const SCHEDULE = Object.freeze([
  'git-leak r1 A-B-D-C; r2 C-D-B-A',
  'pypi r1 B-C-A-D; r2 D-A-C-B',
  'kv-store r1 C-D-B-A; r2 A-B-D-C',
  'sanitize r1 D-A-C-B; r2 B-C-A-D'
]);

export const BUDGET = Object.freeze({
  maxUnitCostUsd: 0.6,
  maxCohortCostUsd: 25,
  maxTurns: 16,
  maxHostCalls: 64,
  maxElapsedMs: 900000,
  maxInputTokens: 180000,
  maxOutputTokens: 12000
});

export const MODEL_PROFILE = Object.freeze({
  transport: 'OpenRouter',
  model: 'anthropic/claude-sonnet-4.6',
  provider: 'Anthropic',
  fallback: 'disabled'
});

export const FIXED_STATEMENT = 'All BB-077 fixed factors and comparison protocol, plus BB-065 BENCHMARK_SUBSTRATE_MANIFEST_V1 and @exharness/benchmark attempt/evidence/accounting/audit semantics';
export const COMPARISON_STATEMENT = 'D/A primary; A->B, B->C, C->D diagnostic; all units/attempts retained';

export class AblationContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'AblationContractError';
    this.code = code;
  }
}

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

function shortId(bundle) {
  const mapping = {
    'terminal-bench/git-leak-recovery': 'git-leak',
    'terminal-bench/pypi-server': 'pypi',
    'terminal-bench/kv-store-grpc': 'kv-store',
    'terminal-bench/sanitize-git-repo': 'sanitize'
  };
  return mapping[bundle] ?? bundle;
}

export function heldOutEntries() {
  return Object.freeze(HELDOUT.map(([bundle, bundleDigest]) => Object.freeze({
    id: bundle.replace('terminal-bench/', ''),
    bundle,
    bundleDigest,
    shortId: shortId(bundle)
  })));
}

export function heldOutDigests() {
  return Object.freeze(HELDOUT.map(([, digest]) => digest));
}

export function isHeldOutTask({ taskId = null, bundle = null, bundleDigest = null } = {}) {
  return HELDOUT.some(([b, d]) => {
    if (taskId != null && (b === taskId || b.replace('terminal-bench/', '') === taskId)) return true;
    if (bundle != null && b === bundle) return true;
    if (bundleDigest != null && d === bundleDigest) return true;
    return false;
  });
}

// Hard rejection: DEV/replacement/mutated tasks never enter the held-out cohort.
export function assertHeldOut({ taskId = null, bundle = null, bundleDigest = null } = {}) {
  const key = bundle ?? taskId ?? bundleDigest ?? 'unknown';
  if (!isHeldOutTask({ taskId, bundle, bundleDigest })) {
    throw new AblationContractError('DEV_REJECTED', `task ${key} is not in the four reserved held-out digests; DEV/replacement tasks are rejected`);
  }
  return true;
}

export function assertArm(arm) {
  if (!ARMS.includes(arm)) {
    throw new AblationContractError('ARM', `unknown arm ${arm}; expected one of ${ARMS.join('|')}`);
  }
  return true;
}

export function unitIdFor({ taskId, arm, repeatIndex }) {
  if (typeof taskId !== 'string' || !taskId) throw new AblationContractError('UNIT', 'unitIdFor needs taskId');
  assertArm(arm);
  if (!Number.isInteger(repeatIndex) || repeatIndex < 0 || repeatIndex >= REPEATS) {
    throw new AblationContractError('UNIT', `repeatIndex must be 0..${REPEATS - 1}`);
  }
  return `${taskId}--${arm}--r${repeatIndex}`;
}

export function registeredUnitIds() {
  const ids = [];
  for (const entry of heldOutEntries()) {
    for (let repeatIndex = 0; repeatIndex < REPEATS; repeatIndex += 1) {
      for (const arm of ARMS) ids.push(unitIdFor({ taskId: entry.id, arm, repeatIndex }));
    }
  }
  return Object.freeze(ids);
}

export function assertRegisteredUnits(unitIds) {
  const expected = new Set(registeredUnitIds());
  const actual = new Set(unitIds);
  if (actual.size !== REGISTERED_ARM_UNITS || expected.size !== REGISTERED_ARM_UNITS) {
    throw new AblationContractError('COHORT', `held-out cohort must be exactly ${REGISTERED_ARM_UNITS} registered arm units`);
  }
  for (const id of expected) {
    if (!actual.has(id)) throw new AblationContractError('COHORT', `missing registered unit ${id}`);
  }
  for (const id of actual) {
    if (!expected.has(id)) throw new AblationContractError('COHORT', `unregistered unit ${id} is not part of the frozen cohort`);
  }
  return true;
}

// Balanced order schedule per task/repeat, parsed from the frozen SCHEDULE.
export function scheduleOrderFor({ shortTaskId, repeatIndex }) {
  const line = SCHEDULE.find((entry) => entry.startsWith(`${shortTaskId} `));
  if (!line) throw new AblationContractError('SCHEDULE', `no frozen schedule for ${shortTaskId}`);
  const part = repeatIndex === 0 ? line.split(';')[0] : line.split(';')[1];
  if (!part) throw new AblationContractError('SCHEDULE', `no frozen repeat r${repeatIndex + 1} for ${shortTaskId}`);
  const orderToken = part.split(' ').at(-1);
  const order = orderToken.split('-').map((s) => s.trim());
  if (order.length !== 4 || new Set(order).size !== 4 || !order.every((a) => ARMS.includes(a))) {
    throw new AblationContractError('SCHEDULE', `frozen schedule order is corrupt for ${shortTaskId} r${repeatIndex + 1}`);
  }
  return Object.freeze(order);
}

export function fullSchedule() {
  const rows = [];
  for (const entry of heldOutEntries()) {
    for (let repeatIndex = 0; repeatIndex < REPEATS; repeatIndex += 1) {
      rows.push(Object.freeze({
        taskId: entry.id,
        shortId: entry.shortId,
        repeatIndex,
        order: scheduleOrderFor({ shortTaskId: entry.shortId, repeatIndex })
      }));
    }
  }
  return Object.freeze(rows);
}

export function protocolHash() {
  return sha(JSON.stringify({
    protocol: `${PROTOCOL_ID}@${PROTOCOL_VERSION}`,
    arms: [...ARMS],
    armDescriptions: { ...ARM_DESCRIPTIONS },
    repeats: REPEATS,
    order: [...SCHEDULE],
    heldOut: HELDOUT.map(([b, d]) => `${b}@${d}`),
    model: MODEL_PROFILE,
    budget: { ...BUDGET }
  }));
}

export function ablationContract() {
  return Object.freeze({
    version: ABLATION_CONTRACT_VERSION,
    experimentId: EXPERIMENT_ID,
    protocolId: PROTOCOL_ID,
    protocolVersion: PROTOCOL_VERSION,
    protocolHash: protocolHash(),
    cohortId: COHORT_ID,
    arms: Object.freeze({ ...ARM_DESCRIPTIONS }),
    heldout: Object.freeze(HELDOUT.map(([bundle, digest]) => Object.freeze([bundle, digest]))),
    unit: 'task digest + repeatIndex + frozen profile hash',
    repeats: REPEATS,
    registeredArmUnits: REGISTERED_ARM_UNITS,
    schedule: Object.freeze([...SCHEDULE]),
    fixed: FIXED_STATEMENT,
    budget: `BB-077 external limits: <=$${BUDGET.maxUnitCostUsd.toFixed(2)}/unit, <=$${BUDGET.maxCohortCostUsd} live cohort, ${BUDGET.maxTurns} turns, ${BUDGET.maxHostCalls} host calls, 900s, 180k input, 12k output`,
    budgetLimits: Object.freeze({ ...BUDGET }),
    comparison: COMPARISON_STATEMENT
  });
}

export function cohortBinding({ substrateManifest }) {
  if (!substrateManifest || typeof substrateManifest !== 'object') {
    throw new AblationContractError('SUBSTRATE', 'cohortBinding needs the substrate manifest');
  }
  return Object.freeze({
    cohortId: COHORT_ID,
    experimentId: EXPERIMENT_ID,
    protocolHash: protocolHash(),
    substrateKind: substrateManifest.kind,
    substrateDigest: sha(JSON.stringify(substrateManifest)),
    harbor: Object.freeze({ ...(substrateManifest.harbor ?? {}) })
  });
}

export function assertCohortBinding({ binding, substrateManifest }) {
  const current = cohortBinding({ substrateManifest });
  if (binding.substrateDigest !== current.substrateDigest) {
    throw new AblationContractError('SUBSTRATE_DRIFT', 'substrate manifest changed; start a new cohort instead of mixing manifests');
  }
  if (binding.protocolHash !== current.protocolHash) {
    throw new AblationContractError('PROTOCOL_DRIFT', 'ablation protocol changed; start a new cohort instead of mixing protocols');
  }
  return true;
}
