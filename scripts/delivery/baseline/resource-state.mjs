import { randomUUID, createHash } from 'node:crypto';
import { open, readFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { canonical, sha256 } from './contract.mjs';

export const RESOURCE_SCHEMA_VERSION = 1;
export const RESOURCE_TERMINAL = Object.freeze([
  'COMPLETED',
  'RESOURCE_EXHAUSTED',
  'UNRESOLVED_PROVIDER',
  'INVALID_INPUT',
  'PREREQUISITE_MISSING',
  'INFRASTRUCTURE_FAILURE'
]);

const fail = (message, code = 'RESOURCE_STATE_INVALID') => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
};
const clone = value => structuredClone(value);
const stamp = value => new Date(value).toISOString();
const digest = value => `sha256:${sha256(value)}`;
const asInteger = (value, label, { min = 0 } = {}) => {
  if (!Number.isInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
  return value;
};
const asNumber = (value, label, { min = 0 } = {}) => {
  if (!Number.isFinite(value) || value < min) fail(`${label} must be a number >= ${min}`);
  return value;
};
const asText = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`);
  return value;
};

function eventBody(event) {
  const { eventHash: ignored, ...body } = event;
  return body;
}

export function hashResourceEvent(event) {
  return digest(eventBody(event));
}

export function redactTransportValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactTransportValue);
  if (typeof value !== 'object') return typeof value === 'string' && value.length > 2048 ? `${value.slice(0, 2048)}...[truncated]` : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (/(authorization|api[-_]?key|cookie|set-cookie|password|secret|token)/i.test(key)) return [key, '[REDACTED]'];
    return [key, redactTransportValue(child)];
  }));
}

export function nextEligibleAt({ now, retryIndex, retryAfterSeconds = null, jitterSeconds = 0 }) {
  const base = Math.min(60 * (2 ** asInteger(retryIndex, 'retryIndex')), 3600);
  const retryAfter = retryAfterSeconds == null ? 0 : asNumber(retryAfterSeconds, 'retryAfterSeconds');
  const jitter = asNumber(jitterSeconds, 'jitterSeconds');
  return stamp(new Date(now).getTime() + Math.max(base + jitter, retryAfter * 1000));
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) return Number(value);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.max(0, (parsed - new Date(now).getTime()) / 1000) : null;
}

async function readLines(path) {
  try {
    return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function acquireOwner(path) {
  const owner = `${path}.owner`;
  try {
    const handle = await open(owner, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + '\n');
    await handle.sync();
    await handle.close();
    return owner;
  } catch (error) {
    if (error.code === 'EEXIST') fail(`journal owner already exists: ${path}`, 'RESOURCE_OWNER_EXISTS');
    throw error;
  }
}

async function releaseOwner(owner) {
  try { await unlink(owner); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function readResourceJournal(path) {
  const events = await readLines(resolve(path));
  let previous = null;
  const ids = new Map();
  let sequence = 0;
  for (const event of events) {
    if (event?.schemaVersion !== RESOURCE_SCHEMA_VERSION || typeof event.eventId !== 'string' ||
        typeof event.kind !== 'string' || !Number.isInteger(event.sequence) || event.sequence !== ++sequence)
      fail('journal sequence or schema is invalid');
    if (event.previousEventHash !== previous) fail(`journal hash chain is broken at ${event.eventId}`);
    if (event.eventHash !== hashResourceEvent(event)) fail(`journal event hash is invalid: ${event.eventId}`);
    const prior = ids.get(event.eventId);
    if (prior && canonical(prior) !== canonical(event)) fail(`duplicate eventId has conflicting bytes: ${event.eventId}`);
    ids.set(event.eventId, event);
    previous = event.eventHash;
  }
  return events;
}

export async function appendResourceEvent(path, input, { eventId = randomUUID(), now = new Date().toISOString() } = {}) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const owner = await acquireOwner(target);
  try {
    const events = await readResourceJournal(target);
    const existing = events.find(event => event.eventId === eventId);
    if (existing) {
      const proposed = {
        schemaVersion: RESOURCE_SCHEMA_VERSION,
        experimentId: input.experimentId,
        executionId: input.executionId ?? null,
        attemptId: input.attemptId ?? null,
        requestId: input.requestId ?? null,
        eventId,
        kind: input.kind,
        payload: redactTransportValue(input.payload ?? {})
      };
      const existingIdentity = Object.fromEntries(Object.entries(eventBody(existing)).filter(([key]) => ['schemaVersion', 'experimentId', 'executionId', 'attemptId', 'requestId', 'eventId', 'kind', 'payload'].includes(key)));
      if (canonical(existingIdentity) !== canonical(proposed)) fail(`eventId ${eventId} already has different content`);
      return clone(existing);
    }
    const event = {
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      experimentId: asText(input.experimentId, 'experimentId'),
      executionId: input.executionId == null ? null : asText(input.executionId, 'executionId'),
      attemptId: input.attemptId == null ? null : asText(input.attemptId, 'attemptId'),
      requestId: input.requestId == null ? null : asText(input.requestId, 'requestId'),
      eventId,
      sequence: events.length + 1,
      at: stamp(now),
      kind: asText(input.kind, 'event kind'),
      previousEventHash: events.at(-1)?.eventHash ?? null,
      payload: redactTransportValue(input.payload ?? {})
    };
    event.eventHash = hashResourceEvent(event);
    const handle = await open(target, 'a');
    try {
      await handle.writeFile(JSON.stringify(event) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    return clone(event);
  } finally { await releaseOwner(owner); }
}

function blankState({ experimentId = null, profileHash = null, candidateSha = null, candidateTree = null, protocolHash = null } = {}) {
  return {
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    experimentId,
    profileHash,
    candidateSha,
    candidateTree,
    protocolHash,
    lastEventHash: null,
    executions: {},
    requests: {},
    counters: { wireRequests: 0, settled: 0, notAdmitted: 0, unknown: 0 },
    invalid: []
  };
}

function execution(state, id) {
  const item = state.executions[id];
  if (!item) fail(`unknown execution: ${id}`);
  return item;
}

function request(state, id) {
  const item = state.requests[id];
  if (!item) fail(`unknown request: ${id}`);
  return item;
}

function ensureTransition(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} transition from ${value} is invalid`);
}

