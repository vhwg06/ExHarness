import { createHash } from "node:crypto";

import { canonicalize, digestValue, evaluateTrustBoundary } from "../../core-harness/src/index.js";
import { defineHowEvolutionEvaluationProtocol, HowEvolutionVerdict } from "./how-evolution.js";

export const HOW_EVOLUTION_JEV_ADAPTER_IDENTITY = "how-evolution-jev-adapter";
export const HOW_EVOLUTION_JEV_ADAPTER_REVISION = "1";
export const HOW_EVOLUTION_JEV_MODEL_SNAPSHOT = "jev-1.13.0";
export const HOW_EVOLUTION_JEV_PROVIDER_ENDPOINT_CLASS = "typesafe-systemone";
export const HOW_EVOLUTION_JEV_QUESTION_IDS = Object.freeze([
  "semantic-preservation",
  "how-improvement",
  "evidence-sufficiency"
]);

const inv = (condition, message) => {
  if (!condition) throw new TypeError(message);
};
const txt = (value, name) => {
  inv(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
};
const fr = (value) => Object.freeze(structuredClone(value));

function requestFor({ protocol, evidence }) {
  const evidenceRefs = [...(evidence?.evidenceRefs ?? [])].map((ref) => txt(ref, "evidence ref")).sort();
  inv(evidenceRefs.length > 0, "Jev adapter requires at least one evidence ref");
  const evidenceDigests = [...(evidence?.evidenceDigests ?? evidenceRefs)].map((entry) => txt(entry, "evidence digest"));
  const request = {
    adapter: HOW_EVOLUTION_JEV_ADAPTER_IDENTITY,
    adapterRevision: HOW_EVOLUTION_JEV_ADAPTER_REVISION,
    protocolDigest: digestValue(protocol),
    workContractRef: protocol.workContract.ref,
    workContractDigest: protocol.workContract.digest,
    acceptanceRefs: protocol.acceptanceRefs,
    baselineStrategyRef: protocol.baselineStrategy.ref,
    candidateStrategyRef: protocol.candidateStrategy.ref,
    semanticPolicyRef: protocol.evaluator.policyRef,
    semanticPolicyDigest: protocol.evaluator.policyDigest,
    questionIds: [...HOW_EVOLUTION_JEV_QUESTION_IDS],
    evidenceRefs,
    evidenceDigests,
    metricPolicy: {
      ref: protocol.metricPolicy.ref,
      primaryMetric: protocol.metricPolicy.primaryMetric,
      minEffect: protocol.metricPolicy.minEffect
    }
  };
  return fr(request);
}

function failClosedReceipt({ protocol, request, evidence, reason, modelSnapshot = null, responseHash = null }) {
  return fr({
    kind: "HOW_EVOLUTION_JEV_RECEIPT",
    version: 1,
    adapterIdentity: HOW_EVOLUTION_JEV_ADAPTER_IDENTITY,
    adapterRevision: HOW_EVOLUTION_JEV_ADAPTER_REVISION,
    providerEndpointClass: HOW_EVOLUTION_JEV_PROVIDER_ENDPOINT_CLASS,
    protocolDigest: digestValue(protocol),
    evaluatorIdentity: protocol.evaluator.identity,
    evaluatorRevision: protocol.evaluator.revision,
    evaluatorPolicyRef: protocol.evaluator.policyRef,
    evaluatorPolicyDigest: protocol.evaluator.policyDigest,
    modelSnapshot,
    semanticPolicyRef: protocol.evaluator.policyRef,
    semanticPolicyDigest: protocol.evaluator.policyDigest,
    requestHash: createHash("sha256").update(canonicalize(request)).digest("hex"),
    requestHashAlgorithm: "sha256:canonical-json",
    questionIds: [...HOW_EVOLUTION_JEV_QUESTION_IDS],
    responseModel: null,
    responseId: null,
    responseHash,
    semanticVerdict: HowEvolutionVerdict.INCONCLUSIVE,
    questionOutcomes: HOW_EVOLUTION_JEV_QUESTION_IDS.map((questionId) => Object.freeze({
      questionId,
      outcome: HowEvolutionVerdict.INCONCLUSIVE
    })),
    evidenceRefs: [...(evidence?.evidenceRefs ?? ["evidence:unavailable"])],
    failureReason: reason,
    evaluatedAt: new Date().toISOString()
  });
}

function normalizeTransportResponse(raw) {
  inv(raw && typeof raw === "object" && !Array.isArray(raw), "Jev transport response must be an object");
  return raw;
}

// Evaluate-only Jev port: Evaluator.evaluate(protocol, evidence) -> immutable
// semantic evaluation receipt. The adapter has no repository, product,
// policy-publisher, promotion or rollback capability: it exposes evaluate()
// only, reads TYPESAFE_API_KEY from the process environment, and never
// persists or returns the key.
export function createHowEvolutionJevEvaluator({
  semanticPolicyRef,
  semanticPolicyDigest,
  modelSnapshot = HOW_EVOLUTION_JEV_MODEL_SNAPSHOT,
  transport = null,
  verifyEvaluatorAuthority = null,
  verifyEvidenceAuthority = null
} = {}) {
  const pinnedPolicyRef = semanticPolicyRef == null ? null : txt(semanticPolicyRef, "Jev adapter semanticPolicyRef");
  const pinnedPolicyDigest = semanticPolicyDigest == null ? null : txt(semanticPolicyDigest, "Jev adapter semanticPolicyDigest");
  const pinnedModel = txt(modelSnapshot, "Jev adapter modelSnapshot");

  async function defaultTransport({ request }) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error("Jev transport unavailable: TYPESAFE_API_KEY is missing");
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: HOW_EVOLUTION_JEV_MODEL_SNAPSHOT, request })
    });
    if (!response.ok) throw new Error(`Jev transport HTTP ${response.status}`);
    return response.json();
  }

  const runTransport = transport ?? defaultTransport;

  async function evaluate({ protocol: rawProtocol, evidence }) {
    const protocol = defineHowEvolutionEvaluationProtocol(rawProtocol);
    if (pinnedPolicyRef != null) inv(protocol.evaluator.policyRef === pinnedPolicyRef, "Jev adapter semantic policy ref mismatch");
    if (pinnedPolicyDigest != null) inv(protocol.evaluator.policyDigest === pinnedPolicyDigest, "Jev adapter semantic policy digest mismatch");
    const request = requestFor({ protocol, evidence });
    const requestHash = createHash("sha256").update(canonicalize(request)).digest("hex");

    let raw;
    try {
      raw = normalizeTransportResponse(await runTransport({ request: fr(request) }));
    } catch {
      return failClosedReceipt({ protocol, request, evidence, reason: "TRANSPORT_ERROR" });
    }

    try {
      inv(raw.model === pinnedModel, "Jev adapter unexpected model snapshot");
      inv(raw.policyRef === protocol.evaluator.policyRef, "Jev adapter unexpected semantic policy ref");
      inv(raw.policyDigest === protocol.evaluator.policyDigest, "Jev adapter unexpected semantic policy digest");
      inv(typeof raw.responseId === "string" && raw.responseId.length > 0, "Jev adapter response id missing");
      inv(Array.isArray(raw.outcomes) && raw.outcomes.length === HOW_EVOLUTION_JEV_QUESTION_IDS.length,
        "Jev adapter outcomes must cover every typed question id");
      const byId = new Map(raw.outcomes.map((entry) => [entry?.questionId, entry]));
      for (const questionId of HOW_EVOLUTION_JEV_QUESTION_IDS) {
        const outcome = byId.get(questionId);
        inv(outcome && Object.values(HowEvolutionVerdict).includes(outcome.outcome),
          `Jev adapter missing atomic outcome: ${questionId}`);
      }
      const questionOutcomes = HOW_EVOLUTION_JEV_QUESTION_IDS.map((questionId) => Object.freeze({
        questionId,
        outcome: byId.get(questionId).outcome
      }));
      const semanticVerdict = questionOutcomes.every((entry) => entry.outcome === HowEvolutionVerdict.PASS)
        ? HowEvolutionVerdict.PASS
        : questionOutcomes.some((entry) => entry.outcome === HowEvolutionVerdict.FAIL)
          ? HowEvolutionVerdict.FAIL
          : HowEvolutionVerdict.INCONCLUSIVE;
      const responseHash = createHash("sha256").update(canonicalize(raw)).digest("hex");

      if (typeof verifyEvaluatorAuthority === "function" || typeof verifyEvidenceAuthority === "function") {
        const boundary = await evaluateTrustBoundary({
          attestation: {
            id: raw.responseId,
            digest: responseHash,
            boundary: "COORDINATION",
            issuer: { identity: protocol.evaluator.identity },
            subject: { type: "how-evolution-protocol", digest: digestValue(protocol) },
            policy: { name: protocol.evaluator.policyRef, digest: protocol.evaluator.policyDigest }
          },
          decision: {
            evaluator: { identity: protocol.evaluator.identity },
            policy: { name: protocol.evaluator.policyRef, digest: protocol.evaluator.policyDigest }
          },
          evidence: (evidence?.evidenceRefs ?? []).map((ref) => ({
            id: ref,
            producer: { identity: evidence?.producerIdentity ?? protocol.candidateProducer },
            environment: { digest: evidence?.environmentDigest ?? "sha256:" + "0".repeat(64) }
          })),
          currentSubject: { type: "how-evolution-protocol", digest: digestValue(protocol) },
          policy: {},
          verifyEvaluatorAuthority: verifyEvaluatorAuthority ?? (async () => true),
          verifyEvidenceAuthority: verifyEvidenceAuthority ?? (async () => true)
        });
        if (!boundary.trusted) {
          return failClosedReceipt({ protocol, request, evidence, reason: "AUTHORITY_FAILURE", modelSnapshot: raw.model, responseHash });
        }
      }

      return fr({
        kind: "HOW_EVOLUTION_JEV_RECEIPT",
        version: 1,
        adapterIdentity: HOW_EVOLUTION_JEV_ADAPTER_IDENTITY,
        adapterRevision: HOW_EVOLUTION_JEV_ADAPTER_REVISION,
        providerEndpointClass: HOW_EVOLUTION_JEV_PROVIDER_ENDPOINT_CLASS,
        protocolDigest: digestValue(protocol),
        evaluatorIdentity: protocol.evaluator.identity,
        evaluatorRevision: protocol.evaluator.revision,
        evaluatorPolicyRef: protocol.evaluator.policyRef,
        evaluatorPolicyDigest: protocol.evaluator.policyDigest,
        modelSnapshot: raw.model,
        semanticPolicyRef: protocol.evaluator.policyRef,
        semanticPolicyDigest: protocol.evaluator.policyDigest,
        requestHash,
        requestHashAlgorithm: "sha256:canonical-json",
        questionIds: [...HOW_EVOLUTION_JEV_QUESTION_IDS],
        responseModel: raw.model,
        responseId: raw.responseId,
        responseHash,
        semanticVerdict,
        questionOutcomes,
        evidenceRefs: [...(evidence?.evidenceRefs ?? [])].sort(),
        evaluatedAt: new Date().toISOString()
      });
    } catch {
      return failClosedReceipt({ protocol, request, evidence, reason: "MALFORMED_RESPONSE", modelSnapshot: raw?.model ?? null });
    }
  }

  return Object.freeze({ evaluate });
}
