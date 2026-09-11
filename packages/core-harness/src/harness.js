import { randomUUID } from "node:crypto";
import { CorePractice, invariant, sameCandidate, validateSupervisorIntervention } from "./contracts.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { createAVOHarness } from "./avo-harness.js";
import { createIdempotentEnvironment } from "./environment.js";
import { assertEvaluationInputsFresh } from "./evaluation-freshness.js";
import { RecoveryRequiredError } from "./errors.js";
import { createEventBus, instrumentAgentRuntime, instrumentCapabilities } from "./observability.js";
import { createValidatedSessionStore } from "./persistence.js";
import { assessRecovery, defineRecoveryPolicy, recoverInterruptedVariation } from "./recovery.js";
import { createSearchInvestmentController } from "./search-investment.js";
import { createInMemorySessionStore } from "./store.js";
import {
  buildSearchHealth,
  createTrajectoryContextProjector,
  defineSupervisionPolicy
} from "./supervision.js";
import {
  TrustBoundary,
  decisionFromEvaluation,
  evidenceFromVerificationArtifact,
  policyRefFromValue,
  subjectFromValue,
  validateTrustBundle
} from "./trust.js";

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

function pushUniqueByDigest(target, artifacts) {
  const existing = new Set(target.map((item) => item.digest));
  for (const artifact of artifacts) {
    if (existing.has(artifact.digest)) continue;
    target.push(structuredClone(artifact));
    existing.add(artifact.digest);
  }
}

