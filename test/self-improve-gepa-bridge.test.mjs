// BB-086 slice I4 — offline GEPA bridge tests (acceptance SI3).
//
// Drives the real gepa_adapter.py for the happy path and the direct protocol
// tests, plus deterministic Python protocol fixtures for crash / malformed /
// timeout / cancellation cases. No GEPA install, no model calls.
//
// ciContract: python3 >= 3.10 on PATH is REQUIRED. A missing/too-old python3
// is a FAILED check, never a skip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createExperimentRegistration,
  createBenchmarkUnit,
  AttemptLedger,
} from '../packages/benchmark/src/index.js';
import { createGepaBridge } from '../scripts/self-improve/gepa-bridge.mjs';

// ---- python3 availability: FAILED check, never a skip ----------------------
const PYTHON = 'python3';
let pythonVersion = 'unknown';
try {
  const out = execFileSync(PYTHON, ['--version'], { encoding: 'utf8' });
  pythonVersion = out.trim();
  const match = /Python (\d+)\.(\d+)/.exec(pythonVersion);
  if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 10)) {
    throw new Error(`FAILED: ${PYTHON} >= 3.10 is required for the bridge tests (found: ${pythonVersion})`);
  }
} catch (err) {
  throw new Error(`FAILED: ${PYTHON} >= 3.10 is required for the bridge tests: ${err.message}`);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const ADAPTER = path.join(REPO_ROOT, 'scripts', 'self-improve', 'gepa_adapter.py');
const LOCK = path.join(REPO_ROOT, 'scripts', 'self-improve', 'requirements.lock');
const ACCOUNTING_FIELDS = ['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd'];

// ---- fixtures ---------------------------------------------------------------
function dgst(value) {
  return 'sha256:' + createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function makeLedger(unitId) {
  const registration = createExperimentRegistration({
    experimentId: 'bb086-bridge-test',
    protocol: { id: 'bb086', version: '1', hash: dgst('protocol') },
    sourceIdentity: 'bb086-bridge-test',
    workloadManifest: { ref: 'workload.json', digest: dgst('workload') },
    environmentIdentity: 'node-test',
    producerProfile: { id: 'gepa-bridge', hash: dgst('producer') },
    resourceBudget: { id: 'test-budget', hash: dgst('budget') },
    artifactPolicy: {},
    evaluatorIdentity: 'bb086-bridge-test',
    resetPolicy: {},
    unitIds: [unitId],
    createdAt: new Date().toISOString(),
  });
  const ledger = new AttemptLedger({ registration });
  ledger.registerUnit(createBenchmarkUnit({
    unitId,
    experimentId: registration.experimentId,
    task: { id: 'task-1', bundleDigest: dgst('bundle') },
    environmentIdentity: 'node-test',
    instructionDigest: dgst('instruction'),
    producerProfile: 'gepa-bridge',
    repeatIndex: 0,
    arm: 'candidate',
    budgetProfileHash: dgst('budget-profile'),
  }, { registration }));
  return ledger;
}

function makeBridge(t, ledger, { adapterPath = ADAPTER, budget, timeoutMs, unitId } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb086-bridge-'));
  const bridge = createGepaBridge({
    ledger,
    adapterPath,
    runDir,
    ...(budget ? { budget } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    unitId,
  });
  t.after(async () => { await bridge.close(); });
  return bridge;
}

function writeFixture(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb086-fixture-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

// Reads one stdin line, then dies with exit code 23 the FIRST time the script
// file is executed (sentinel next to the script); afterwards it answers the
// protocol like a minimal stub. Models crash-after-commit: the Node-side
// reservation is already committed when the child dies.
const CRASH_ONCE = `
import json, os, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
SENTINEL = os.path.join(HERE, ".bb086-crashed-once")
def stub(msg):
    p = msg["payload"]; seed = p["candidateSeed"]; cases = p["developmentCases"]; d = p["configDigest"]
    per = []
    for c in cases:
        h = hashlib.sha256(f"{seed}|{c}|{d}".encode()).hexdigest()
        per.append({"caseRef": c, "score": int(h[:8], 16) / 2**32})
    agg = sum(x["score"] for x in per) / len(per) if per else 0.0
    return {"id": msg["id"], "kind": "search.request.result",
            "payload": {"candidate": {"strategy": seed,
                                      "digest": hashlib.sha256(f"{seed}|{d}".encode()).hexdigest(),
                                      "mutation": "stub-reflection"},
                        "perCase": per, "aggregate": agg, "usage": None,
                        "optimizer": {"engine": "gepa", "version": "0.1.4",
                                      "commit": "d771eb21b5dd3228bc3f567293d2ccfc423fc900",
                                      "mode": "stub-fixture"}}}
def main():
    raw = sys.stdin.readline()
    if not os.path.exists(SENTINEL):
        open(SENTINEL, "w").write("x"); sys.stdout.flush(); os._exit(23)
    sys.stdout.write(json.dumps(stub(json.loads(raw))) + "\\n"); sys.stdout.flush()
    for line in sys.stdin:
        try: m = json.loads(line)
        except Exception: continue
        if m.get("kind") == "shutdown":
            sys.stdout.write(json.dumps({"id": m.get("id"), "kind": "shutdown.result",
                                         "payload": {"ok": True}}) + "\\n"); sys.stdout.flush(); break
main()
`;

// Sleeps before answering: used for timeout and cancellation tests.
const SLEEPY = `
import json, sys, time
def main():
    for raw in sys.stdin:
        try: m = json.loads(raw)
        except Exception: continue
        if m.get("kind") == "search.request":
            time.sleep(30)
            sys.stdout.write(json.dumps({"id": m["id"], "kind": "search.request.result",
                                         "payload": {"ok": True, "usage": None}}) + "\\n")
            sys.stdout.flush()
        elif m.get("kind") == "shutdown":
            sys.stdout.write(json.dumps({"id": m.get("id"), "kind": "shutdown.result",
                                         "payload": {"ok": True}}) + "\\n")
            sys.stdout.flush(); break
main()
`;

// Speaks garbage, then exits: fail-closed malformed case.
const GARBAGE = `import sys\nsys.stdout.write("not json\\n")\nsys.stdout.flush()\n`;

const SEARCH = { candidateSeed: 'seed-1', developmentCases: ['dev-1', 'dev-2'], configDigest: 'cfg-digest' };

// ---- tests ------------------------------------------------------------------
test('python3 >= 3.10 is available (FAILED check, never a skip)', () => {
  assert.match(pythonVersion, /^Python 3\.(1[0-9]|[1-9]\d)/, `unexpected python version: ${pythonVersion}`);
  assert.ok(fs.existsSync(ADAPTER), 'gepa_adapter.py exists');
});

test('happy path: real adapter dispatch settles COMPLETED, usage stays null, replay is free', async (t) => {
  const ledger = makeLedger('unit-happy');
  const bridge = makeBridge(t, ledger, { unitId: 'unit-happy' });
  assert.equal(bridge.debug.child(), null, 'no child before first dispatch');

  const first = await bridge.dispatchSearch({ unitId: 'unit-happy', ...SEARCH });
  assert.equal(first.status, 'OK');
  assert.ok(bridge.debug.child(), 'one child spawned for the run');

  const attempts = ledger.attempts();
  assert.equal(attempts.length, 1);
  const attempt = attempts[0];
  assert.equal(attempt.status, 'SETTLED');
  assert.equal(attempt.retryOfAttemptId, null);
  assert.equal(attempt.record.termination, 'COMPLETED');
  assert.equal(attempt.record.quality.verdict, 'NOT_EVALUATED');
  // Unknown usage/cost stays null, never 0.
  assert.equal(attempt.record.usage.status, 'UNKNOWN');
  assert.deepEqual(attempt.record.usage.observedFields, []);
  for (const field of ACCOUNTING_FIELDS) assert.equal(attempt.record.usage[field], null);

  // Deterministic stub: identical request replays without a new attempt.
  const second = await bridge.dispatchSearch({ unitId: 'unit-happy', ...SEARCH });
  assert.equal(second.status, 'OK');
  assert.equal(second.replayed, true);
  assert.equal(second.attemptId, first.attemptId);
  assert.deepEqual(second.result, first.result);
  assert.equal(ledger.attempts().length, 1, 'replay dispatches nothing new');

  const closed = await bridge.close();
  assert.equal(closed.status, 'CLOSED');
  assert.equal((await bridge.close()).status, 'CLOSED', 'close is idempotent');
  const afterClose = await bridge.dispatchSearch({ unitId: 'unit-happy', ...SEARCH });
  assert.equal(afterClose.status, 'FAILED');
  assert.equal(afterClose.reason, 'BRIDGE_CLOSED');
});

test('crash-after-commit recovers without duplicate dispatch (retry links retryOfAttemptId)', async (t) => {
  const ledger = makeLedger('unit-crash');
  const crashOnce = writeFixture('crash_once.py', CRASH_ONCE);
  const bridge = makeBridge(t, ledger, { adapterPath: crashOnce, unitId: 'unit-crash' });

  const failed = await bridge.dispatchSearch({ unitId: 'unit-crash', ...SEARCH });
  assert.equal(failed.status, 'FAILED');
  assert.ok(['CHILD_CRASH', 'MALFORMED_RESPONSE'].includes(failed.reason), `reason: ${failed.reason}`);

  let attempts = ledger.attempts();
  assert.equal(attempts.length, 1, 'exactly one attempt after the crash');
  assert.equal(attempts[0].status, 'SETTLED');
  assert.equal(attempts[0].record.termination, 'AGENT_ERROR');
  assert.equal(attempts[0].retryOfAttemptId, null);

  // Retry: the bridge must NOT blindly redispatch the unsettled attempt; the
  // crashed attempt is settled, so the retry is a NEW attemptId linked back.
  const retried = await bridge.dispatchSearch({ unitId: 'unit-crash', ...SEARCH });
  assert.equal(retried.status, 'OK');
  assert.notEqual(retried.attemptId, failed.attemptId);

  attempts = ledger.attempts();
  assert.equal(attempts.length, 2, 'no duplicate dispatch: one failed attempt + one retry');
  assert.equal(attempts[1].retryOfAttemptId, attempts[0].attemptId);
  assert.equal(attempts[1].record.termination, 'COMPLETED');
});

test('cancellation keeps the reservation consumed (no refund)', async (t) => {
  const ledger = makeLedger('unit-cancel');
  const sleepy = writeFixture('sleepy.py', SLEEPY);
  const bridge = makeBridge(t, ledger, { adapterPath: sleepy, timeoutMs: 10000, budget: { maxAttempts: 1 }, unitId: 'unit-cancel' });

  const controller = new AbortController();
  const pending = bridge.dispatchSearch({
    unitId: 'unit-cancel',
    candidateSeed: 'seed-c',
    developmentCases: ['dev-1'],
    configDigest: 'cfg-c',
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const cancelled = await pending;
  assert.equal(cancelled.status, 'CANCELLED');

  const attempt = ledger.attempt(cancelled.attemptId);
  assert.ok(attempt, 'cancelled attempt stays auditable');
  assert.equal(attempt.status, 'SETTLED');
  assert.equal(attempt.record.termination, 'CANCELLED');

  // The consumed reservation is not refunded: the hard budget is exhausted.
  const denied = await bridge.dispatchSearch({ unitId: 'unit-cancel', candidateSeed: 'seed-c2', developmentCases: ['dev-1'], configDigest: 'cfg-c2' });
  assert.equal(denied.status, 'BUDGET_DENIED');
});

test('over-budget returns BUDGET_DENIED with no child spawned and no ledger side effect', async (t) => {
  const ledger = makeLedger('unit-budget');
  const bridge = makeBridge(t, ledger, {
    adapterPath: '/nonexistent/gepa_adapter.py', // would fail loudly if spawned
    budget: { maxAttempts: 0 },
    unitId: 'unit-budget',
  });
  const denied = await bridge.dispatchSearch({ unitId: 'unit-budget', ...SEARCH });
  assert.equal(denied.status, 'BUDGET_DENIED');
  assert.equal(ledger.attempts().length, 0, 'no reservation without budget');
  assert.equal(bridge.debug.child(), null, 'no child spawned on denial');
});

test('malformed child output fails closed', async (t) => {
  const ledger = makeLedger('unit-malformed');
  const garbage = writeFixture('garbage.py', GARBAGE);
  const bridge = makeBridge(t, ledger, { adapterPath: garbage, unitId: 'unit-malformed' });

  const failed = await bridge.dispatchSearch({ unitId: 'unit-malformed', ...SEARCH });
  assert.equal(failed.status, 'FAILED');
  assert.ok(['MALFORMED_RESPONSE', 'CHILD_CRASH'].includes(failed.reason), `reason: ${failed.reason}`);

  const attempts = ledger.attempts();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'SETTLED');
  assert.equal(attempts[0].record.termination, 'AGENT_ERROR');
  assert.equal(attempts[0].record.infrastructureStatus, 'HARNESS_PROTOCOL');
});

test('timeout fails closed', async (t) => {
  const ledger = makeLedger('unit-timeout');
  const sleepy = writeFixture('sleepy.py', SLEEPY);
  const bridge = makeBridge(t, ledger, { adapterPath: sleepy, timeoutMs: 300, unitId: 'unit-timeout' });

  const failed = await bridge.dispatchSearch({ unitId: 'unit-timeout', ...SEARCH });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.reason, 'TIMEOUT');

  const attempts = ledger.attempts();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'SETTLED');
  assert.equal(attempts[0].record.termination, 'AGENT_TIMEOUT');
});

test('holdout ref in developmentCases throws HOLDOUT_EXPOSED with no reservation', async (t) => {
  const ledger = makeLedger('unit-holdout');
  const bridge = makeBridge(t, ledger, { unitId: 'unit-holdout' });
  await assert.rejects(
    bridge.dispatchSearch({
      unitId: 'unit-holdout',
      candidateSeed: 'seed-h',
      developmentCases: ['h1', 'd2'],
      configDigest: 'cfg-h',
      holdoutRefs: ['h1'],
    }),
    /HOLDOUT_EXPOSED/,
  );
  assert.equal(ledger.attempts().length, 0, 'no reservation on holdout exposure');
  assert.equal(bridge.debug.reservedCount(), 0);
});

test('requirements.lock pins the optimizer identity (no extras)', () => {
  const lock = fs.readFileSync(LOCK, 'utf8');
  assert.match(lock, /gepa/, 'names the gepa engine');
  assert.match(lock, /0\.1\.4/, 'pins version 0.1.4');
  assert.match(lock, /d771eb21b5dd3228bc3f567293d2ccfc423fc900/, 'pins the exact VCS commit');
  assert.match(lock, />=3\.10/, 'declares python >=3.10');
  assert.match(lock, /<3\.15/, 'declares python <3.15');
  assert.match(lock, /any change creates a new optimizer identity/, 'identity-change notice');
  assert.doesNotMatch(lock, /extras/i, 'no extras');
  assert.doesNotMatch(lock, /\[.*\]/, 'no bracketed extras markers');
});

// ---- direct adapter protocol tests ------------------------------------------
function startAdapter() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb086-adapter-'));
  const cp = spawn(PYTHON, [ADAPTER, '--run-dir', runDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const waiters = [];
  cp.stdout.on('data', (data) => {
    buffer += String(data);
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
    }
  });
  let seq = 0;
  const nextLine = (timeoutMs = 10000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('adapter response timeout')), timeoutMs);
    waiters.push((line) => { clearTimeout(timer); resolve(line); });
  });
  return {
    runDir,
    async rpc(kind, payload) {
      const id = `t${++seq}`;
      const pending = nextLine().then((line) => JSON.parse(line));
      cp.stdin.write(JSON.stringify({ id, kind, payload }) + '\n');
      const response = await pending;
      assert.equal(response.id, id);
      return response;
    },
    async rawLine(line) {
      const pending = nextLine().then((l) => JSON.parse(l));
      cp.stdin.write(line + '\n');
      return pending;
    },
    stdin: cp.stdin,
    exited: new Promise((resolve) => cp.on('exit', (code) => resolve(code))),
  };
}

