import {
  EvaluationValidity,
  EvaluationVerdict,
  createHarness
} from "../../core-harness/src/index.js";
import {
  BackendContextSchema,
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

export function createBackendWorker({ strategy, workspace }) {
  invariant(strategy && typeof strategy.run === "function", "BackendWorker requires strategy.run()");
  invariant(workspace && typeof workspace.act === "function", "BackendWorker requires workspace.act()");

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

      const result = BackendWorkResultSchema.parse(variation.result);

      if (result.status === BackendWorkStatus.APPLIED) {
        invariant(variation.lineage.advanced, "APPLIED BackendWorkResult requires ExHarness lineage promotion");
        invariant(variation.after.version === result.revision, "APPLIED BackendWorkResult revision must match ExHarness candidate");
      } else {
        invariant(!variation.lineage.advanced, `${result.status} BackendWorkResult cannot advance ExHarness lineage`);
      }

      return result;
    }
  });
}