export function createHarness({
  agent = null,
  strategy = null,
  capabilities = [],
  contextBlocks = [],
  contextPolicy = {},
  contextSelection = {},
  models = [],
  model = null,
  modelRegistry = null,
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
  searchInvestmentPolicy = null,
  supervisionPolicy = {},
  recoveryPolicy = {},
  attestationIssuer = null,
  eventBus = null,
  eventSinks = [],
  strictObservability = false,
  tracer = null,
  clock,
  idFactory,
  requireRevisionStore = true,
  idempotentActions = true
}) {
  invariant(strategy || agent, "createHarness requires strategy or agent");
  invariant(environment, "createHarness requires environment");
  invariant(objective || evaluator, "createHarness requires objective or evaluator");
  invariant(agent == null || tracer == null, "createHarness tracer is owned by an internally composed agent runtime; custom agent must own its tracer");
  invariant(
    agent == null || (models.length === 0 && model == null && modelRegistry == null),
    "createHarness model routing is owned by an internally composed agent runtime; custom agent must own its model routing"
  );

  const now = clock ?? (() => new Date().toISOString());
  const newId = idFactory ?? (() => randomUUID());
  const rawStore = sessionStore ?? createInMemorySessionStore();
  if (requireRevisionStore) {
    invariant(
      rawStore.supportsRevisions === true,
      "createHarness requires a revision-aware session store; run the store contract kit or use createInMemorySessionStore()"
    );
  }
  const resolvedStore = createValidatedSessionStore(rawStore);
  const resolvedEnvironment = idempotentActions
    ? createIdempotentEnvironment(environment)
    : environment;

  const resolvedEventBus = eventBus ?? createEventBus({
    sinks: eventSinks,
    strict: strictObservability,
    clock: now,
    idFactory: newId
  });
  const resolvedSupervisionPolicy = defineSupervisionPolicy(supervisionPolicy);
  const resolvedRecoveryPolicy = defineRecoveryPolicy(recoveryPolicy);
  const resolvedProjector = createTrajectoryContextProjector({
    projector: contextProjector,
    supervisionPolicy: resolvedSupervisionPolicy
  });
  const resolvedSupervisor = supervisor ?? createNoopSupervisor();
  const resolvedDosage = dosagePolicy ?? createDefaultDosagePolicy({ hasSupervisor: supervisor != null });
  const resolvedSearchInvestment = createSearchInvestmentController({
    policy: searchInvestmentPolicy,
    sessionStore: resolvedStore,
    clock: now,
    idFactory: newId
  });

  const baseAgent = agent ?? createAgentRuntime({
    strategy,
    capabilities: instrumentCapabilities(capabilities, resolvedEventBus),
    contextBlocks,
    contextPolicy,
    models,
    model,
    modelRegistry,
    tracer: tracer ?? undefined
  });
  const observedAgent = instrumentAgentRuntime(baseAgent, resolvedEventBus);

  const core = createAVOHarness({
    agent: observedAgent,
    contextSelection,
    verifiers,
    verificationPolicy,
    variationPolicy,
    searchInvestmentController: resolvedSearchInvestment,
    objective,
    evaluator,
    environment: resolvedEnvironment,
    sessionStore: resolvedStore,
    supervisor: resolvedSupervisor,
    contextProjector: resolvedProjector,
    dosagePolicy: resolvedDosage,
    clock: now,
    idFactory: newId
  });

  async function recoveryAssessment(sessionId) {
    return assessRecovery(await core.workState(sessionId), {
      policy: resolvedRecoveryPolicy,
      now
    });
  }

  function throwRecoveryRequired(sessionId, recovery) {
    throw new RecoveryRequiredError({
      sessionId,
      variationId: recovery.variation.id,
      lastActivityAt: recovery.lastActivityAt
    });
  }

  async function reviewCompletedVariation(sessionId, variationResult) {
    const state = await core.workState(sessionId);
    const searchHealth = buildSearchHealth(state, resolvedSupervisionPolicy);
    if (supervisor == null || !searchHealth.attentionSuggested) {
      return Object.freeze({ searchHealth, intervention: null });
    }

    const dose = { maxRecent: resolvedSupervisionPolicy.variationWindow };
    const projected = await resolvedProjector.project({
      consumer: "SUPERVISOR",
      problem: "review completed variation trajectory for search stagnation or repeated failure",
      progress: state,
      dose
    });
    const raw = await resolvedSupervisor.inspect({
      trigger: {
        eventId: null,
        type: "VARIATION_COMPLETED",
        variationId: variationResult.variation.id
      },
      context: structuredClone(projected),
      dose: structuredClone(dose)
    });
    const intervention = validateSupervisorIntervention(raw);
    if (!intervention) {
      return Object.freeze({ searchHealth, intervention: null });
    }

    const at = now();
    const interventionRecord = {
      id: newId(),
      at,
      candidate: structuredClone(state.currentCandidate),
      ...structuredClone(intervention)
    };
    const trajectoryEvent = {
      id: newId(),
      type: "SUPERVISOR_REDIRECTED",
      at,
      candidate: structuredClone(state.currentCandidate),
      interventionId: interventionRecord.id,
      reason: interventionRecord.reason,
      triggerVariationId: variationResult.variation.id
    };
    state.supervision.inspections += 1;
    state.supervision.lastInspectedEventId = trajectoryEvent.id;
    state.supervision.lastDecision = {
      eventId: trajectoryEvent.id,
      practice: CorePractice.SUPERVISION,
      enabled: true,
      dose: structuredClone(dose),
      reason: "trajectory health requested supervisor review"
    };
    state.supervision.interventions.push(interventionRecord);
    state.trajectory.push(trajectoryEvent);
    await resolvedStore.save(state);
    await resolvedEventBus.emit("SUPERVISOR_REDIRECTED", {
      sessionId,
      variationId: variationResult.variation.id,
      interventionId: interventionRecord.id,
      reason: interventionRecord.reason,
      searchHealth
    });

    return Object.freeze({
      searchHealth,
      intervention: structuredClone(interventionRecord)
    });
  }

  async function attestCurrentEvaluation(sessionId, {
    subject = null,
    policy = null,
    evidenceEnvironment,
    attestationEnvironment,
    evaluator: decisionEvaluator,
    boundary = TrustBoundary.VERIFICATION,
    claims = null,
    unresolved = [],
    verdict = null,
    upstreamAttestations = []
  } = {}) {
    invariant(attestationIssuer && typeof attestationIssuer.issue === "function", "attestCurrentEvaluation requires attestationIssuer");
    invariant(evidenceEnvironment, "attestCurrentEvaluation requires evidenceEnvironment or an evidenceEnvironment resolver");
    invariant(attestationEnvironment, "attestCurrentEvaluation requires attestationEnvironment");
    invariant(decisionEvaluator, "attestCurrentEvaluation requires evaluator authority");

    const state = await core.workState(sessionId);
    const candidate = structuredClone(state.currentCandidate);
    const evaluation = assertEvaluationInputsFresh(state);
    const currentVerifications = state.persistentMemory.verifications.filter((item) => sameCandidate(item.candidate, candidate));

    const resolvedSubject = subject ?? subjectFromValue(candidate, { type: "candidate" });
    const resolvedPolicy = policy ?? policyRefFromValue("verification-policy", core.verificationPolicy());
    const evidence = [];
    for (const verification of currentVerifications) {
      const resolvedEvidenceEnvironment = typeof evidenceEnvironment === "function"
        ? await evidenceEnvironment(structuredClone(verification))
        : evidenceEnvironment;
      invariant(resolvedEvidenceEnvironment, `evidence environment is required for verification ${verification.id ?? "unknown"}`);
      evidence.push(evidenceFromVerificationArtifact(verification, {
        subject: resolvedSubject,
        environment: resolvedEvidenceEnvironment,
        generatedAt: verification.at
      }));
    }
    const decision = decisionFromEvaluation(evaluation, {
      subject: resolvedSubject,
      boundary,
      policy: resolvedPolicy,
      evaluator: decisionEvaluator,
      evidence,
      claims,
      unresolved,
      verdict: verdict ?? evaluation.verdict,
      generatedAt: evaluation.at
    });
    const attestation = await attestationIssuer.issue({
      decision,
      environment: attestationEnvironment,
      upstreamAttestations,
      issuedAt: now()
    });
    const bundle = validateTrustBundle({ evidence, decision, attestation });

    state.persistentMemory.evidenceArtifacts ??= [];
    state.persistentMemory.decisionArtifacts ??= [];
    state.persistentMemory.attestations ??= [];
    pushUniqueByDigest(state.persistentMemory.evidenceArtifacts, bundle.evidence);
    pushUniqueByDigest(state.persistentMemory.decisionArtifacts, [bundle.decision]);
    pushUniqueByDigest(state.persistentMemory.attestations, [bundle.attestation]);
    state.trajectory.push({
      id: newId(),
      type: "TRUST_ATTESTED",
      at: now(),
      candidate,
      boundary,
      subject: structuredClone(resolvedSubject),
      decisionId: decision.id,
      attestationId: attestation.id,
      policyDigest: decision.policy.digest
    });
    await resolvedStore.save(state);
    await resolvedEventBus.emit("HARNESS_TRUST_ATTESTED", {
      sessionId,
      boundary,
      subject: resolvedSubject,
      decisionId: decision.id,
      attestationId: attestation.id,
      policyDigest: decision.policy.digest
    });
    return bundle;
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
      if (recovery.required) throwRecoveryRequired(sessionId, recovery);
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
        now,
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
      if (recovery.required) throwRecoveryRequired(sessionId, recovery);
      await resolvedSearchInvestment.assertCanContinue(sessionId);
      await resolvedEventBus.emit("HARNESS_VARIATION_STARTED", { sessionId });
      const result = await core.vary(sessionId, options);
      await resolvedEventBus.emit("HARNESS_VARIATION_COMPLETED", {
        sessionId,
        variationId: result.variation.id,
        outcome: result.variation.outcome,
        termination: result.variation.termination,
        lineageAdvanced: result.lineage.advanced
      });
      if (result.searchInvestment) {
        await resolvedEventBus.emit("HARNESS_SEARCH_INVESTMENT_DECIDED", {
          sessionId,
          variationId: result.variation.id,
          decisionId: result.searchInvestment.id,
          state: result.searchInvestment.state,
          action: result.searchInvestment.action
        });
      }
      const trajectoryReview = await reviewCompletedVariation(sessionId, result);
      return Object.freeze({ ...result, trajectoryReview });
    },

    attestCurrentEvaluation,

    async trustArtifacts(sessionId) {
      const state = await core.workState(sessionId);
      return Object.freeze({
        evidence: Object.freeze(structuredClone(state.persistentMemory.evidenceArtifacts ?? [])),
        decisions: Object.freeze(structuredClone(state.persistentMemory.decisionArtifacts ?? [])),
        attestations: Object.freeze(structuredClone(state.persistentMemory.attestations ?? []))
      });
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

    modelRouting() {
      return observedAgent.modelRouting?.() ?? null;
    },

    traces() {
      return observedAgent.traces?.() ?? Object.freeze([]);
    },

    traceFailures() {
      return observedAgent.traceFailures?.() ?? Object.freeze([]);
    },

    policies() {
      return Object.freeze({
        variation: core.variationPolicy(),
        verification: core.verificationPolicy(),
        searchInvestment: core.searchInvestmentPolicy(),
        supervision: structuredClone(resolvedSupervisionPolicy),
        recovery: structuredClone(resolvedRecoveryPolicy),
        idempotentActions
      });
    }
  });
}
