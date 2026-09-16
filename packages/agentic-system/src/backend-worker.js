import { isDeepStrictEqual } from "node:util";
import {
  EvaluationValidity,
  EvaluationVerdict,
  createEvidenceArtifact,
  createHarness,
  createInMemorySessionStore,
  environmentRefFromValue,
  evidenceFromVerificationArtifact,
  sameCandidate,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  EffectOperationStatus,
  EffectRecoveryAction
} from "../../core-harness/src/effect-reconciliation.js";
import {
  BackendContextSchema,
  BackendEvidenceClaim,
  BackendWorkResultSchema,
  BackendWorkStatus,
  parseBackendWorkOrder
} from "./contracts.js";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContextMatchesOrder(order, context) {
  invariant(
    context.repository.ref === order.repositoryRef && context.repository.revision === order.revision,
    "BackendContext repository must match BackendWorkOrder source revision"
  );

  const resolvedPaths = context.files.map((file) => file.path);
  invariant(
    resolvedPaths.length === order.requiredFiles.length &&
      resolvedPaths.every((path, index) => path === order.requiredFiles[index]),
    "BackendContext files must exactly match BackendWorkOrder.requiredFiles"
  );
}

function evidenceSubject(order, result) {
  return subjectFromValue({
    repositoryRef: order.repositoryRef,
    revision: result.revision
  }, {
    type: "backend-candidate",
    producer: {
      identity: "backend-worker",
      roles: ["executor"]
    },
    metadata: {
      objectiveId: order.objectiveId,
      workOrderId: order.id
    }
  });
}

function evidenceEnvironment(order, context, result) {
  return environmentRefFromValue({
    repositoryRef: order.repositoryRef,
    baseRevision: order.revision,
    resultRevision: result.revision,
    contextSources: context.files.map((file) => file.sourceRef)
  }, {
    name: "backend-workspace"
  });
}

function mutationEvidence(order, result, variation, subject, environment) {
  return createEvidenceArtifact({
    subject,
    kind: "BACKEND_MUTATION",
    producer: {
      identity: "backend-worker",
      roles: ["executor"]
    },
    environment,
    generatedAt: variation.variation.completedAt,
    metadata: {
      claim: BackendEvidenceClaim.MUTATION,
      verificationStatus: variation.lineage.advanced ? "PASS" : "FAIL"
    },
    content: {
      beforeRevision: order.revision,
      afterRevision: result.revision,
      lineageAdvanced: variation.lineage.advanced
    }
  });
}

function sessionIdFor(order) {
  return `backend:${order.id}`;
}

function sameWork(state, order, context) {
  return state?.work?.kind === "BACKEND" &&
    isDeepStrictEqual(state.work.order, order) &&
    isDeepStrictEqual(state.work.context, context);
}

export const BackendRecoveryAction = Object.freeze({
  RETRY_EXECUTION: "RETRY_EXECUTION",
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED"
});

function blockedRecovery(sessionId, blockers, { effects = [], reconciliations = [] } = {}) {
  return Object.freeze({
    action: BackendRecoveryAction.BLOCKED,
    sessionId,
    result: null,
    blockers: Object.freeze([...blockers]),
    effects: Object.freeze(structuredClone(effects)),
    reconciliations: Object.freeze(structuredClone(reconciliations))
  });
}