export function foldResourceJournal(events, options = {}) {
  const state = blankState(options);
  for (const event of events) {
    const payload = event.payload ?? {};
    if (options.experimentId != null && event.experimentId !== options.experimentId) fail(`event experiment binding differs: ${event.eventId}`);
    if (options.profileHash != null && payload.profileHash != null && payload.profileHash !== options.profileHash) fail(`event profile binding differs: ${event.eventId}`);
    if (options.candidateSha != null && payload.candidateSha != null && payload.candidateSha !== options.candidateSha) fail(`event candidate binding differs: ${event.eventId}`);
    if (options.candidateTree != null && payload.candidateTree != null && payload.candidateTree !== options.candidateTree) fail(`event candidate tree binding differs: ${event.eventId}`);
    if (options.protocolHash != null && payload.protocolHash != null && payload.protocolHash !== options.protocolHash) fail(`event protocol binding differs: ${event.eventId}`);
    state.lastEventHash = event.eventHash;
    switch (event.kind) {
      case 'REGISTER_EXECUTION': {
        const id = asText(event.executionId, 'executionId');
        if (state.executions[id]) fail(`execution registered twice: ${id}`);
        state.executions[id] = {
          executionId: id,
          pairId: payload.pairId ?? null,
          taskId: payload.taskId ?? null,
          arm: payload.arm ?? null,
          repeat: payload.repeat ?? null,
          registeredAt: event.at,
          deadline: payload.deadline ?? null,
          status: 'REGISTERED',
          activeMs: 0,
          providerWaitMs: 0,
          attempts: 0,
          terminalReason: null,
          nextEligibleAt: null,
          outstandingRequestIds: [],
          resultCaptured: false,
          verified: false,
          coreAdopted: false
        };
        break;
      }
      case 'ATTEMPT_REGISTERED': {
        const item = execution(state, event.executionId);
        asInteger(payload.attemptNumber, 'attemptNumber', { min: 1 });
        if (item.status === 'TERMINAL') fail('cannot register attempt after terminal execution');
        if (payload.attemptNumber > 2) fail('attempt limit exceeded');
        item.attempts = Math.max(item.attempts, payload.attemptNumber);
        item.status = 'RUNNING';
        break;
      }
      case 'REQUEST_INTENT': {
        const item = execution(state, event.executionId);
        const id = asText(event.requestId, 'requestId');
        if (state.requests[id]) fail(`request intent duplicated: ${id}`);
        state.requests[id] = {
          requestId: id,
          executionId: event.executionId,
          attemptId: event.attemptId,
          status: 'INTENT',
          inputTokensReserved: payload.inputTokensReserved ?? null,
          outputTokensReserved: payload.outputTokensReserved ?? null,
          costUsdReserved: payload.costUsdReserved ?? null,
          retryIndex: payload.retryIndex ?? 0,
          sendStartedAt: null,
          providerRequestId: null,
          responseHash: null,
          usage: null,
          proof: null,
          reason: null
        };
        item.outstandingRequestIds.push(id);
        state.counters.wireRequests += 1;
        break;
      }
      case 'SEND_STARTED': {
        const item = request(state, event.requestId);
        ensureTransition(item.status, ['INTENT'], 'SEND_STARTED');
        item.status = 'IN_FLIGHT';
        item.sendStartedAt = event.at;
        break;
      }
      case 'SETTLED': {
        const item = request(state, event.requestId);
        ensureTransition(item.status, ['IN_FLIGHT', 'INTENT'], 'SETTLED');
        item.status = 'SETTLED';
        item.providerRequestId = asText(payload.providerRequestId, 'providerRequestId');
        item.responseHash = payload.responseHash ?? null;
        item.usage = clone(payload.usage ?? null);
        item.proof = clone(payload.proof ?? null);
        state.counters.settled += 1;
        const owner = execution(state, item.executionId);
        owner.outstandingRequestIds = owner.outstandingRequestIds.filter(id => id !== item.requestId);
        break;
      }
      case 'NOT_ADMITTED': {
        const item = request(state, event.requestId);
        ensureTransition(item.status, ['IN_FLIGHT', 'INTENT'], 'NOT_ADMITTED');
        if (!payload.proofRef || !payload.proofHash) fail('non-admission requires proof ref/hash');
        item.status = 'NOT_ADMITTED';
        item.proof = { ref: payload.proofRef, hash: payload.proofHash };
        item.reason = payload.reason ?? null;
        state.counters.notAdmitted += 1;
        const owner = execution(state, item.executionId);
        owner.outstandingRequestIds = owner.outstandingRequestIds.filter(id => id !== item.requestId);
        break;
      }
      case 'UNKNOWN': {
        const item = request(state, event.requestId);
        ensureTransition(item.status, ['IN_FLIGHT', 'INTENT'], 'UNKNOWN');
        item.status = 'UNKNOWN';
        item.reason = payload.reason ?? null;
        item.proof = clone(payload.proof ?? null);
        state.counters.unknown += 1;
        break;
      }
      case 'WAITING_PROVIDER': {
        const item = execution(state, event.executionId);
        item.status = 'WAITING_PROVIDER';
        item.nextEligibleAt = asText(payload.nextEligibleAt, 'nextEligibleAt');
        item.providerWaitMs += asNumber(payload.waitMs ?? 0, 'waitMs');
        break;
      }
      case 'RECONCILED_SETTLED':
      case 'RECONCILED_NOT_ADMITTED': {
        const item = request(state, event.requestId);
        ensureTransition(item.status, ['UNKNOWN'], event.kind);
        if (!payload.originalEventHash || !payload.responseHash && event.kind === 'RECONCILED_SETTLED') fail('reconciliation proof is incomplete');
        item.status = event.kind === 'RECONCILED_SETTLED' ? 'SETTLED' : 'NOT_ADMITTED';
        item.providerRequestId = payload.providerRequestId ?? null;
        item.responseHash = payload.responseHash ?? null;
        item.usage = clone(payload.usage ?? null);
        item.proof = { originalEventHash: payload.originalEventHash, responseHash: payload.responseHash ?? payload.proofHash ?? null };
        if (item.status === 'SETTLED') state.counters.settled += 1;
        else state.counters.notAdmitted += 1;
        const owner = execution(state, item.executionId);
        owner.outstandingRequestIds = owner.outstandingRequestIds.filter(id => id !== item.requestId);
        break;
      }
      case 'RESULT_CAPTURED': {
        const item = execution(state, event.executionId);
        item.resultCaptured = true;
        item.status = 'RESULT_CAPTURED';
        break;
      }
      case 'VERIFIED': {
        const item = execution(state, event.executionId);
        ensureTransition(item.status, ['RESULT_CAPTURED', 'VERIFIED'], 'VERIFIED');
        item.verified = true;
        item.status = 'VERIFIED';
        break;
      }
      case 'CORE_ADOPTED': {
        const item = execution(state, event.executionId);
        ensureTransition(item.status, ['VERIFIED', 'CORE_ADOPTED'], 'CORE_ADOPTED');
        item.coreAdopted = true;
        item.status = 'CORE_ADOPTED';
        break;
      }
      case 'ATTEMPT_TERMINAL': {
        const item = execution(state, event.executionId);
        if (!['RESULT_CAPTURED', 'VERIFIED', 'CORE_ADOPTED', 'RUNNING', 'WAITING_PROVIDER'].includes(item.status)) fail('attempt terminal before result state');
        item.status = payload.status === 'COMPLETED' ? 'COMPLETED' : payload.status === 'RETRYABLE' ? 'RETRYABLE' : 'TERMINAL';
        item.terminalReason = payload.reason ?? payload.status ?? null;
        break;
      }
      case 'TERMINAL': {
        const item = execution(state, event.executionId);
        if (!RESOURCE_TERMINAL.includes(payload.reason)) fail(`unknown terminal reason: ${payload.reason}`);
        item.status = 'TERMINAL';
        item.terminalReason = payload.reason;
        break;
      }
      default:
        fail(`unknown resource event kind: ${event.kind}`);
    }
  }
  return state;
}

