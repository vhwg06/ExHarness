import { randomUUID } from "node:crypto";
import {
  CorePractice,
  EvaluationValidity,
  EvaluationVerdict,
  ImplementationStatus,
  candidateKey,
  invariant,
  normalizeCandidate,
  requireText,
  sameCandidate,
  validateDoseDecision,
  validateEvaluation,
  validateKnowledgeRecord,
  validateSupervisorIntervention
} from "./contracts.js";
import { validateCorePorts } from "./ports.js";
import { createPersistentWorkState, findImplementation, publicSnapshot } from "./state.js";

const defaultClock = () => new Date().toISOString();
const defaultId = () => randomUUID();

export function createCoreHarness({
  environment,
  evaluator,
  sessionStore,
  supervisor,
  contextProjector,
  dosagePolicy,
  clock = defaultClock,
  idFactory = defaultId
}) {
  validateCorePorts({ environment, evaluator, sessionStore, supervisor, contextProjector, dosagePolicy });

  async function load(sessionId) {
    requireText(sessionId, "sessionId");
    const state = await sessionStore.load(sessionId);
    invariant(state, `session not found: ${sessionId}`);
    return state;
  }

  async function save(state) {
    state.updatedAt = clock();
    await sessionStore.save(state);
  }

  function event(state, type, payload = {}) {
    const item = {
      id: idFactory(),
      type,
      at: clock(),
      candidate: structuredClone(state.currentCandidate),
      ...structuredClone(payload)
    };
    state.trajectory.push(item);
    return item;
  }

  function currentObservations(state) {
    const key = candidateKey(state.currentCandidate);
    return state.persistentMemory.observations.filter((item) => candidateKey(item.candidate) === key);
  }

  function currentEvaluation(state) {
    const key = candidateKey(state.currentCandidate);
    return [...state.persistentMemory.evaluations]
      .reverse()
      .find((item) => candidateKey(item.candidate) === key) ?? null;
  }

  function progressView(state) {
    return Object.freeze({
      sessionId: state.id,
      work: structuredClone(state.work),
      currentCandidate: structuredClone(state.currentCandidate),
      persistentMemory: structuredClone(state.persistentMemory),
      trajectory: structuredClone(state.trajectory),
      supervision: structuredClone(state.supervision)
    });
  }

  function controlView(state) {
    return Object.freeze({
      sessionId: state.id,
      work: structuredClone(state.work),
      currentCandidate: structuredClone(state.currentCandidate),
      latestEvaluation: structuredClone(currentEvaluation(state)),
      lineageHead: structuredClone(state.persistentMemory.lineage.at(-1) ?? null),
      counts: Object.freeze({
        implementations: state.persistentMemory.implementations.length,
        observations: state.persistentMemory.observations.length,
        evaluations: state.persistentMemory.evaluations.length,
        knowledge: state.persistentMemory.knowledge.length,
        lineage: state.persistentMemory.lineage.length,
        trajectoryEvents: state.trajectory.length
      }),
      supervision: Object.freeze({
        inspections: state.supervision.inspections,
        skipped: state.supervision.skipped,
        interventions: state.supervision.interventions.length,
        lastDecision: structuredClone(state.supervision.lastDecision)
      })
    });
  }

  async function decideDose(practice, context) {
    const raw = await dosagePolicy.decide({
      practice,
      context: structuredClone(context)
    });
    return validateDoseDecision(raw);
  }

  async function inspectProgress(state, triggerEvent) {
    const control = controlView(state);
    const decision = await decideDose(CorePractice.SUPERVISION, {
      trigger: {
        eventId: triggerEvent.id,
        type: triggerEvent.type
      },
      control
    });

    state.supervision.lastDecision = {
      eventId: triggerEvent.id,
      practice: CorePractice.SUPERVISION,
      ...structuredClone(decision)
    };

    if (!decision.enabled) {
      state.supervision.skipped += 1;
      return Object.freeze({ decision, intervention: null });
    }

    const supervisionContext = await contextProjector.project({
      consumer: "SUPERVISOR",
      problem: "assess whether the current search remains productive",
      progress: progressView(state),
      dose: structuredClone(decision.dose)
    });

    state.supervision.inspections += 1;
    state.supervision.lastInspectedEventId = triggerEvent.id;
    const raw = await supervisor.inspect({
      trigger: {
        eventId: triggerEvent.id,
        type: triggerEvent.type
      },
      context: structuredClone(supervisionContext),
      dose: structuredClone(decision.dose)
    });

    const intervention = validateSupervisorIntervention(raw);
    if (!intervention) return Object.freeze({ decision, intervention: null });

    const record = {
      id: idFactory(),
      at: clock(),
      candidate: structuredClone(state.currentCandidate),
      ...structuredClone(intervention)
    };
    state.supervision.interventions.push(record);
    event(state, "SUPERVISOR_REDIRECTED", { interventionId: record.id, reason: record.reason });
    return Object.freeze({ decision, intervention: record });
  }

  function contextIndexes(state) {
    return Object.freeze({
      currentObservations: Object.freeze({ count: currentObservations(state).length }),
      implementations: Object.freeze({ count: state.persistentMemory.implementations.length }),
      evaluations: Object.freeze({ count: state.persistentMemory.evaluations.length }),
      knowledge: Object.freeze({ count: state.persistentMemory.knowledge.length }),
      lineage: Object.freeze({
        count: state.persistentMemory.lineage.length,
        head: structuredClone(state.persistentMemory.lineage.at(-1) ?? null)
      }),
      supervision: Object.freeze({
        inspections: state.supervision.inspections,
        skipped: state.supervision.skipped,
        interventions: state.supervision.interventions.length
      }),
      trajectory: Object.freeze({
        eventCount: state.trajectory.length,
        lastEventId: state.trajectory.at(-1)?.id ?? null
      })
    });
  }

  return Object.freeze({
    async start({ sessionId = idFactory(), work, seedCandidate }) {
      requireText(sessionId, "sessionId");
      invariant(work != null, "work is required");
      const existing = await sessionStore.load(sessionId);
      invariant(existing == null, `session already exists: ${sessionId}`);

      const state = createPersistentWorkState({ id: sessionId, work, seedCandidate, now: clock });
      event(state, "SESSION_STARTED");
      await save(state);
      return publicSnapshot(state);
    },

    async resume(sessionId) {
      return publicSnapshot(await load(sessionId));
    },

    async context(sessionId, { problem = null } = {}) {
      const state = await load(sessionId);
      const decision = await decideDose(CorePractice.CONTEXT_PROJECTION, {
        problem,
        control: controlView(state)
      });
      let projected = null;

      if (decision.enabled) {
        projected = await contextProjector.project({
          consumer: "AGENT",
          problem,
          progress: progressView(state),
          dose: structuredClone(decision.dose)
        });
      }

      return Object.freeze({
        sessionId: state.id,
        work: structuredClone(state.work),
        candidate: structuredClone(state.currentCandidate),
        latestEvaluation: structuredClone(currentEvaluation(state)),
        latestIntervention: structuredClone(state.supervision.interventions.at(-1) ?? null),
        projected: structuredClone(projected),
        dosage: Object.freeze({ contextProjection: decision }),
        indexes: contextIndexes(state)
      });
    },

    async workState(sessionId) {
      return structuredClone(await load(sessionId));
    },

    async implementationHistory(sessionId) {
      const state = await load(sessionId);
      return structuredClone(state.persistentMemory.implementations);
    },

    async observations(sessionId, { currentCandidateOnly = false } = {}) {
      const state = await load(sessionId);
      return structuredClone(currentCandidateOnly ? currentObservations(state) : state.persistentMemory.observations);
    },

    async evaluations(sessionId) {
      const state = await load(sessionId);
      return structuredClone(state.persistentMemory.evaluations);
    },

    async knowledge(sessionId) {
      const state = await load(sessionId);
      return structuredClone(state.persistentMemory.knowledge);
    },

    async lineage(sessionId) {
      const state = await load(sessionId);
      return structuredClone(state.persistentMemory.lineage);
    },

    async trajectory(sessionId, { afterEventId = null } = {}) {
      const state = await load(sessionId);
      if (!afterEventId) return structuredClone(state.trajectory);

      const index = state.trajectory.findIndex((item) => item.id === afterEventId);
      invariant(index >= 0, `trajectory event not found: ${afterEventId}`);
      return structuredClone(state.trajectory.slice(index + 1));
    },

    async observe(sessionId, request) {
      const state = await load(sessionId);
      const result = await environment.observe({
        sessionId: state.id,
        work: structuredClone(state.work),
        candidate: structuredClone(state.currentCandidate),
        request: structuredClone(request)
      });

      const observation = {
        id: idFactory(),
        candidate: structuredClone(state.currentCandidate),
        at: clock(),
        request: structuredClone(request),
        value: structuredClone(result)
      };
      state.persistentMemory.observations.push(observation);
      event(state, "OBSERVED", { observationId: observation.id });
      await save(state);
      return structuredClone(observation);
    },

    async act(sessionId, action) {
      const state = await load(sessionId);
      const before = structuredClone(state.currentCandidate);
      const result = await environment.act({
        sessionId: state.id,
        work: structuredClone(state.work),
        candidate: before,
        action: structuredClone(action)
      });

      invariant(result && typeof result === "object", "environment action result is required");
      const mutated = result.mutated === true;
      let after = before;

      if (mutated) {
        after = normalizeCandidate(result.candidate);
        invariant(!sameCandidate(before, after), "mutating action must return a new candidate version");
        invariant(!findImplementation(state, after), "candidate version already exists in implementation history");
        state.currentCandidate = after;
        state.persistentMemory.implementations.push({
          candidate: after,
          parent: before,
          status: ImplementationStatus.WORKING,
          createdAt: clock(),
          promotedAt: null
        });
      } else {
        invariant(result.candidate == null || sameCandidate(before, result.candidate), "non-mutating action cannot change candidate");
      }

      const actionEvent = event(state, "ACTED", {
        mutated,
        before,
        after,
        result: structuredClone(result.result ?? null)
      });
      const supervision = await inspectProgress(state, actionEvent);
      await save(state);

      return Object.freeze({
        eventId: actionEvent.id,
        mutated,
        candidate: structuredClone(after),
        result: structuredClone(result.result ?? null),
        supervision: structuredClone(supervision)
      });
    },

    async evaluate(sessionId, request = null) {
      const state = await load(sessionId);
      const candidate = structuredClone(state.currentCandidate);
      const observations = structuredClone(currentObservations(state));

      const raw = await evaluator.evaluate({
        sessionId: state.id,
        work: structuredClone(state.work),
        candidate,
        observations,
        request: structuredClone(request)
      });
      const result = validateEvaluation(raw);

      const evaluation = {
        id: idFactory(),
        candidate,
        at: clock(),
        ...result
      };
      state.persistentMemory.evaluations.push(evaluation);
      const evaluationEvent = event(state, "EVALUATED", {
        evaluationId: evaluation.id,
        validity: evaluation.validity,
        verdict: evaluation.verdict
      });
      await inspectProgress(state, evaluationEvent);
      await save(state);
      return structuredClone(evaluation);
    },

    async recordKnowledge(sessionId, record) {
      const state = await load(sessionId);
      const validated = validateKnowledgeRecord(record);
      const item = {
        id: idFactory(),
        candidate: structuredClone(state.currentCandidate),
        at: clock(),
        ...structuredClone(validated)
      };
      state.persistentMemory.knowledge.push(item);
      event(state, "KNOWLEDGE_RECORDED", { knowledgeId: item.id, kind: item.kind });
      await save(state);
      return structuredClone(item);
    },

    async promote(sessionId) {
      const state = await load(sessionId);
      const evaluation = currentEvaluation(state);
      invariant(evaluation, "current candidate has not been evaluated");
      invariant(evaluation.validity === EvaluationValidity.VALID, "current evaluation is not valid");
      invariant(evaluation.verdict === EvaluationVerdict.PASS, "current candidate did not pass evaluation");

      const head = state.persistentMemory.lineage.at(-1);
      invariant(!sameCandidate(head.candidate, state.currentCandidate), "current candidate is already committed to lineage");

      const implementation = findImplementation(state, state.currentCandidate);
      invariant(implementation, "current candidate is missing from implementation history");
      implementation.status = ImplementationStatus.PROMOTED;
      implementation.promotedAt = clock();

      const promotion = {
        kind: "PROMOTED",
        candidate: structuredClone(state.currentCandidate),
        evaluation: evaluation.id,
        promotedAt: implementation.promotedAt
      };
      state.persistentMemory.lineage.push(promotion);
      event(state, "PROMOTED", { evaluationId: evaluation.id });
      await save(state);
      return structuredClone(promotion);
    }
  });
}