export function createBackendWorker({
  strategy,
  workspace,
  verifiers = [],
  sessionStore = null,
  actionEffect = null
}) {
  invariant(strategy && typeof strategy.run === "function", "BackendWorker requires strategy.run()");
  invariant(workspace && typeof workspace.act === "function", "BackendWorker requires workspace.act()");
  invariant(Array.isArray(verifiers), "BackendWorker verifiers must be an array");
  const resolvedSessionStore = sessionStore ?? createInMemorySessionStore();
  invariant(
    resolvedSessionStore && typeof resolvedSessionStore.load === "function" && typeof resolvedSessionStore.save === "function",
    "BackendWorker sessionStore requires load() and save()"
  );

  function createExecutionHarness(order, context) {
    const environment = {
      async observe(args) {
        if (typeof workspace.observe === "function") {
          return workspace.observe(args);
        }
        return { candidate: args.candidate };
      },
      act: (args) => workspace.act(args)
    };

    return createHarness({
      strategy,
      environment,
      verifiers,
      sessionStore: resolvedSessionStore,
      ...(actionEffect == null && workspace.effect == null
        ? {}
        : { actionEffect: actionEffect ?? workspace.effect }),
      objective: {
        async evaluate({ candidate }) {
          const changed = candidate.version !== order.revision;
          return {
            validity: EvaluationValidity.VALID,
            verdict: changed ? EvaluationVerdict.PASS : EvaluationVerdict.FAIL,
            evidence: [
              changed
                ? `backend-candidate-advanced:${order.revision}->${candidate.version}`
                : `backend-candidate-unchanged:${candidate.version}`
            ]
          };
        }
      }
    });
  }

  async function resultFromVariation(harness, order, context, variation) {
    invariant(variation.failure == null, `BackendWorker ExHarness execution failed: ${variation.failure?.message ?? "unknown failure"}`);

    const claimed = BackendWorkResultSchema.parse({
      ...variation.result,
      evidence: []
    });

    if (claimed.status === BackendWorkStatus.APPLIED) {
      invariant(variation.lineage.advanced, "APPLIED BackendWorkResult requires ExHarness lineage promotion");
      invariant(variation.after.version === claimed.revision, "APPLIED BackendWorkResult revision must match ExHarness candidate");
    } else {
      invariant(!variation.lineage.advanced, `${claimed.status} BackendWorkResult cannot advance ExHarness lineage`);
    }

    if (claimed.status !== BackendWorkStatus.APPLIED) return claimed;

    const subject = evidenceSubject(order, claimed);
    const evidenceEnv = evidenceEnvironment(order, context, claimed);
    const currentVerifications = await harness.verifications(sessionIdFor(order), { currentCandidateOnly: true });
    const evidence = [
      mutationEvidence(order, claimed, variation, subject, evidenceEnv),
      ...currentVerifications.map((verification) => evidenceFromVerificationArtifact(verification, {
        subject,
        environment: evidenceEnv
      }))
    ];

    return BackendWorkResultSchema.parse({
      ...claimed,
      evidence
    });
  }

  async function runVariation(harness, order, context) {
    const variation = await harness.vary(sessionIdFor(order), { problem: order.task });
    return resultFromVariation(harness, order, context, variation);
  }

  async function execute(rawOrder, rawContext) {
    const order = parseBackendWorkOrder(rawOrder);
    const context = BackendContextSchema.parse(rawContext);
    assertContextMatchesOrder(order, context);

    const harness = createExecutionHarness(order, context);
    const sessionId = sessionIdFor(order);
    await harness.start({
      sessionId,
      work: {
        kind: "BACKEND",
        order,
        context
      },
      seedCandidate: {
        id: order.repositoryRef,
        version: order.revision
      }
    });

    return runVariation(harness, order, context);
  }

  async function recover(rawOrder, rawContext) {
    const order = parseBackendWorkOrder(rawOrder);
    const context = BackendContextSchema.parse(rawContext);
    assertContextMatchesOrder(order, context);
    const sessionId = sessionIdFor(order);

    const persisted = await resolvedSessionStore.load(sessionId);
    if (persisted == null) {
      if (resolvedSessionStore.supportsDurableRecovery !== true) {
        return blockedRecovery(sessionId, [
          "Interrupted Backend recovery cannot infer safe fresh execution from an empty non-durable SessionStore; durable recovery authority is required."
        ]);
      }
      return Object.freeze({
        action: BackendRecoveryAction.RETRY_EXECUTION,
        sessionId,
        result: null,
        blockers: Object.freeze([]),
        effects: Object.freeze([]),
        reconciliations: Object.freeze([])
      });
    }

    const harness = createExecutionHarness(order, context);
    const state = await harness.workState(sessionId);
    invariant(sameWork(state, order, context), "Backend recovery target does not match persisted Core work");

    const effects = await harness.actionEffects(sessionId);
    const reconciliations = [];

    if (effects.length > 1) {
      return blockedRecovery(sessionId, [
        "Interrupted Backend recovery found multiple persisted mutation effects; strategy continuation cannot be reconstructed safely without a durable program counter."
      ], { effects });
    }

    for (const effect of effects) {
      if (effect.status === EffectOperationStatus.CONFIRMED) {
        reconciliations.push({ action: EffectRecoveryAction.CONTINUE, operation: effect });
        continue;
      }
      if (effect.status === EffectOperationStatus.INTENDED) {
        reconciliations.push({ action: EffectRecoveryAction.RETRY, operation: effect });
        continue;
      }

      const reconciliation = await harness.reconcileActionEffect(sessionId, effect.operationId);
      reconciliations.push(reconciliation);
      if (reconciliation.action === EffectRecoveryAction.ESCALATE) {
        return blockedRecovery(sessionId, [
          `Interrupted Backend effect cannot be reconciled safely: ${effect.operationId} (${effect.status}).`
        ], { effects, reconciliations });
      }
    }

    const refreshed = await harness.workState(sessionId);
    if (effects.length === 1) {
      const operation = reconciliations[0].operation;
      if (!sameCandidate(refreshed.currentCandidate, operation.candidate)) {
        const confirmedCandidate = operation.result?.candidate ?? null;
        const alreadyApplied = confirmedCandidate != null && sameCandidate(refreshed.currentCandidate, confirmedCandidate);
        return blockedRecovery(sessionId, [
          alreadyApplied
            ? "Interrupted Backend mutation is already persisted in Core state, but the Worker semantic result was not durably committed; reassessment is required before continuing."
            : "Interrupted Backend Core candidate diverged from the persisted effect base; automatic replay is unsafe."
        ], { effects, reconciliations });
      }
    } else {
      invariant(
        refreshed.currentCandidate.id === order.repositoryRef && refreshed.currentCandidate.version === order.revision,
        "Backend recovery without persisted effects requires the original candidate"
      );
    }

    await harness.recover(sessionId, { force: true });

    try {
      const result = await runVariation(harness, order, context);
      return Object.freeze({
        action: BackendRecoveryAction.COMPLETED,
        sessionId,
        result,
        blockers: Object.freeze([]),
        effects: Object.freeze(structuredClone(await harness.actionEffects(sessionId))),
        reconciliations: Object.freeze(structuredClone(reconciliations))
      });
    } catch (error) {
      return blockedRecovery(sessionId, [
        `Interrupted Backend execution could not complete after effect reconciliation: ${error.message}`
      ], {
        effects: await harness.actionEffects(sessionId),
        reconciliations
      });
    }
  }

  return Object.freeze({ execute, recover });
}