export async function loadResourceState(path, options = {}) {
  const events = await readResourceJournal(path);
  return foldResourceJournal(events, options);
}

function assertWithin(value, max, label) {
  if (max != null && value > max) fail(`${label} exceeds registered limit`, 'RESOURCE_LIMIT_EXCEEDED');
}

export class ResourceState {
  constructor({ journalPath, experimentId, profileHash = null, candidateSha = null, candidateTree = null, protocolHash = null, limits = {}, now = () => new Date() } = {}) {
    if (!journalPath) fail('journalPath is required');
    this.journalPath = resolve(journalPath);
    this.experimentId = asText(experimentId, 'experimentId');
    this.identity = { profileHash, candidateSha, candidateTree, protocolHash };
    this.limits = { maxConcurrentProviderRequests: 1, maxWireRequestsPerExecution: 24, maxTotalTokensPerExecution: 50000, maxApiUsdPerExecution: 5, maxAttemptsPerExecution: 2, maxExecutionActiveSeconds: 1200, maxProviderWaitSeconds: 86400, maxCohortWallSeconds: 259200, ...limits };
    this.now = now;
  }

  async acquireCohortLock() {
    const path = `${this.journalPath}.cohort-owner`;
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, experimentId: this.experimentId, pid: process.pid, acquiredAt: new Date().toISOString() }) + '\n');
      await handle.sync();
      await handle.close();
      return path;
    } catch (error) {
      if (error.code === 'EEXIST') fail(`cohort owner already exists: ${this.experimentId}`, 'RESOURCE_OWNER_EXISTS');
      throw error;
    }
  }

  async releaseCohortLock(path) {
    if (!path) return;
    try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async events() { return readResourceJournal(this.journalPath); }
  async state() { return loadResourceState(this.journalPath, { experimentId: this.experimentId, ...this.identity }); }
  async append(kind, { executionId = null, attemptId = null, requestId = null, payload = {}, eventId = randomUUID() } = {}) {
    return appendResourceEvent(this.journalPath, { experimentId: this.experimentId, executionId, attemptId, requestId, kind, payload: { ...this.identity, ...payload } }, { eventId, now: this.now() });
  }
  async registerExecution(input) {
    const existing = (await this.state()).executions[input.executionId];
    if (existing) return clone(existing);
    await this.append('REGISTER_EXECUTION', { executionId: input.executionId, payload: { pairId: input.pairId, taskId: input.taskId, arm: input.arm, repeat: input.repeat, deadline: input.deadline } });
    return (await this.state()).executions[input.executionId];
  }
  async registerAttempt({ executionId, attemptId, attemptNumber }) {
    const current = await this.state();
    const item = execution(current, executionId);
    if (item.attempts >= attemptNumber) return clone(item);
    assertWithin(attemptNumber, this.limits.maxAttemptsPerExecution, 'attempt count');
    await this.append('ATTEMPT_REGISTERED', { executionId, attemptId, payload: { attemptNumber } });
    return (await this.state()).executions[executionId];
  }
  async reserve({ executionId, attemptId, requestId = randomUUID(), inputTokens, outputTokens, costUsd, retryIndex = 0 }) {
    const current = await this.state();
    const item = execution(current, executionId);
    if (item.nextEligibleAt && new Date(this.now()).getTime() < Date.parse(item.nextEligibleAt)) {
      const error = new Error(`provider wait has not elapsed: ${item.nextEligibleAt}`);
      error.code = 'RESOURCE_WAIT';
      error.nextEligibleAt = item.nextEligibleAt;
      throw error;
    }
    if (item.outstandingRequestIds.length >= this.limits.maxConcurrentProviderRequests) fail('provider concurrency limit reached', 'RESOURCE_WAIT');
    const rows = Object.values(current.requests).filter(row => row.executionId === executionId);
    if (rows.some(row => row.requestId === requestId)) return clone(request(current, requestId));
    assertWithin(rows.length + 1, this.limits.maxWireRequestsPerExecution, 'wire request count');
    const reservedTokens = rows.reduce((sum, row) => sum + Number(row.inputTokensReserved ?? 0) + Number(row.outputTokensReserved ?? 0), 0);
    const reservedCost = rows.reduce((sum, row) => sum + Number(row.costUsdReserved ?? 0), 0);
    assertWithin(reservedTokens + inputTokens + outputTokens, this.limits.maxTotalTokensPerExecution, 'reserved token count');
    assertWithin(reservedCost + costUsd, this.limits.maxApiUsdPerExecution, 'reserved API cost');
    await this.append('REQUEST_INTENT', { executionId, attemptId, requestId, payload: { inputTokensReserved: inputTokens, outputTokensReserved: outputTokens, costUsdReserved: costUsd, retryIndex } });
    return clone((await this.state()).requests[requestId]);
  }
  async sendStarted({ executionId, attemptId, requestId, requestHash = null }) {
    const current = await this.state();
    const item = request(current, requestId);
    if (item.status === 'IN_FLIGHT') return clone(item);
    if (item.status !== 'INTENT') fail(`request ${requestId} is not dispatchable`);
    await this.append('SEND_STARTED', { executionId, attemptId, requestId, payload: { requestHash } });
    return clone((await this.state()).requests[requestId]);
  }
  async settled({ executionId, attemptId, requestId, providerRequestId, responseHash, usage, proof = null }) {
    const current = await this.state();
    const item = request(current, requestId);
    if (item.status === 'SETTLED') return clone(item);
    await this.append('SETTLED', { executionId, attemptId, requestId, payload: { providerRequestId, responseHash, usage, proof } });
    return clone((await this.state()).requests[requestId]);
  }
  async notAdmitted({ executionId, attemptId, requestId, proofRef, proofHash, reason = null }) {
    const current = await this.state();
    const item = request(current, requestId);
    if (item.status === 'NOT_ADMITTED') return clone(item);
    await this.append('NOT_ADMITTED', { executionId, attemptId, requestId, payload: { proofRef, proofHash, reason } });
    return clone((await this.state()).requests[requestId]);
  }
  async unknown({ executionId, attemptId, requestId, reason, proof = null }) {
    const current = await this.state();
    const item = request(current, requestId);
    if (item.status === 'UNKNOWN') return clone(item);
    await this.append('UNKNOWN', { executionId, attemptId, requestId, payload: { reason, proof } });
    return clone((await this.state()).requests[requestId]);
  }
  async reconcile({ executionId, attemptId, requestId, settled = false, originalEventHash, providerRequestId = null, responseHash = null, proofHash = null, usage = null }) {
    const current = await this.state();
    const item = request(current, requestId);
    if (item.status === 'SETTLED' || item.status === 'NOT_ADMITTED') return clone(item);
    const kind = settled ? 'RECONCILED_SETTLED' : 'RECONCILED_NOT_ADMITTED';
    await this.append(kind, { executionId, attemptId, requestId, payload: { originalEventHash, providerRequestId, responseHash, proofHash, usage } });
    return clone((await this.state()).requests[requestId]);
  }
  async wait({ executionId, nextAt, waitMs, reason = 'PROVIDER_BACKOFF' }) {
    const seconds = Number(waitMs) / 1000;
    assertWithin(seconds, this.limits.maxProviderWaitSeconds, 'provider wait');
    await this.append('WAITING_PROVIDER', { executionId, payload: { nextEligibleAt: stamp(nextAt), waitMs, reason } });
    return (await this.state()).executions[executionId];
  }
  async captureResult({ executionId, attemptId, resultHash, candidateDigest, path }) {
    await this.append('RESULT_CAPTURED', { executionId, attemptId, payload: { resultHash, candidateDigest, path } });
    return (await this.state()).executions[executionId];
  }
  async verified({ executionId, attemptId, verificationHash, status }) {
    await this.append('VERIFIED', { executionId, attemptId, payload: { verificationHash, status } });
    return (await this.state()).executions[executionId];
  }
  async adopted({ executionId, attemptId, sessionId, eventHash }) {
    await this.append('CORE_ADOPTED', { executionId, attemptId, payload: { sessionId, eventHash } });
    return (await this.state()).executions[executionId];
  }
  async terminal({ executionId, attemptId = null, reason, status = null }) {
    if (status) await this.append('ATTEMPT_TERMINAL', { executionId, attemptId, payload: { status, reason } });
    else await this.append('TERMINAL', { executionId, attemptId, payload: { reason } });
    return (await this.state()).executions[executionId];
  }
}

