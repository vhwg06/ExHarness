import { CorePractice, invariant } from "./contracts.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { createAVOHarness } from "./avo-harness.js";
import { createEventBus, instrumentAgentRuntime, instrumentCapabilities } from "./observability.js";
import { assessRecovery, defineRecoveryPolicy, recoverInterruptedVariation } from "./recovery.js";
import { createInMemorySessionStore } from "./store.js";
import {
  buildSearchHealth,
  createTrajectoryContextProjector,
  defineSupervisionPolicy
} from "./supervision.js";

function createDefaultDosagePolicy({ hasSupervisor }) {
  return Object.freeze({
    async decide({ practice }) {
      if (practice === CorePractice.CONTEXT_PROJECTION) {
        return {
          enabled: true,
          dose: { maxRecent: 6 },
          reason: "bounded default context projection"
        };
      }
      if (practice === CorePractice.SUPERVISION && hasSupervisor) {
        return {
          enabled: true,
          dose: { maxRecent: 6 },
          reason: "supervisor configured for trajectory review"
        };
      }
      return { enabled: false, reason: "practice is not configured" };
    }
  });
}

function createNoopSupervisor() {
  return Object.freeze({
    async inspect() {
      return null;
    }
  });
}

export function createHarness({
  agent = null,
  strategy = null,
  capabilities = [],
  environment,
  objective = null,
  evaluator = null,
  sessionStore = null,
  supervisor = null,
  contextProjector = null,
  dosagePolicy = null,
  verifiers = [],
  verificationPolicy = {},
  variationPolicy = {},
  supervisionPolicy = {},
  recoveryPolicy = {},
  eventBus = null,
  eventSinks = [],
  strictObservability = false,
  clock,
  idFactory,
  requireRevisionStore = true
}) {
  invariant(strategy || agent, "createHarness requires strategy or agent");
  invariant(environment, "createHarness requires environment");
  invariant(objective || evaluator, "createHarness requires objective or evaluator");

  const resolvedStore = sessionStore ?? createInMemorySessionStore();
  if (requireRevisionStore) {
    invariant(
      resolvedStore.supportsRevisions === true,
      "createHarness requires a revision-aware session store; run the store contract kit or use createInMemorySessionStore()"
    );
  }

  const resolvedEventBus = eventBus ?? createEventBus({
    sinks: eventSinks,
    strict: strictObservability,
    clock,
    idFactory
  });
  const resolvedSupervisionPolicy = defineSupervisionPolicy(supervisionPolicy);
  const resolvedRecoveryPolicy = defineRecoveryPolicy(recoveryPolicy);
  const resolvedProjector = createTrajectoryContextProjector({
    projector: contextProjector,
    supervisionPolicy: resolvedSupervisionPolicy
  });
  const resolvedSupervisor = supervisor ?? createNoopSupervisor();
  const resolvedDosage = dosagePolicy ?? createDefaultDosagePolicy({ hasSupervisor: supervisor != null });

  const baseAgent = agent ?? createAgentRuntime({
    strategy,
    capabilities: instrumentCapabilities(capabilities, resolvedEventBus)
  });
  const observedAgent = instrumentAgentRuntime(baseAgent, resolvedEventBus);

  const core = createAVOHarness({
    agent: observedAgent,
    verifiers,
    verificationPolicy,
    variationPolicy,
    objective,
    evaluator,
    environment,
    sessionStore: resolvedStore,
    supervisor: resolvedSupervisor,
    contextProjector: resolvedProjector,
    dosagePolicy: resolvedDosage,
    clock,
    idFactory
  });

  async function recoveryAssessment(sessionId) {
    return assessRecovery(await core.workState(sessionId), {
      policy: resolvedRecoveryPolicy,
      now: clock ?? (() => new Date().toISOString())
    });
  }

  return Object.freeze({
    ...core,

    async start(args) {
      const snapshot = await core.start(args);
      await resolvedEventBus.emit("HARNESS_SESSION_STARTED", {
        sessionId: snapshot.id,
        candidate: snapshot.candidate,
        revision: snapshot.revision
      });
      return snapshot;
    },

    async resume(sessionId) {
      const recovery = await recoveryAssessment(sessionId);
      if (recovery.required) {
        const { RecoveryRequiredError } = await import("./errors.js");
        throw new RecoveryRequiredError({
          sessionId,
          variationId: recovery.variation.id,
          lastActivityAt: recovery.lastActivityAt
        });
      }
      const snapshot = await core.resume(sessionId);
      await resolvedEventBus.emit("HARNESS_SESSION_RESUMED", {
        sessionId,
        candidate: snapshot.candidate,
        revision: snapshot.revision
      });
      return snapshot;
    },

    async recover(sessionId, options = {}) {
      const result = await recoverInterruptedVariation(core, sessionId, {
        policy: resolvedRecoveryPolicy,
        now: clock ?? (() => new Date().toISOString()),
        ...options
      });
      if (result.recovered) {
        await resolvedEventBus.emit("HARNESS_SESSION_RECOVERED", {
          sessionId,
          variationId: result.variation.id,
          outcome: result.variation.outcome
        });
      }
      return result;
    },

    async vary(sessionId, options = {}) {
      const recovery = await recoveryAssessment(sessionId);
      if (recovery.required) {
        const { RecoveryRequiredError } = await import("./errors.js");
        throw new RecoveryRequiredError({
          sessionId,
          variationId: recovery.variation.id,
          lastActivityAt: recovery.lastActivityAt
        });
      }
      await resolvedEventBus.emit("HARNESS_VARIATION_STARTED", { sessionId });
      const result = await core.vary(sessionId, options);
      await resolvedEventBus.emit("HARNESS_VARIATION_COMPLETED", {
        sessionId,
        variationId: result.variation.id,
        outcome: result.variation.outcome,
        termination: result.variation.termination,
        lineageAdvanced: result.lineage.advanced
      });
      return result;
    },

    async searchHealth(sessionId) {
      return buildSearchHealth(await core.workState(sessionId), resolvedSupervisionPolicy);
    },

    async recoveryStatus(sessionId) {
      return recoveryAssessment(sessionId);
    },

    events() {
      return resolvedEventBus.events();
    },

    observabilityFailures() {
      return resolvedEventBus.failures();
    },

    policies() {
      return Object.freeze({
        variation: core.variationPolicy(),
        verification: core.verificationPolicy(),
        supervision: structuredClone(resolvedSupervisionPolicy),
        recovery: structuredClone(resolvedRecoveryPolicy)
      });
    }
  });
}
