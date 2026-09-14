import {
  EvaluationValidity,
  EvaluationVerdict,
  createHarness,
  environmentRefFromValue,
  evidenceFromVerificationArtifact,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  QaContextSchema,
  QaWorkResultSchema,
  QaWorkStatus,
  parseQaWorkOrder
} from "./qa-contracts.js";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContextMatchesOrder(order, context) {
  invariant(
    context.upstream.workOrderId === order.upstream.workOrderId &&
      context.upstream.revision === order.upstream.revision &&
      context.upstream.acceptanceDecision.id === order.upstream.acceptanceDecision.id &&
      context.upstream.acceptanceDecision.digest === order.upstream.acceptanceDecision.digest,
    "QaContext upstream must match QaWorkOrder upstream"
  );

  const resolvedRefs = context.artifacts.map((artifact) => artifact.ref);
  const requiredRefs = order.requiredArtifacts.map((artifact) => artifact.ref);
  invariant(
    resolvedRefs.length === requiredRefs.length && resolvedRefs.every((ref, index) => ref === requiredRefs[index]),
    "QaContext artifacts must exactly match QaWorkOrder.requiredArtifacts"
  );
}

function qaSubject(order, context) {
  return subjectFromValue({
    revision: order.upstream.revision,
    artifacts: context.artifacts.map((artifact) => artifact.ref)
  }, {
    type: "qa-inspection-target",
    producer: {
      identity: "backend-worker",
      roles: ["producer"]
    },
    metadata: {
      qaObjectiveId: order.objectiveId,
      upstreamWorkOrderId: order.upstream.workOrderId,
      acceptanceDecision: order.upstream.acceptanceDecision
    }
  });
}

function qaEnvironment(order, context) {
  return environmentRefFromValue({
    upstreamWorkOrderId: order.upstream.workOrderId,
    revision: order.upstream.revision,
    artifactSources: context.artifacts.map((artifact) => artifact.sourceRef)
  }, {
    name: "qa-artifact-inspection"
  });
}

export function createQaWorker({ strategy, verifiers = [] }) {
  invariant(strategy && typeof strategy.run === "function", "QaWorker requires strategy.run()");
  invariant(Array.isArray(verifiers), "QaWorker verifiers must be an array");

  return Object.freeze({
    async execute(rawOrder, rawContext) {
      const order = parseQaWorkOrder(rawOrder);
      const context = QaContextSchema.parse(rawContext);
      assertContextMatchesOrder(order, context);

      const harness = createHarness({
        strategy,
        verifiers,
        environment: {
          async observe({ candidate }) {
            return {
              candidate,
              artifacts: context.artifacts.map(({ ref, path, sourceRef }) => ({ ref, path: path ?? null, sourceRef }))
            };
          },
          async act() {
            throw new Error("QaWorker is non-mutating and cannot invoke environment actions");
          }
        },
        objective: {
          async evaluate({ candidate }) {
            const unchanged = candidate.version === order.upstream.revision;
            return {
              validity: EvaluationValidity.VALID,
              verdict: unchanged ? EvaluationVerdict.PASS : EvaluationVerdict.FAIL,
              evidence: [
                unchanged
                  ? `qa-target-unchanged:${candidate.version}`
                  : `qa-target-mutated:${order.upstream.revision}->${candidate.version}`
              ]
            };
          }
        }
      });

      const sessionId = `qa:${order.id}`;
      await harness.start({
        sessionId,
        work: {
          kind: "QA",
          order,
          context
        },
        seedCandidate: {
          id: `qa-target:${order.upstream.workOrderId}`,
          version: order.upstream.revision
        }
      });

      const variation = await harness.vary(sessionId, { problem: order.task });
      invariant(variation.failure == null, `QaWorker ExHarness execution failed: ${variation.failure?.message ?? "unknown failure"}`);
      invariant(!variation.lineage.advanced, "QaWorker cannot advance ExHarness lineage for the inspected Backend revision");

      const inspectedArtifacts = context.artifacts.map(({ ref, path }) => ({ ...(path == null ? {} : { path }), ref }));
      const claimed = QaWorkResultSchema.parse({
        ...variation.result,
        inspectedArtifacts,
        evidence: []
      });

      const evaluations = await harness.evaluations(sessionId);
      const latestEvaluation = evaluations.at(-1) ?? null;
      if (claimed.status === QaWorkStatus.VERIFIED || claimed.status === QaWorkStatus.ISSUES_FOUND) {
        invariant(latestEvaluation?.verdict === EvaluationVerdict.PASS, `${claimed.status} QaWorkResult requires a passing non-mutation evaluation`);
        invariant(claimed.verifiedRevision === order.upstream.revision, `${claimed.status} QaWorkResult verifiedRevision must match the inspected Backend revision`);
      }

      const subject = qaSubject(order, context);
      const environment = qaEnvironment(order, context);
      const verifications = await harness.verifications(sessionId, { currentCandidateOnly: true });
      const evidence = verifications.map((verification) => evidenceFromVerificationArtifact(verification, {
        subject,
        environment
      }));

      return QaWorkResultSchema.parse({
        ...claimed,
        inspectedArtifacts,
        evidence
      });
    }
  });
}
