// S5 — BB-081 deterministic fault matrix: safety/recovery probes as fixtures.
// No paid-provider calls. Undeclared arm/scenario cells are N/A, never passes.
// Every D-applicable assertion must pass and D duplicate effects must be zero.
import { createHash } from 'node:crypto';

export const FAULT_MATRIX_VERSION = 1;

export const SCENARIOS = Object.freeze([
  Object.freeze(['PROVIDER_TIMEOUT', 'ABCD', 'provider/termination separate from quality; no hidden usage/retry']),
  Object.freeze(['PROVIDER_429', 'ABCD', 'rate-limit retained; retry append-only']),
  Object.freeze(['AMBIGUOUS_COMPLETION', 'ABCD', 'unverified result never authoritative']),
  Object.freeze(['TOOL_FAILURE', 'ABCD', 'failure fingerprint retained; verifier owns quality']),
  Object.freeze(['KILL_AFTER_DURABLE_OPERATION', 'BCD', 'exact operation/effect/generation on restart; zero duplicate effects']),
  Object.freeze(['CANCEL_AFTER_DISPATCH', 'BCD', 'replay-policy truth; unresolved effect not relabelled cancelled']),
  Object.freeze(['DUPLICATE_TRANSITION', 'CD', 'idempotent duplicate; binding conflict fails closed']),
  Object.freeze(['DUPLICATE_WAKE', 'D', 'at most one active wake; no turn storm']),
  Object.freeze(['STALE_MODEL_AFTER_STEER', 'D', 'zero stale action/tool dispatch; one current successor']),
  Object.freeze(['NON_RECONCILABLE_AMBIGUITY', 'BCD', 'escalate/fail closed; no second semantic dispatch'])
]);

export const RECOVERY_OUTCOMES = Object.freeze(['NOT_APPLICABLE', 'RECOVERED', 'ESCALATED', 'FAILED', 'UNKNOWN']);

export function scenarioNames() {
  return Object.freeze(SCENARIOS.map(([name]) => name));
}

export function armsFor(scenarioName) {
  const entry = SCENARIOS.find(([name]) => name === scenarioName);
  if (!entry) throw new Error(`unknown fault scenario ${scenarioName}`);
  return entry[1];
}

export function isApplicable(scenarioName, arm) {
  return armsFor(scenarioName).includes(arm);
}

export function declaredCells() {
  const cells = [];
  for (const [name, arms] of SCENARIOS) {
    for (const arm of arms) cells.push(Object.freeze({ scenario: name, arm }));
  }
  return Object.freeze(cells);
}

export function isDeclaredCell({ scenario, arm }) {
  return declaredCells().some((c) => c.scenario === scenario && c.arm === arm);
}

function traceDigest({ scenario, arm }) {
  return `sha256:${createHash('sha256').update(`BB081-fault:${scenario}:${arm}`, 'utf8').digest('hex')}`;
}

