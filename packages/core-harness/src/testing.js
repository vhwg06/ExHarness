import { invariant } from "./contracts.js";
import { ExHarnessErrorCode } from "./errors.js";
import { ExecutionStatus, defineExecutor } from "./execution.js";
import {
  GroundingVerdict,
  createGroundedCognitionPort,
  defineGroundingVerifier
} from "./grounded-cognition.js";
import { CURRENT_STATE_SCHEMA_VERSION } from "./persistence.js";
import {
  SemanticMemoryKind,
  SemanticMemorySourceRefKind,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort
} from "./semantic-memory.js";

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

export async function verifyReflectionGroundingContract(createPort = (options) => createGroundedCognitionPort(options)) {
  invariant(typeof createPort === "function", "reflection grounding contract requires a port factory");
  const candidate = Object.freeze({ id: "candidate", version: "v1" });
  const observation = Object.freeze({ id: "observation-1", candidate });
  const verification = Object.freeze({ id: "verification-1", candidate });
  const evaluation = Object.freeze({
    id: "evaluation-1",
    candidate,
    metadata: Object.freeze({
      inputSnapshot: Object.freeze({
        observationIds: Object.freeze([observation.id]),
        verificationIds: Object.freeze([verification.id])
      })
    })
  });
  let state = {
    id: "grounding-contract",
    revision: 1,
    currentCandidate: candidate,
    persistentMemory: {
      observations: [observation],
      verifications: [verification],
      evaluations: [evaluation]
    }
  };
  const sessionStore = Object.freeze({
    async load(id) {
      return id === state.id ? structuredClone(state) : null;
    }
  });
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: createDeterministicIdFactory("contract-memory"),
    clock: createDeterministicClock()
  });
  const groundingVerifier = defineGroundingVerifier({
    name: "contract-grounder",
    revision: "1",
    async verify() {
      return {
        verdict: GroundingVerdict.GROUNDED,
        reason: "contract verifier accepts semantically supported fixture",
        confidence: 1
      };
    }
  });
  const port = await createPort({
    memory,
    sessionStore,
    groundingVerifier,
    idFactory: createDeterministicIdFactory("contract-cognition"),
    clock: createDeterministicClock({ start: "2026-01-02T00:00:00.000Z" })
  });
  invariant(port && typeof port.deriveReflection === "function", "reflection grounding port requires deriveReflection()");

  const base = {
    sessionId: state.id,
    content: "grounded contract reflection",
    tags: ["contract"],
    importance: 0.5,
    confidence: 1,
    provenance: { source: "reflection-grounding-contract", sourceId: "contract" }
  };

  let missingEvaluationError = null;
  try {
    await port.deriveReflection({
      ...base,
      sourceRefs: [{ kind: SemanticMemorySourceRefKind.OBSERVATION, id: observation.id }]
    });
  } catch (error) {
    missingEvaluationError = error;
  }
  invariant(
    missingEvaluationError?.code === ExHarnessErrorCode.GROUNDING_REQUIRED,
    "reflection without evaluation source must fail with GROUNDING_REQUIRED"
  );

  state = structuredClone(state);
  state.revision += 1;
  state.persistentMemory.observations.push({ id: "observation-2", candidate });
  let staleEvaluationError = null;
  try {
    await port.deriveReflection({
      ...base,
      sourceRefs: [{ kind: SemanticMemorySourceRefKind.EVALUATION, id: evaluation.id }]
    });
  } catch (error) {
    staleEvaluationError = error;
  }
  invariant(
    staleEvaluationError?.code === ExHarnessErrorCode.GROUNDING_REQUIRED,
    "reflection with stale evaluation source must fail with GROUNDING_REQUIRED"
  );

  state = structuredClone(state);
  state.revision += 1;
  const freshEvaluation = {
    id: "evaluation-2",
    candidate,
    metadata: {
      inputSnapshot: {
        observationIds: state.persistentMemory.observations.map((item) => item.id),
        verificationIds: [verification.id]
      }
    }
  };
  state.persistentMemory.evaluations.push(freshEvaluation);
  const derived = await port.deriveReflection({
    ...base,
    sourceRefs: [{ kind: SemanticMemorySourceRefKind.EVALUATION, id: freshEvaluation.id }]
  });
  invariant(derived?.memory?.kind === SemanticMemoryKind.REFLECTION, "fresh grounded reflection must be created");
  invariant(
    derived.memory.sourceRefs.some(
      (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION && ref.id === freshEvaluation.id
    ),
    "grounded reflection must retain exact evaluation source ref"
  );

  return Object.freeze({
    passed: true,
    checks: Object.freeze([
      "missing-evaluation-rejected",
      "stale-evaluation-rejected",
      "fresh-evaluation-required",
      "evaluation-source-retained"
    ])
  });
}
