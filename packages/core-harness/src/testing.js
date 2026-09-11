import { invariant } from "./contracts.js";
import { ExHarnessErrorCode } from "./errors.js";
import { ExecutionStatus, defineExecutor } from "./execution.js";
import { CURRENT_STATE_SCHEMA_VERSION } from "./persistence.js";

export function createDeterministicClock({
  start = "2026-01-01T00:00:00.000Z",
  stepMs = 1
} = {}) {
  let current = Date.parse(start);
  invariant(Number.isFinite(current), "deterministic clock start must be an ISO date");
  invariant(Number.isInteger(stepMs) && stepMs >= 0, "deterministic clock stepMs must be non-negative");

  function clock() {
    const value = new Date(current).toISOString();
    current += stepMs;
    return value;
  }
  clock.peek = () => new Date(current).toISOString();
  clock.advance = (ms) => {
    invariant(Number.isInteger(ms), "clock advance requires integer milliseconds");
    current += ms;
    return clock.peek();
  };
  return clock;
}

export function createDeterministicIdFactory(prefix = "id") {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

export function createFakeEnvironment({ observe = null, act = null } = {}) {
  return Object.freeze({
    async observe(input) {
      return observe ? observe(input) : { candidate: input.candidate, request: input.request };
    },
    async act(input) {
      if (act) return act(input);
      return { mutated: false, candidate: input.candidate, result: null };
    }
  });
}

export function createFakeExecutor(handler = null) {
  return Object.freeze({
    async execute(request, context) {
      if (handler) return handler(request, context);
      return { status: ExecutionStatus.SUCCESS, output: request };
    }
  });
}

export async function verifySessionStoreContract(createStore) {
  invariant(typeof createStore === "function", "store contract requires a store factory");
  const store = await createStore();
  invariant(store && typeof store.load === "function" && typeof store.save === "function", "store contract requires load/save");
  invariant(store.supportsRevisions === true, "production store must advertise supportsRevisions=true");

  const session = {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    revision: 0,
    id: "contract-session",
    work: { probe: true },
    currentCandidate: { id: "candidate", version: "v0" },
    persistentMemory: {},
    trajectory: [],
    supervision: { inspections: 0, skipped: 0, interventions: [], lastInspectedEventId: null, lastDecision: null },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const first = await store.save(session);
  invariant(first?.revision === 1, "store must advance new session to revision 1");
  const loaded = await store.load(session.id);
  invariant(loaded?.revision === 1, "store load must preserve persisted revision");

  const left = structuredClone(loaded);
  const right = structuredClone(loaded);
  const second = await store.save(left);
  invariant(second?.revision === 2, "store must advance revision exactly once per save");

  let conflict = null;
  try {
    await store.save(right);
  } catch (error) {
    conflict = error;
  }
  invariant(conflict?.code === ExHarnessErrorCode.STORE_CONFLICT, "stale store write must fail with STORE_CONFLICT");

  return Object.freeze({
    passed: true,
    checks: Object.freeze([
      "revision-advertised",
      "create-load-roundtrip",
      "monotonic-revision",
      "stale-write-conflict"
    ])
  });
}

export async function verifyExecutorContract(executor, {
  request = { probe: true },
  expectedStatus = ExecutionStatus.SUCCESS
} = {}) {
  const resolved = defineExecutor(executor);
  const controller = new AbortController();
  const result = await resolved.execute(structuredClone(request), Object.freeze({
    signal: controller.signal,
    startedAt: 0,
    deadlineAt: null,
    constraints: {}
  }));
  invariant(result && typeof result === "object", "executor contract requires an object result");
  invariant(Object.values(ExecutionStatus).includes(result.status), "executor contract returned invalid status");
  invariant(result.status === expectedStatus, `executor contract expected ${expectedStatus} but received ${result.status}`);
  return Object.freeze({ passed: true, status: result.status });
}