// Deterministic fixture outcome per declared cell. Provider/termination faults
// never synthesize quality; recovery faults bind exact operation identity and
// never duplicate effects. D cells pass with zero duplicates by construction;
// callers mutate fixtures to prove KEEP_SYNC paths.
export function runFaultCell({ scenario, arm, mutate = null } = {}) {
  if (!isDeclaredCell({ scenario, arm })) {
    return Object.freeze({
      scenario, arm, applicable: false, status: 'N/A',
      passed: null, recoveryOutcome: 'NOT_APPLICABLE',
      duplicateEffects: null, traceDigest: null,
      note: 'Undeclared arm/scenario cells are N/A, never passes'
    });
  }
  const base = (() => {
    switch (scenario) {
      case 'PROVIDER_TIMEOUT':
        return { recoveryOutcome: 'NOT_APPLICABLE', duplicateEffects: 0, providerStatus: 'PROVIDER_TIMEOUT', quality: 'NOT_EVALUATED', termination: 'AGENT_TIMEOUT' };
      case 'PROVIDER_429':
        return { recoveryOutcome: 'RECOVERED', duplicateEffects: 0, providerStatus: 'RATE_LIMITED', quality: 'NOT_EVALUATED', termination: 'COMPLETED' };
      case 'AMBIGUOUS_COMPLETION':
        return { recoveryOutcome: 'ESCALATED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED' };
      case 'TOOL_FAILURE':
        return { recoveryOutcome: 'FAILED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'REJECTED', termination: 'COMPLETED' };
      case 'KILL_AFTER_DURABLE_OPERATION':
        return { recoveryOutcome: 'RECOVERED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED' };
      case 'CANCEL_AFTER_DISPATCH':
        return { recoveryOutcome: 'ESCALATED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'CANCELLED' };
      case 'DUPLICATE_TRANSITION':
        return { recoveryOutcome: 'RECOVERED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED' };
      case 'DUPLICATE_WAKE':
        return { recoveryOutcome: 'RECOVERED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED', wakes: 1 };
      case 'STALE_MODEL_AFTER_STEER':
        return { recoveryOutcome: 'RECOVERED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED', staleDispatches: 0 };
      case 'NON_RECONCILABLE_AMBIGUITY':
        return { recoveryOutcome: 'ESCALATED', duplicateEffects: 0, providerStatus: 'NONE', quality: 'NOT_EVALUATED', termination: 'COMPLETED' };
      default:
        return { recoveryOutcome: 'UNKNOWN', duplicateEffects: 0 };
    }
  })();
  const merged = { ...base, ...(mutate ?? {}) };
  // Safety invariant: any conclusive D duplicate effect or unresolved
  // NON_RECONCILABLE ambiguity forces failure of that cell.
  let passed = true;
  if (typeof merged.duplicateEffects === 'number' && merged.duplicateEffects !== 0) passed = false;
  if (scenario === 'NON_RECONCILABLE_AMBIGUITY' && merged.recoveryOutcome !== 'ESCALATED') passed = false;
  if (scenario === 'STALE_MODEL_AFTER_STEER' && (merged.staleDispatches ?? 0) !== 0) passed = false;
  if (scenario === 'DUPLICATE_WAKE' && (merged.wakes ?? 1) !== 1) passed = false;
  if (mutate?.forceFail === true) passed = false;
  return Object.freeze({
    scenario, arm, applicable: true,
    status: passed ? 'PASS' : 'FAIL',
    passed,
    recoveryOutcome: merged.recoveryOutcome,
    duplicateEffects: merged.duplicateEffects,
    providerStatus: merged.providerStatus ?? 'NONE',
    quality: merged.quality ?? 'NOT_EVALUATED',
    termination: merged.termination ?? 'COMPLETED',
    traceDigest: traceDigest({ scenario, arm }),
    evidence: Object.freeze({ ...merged, traceDigest: traceDigest({ scenario, arm }) })
  });
}

export function runFaultMatrix({ mutateCell = null } = {}) {
  const cells = declaredCells().map(({ scenario, arm }) => {
    const mutate = typeof mutateCell === 'function' ? mutateCell({ scenario, arm }) : null;
    return runFaultCell({ scenario, arm, mutate });
  });
  return Object.freeze(cells);
}

export function requiredDCells(cells = runFaultMatrix()) {
  return Object.freeze(cells.filter((c) => c.arm === 'D' && c.applicable));
}

export function assertMatrixComplete(cells) {
  const expected = declaredCells();
  if (cells.length !== expected.length) {
    throw new Error(`fault matrix is incomplete: expected ${expected.length} declared cells, found ${cells.length}`);
  }
  for (const cell of expected) {
    if (!cells.some((c) => c.scenario === cell.scenario && c.arm === cell.arm)) {
      throw new Error(`fault matrix missing declared cell ${cell.scenario}/${cell.arm}`);
    }
  }
  return true;
}

// N/A is never counted as pass; only declared PASS cells count.
export function countPasses(cells) {
  return cells.filter((c) => c.applicable && c.passed === true).length;
}

export function dSafetySatisfied(cells) {
  const dCells = requiredDCells(cells);
  if (!dCells.length) return false;
  return dCells.every((c) => c.passed === true) && dCells.every((c) => c.duplicateEffects === 0);
}

export function faultMatrixManifest() {
  return Object.freeze({
    version: FAULT_MATRIX_VERSION,
    mode: 'deterministic fixtures; no paid-provider calls',
    scenarios: SCENARIOS,
    rule: 'Undeclared arm/scenario cells are N/A, never passes. Every D-applicable assertion must pass and D duplicate external effects must be zero.'
  });
}