test('adapter: checkpoint save/load is same-run-local; foreign and pickle refs rejected', async () => {
  const adapter = startAdapter();
  for (const ref of ['../../evil', '/abs/x', '..\\win', 'x.pkl', 'X.PKL', 'a/b']) {
    const response = await adapter.rpc('checkpoint.save', { checkpointRef: ref, state: { a: 1 } });
    assert.equal(response.kind, 'error', `ref ${ref} must be rejected`);
  }
  const saved = await adapter.rpc('checkpoint.save', { checkpointRef: 'ckpt-1', state: { a: 1, b: [2, 3] } });
  assert.equal(saved.kind, 'checkpoint.save.result');
  const loaded = await adapter.rpc('checkpoint.load', { checkpointRef: 'ckpt-1' });
  assert.equal(loaded.kind, 'checkpoint.load.result');
  assert.deepEqual(loaded.payload.state, { a: 1, b: [2, 3] });
  const missing = await adapter.rpc('checkpoint.load', { checkpointRef: 'nope' });
  assert.equal(missing.kind, 'error');
  assert.equal(missing.payload.code, 'NOT_FOUND');
  const shutdown = await adapter.rpc('shutdown', {});
  assert.equal(shutdown.kind, 'shutdown.result');
  assert.equal(await adapter.exited, 0);
});

test('adapter: malformed and oversized lines fail closed per-message, adapter keeps running', async () => {
  const adapter = startAdapter();
  const malformed = await adapter.rawLine('this is not json');
  assert.equal(malformed.kind, 'error');
  assert.equal(malformed.payload.code, 'MALFORMED_JSON');

  // Still alive: a valid request afterwards is answered.
  const first = await adapter.rpc('search.request', { candidateSeed: 's', developmentCases: ['d1'], configDigest: 'c' });
  assert.equal(first.kind, 'search.request.result');

  // Deterministic stub: identical inputs, identical outputs.
  const second = await adapter.rpc('search.request', { candidateSeed: 's', developmentCases: ['d1'], configDigest: 'c' });
  assert.deepEqual(second.payload, first.payload);

  const oversized = await adapter.rawLine('x'.repeat(1048576 + 16));
  assert.equal(oversized.kind, 'error');
  assert.equal(oversized.payload.code, 'OVERSIZED');

  const unknown = await adapter.rpc('nope.kind', {});
  assert.equal(unknown.kind, 'error');
  assert.equal(unknown.payload.code, 'UNKNOWN_KIND');

  await adapter.rpc('shutdown', {});
  assert.equal(await adapter.exited, 0);
});
