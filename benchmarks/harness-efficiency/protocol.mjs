// S2 — Fixed-factor/cohort protocol: preregistered development and held-out
// manifests, pair identity, three-repeat alternating order, task-specific
// admissibility through the delivered substrate, and hard held-out rejection.
// Every unit binds the upstream substrate manifest; a changed manifest starts a
// new cohort instead of mixing into this one.
import { createHash } from 'node:crypto';
import {
  ARMS,
  COHORT_ID,
  DEVELOPMENT_TASKS,
  HELD_OUT_SET_ID,
  HELD_OUT_TASKS,
  PAIR_ORDER,
  REPEATS,
  environmentIdentityFor,
  fixedFactorDigest,
  instructionDigestFor
} from './constants.mjs';

export class ProtocolError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

export function developmentEntries() {
  return DEVELOPMENT_TASKS.map((task) => Object.freeze({
    id: task.id,
    bundle: task.bundle,
    bundleDigest: task.bundleDigest,
    environmentIdentity: environmentIdentityFor(),
    instructionDigest: instructionDigestFor(task.bundleDigest)
  }));
}

export function heldOutEntries() {
  return HELD_OUT_TASKS.map((task) => Object.freeze({
    id: task.id,
    bundle: task.bundle,
    bundleDigest: task.bundleDigest,
    environmentIdentity: environmentIdentityFor(),
    instructionDigest: instructionDigestFor(task.bundleDigest)
  }));
}

export function isHeldOut(taskId) {
  return HELD_OUT_TASKS.some((task) => task.id === taskId);
}

export function isDevelopment(taskId) {
  return DEVELOPMENT_TASKS.some((task) => task.id === taskId);
}

// Hard rejection: BB-077 never executes held-out tasks.
export function assertNotHeldOut(taskId) {
  if (isHeldOut(taskId)) {
    throw new ProtocolError('HELD_OUT', `task ${taskId} is reserved for the held-out decision and cannot execute here`);
  }
  return true;
}

export function assertDevelopment(taskId) {
  assertNotHeldOut(taskId);
  if (!isDevelopment(taskId)) {
    throw new ProtocolError('UNKNOWN_TASK', `task ${taskId} is not in the preregistered development cohort`);
  }
  return true;
}

// Pair schedule: three repeats per task with alternating arm order.
export function pairSchedule() {
  const schedule = [];
  for (const task of DEVELOPMENT_TASKS) {
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      const [first, second] = PAIR_ORDER[repeat].split('->');
      schedule.push(Object.freeze({
        pairId: `${task.id}:r${repeat}`,
        taskId: task.id,
        bundleDigest: task.bundleDigest,
        repeatIndex: repeat,
        order: PAIR_ORDER[repeat],
        first: first.trim(),
        second: second.trim(),
        fixedDigest: fixedFactorDigest({ taskId: task.id, bundleDigest: task.bundleDigest })
      }));
    }
  }
  return Object.freeze(schedule);
}

export function unitIdFor({ taskId, arm, repeatIndex }) {
  return `${taskId}--${arm}--r${repeatIndex}`;
}

// All unit ids preregistered for the cohort (6 tasks x 3 repeats x 2 arms).
export function cohortUnitIds() {
  const ids = [];
  for (const task of DEVELOPMENT_TASKS) {
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      for (const arm of ARMS) ids.push(unitIdFor({ taskId: task.id, arm, repeatIndex: repeat }));
    }
  }
  return Object.freeze(ids);
}

// Matched-pair identity: both units share every fixed factor; only the arm varies.
export function assertPairIdentity(directUnit, coreUnit) {
  if (directUnit.arm !== 'DIRECT_CODEACT' || coreUnit.arm !== 'CORE_SYNC') {
    throw new ProtocolError('ARM', 'a pair must be DIRECT_CODEACT versus CORE_SYNC');
  }
  const drift = [];
  if (directUnit.task.id !== coreUnit.task.id) drift.push('task.id');
  if (directUnit.task.bundleDigest !== coreUnit.task.bundleDigest) drift.push('task.bundleDigest');
  if (directUnit.environmentIdentity !== coreUnit.environmentIdentity) drift.push('environmentIdentity');
  if (directUnit.instructionDigest !== coreUnit.instructionDigest) drift.push('instructionDigest');
  if (directUnit.producerProfile !== coreUnit.producerProfile) drift.push('producerProfile');
  if (directUnit.budgetProfileHash !== coreUnit.budgetProfileHash) drift.push('budgetProfileHash');
  if (directUnit.repeatIndex !== coreUnit.repeatIndex) drift.push('repeatIndex');
  if (drift.length) {
    throw new ProtocolError('FIXED_FACTOR_DRIFT', `matched pair changed fixed factors: ${drift.join(', ')}`);
  }
  return true;
}

// Binds a cohort to one substrate manifest digest. A changed manifest digest
// must start a new cohort; it is never silently mixed into this one.
export function cohortBinding({ substrateManifest }) {
  const digest = sha(JSON.stringify(substrateManifest));
  return Object.freeze({
    cohortId: COHORT_ID,
    substrateKind: substrateManifest.kind,
    substrateDigest: digest,
    harbor: { ...substrateManifest.harbor }
  });
}

export function assertCohortBinding({ binding, substrateManifest }) {
  const current = cohortBinding({ substrateManifest });
  if (binding.substrateDigest !== current.substrateDigest) {
    throw new ProtocolError('SUBSTRATE_DRIFT', 'substrate manifest changed; start a new cohort instead of mixing manifests');
  }
  return true;
}

// Task-specific oracle/nop admissibility runs through the delivered substrate
// port result; this experiment only reads that verdict, never reimplements
// Harbor reset/artifact/verifier/failure normalization.
export function admissibility({ oraclePasses, nopFails }) {
  if (oraclePasses !== 5) return Object.freeze({ admissible: false, reason: 'oracle must pass 5/5' });
  if (nopFails < 1) return Object.freeze({ admissible: false, reason: 'nop must fail at least 1/1' });
  return Object.freeze({ admissible: true, reason: null });
}

export function developmentManifest({ binding }) {
  return Object.freeze({
    kind: 'BB077_DEVELOPMENT_COHORT_V1',
    cohortId: COHORT_ID,
    repeats: REPEATS,
    order: [...PAIR_ORDER],
    substrateDigest: binding.substrateDigest,
    tasks: developmentEntries()
  });
}

export function heldOutManifest() {
  return Object.freeze({
    kind: 'BB077_HELD_OUT_V1',
    setId: HELD_OUT_SET_ID,
    tasks: heldOutEntries()
  });
}
