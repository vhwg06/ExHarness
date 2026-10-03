// BB-086 offline GEPA bridge — Node owner side (D8/D9).
//
// Node owns ALL side effects: benchmark reservation (AttemptLedger), crash
// reconciliation, hard-budget admission, accounting and the child process.
// Python owns ONLY the pinned optimizer computation and speaks a bounded
// JSON-lines protocol with explicit request ids. Unknown usage/cost from
// Python stays null, never 0.
//
// Node built-ins only. The benchmark package is imported read-only from its
// root export surface (relative path; this repo has no node_modules).

import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { AttemptLedger, normalizeAccounting } from '../../packages/benchmark/src/index.js';

const GEPA_COMMIT = 'd771eb21b5dd3228bc3f567293d2ccfc423fc900';
const SHUTDOWN_TIMEOUT_MS = 2000;
const MAX_STDERR_BYTES = 4096;

function sha256digest(value) {
  return 'sha256:' + createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function nowIso() {
  return new Date().toISOString();
}

function codedError(code, message) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

/**
 * Create a Node-owned GEPA bridge.
 *
 * @param {object} opts
 * @param {AttemptLedger} opts.ledger  Delivered @exharness/benchmark ledger (required).
 * @param {string} [opts.pythonPath='python3']
 * @param {string} opts.adapterPath   Path to gepa_adapter.py (required).
 * @param {string} opts.runDir        Run-scoped dir handed to the adapter (required).
 * @param {object} [opts.budget={maxAttempts: Infinity}]  Hard pre-dispatch budget.
 * @param {number} [opts.timeoutMs=30000]  Per-request child timeout.
 * @param {string|null} [opts.unitId=null]  Default benchmark unit for reservations.
 */
export function createGepaBridge({
  ledger,
  pythonPath = 'python3',
  adapterPath,
  runDir,
  budget = {},
  timeoutMs = 30000,
  unitId = null,
} = {}) {
  if (!(ledger instanceof AttemptLedger)) throw codedError('LEDGER_REQUIRED', 'ledger must be an AttemptLedger instance');
  if (typeof adapterPath !== 'string' || !adapterPath) throw codedError('ADAPTER_REQUIRED', 'adapterPath is required');
  if (typeof runDir !== 'string' || !runDir) throw codedError('RUNDIR_REQUIRED', 'runDir is required');
  const maxAttempts = budget && budget.maxAttempts != null ? budget.maxAttempts : Infinity;

  let child = null;
  let seq = 0;
  let reservedCount = 0;
  let closed = false;
  const pending = new Map(); // id -> { resolve, reject, timer, kind, onAbort, signal }
  const successCache = new Map(); // digestKey -> { attemptId, result }
  const lastFailed = new Map(); // digestKey -> attemptId
  const inFlight = new Set(); // attemptIds reserved by this bridge and not yet settled
  let stderrTail = '';

  function killChild() {
    const cp = child;
    child = null;
    if (cp && !cp.killed && cp.exitCode === null) {
      try { cp.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }

  function failAllPending(code, message) {
    if (!pending.size) return;
    const err = codedError(code, message);
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
      entry.reject(err);
    }
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // The child is speaking a broken protocol: fail closed, do not guess.
      failAllPending('MALFORMED_RESPONSE', `child sent unparseable line: ${line.slice(0, 120)}`);
      killChild();
      return;
    }
    if (!message || typeof message !== 'object') {
      failAllPending('MALFORMED_RESPONSE', 'child sent a non-object message');
      killChild();
      return;
    }
    const entry = pending.get(String(message.id));
    if (!entry) return; // unknown/stale id: ignore
    pending.delete(String(message.id));
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
    if (message.kind === 'error') {
      const code = message.payload && message.payload.code ? String(message.payload.code) : 'ADAPTER_ERROR';
      const detail = message.payload && message.payload.message ? String(message.payload.message) : 'adapter error';
      entry.reject(codedError(code, detail));
      return;
    }
    if (message.kind !== `${entry.kind}.result`) {
      entry.reject(codedError('MALFORMED_RESPONSE', `unexpected kind ${message.kind} for ${entry.kind}`));
      return;
    }
    entry.resolve(message.payload);
  }

  function ensureChild({ allowClosed = false } = {}) {
    if (closed && !allowClosed) throw codedError('BRIDGE_CLOSED', 'bridge is closed');
    if (child && !child.killed && child.exitCode === null) return child;
    const cp = spawn(pythonPath, [adapterPath, '--run-dir', runDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    child = cp;
    cp.stdin.on('error', () => {});
    let buffer = '';
    cp.stdout.on('data', (data) => {
      buffer += String(data);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        handleLine(line);
      }
    });
    cp.stderr.on('data', (data) => {
      stderrTail = (stderrTail + String(data)).slice(-MAX_STDERR_BYTES);
    });
    cp.on('error', (err) => {
      failAllPending('SPAWN_FAILED', `could not spawn adapter: ${err.message}`);
      if (child === cp) child = null;
    });
    cp.on('exit', (code, signal) => {
      failAllPending('CHILD_EXIT', `adapter exited code=${code} signal=${signal}${stderrTail ? ` stderr=${stderrTail.slice(-200)}` : ''}`);
      if (child === cp) child = null;
    });
    return cp;
  }

  function sendRequest(kind, payload, { signal, timeout = timeoutMs, allowClosed = false } = {}) {
    return new Promise((resolve, reject) => {
      let cp;
      try {
        cp = ensureChild({ allowClosed });
      } catch (err) {
        reject(err);
        return;
      }
      const id = String(++seq);
      const entry = { resolve, reject, timer: null, kind, signal: signal || null, onAbort: null };
      const abortErr = () => codedError('ABORTED', 'dispatch aborted');
      const onAbort = () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(abortErr());
      };
      entry.onAbort = onAbort;
      entry.timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
        entry.reject(codedError('TIMEOUT', `no ${kind} response within ${timeout}ms`));
      }, timeout);
      pending.set(id, entry);
      if (entry.signal) {
        if (entry.signal.aborted) {
          onAbort();
          return;
        }
        entry.signal.addEventListener('abort', onAbort, { once: true });
      }
      cp.stdin.write(JSON.stringify({ id, kind, payload }) + '\n', (err) => {
        if (err && pending.has(id)) {
          pending.delete(id);
          clearTimeout(entry.timer);
          if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
          entry.reject(codedError('SPAWN_FAILED', `could not write to adapter: ${err.message}`));
        }
      });
    });
  }

  function buildRecordInput({ unitId: uid, attemptId, retryOfAttemptId, startedAt, endedAt, outcome, configDigest, resultSummary, failureFingerprint }) {
    const unit = ledger.unit(uid);
    const startedMs = Date.parse(startedAt);
    const endedMs = Date.parse(endedAt);
    const elapsedMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : null;
    const outcomeMeta = {
      COMPLETED: { termination: 'COMPLETED', infrastructureStatus: 'NONE', failureFingerprint: null },
      FAILED: { termination: 'AGENT_ERROR', infrastructureStatus: 'HARNESS_PROTOCOL', failureFingerprint },
      TIMEOUT: { termination: 'AGENT_TIMEOUT', infrastructureStatus: 'HARNESS_PROTOCOL', failureFingerprint },
      SPAWN_FAILED: { termination: 'AGENT_ERROR', infrastructureStatus: 'ADAPTER_SETUP', failureFingerprint },
      CANCELLED: { termination: 'CANCELLED', infrastructureStatus: 'NONE', failureFingerprint },
      CRASH_RECOVERY: { termination: 'AGENT_ERROR', infrastructureStatus: 'HARNESS_PROTOCOL', failureFingerprint },
    }[outcome];
    if (!outcomeMeta) throw codedError('INVALID_OUTCOME', `unknown settle outcome ${outcome}`);
    return {
      experimentId: ledger.registration.experimentId,
      cohortId: null,
      unitId: uid,
      attemptId,
      retryOfAttemptId,
      protocolHash: ledger.registration.protocol.hash,
      task: {
        id: unit.task.id,
        bundleDigest: unit.task.bundleDigest,
        environmentIdentity: unit.environmentIdentity,
        instructionDigest: unit.instructionDigest,
      },
      runtime: {
        substrate: 'gepa-bridge',
        substrateVersion: '1.0.0',
        substrateCommit: GEPA_COMMIT,
        sourceSha: 'gepa-bridge',
        profileHash: sha256digest(configDigest == null ? '' : String(configDigest)),
      },
      producer: { kind: 'optimizer', identity: 'gepa-bridge', model: null, provider: null },
      budget: { wallMs: elapsedMs, inputTokens: null, outputTokens: null, costUsd: null, toolCalls: null },
      candidate: { artifactRef: null, artifactDigest: null, extractionStatus: 'NOT_PRODUCED' },
      evidence: {
        substrateTrialRef: `gepa-bridge:${attemptId}`,
        resultRef: `bridge-results/${attemptId}.json`,
        trajectoryRef: null,
        verifierRefs: [],
        artifactManifestRef: null,
        manifestDigest: sha256digest(canonical(resultSummary == null ? { attemptId, outcome } : resultSummary)),
      },
      // Unknown usage/cost stays null, never 0 (ACCOUNTING_V1 UNKNOWN).
      usage: normalizeAccounting({ source: 'gepa-bridge', reportedFields: [], values: {} }),
      timing: { startedAt, endedAt, elapsedMs, providerWaitMs: null, capabilityWaitMs: null },
      quality: { verdict: 'NOT_EVALUATED', evaluatorIdentity: 'gepa-bridge', evidenceRef: null },
      termination: outcomeMeta.termination,
      providerStatus: 'USAGE_UNKNOWN',
      infrastructureStatus: outcomeMeta.infrastructureStatus,
      failureFingerprint: outcomeMeta.failureFingerprint,
    };
  }

  function settleAttemptRecord(args) {
    const endedAt = nowIso();
    const recordInput = buildRecordInput({ ...args, endedAt });
    return ledger.settleAttempt(recordInput, { settledAt: endedAt });
  }

  // Crash reconciliation: reopen settled attempts by exact refs; a
  // STARTED-without-SETTLED attempt is never blindly redispatched — it is
  // settled as failed first, and any retry is a NEW attemptId linked via
  // retryOfAttemptId (the ledger itself enforces this).
  function reconcile(uid) {
    const reconciled = [];
    for (const attempt of ledger.attempts()) {
      if (attempt.unitId !== uid) continue;
      if (attempt.status !== 'STARTED') continue;
      if (inFlight.has(attempt.attemptId)) continue;
      settleAttemptRecord({
        unitId: uid,
        attemptId: attempt.attemptId,
        retryOfAttemptId: attempt.retryOfAttemptId,
        startedAt: nowIso(),
        outcome: 'CRASH_RECOVERY',
        configDigest: '',
        resultSummary: null,
        failureFingerprint: 'CRASH_RECOVERY',
      });
      reconciled.push(attempt.attemptId);
    }
    return reconciled;
  }

  async function dispatchSearch({
    unitId: overrideUnitId,
    candidateSeed,
    developmentCases,
    configDigest,
    holdoutRefs = [],
    signal,
  } = {}) {
    const uid = overrideUnitId != null ? overrideUnitId : unitId;
    if (!uid) throw codedError('UNIT_REQUIRED', 'a benchmark unitId is required');
    if (typeof candidateSeed !== 'string' || !Array.isArray(developmentCases) || typeof configDigest !== 'string') {
      throw codedError('INVALID_ARGS', 'dispatchSearch needs {candidateSeed: string, developmentCases: string[], configDigest: string}');
    }
    // Defense in depth: the final holdout must never reach the bridge input.
    const leaked = holdoutRefs.filter((ref) => developmentCases.includes(ref));
    if (leaked.length) {
      throw codedError('HOLDOUT_EXPOSED', `holdout refs present in developmentCases: ${leaked.join(',')}`);
    }
    if (closed) return { status: 'FAILED', reason: 'BRIDGE_CLOSED' };

    const digestKey = createHash('sha256')
      .update(canonical({ unitId: uid, candidateSeed, developmentCases, configDigest }))
      .digest('hex');
    const cached = successCache.get(digestKey);
    if (cached) {
      return { status: 'OK', replayed: true, attemptId: cached.attemptId, result: cached.result };
    }

    reconcile(uid);

    // Hard budget admission BEFORE any reservation or child spawn: denial has
    // no side effect at all.
    if (reservedCount >= maxAttempts) return { status: 'BUDGET_DENIED' };

    const attemptId = `gepa-${randomUUID()}`;
    let retryOfAttemptId = null;
    const priorFailed = lastFailed.get(digestKey);
    if (priorFailed) {
      const prior = ledger.attempt(priorFailed);
      if (prior && prior.status === 'SETTLED') retryOfAttemptId = priorFailed;
    }
    const startedAt = nowIso();
    try {
      ledger.beginAttempt({ unitId: uid, attemptId, retryOfAttemptId, startedAt });
    } catch (err) {
      return { status: 'FAILED', reason: 'RESERVATION_FAILED', detail: String((err && err.message) || err) };
    }
    reservedCount += 1;
    inFlight.add(attemptId);

    const finish = (fn) => {
      try {
        return fn();
      } finally {
        inFlight.delete(attemptId);
      }
    };
    const settleFailed = (outcome, reason, { fingerprint = reason, detail = null } = {}) => {
      finish(() => settleAttemptRecord({
        unitId: uid,
        attemptId,
        retryOfAttemptId,
        startedAt,
        outcome,
        configDigest,
        resultSummary: null,
        failureFingerprint: fingerprint,
      }));
      lastFailed.set(digestKey, attemptId);
      return { status: 'FAILED', reason, attemptId, ...(detail ? { detail } : {}) };
    };

    let result;
    try {
      result = await sendRequest(
        'search.request',
        { candidateSeed, developmentCases, configDigest, attemptId },
        { signal },
      );
    } catch (err) {
      killChild();
      const code = err && err.code;
      const detail = String((err && err.message) || err);
      if (code === 'TIMEOUT') return settleFailed('TIMEOUT', 'TIMEOUT', { detail });
      if (code === 'ABORTED') {
        // Cancellation never refunds: the reservation stays consumed and the
        // attempt stays auditable.
        finish(() => settleAttemptRecord({
          unitId: uid,
          attemptId,
          retryOfAttemptId,
          startedAt,
          outcome: 'CANCELLED',
          configDigest,
          resultSummary: null,
          failureFingerprint: 'CANCELLED',
        }));
        return { status: 'CANCELLED', attemptId };
      }
      if (code === 'SPAWN_FAILED') return settleFailed('SPAWN_FAILED', 'SPAWN_FAILED', { detail });
      if (code === 'MALFORMED_RESPONSE') return settleFailed('FAILED', 'MALFORMED_RESPONSE', { detail });
      if (code && code !== 'CHILD_EXIT') return settleFailed('FAILED', 'ADAPTER_ERROR', { fingerprint: code, detail });
      return settleFailed('FAILED', 'CHILD_CRASH', { detail });
    }

    finish(() => settleAttemptRecord({
      unitId: uid,
      attemptId,
      retryOfAttemptId,
      startedAt,
      outcome: 'COMPLETED',
      configDigest,
      resultSummary: result,
      failureFingerprint: null,
    }));
    successCache.set(digestKey, { attemptId, result });
    return { status: 'OK', attemptId, result };
  }

  async function close() {
    if (closed) return { status: 'CLOSED' };
    closed = true;
    if (child) {
      try {
        await sendRequest('shutdown', {}, { timeout: SHUTDOWN_TIMEOUT_MS, allowClosed: true });
      } catch { /* fall through to kill */ }
    }
    killChild();
    return { status: 'CLOSED' };
  }

  return {
    dispatchSearch,
    close,
    // Test-only: lets protocol tests observe/kill the owned child process.
    debug: {
      child: () => child,
      reservedCount: () => reservedCount,
    },
  };
}
