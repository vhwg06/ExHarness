// S7 — BB-081 execution profiles: CORE_SYNC stays supported; CORE_ASYNC_FIRST_V1
// publishes only after PROMOTE_ASYNC with exact evidence binding and
// quiescent rollback. B/C remain diagnostic. Runtime defaults unchanged.
import { createHash } from 'node:crypto';

export const EXECUTION_PROFILE_VERSION = 1;
export const CORE_SYNC = 'CORE_SYNC';
export const CORE_ASYNC_FIRST_V1 = 'CORE_ASYNC_FIRST_V1';
export const SUPPORTED_BASE = Object.freeze([CORE_SYNC]);
export const DIAGNOSTIC_ARMS = Object.freeze(['B', 'C']);

export const EVIDENCE_BINDING_FIELDS = Object.freeze([
  'decision',
  'ablation/fault protocol',
  'evaluated source',
  'BB-077/078/079/080 deliveries',
  'provider/model profile'
]);

export class ExecutionProfileError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ExecutionProfileError';
    this.code = code;
  }
}

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

export function getSupportedProfiles({ decision } = {}) {
  if (decision === 'PROMOTE_ASYNC') return Object.freeze([CORE_SYNC, CORE_ASYNC_FIRST_V1]);
  return Object.freeze([CORE_SYNC]);
}

export function isSupported({ profile, decision } = {}) {
  return getSupportedProfiles({ decision }).includes(profile);
}

export function isDiagnosticArm(arm) {
  return DIAGNOSTIC_ARMS.includes(arm);
}

// Evidence binding: decision + ablation/fault protocol + evaluated source +
// dependency deliveries + provider/model profile. Later mutation invalidates.
export function createEvidenceBinding({
  decision,
  ablationProtocolHash = null,
  faultProtocolVersion = null,
  evaluatedSourceSha = null,
  dependencyDigest = null,
  providerProfile = null
} = {}) {
  if (decision !== 'PROMOTE_ASYNC') {
    throw new ExecutionProfileError('BINDING', 'evidence binding is only created for PROMOTE_ASYNC; INCONCLUSIVE publishes no async claim');
  }
  for (const [label, value] of [
    ['ablationProtocolHash', ablationProtocolHash],
    ['evaluatedSourceSha', evaluatedSourceSha],
    ['dependencyDigest', dependencyDigest]
  ]) {
    if (typeof value !== 'string' || !value) {
      throw new ExecutionProfileError('BINDING', `evidence binding needs ${label}`);
    }
  }
  const binding = {
    version: EXECUTION_PROFILE_VERSION,
    profile: CORE_ASYNC_FIRST_V1,
    decision,
    ablationProtocolHash,
    faultProtocolVersion: faultProtocolVersion ?? 1,
    evaluatedSourceSha,
    dependencyDigest,
    providerProfile: providerProfile ? JSON.parse(JSON.stringify(providerProfile)) : null
  };
  const digest = sha(JSON.stringify(binding));
  return Object.freeze({ ...binding, bindingDigest: digest });
}

export function assertEvidenceFresh({ binding, current } = {}) {
  if (!binding || typeof binding !== 'object') throw new ExecutionProfileError('STALE', 'evidence binding is missing');
  if (!current || typeof current !== 'object') throw new ExecutionProfileError('STALE', 'current binding context is missing');
  for (const field of ['ablationProtocolHash', 'evaluatedSourceSha', 'dependencyDigest']) {
    if (binding[field] !== current[field]) {
      throw new ExecutionProfileError('STALE', `evidence binding drifted on ${field}; the evidence-backed claim is invalidated`);
    }
  }
  const recomputed = sha(JSON.stringify({
    version: binding.version,
    profile: binding.profile,
    decision: binding.decision,
    ablationProtocolHash: binding.ablationProtocolHash,
    faultProtocolVersion: binding.faultProtocolVersion,
    evaluatedSourceSha: binding.evaluatedSourceSha,
    dependencyDigest: binding.dependencyDigest,
    providerProfile: binding.providerProfile
  }));
  if (recomputed !== binding.bindingDigest) {
    throw new ExecutionProfileError('STALE', 'evidence binding digest does not match content; later mutation invalidates the claim');
  }
  return Object.freeze({ fresh: true, profile: binding.profile });
}

export function assertProfilePublishable({ profile, decision, evidenceBinding = null } = {}) {
  if (profile === CORE_SYNC) return Object.freeze({ publishable: true, profile });
  if (profile === CORE_ASYNC_FIRST_V1) {
    if (decision !== 'PROMOTE_ASYNC') {
      throw new ExecutionProfileError('PUBLISH', `profile ${profile} requires PROMOTE_ASYNC (found ${decision ?? 'none'}); B/C and INCONCLUSIVE never publish`);
    }
    if (!evidenceBinding) throw new ExecutionProfileError('PUBLISH', 'async publication requires the exact evidence binding');
    if (evidenceBinding.profile !== CORE_ASYNC_FIRST_V1 || evidenceBinding.decision !== 'PROMOTE_ASYNC') {
      throw new ExecutionProfileError('PUBLISH', 'evidence binding does not authorize this profile');
    }
    return Object.freeze({ publishable: true, profile });
  }
  if (profile === 'B' || profile === 'C') {
    throw new ExecutionProfileError('PUBLISH', `arm ${profile} is diagnostic-only and is never published as a supported profile`);
  }
  throw new ExecutionProfileError('PUBLISH', `unknown profile ${profile}`);
}

// Rollback is quiescent-session only: after in-flight async operations/effects
// are terminal or reconciled. Mid-flight rollback is rejected.
export function rollbackToSync({ session } = {}) {
  const state = session ?? {};
  const inFlight = state.inFlightAsyncOperations ?? state.inFlight ?? 0;
  const unresolved = state.unresolvedEffects ?? 0;
  const pendingTurns = state.pendingModelTurns ?? 0;
  if (inFlight !== 0 || unresolved !== 0 || pendingTurns !== 0) {
    throw new ExecutionProfileError(
      'ROLLBACK',
      `rollback refused mid-flight (inFlight=${inFlight}, unresolved=${unresolved}, pendingTurns=${pendingTurns}); rollback is only at a new/quiescent session boundary`
    );
  }
  if (state.isNewSession !== true && state.quiescent !== true) {
    // Accept either explicit marker; both mean the session boundary is quiet.
    if (state.isNewSession !== true) {
      throw new ExecutionProfileError('ROLLBACK', 'rollback requires a new/quiescent session boundary');
    }
  }
  return Object.freeze({ profile: CORE_SYNC, rolledBack: true });
}

export function defaultProfile() {
  // createAgentRuntime defaults are not silently changed by BB-081.
  return CORE_SYNC;
}

export function executionProfileManifest() {
  return Object.freeze({
    version: EXECUTION_PROFILE_VERSION,
    supported: Object.freeze([CORE_SYNC, `${CORE_ASYNC_FIRST_V1} only after PROMOTE_ASYNC`]),
    diagnostic: Object.freeze([...DIAGNOSTIC_ARMS]),
    noImplicitDefault: true,
    binding: Object.freeze([...EVIDENCE_BINDING_FIELDS]),
    rollback: 'CORE_SYNC at new/quiescent session after async operations/effects are terminal or reconciled',
    inconclusive: 'no profile change'
  });
}
