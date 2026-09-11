import { invariant, sameCandidate } from "./contracts.js";
import { createCoreHarness } from "./core-harness.js";
import { createAgentRuntime, defineCapability } from "./agent-runtime.js";

export const AVOCapability = Object.freeze({
  OBSERVE: "avo.observe",
  ACT: "avo.act",
  EVALUATE: "avo.evaluate",
  RECORD_KNOWLEDGE: "avo.recordKnowledge",
  PROMOTE: "avo.promote"
});

function createSessionCapabilities(core, sessionId) {
  return Object.freeze([
    defineCapability({
      name: AVOCapability.OBSERVE,
      description: "Inspect the current candidate or environment without mutating candidate state.",
      mutatesCandidate: false,
      execute: (request) => core.observe(sessionId, request)
    }),
    defineCapability({
      name: AVOCapability.ACT,
      description: "Act on the environment. A mutating result must produce a new candidate version.",
      mutatesCandidate: true,
      execute: (action) => core.act(sessionId, action)
    }),
    defineCapability({
      name: AVOCapability.EVALUATE,
      description: "Evaluate the current candidate against the injected objective.",
      mutatesCandidate: false,
      execute: (request) => core.evaluate(sessionId, request)
    }),
    defineCapability({
      name: AVOCapability.RECORD_KNOWLEDGE,
      description: "Persist an explicit hypothesis, finding, failed direction, or decision.",
      mutatesCandidate: false,
      execute: (record) => core.recordKnowledge(sessionId, record)
    }),
    defineCapability({
      name: AVOCapability.PROMOTE,
      description: "Commit the current candidate to lineage. Core invariants require a fresh valid PASS.",
      mutatesCandidate: false,
      execute: () => core.promote(sessionId)
    })
  ]);
}

export function createAVOHarness({
  agent = null,
  strategy = null,
  capabilities = [],
  objective = null,
  evaluator = null,
  environment,
  sessionStore,
  supervisor,
  contextProjector,
  dosagePolicy,
  clock,
  idFactory
}) {
  const resolvedObjective = objective ?? evaluator;
  invariant(resolvedObjective && typeof resolvedObjective.evaluate === "function", "AVO harness requires objective.evaluate()");

  const agentRuntime = agent ?? createAgentRuntime({ strategy, capabilities });
  invariant(agentRuntime && typeof agentRuntime.run === "function", "AVO harness requires agent.run()");

  const core = createCoreHarness({
    environment,
    evaluator: resolvedObjective,
    sessionStore,
    supervisor,
    contextProjector,
    dosagePolicy,
    clock,
    idFactory
  });

  return Object.freeze({
    ...core,

    async vary(sessionId, { problem = null, input = null } = {}) {
      const context = await core.context(sessionId, { problem });
      const before = structuredClone(context.candidate);
      const lineageBefore = structuredClone(context.indexes.lineage.head);

      const result = await agentRuntime.run({
        input: Object.freeze({
          sessionId,
          work: structuredClone(context.work),
          candidate: structuredClone(before),
          lineageHead: structuredClone(lineageBefore),
          request: structuredClone(input)
        }),
        context,
        capabilities: createSessionCapabilities(core, sessionId)
      });

      const after = await core.resume(sessionId);
      const lineageAfter = structuredClone(after.progress.lineage.head);
      const lineageAdvanced = Boolean(
        lineageBefore &&
        lineageAfter &&
        !sameCandidate(lineageBefore.candidate, lineageAfter.candidate)
      );

      return Object.freeze({
        sessionId,
        before,
        after: structuredClone(after.candidate),
        lineage: Object.freeze({
          before: lineageBefore,
          after: lineageAfter,
          advanced: lineageAdvanced
        }),
        lineageHead: lineageAfter,
        result: structuredClone(result)
      });
    }
  });
}
