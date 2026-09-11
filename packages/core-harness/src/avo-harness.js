import { candidateKey, invariant, sameCandidate } from "./contracts.js";
import { createCoreHarness } from "./core-harness.js";
import { createAgentRuntime, defineCapability } from "./agent-runtime.js";
import {
  VerificationSourceKind,
  defineVerifier,
  verificationCapabilityName
} from "./verification.js";
import {
  createVerificationAwareObjective,
  defineVerificationPolicy
} from "./verification-assessment.js";

export const AVOCapability = Object.freeze({
  OBSERVE: "avo.observe",
  ACT: "avo.act",
  EVALUATE: "avo.evaluate",
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

function sameArtifactSnapshot(evaluatedIds, currentIds) {
  if (evaluatedIds.length !== currentIds.length) return false;
  return evaluatedIds.every((id, index) => id === currentIds[index]);
}

async function promoteWithFreshVerification(core, sessionId) {
  const state = await core.workState(sessionId);
  const key = candidateKey(state.currentCandidate);
  const evaluation = [...state.persistentMemory.evaluations]
    .reverse()
    .find((item) => candidateKey(item.candidate) === key) ?? null;

  invariant(evaluation, "current candidate has not been evaluated");

  const currentVerificationIds = state.persistentMemory.verifications
    .filter((item) => candidateKey(item.candidate) === key)
    .map((item) => item.id);
  const evaluatedVerificationIds = [...(evaluation.verificationIds ?? [])];

  invariant(
    sameArtifactSnapshot(evaluatedVerificationIds, currentVerificationIds),
    "verification artifacts changed since evaluation; re-evaluate before promotion"
  );

  return core.promote(sessionId);
}

function createSessionCapabilities(core, sessionId, verifiers, promote) {
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
      name: AVOCapability.RECORD_KNOWLEDGE,
      description: "Persist an explicit hypothesis, finding, failed direction, or decision.",
      mutatesCandidate: false,
      execute: (record) => core.recordKnowledge(sessionId, record)
    }),
    defineCapability({
      name: AVOCapability.PROMOTE,
      description: "Commit the current candidate to lineage. Core invariants require a fresh valid PASS evaluation over the current verification snapshot.",
      mutatesCandidate: false,
      execute: () => promote(sessionId)
    }),
    ...createVerificationCapabilities(core, sessionId, verifiers)
  ]);
}

export function createAVOHarness({
  agent = null,
  strategy = null,
  capabilities = [],
  verifiers = [],
  verificationPolicy = {},
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

  const normalizedVerificationPolicy = defineVerificationPolicy(verificationPolicy);
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
  const promote = (sessionId) => promoteWithFreshVerification(core, sessionId);

  return Object.freeze({
    ...core,
    promote,

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
          verifiers: normalizedVerifiers.map((verifier) => Object.freeze({
            name: verifier.name,
            capability: verificationCapabilityName(verifier.name)
          })),
          verificationPolicy: structuredClone(normalizedVerificationPolicy),
          request: structuredClone(input)
        }),
        context,
        capabilities: createSessionCapabilities(core, sessionId, normalizedVerifiers, promote)
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