export function portableResourceState(state) {
  const value = clone(state);
  for (const item of Object.values(value.executions)) delete item.absolutePath;
  return value;
}

export async function writeAtomicJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'w');
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, target);
}

export async function writeResourceSnapshot({ path, state, journalPath, files = [] }) {
  const snapshotRoot = dirname(resolve(path));
  const rows = [];
  for (const file of files) {
    const absolute = resolve(file);
    const body = await readFile(absolute);
    rows.push({ ref: relative(snapshotRoot, absolute).replaceAll('\\', '/'), hash: `sha256:${createHash('sha256').update(body).digest('hex')}`, bytes: body.byteLength });
  }
  const snapshot = { schemaVersion: RESOURCE_SCHEMA_VERSION, state: portableResourceState(state), journal: journalPath ? { ref: relative(snapshotRoot, resolve(journalPath)).replaceAll('\\', '/'), hash: digest(await readFile(resolve(journalPath))) } : null, files: rows };
  await writeAtomicJson(path, snapshot);
  return snapshot;
}

export function isProviderAdmissionError(error) {
  return Boolean(error && (error.code === 'RESOURCE_WAIT' || error.status === 429 || error.status === 503 || error.status === 529));
}

export function resourceExitCode(reason) {
  return { COMPLETED: 0, WAITING_PROVIDER: 10, UNRESOLVED_PROVIDER: 11, RESOURCE_EXHAUSTED: 12, INVALID_INPUT: 2, PREREQUISITE_MISSING: 3, INFRASTRUCTURE_FAILURE: 4 }[reason] ?? 4;
}
