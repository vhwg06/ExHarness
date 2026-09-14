import {
  EvaluationValidity,
  EvaluationVerdict,
  createEvidenceArtifact,
  createHarness,
  environmentRefFromValue,
  evidenceFromVerificationArtifact,
  subjectFromValue
} from "../../core-harness/src/index.js";
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

export function createBackendWorker({ strategy, workspace, verifiers = [] }) {
  invariant(strategy && typeof strategy.run === "function", "BackendWorker requires strategy.run()");
  invariant(workspace && typeof workspace.act === "function", "BackendWorker requires workspace.act()");
  invariant(Array.isArray(verifiers), "BackendWorker verifiers must be an array");

  return Object.freeze({
    async execute(rawOrder, rawContext) {
      const order = parseBackendWorkOrder(rawOrder);
      const context = BackendContextSchema.parse(rawContext);
      assertContextMatchesOrder(order, context);

      const environment = {
        async observe(args) {
          if (typeof workspace.observe === "function") {
            return workspace.observe(args);
          }
          return { candidate: args.candidate };
        },
        act: (args) => workspace.act(args)
      };

      const harness = createHarness({
        strategy,
        environment,
        verifiers,
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

      const sessionId = `backend:${order.id}`;
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

      const variation = await harness.vary(sessionId, { problem: order.task });
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
      const verifications = await harness.verifications(sessionId, { currentCandidateOnly: true });
      const evidence = [
        mutationEvidence(order, claimed, variation, subject, evidenceEnv),
        ...verifications.map((verification) => evidenceFromVerificationArtifact(verification, {
          subject,
          environment: evidenceEnv
        }))
      ];

      return BackendWorkResultSchema.parse({
        ...claimed,
        evidence
      });
    }
  });
}
