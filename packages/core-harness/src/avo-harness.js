import { invariant, sameCandidate } from "./contracts.js";
import { defineContextSelection } from "./context.js";
import { createCoreHarness } from "./core-harness.js";
import { createAgentRuntime, defineCapability } from "./agent-runtime.js";
import { assertEvaluationInputsFresh } from "./evaluation-freshness.js";
import { createMemoryFacade } from "./memory.js";
import {
  VerificationSourceKind,
  defineVerifier,
  verificationCapabilityName
} from "./verification.js";
import {
  createVerificationAwareObjective,
  defineVerificationPolicy
} from "./verification-assessment.js";
import {
  AgentRunErrorCode,
  VariationClosedAfterCommitError,
  VariationTermination,
  defineVariationPolicy
} from "./variation.js";

export const AVOCapability = Object.freeze({
  OBSERVE: "avo.observe",
  ACT: "avo.act",
  EVALUATE: "avo.evaluate",
  QUERY_FEEDBACK: "avo.queryFeedback",
  QUERY_KNOWLEDGE: "avo.queryKnowledge",
  RECORD_KNOWLEDGE: "avo.recordKnowledge",
  PROMOTE: "avo.promote"
});

function createVerificationCapabilities(core, sessionId, verifiers) {
  return verifiers.map((verifier) => {
    const capabilityName = verificationCapabilityName(verifier.name);

    return defineCapability({
      name: capabilityName,
      description: verifier.description ?? `Run objective verification: ${verifier.name}`,
      mutatesCandidate: false,
      async execute(request) {
        const state = await core.workState(sessionId);
        const candidate = structuredClone(state.currentCandidate);
        const observations = await core.observations(sessionId, { currentCandidateOnly: true });
        const previousVerifications = await core.verifications(sessionId, { currentCandidateOnly: true });

        const raw = await verifier.verify({
          sessionId,
          work: structuredClone(state.work),
          candidate: structuredClone(candidate),
          observations,
          previousVerifications,
          request: structuredClone(request)
        });

        invariant(raw && typeof raw === "object", `verifier ${verifier.name} must return a verification result`);

        return core.recordVerification(sessionId, {
          ...structuredClone(raw),
          candidate,
          request: structuredClone(request),
          source: {
            kind: VerificationSourceKind.CAPABILITY,
            name: capabilityName
          }
        });
      }
    });
  });
}

async function promoteWithFreshEvaluationInputs(core, sessionId) {
  const state = await core.workState(sessionId);
  assertEvaluationInputsFresh(state);
  return core.promote(sessionId);
}

function createSessionCapabilities(core, memory, sessionId, verifiers, promote, onPromoted) {
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
      description: "Judge the current candidate against the objective using current observations and verification artifacts.",
      mutatesCandidate: false,
      execute: (request) => core.evaluate(sessionId, request)
    }),
    defineCapability({
      name: AVOCapability.QUERY_FEEDBACK,
      description: "Query grounded execution and evaluation feedback projected from persistent state.",
      mutatesCandidate: false,
      execute: (query) => memory.feedback(sessionId, query ?? {})
    }),
    defineCapability({
      name: AVOCapability.QUERY_KNOWLEDGE,
      description: "Query active curated knowledge without dumping the full memory history into context.",
      mutatesCandidate: false,
      execute: (query) => memory.knowledgeView(sessionId, query ?? {})
    }),
    defineCapability({
      name: AVOCapability.RECORD_KNOWLEDGE,
      description: "Persist curated knowledge with explicit scope, provenance references, and typed relations.",
      mutatesCandidate: false,
      execute: (record) => memory.recordKnowledge(sessionId, record)
    }),
    defineCapability({
      name: AVOCapability.PROMOTE,
      description: "Commit the current candidate to lineage and terminate variation capability activity. Core invariants require a fresh valid PASS evaluation over the current observation and verification snapshot.",
      mutatesCandidate: false,
      async execute() {
        const promotion = await promote(sessionId);
        onPromoted(promotion);
        return promotion;
      }
    }),
    ...createVerificationCapabilities(core, sessionId, verifiers)
  ]);
}

function serializeFailure(error) {
  if (!error) return null;
  return Object.freeze({
    name: error.name ?? "Error",
    message: error.message ?? String(error),
    code: error.code ?? null,
    attemptedCapability: error.attemptedCapability ?? null
  });
}

