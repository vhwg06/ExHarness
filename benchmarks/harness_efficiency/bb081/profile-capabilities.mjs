// S2 — BB-081 profile capabilities: A=CORE_SYNC, B=A+BB-078, C=B+BB-079,
// D=C+BB-080. B/C diagnostic-only; D sole promotion candidate. Only delivered
// Core capability composition varies; BB-065 substrate and BB-077 fixed factors
// stay frozen.
export const PROFILE_CAPABILITIES_VERSION = 1;

export const PROFILES = Object.freeze({
  A: Object.freeze({
    arm: 'A',
    description: 'CORE_SYNC control',
    usesDetached: false,
    usesAsyncContext: false,
    usesCoordinator: false,
    diagnostic: false,
    promotionCandidate: false,
    supported: true
  }),
  B: Object.freeze({
    arm: 'B',
    description: 'A + BB-078 detached operations (diagnostic)',
    usesDetached: true,
    usesAsyncContext: false,
    usesCoordinator: false,
    diagnostic: true,
    promotionCandidate: false,
    supported: false
  }),
  C: Object.freeze({
    arm: 'C',
    description: 'B + BB-079 async-result context (diagnostic)',
    usesDetached: true,
    usesAsyncContext: true,
    usesCoordinator: false,
    diagnostic: true,
    promotionCandidate: false,
    supported: false
  }),
  D: Object.freeze({
    arm: 'D',
    description: 'C + BB-080 steering/wakeup/recovery (promotion candidate)',
    usesDetached: true,
    usesAsyncContext: true,
    usesCoordinator: true,
    diagnostic: false,
    promotionCandidate: true,
    supported: false
  })
});

export class ProfileCapabilitiesError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ProfileCapabilitiesError';
    this.code = code;
  }
}

export function getProfileCapabilities(arm) {
  const profile = PROFILES[arm];
  if (!profile) throw new ProfileCapabilitiesError('ARM', `unknown arm ${arm}; expected A|B|C|D`);
  return profile;
}

export function isDiagnostic(arm) {
  return getProfileCapabilities(arm).diagnostic;
}

export function isPromotionCandidate(arm) {
  return getProfileCapabilities(arm).promotionCandidate;
}

export function isSupportedProfileArm(arm) {
  return getProfileCapabilities(arm).supported;
}

// Composition check against the live Core surface. B/C/D cannot be approximated:
// missing seams fail PLAN_INPUT_CONTRADICTION.
export function assertComposable({ arm, core } = {}) {
  const profile = getProfileCapabilities(arm);
  if (core == null || typeof core !== 'object') {
    throw new ProfileCapabilitiesError('PLAN_INPUT_CONTRADICTION', `arm ${arm} has no Core surface to compose against`);
  }
  const required = ['createAgentRuntime'];
  if (profile.usesDetached) required.push('createDetachedOperationManager');
  if (profile.usesAsyncContext) required.push('createAsyncResultContextState', 'stageAsyncResultTransitions');
  if (profile.usesCoordinator) required.push('createAsyncAgentCoordinator');
  const missing = required.filter((name) => typeof core[name] !== 'function');
  if (missing.length > 0) {
    throw new ProfileCapabilitiesError('PLAN_INPUT_CONTRADICTION', `arm ${arm} is non-composable: missing ${missing.join(', ')}`);
  }
  return Object.freeze({ arm, composable: true, uses: Object.freeze(required) });
}

export function assertAllComposable({ core } = {}) {
  for (const arm of ['A', 'B', 'C', 'D']) assertComposable({ arm, core });
  return Object.freeze({ composable: true, arms: Object.freeze(['A', 'B', 'C', 'D']) });
}

// Tool-activation probe semantics: same capability/schema/effect identity in
// every arm; A waits terminal, B/C/D return RUNNING before identical delayed
// effect completes. Recorded detachable-call count per unit; all eight D units
// zero => INCONCLUSIVE (handled by the reducer).
export function toolActivationExpectation(arm) {
  const profile = getProfileCapabilities(arm);
  if (!profile.usesDetached) {
    return Object.freeze({ arm, behavior: 'synchronous bound effect', returnsRunning: false });
  }
  if (arm === 'B') return Object.freeze({ arm, behavior: 'A via BB-078 detach', returnsRunning: true });
  if (arm === 'C') return Object.freeze({ arm, behavior: 'B + BB-079', returnsRunning: true });
  return Object.freeze({ arm, behavior: 'C + BB-080', returnsRunning: true });
}

export function profileCapabilitiesManifest() {
  return Object.freeze({
    version: PROFILE_CAPABILITIES_VERSION,
    profiles: PROFILES,
    rule: 'Only delivered Core capability composition varies; BB-065 substrate and BB-077 fixed factors stay frozen'
  });
}