export function createAVOHarness({
  agent = null,
  strategy = null,
  capabilities = [],
  contextBlocks = [],
  contextPolicy = {},
  contextSelection = {},
  verifiers = [],
  verificationPolicy = {},
  variationPolicy = {},
  searchInvestmentController = null,
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
  const baseObjective = objective ?? evaluator;
  invariant(baseObjective && typeof baseObjective.evaluate === "function", "AVO harness requires objective.evaluate()");
  if (searchInvestmentController != null) {
    invariant(typeof searchInvestmentController.assertCanContinue === "function", "search investment controller requires assertCanContinue()");
    invariant(typeof searchInvestmentController.assess === "function", "search investment controller requires assess()");
  }

  const normalizedVerificationPolicy = defineVerificationPolicy(verificationPolicy);
  const normalizedVariationPolicy = defineVariationPolicy(variationPolicy);
  const resolvedContextSelection = defineContextSelection(contextSelection);
  const resolvedObjective = createVerificationAwareObjective({
    objective: baseObjective,
    policy: normalizedVerificationPolicy
  });

  const normalizedVerifiers = verifiers.map(defineVerifier);
  const verifierNames = new Set();
  for (const verifier of normalizedVerifiers) {
    invariant(!verifierNames.has(verifier.name), `duplicate verifier: ${verifier.name}`);
    verifierNames.add(verifier.name);
  }

  const agentRuntime = agent ?? createAgentRuntime({
    strategy,
    capabilities,
    contextBlocks,
    contextPolicy
  });
  invariant(agentRuntime && typeof agentRuntime.run === "function", "AVO harness requires agent.run()");
  invariant(
    typeof agentRuntime.runWithReport === "function",
    "AVO variation semantics require agent.runWithReport() for bounded capability accounting"
  );

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
  const memory = createMemoryFacade(core);
  const promote = (sessionId) => promoteWithFreshEvaluationInputs(core, sessionId);

  return Object.freeze({
    ...core,
    promote,
    recordKnowledge: memory.recordKnowledge,
    knowledgeView: memory.knowledgeView,
    feedback: memory.feedback,

    verifiers() {
      return Object.freeze(normalizedVerifiers.map((verifier) => Object.freeze({
        name: verifier.name,
        description: verifier.description,
        capability: verificationCapabilityName(verifier.name)
      })));
    },

    verificationPolicy() {
      return structuredClone(normalizedVerificationPolicy);
    },

    variationPolicy() {
      return structuredClone(normalizedVariationPolicy);
    },

    searchInvestmentPolicy() {
      return structuredClone(searchInvestmentController?.policy ?? null);
    },

    async assessSearchInvestment(sessionId) {
      return searchInvestmentController?.assess(sessionId) ?? null;
    },

    async searchInvestmentStatus(sessionId, options = {}) {
      return searchInvestmentController?.current(sessionId, options) ?? null;
    },

    async vary(sessionId, { problem = null, input = null } = {}) {
      const priorSearchInvestment = searchInvestmentController
        ? await searchInvestmentController.assertCanContinue(sessionId)
        : null;
      const context = await core.context(sessionId, { problem });
      const lineageBefore = structuredClone(context.indexes.lineage.head);
      const variation = await core.beginVariation(sessionId, {
        problem,
        request: input,
        policy: normalizedVariationPolicy
      });

      let capabilityCalls = 0;
      let committed = false;
      let protocolViolation = null;
      let result = null;
      let failure = null;
      let termination = VariationTermination.RETURNED;

      try {
        const report = await agentRuntime.runWithReport({
          input: Object.freeze({
            sessionId,
            variationId: variation.id,
            work: structuredClone(context.work),
            candidate: structuredClone(variation.baseCandidate),
            lineageHead: structuredClone(lineageBefore),
            memory: Object.freeze({
              feedbackCapability: AVOCapability.QUERY_FEEDBACK,
              knowledgeCapability: AVOCapability.QUERY_KNOWLEDGE,
              recordKnowledgeCapability: AVOCapability.RECORD_KNOWLEDGE
            }),
            verifiers: normalizedVerifiers.map((verifier) => Object.freeze({
              name: verifier.name,
              capability: verificationCapabilityName(verifier.name)
            })),
            verificationPolicy: structuredClone(normalizedVerificationPolicy),
            variationPolicy: structuredClone(normalizedVariationPolicy),
            searchInvestment: structuredClone(priorSearchInvestment),
            request: structuredClone(input)
          }),
          context,
          contextSelection: resolvedContextSelection,
          capabilities: createSessionCapabilities(
            core,
            memory,
            sessionId,
            normalizedVerifiers,
            promote,
            () => { committed = true; }
          ),
          budget: normalizedVariationPolicy,
          async onCapabilityInvoke(call) {
            capabilityCalls = call.index;
            if (committed) {
              const error = new VariationClosedAfterCommitError({ attemptedCapability: call.name });
              protocolViolation = serializeFailure(error);
              throw error;
            }
          }
        });

        result = report.result;
        capabilityCalls = report.usage.capabilityCalls;

        if (protocolViolation) {
          failure = protocolViolation;
          termination = VariationTermination.FAILED;
        } else if (report.usage.budgetExhausted) {
          termination = VariationTermination.BUDGET_EXHAUSTED;
        }
      } catch (error) {
        failure = protocolViolation ?? serializeFailure(error);
        termination = error?.code === AgentRunErrorCode.CAPABILITY_BUDGET_EXHAUSTED
          ? VariationTermination.BUDGET_EXHAUSTED
          : VariationTermination.FAILED;
      }

      const completedVariation = await core.completeVariation(sessionId, variation.id, {
        termination,
        capabilityCalls,
        failure
      });
      const searchInvestment = searchInvestmentController
        ? await searchInvestmentController.assess(sessionId)
        : null;
      const after = await core.resume(sessionId);
      const lineageAfter = structuredClone(after.progress.lineage.head);
      const lineageAdvanced = Boolean(
        lineageBefore &&
        lineageAfter &&
        !sameCandidate(lineageBefore.candidate, lineageAfter.candidate)
      );

      return Object.freeze({
        sessionId,
        variation: completedVariation,
        before: structuredClone(variation.baseCandidate),
        after: structuredClone(after.candidate),
        lineage: Object.freeze({
          before: lineageBefore,
          after: lineageAfter,
          advanced: lineageAdvanced
        }),
        lineageHead: lineageAfter,
        searchInvestment: structuredClone(searchInvestment),
        result: structuredClone(result),
        failure: structuredClone(failure)
      });
    }
  });
}
