import {
  TrustBoundary,
  createDecisionArtifact,
  policyRefFromValue,
  validateTrustBundle
} from "../../core-harness/src/index.js";
import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { requireTrustArtifactStore } from "./trust-artifact-store.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function sameSubject(left, right) {
  return left?.type === right?.type && left?.digest === right?.digest;
}

function boardItem(board, itemId) {
  const item = board.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function normalizeAuthority(raw, name) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${name} is required`);
  return Object.freeze({
    identity: requireText(raw.identity, `${name}.identity`),
    version: raw.version == null ? null : requireText(raw.version, `${name}.version`)
  });
}

export const BackendQaProjectAcceptanceReviewKey = "BACKEND_QA_PROJECT_ACCEPTANCE";

export function defineBackendQaProjectAcceptanceRequirement({
  key = BackendQaProjectAcceptanceReviewKey,
  source,
  reason,
  authorizedBy
}) {
  invariant(source === ReviewRequirementSource.PM, "Backend/QA project acceptance requirement must be PM-sourced");
  const authority = normalizeAuthority(authorizedBy, "project acceptance authorizedBy");
  return Object.freeze({
    key: requireText(key, "project acceptance requirement key"),
    source,
    reason: requireText(reason, "project acceptance requirement reason"),
    authorizedBy: authority
  });
}

function assertOrchestrator(orchestrator) {
  invariant(
    orchestrator &&
      typeof orchestrator.readBlackboard === "function" &&
      typeof orchestrator.requireReview === "function" &&
      typeof orchestrator.beginReview === "function" &&
      typeof orchestrator.recoverReview === "function" &&
      typeof orchestrator.recordAssessment === "function",
    "project acceptance requires review-capable ApplicationOrchestrator"
  );
  return orchestrator;
}

function assertArtifactReader(reader) {
  invariant(reader && typeof reader.readArtifact === "function", "project acceptance requires application artifactReader.readArtifact()");
  return reader;
}

function assertVerifier(verifier) {
  invariant(verifier && typeof verifier.verify === "function", "project acceptance requires verifier.verify()");
  return verifier;
}

function assertEvaluator(evaluator) {
  invariant(evaluator && typeof evaluator.evaluate === "function", "project acceptance requires evaluator.evaluate()");
  return evaluator;
}

function assertIssuer(issuer) {
  invariant(issuer && typeof issuer.issue === "function" && issuer.issuer, "project acceptance requires Core attestation issuer");
  return issuer;
}

async function persistEvidence(store, evidence) {
  invariant(Array.isArray(evidence), "completion evidence must be an array");
  const refs = [];
  for (const artifact of evidence) refs.push(await store.putEvidence(artifact));
  return refs;
}

function manifestSet(refs) {
  return new Set(refs.map((ref) => `${ref.id}:${ref.digest}`));
}

function assertManifestMatches(decision, refs, label) {
  const expected = decision?.evidenceManifest?.refs ?? [];
  const actualSet = manifestSet(refs);
  const expectedSet = manifestSet(expected);
  invariant(actualSet.size === expectedSet.size, `${label} persisted evidence does not match decision manifest`);
  invariant([...actualSet].every((ref) => expectedSet.has(ref)), `${label} persisted evidence does not match decision manifest`);
}

async function persistCompletionArtifacts(store, { decision, evidence, label }) {
  invariant(decision && typeof decision === "object", `${label} completion decision is required`);
  const evidenceRefs = await persistEvidence(store, evidence);
  assertManifestMatches(decision, evidenceRefs, label);
  const decisionRef = await store.putDecision(decision);
  return freezeClone({ decisionRef, evidenceRefs });
}

async function resolveDecisionBundle(store, ref, label) {
  const decision = await store.readDecision(ref);
  const evidence = [];
  for (const evidenceRef of decision.evidenceManifest.refs) {
    evidence.push(await store.readEvidence(evidenceRef));
  }
  assertManifestMatches(decision, evidence.map((artifact) => ({ id: artifact.id, digest: artifact.digest })), label);
  return freezeClone({ decision, evidence });
}

function normalizeEvaluation(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "project review evaluator must return an evaluation object");
  invariant(Array.isArray(raw.claims ?? []), "project review evaluation claims must be an array");
  invariant(Array.isArray(raw.unresolved ?? []), "project review evaluation unresolved must be an array");
  invariant(Array.isArray(raw.findings ?? []), "project review evaluation findings must be an array");
  return freezeClone({
    verdict: requireText(raw.verdict, "project review evaluation verdict"),
    claims: raw.claims ?? [],
    unresolved: raw.unresolved ?? [],
    findings: (raw.findings ?? []).map((finding, index) => requireText(finding, `project review evaluation findings[${index}]`)),
    metadata: raw.metadata == null ? null : raw.metadata
  });
}

export function createBackendQaProjectAcceptanceController({
  orchestrator,
  trustArtifactStore,
  artifactReader,
  requirement,
  reviewer,
  verifier,
  evaluator,
  attestationIssuer,
  acceptancePolicy,
  attestationEnvironment,
  now = () => new Date().toISOString()
}) {
  const appOrchestrator = assertOrchestrator(orchestrator);
  const store = requireTrustArtifactStore(trustArtifactStore);
  const appArtifacts = assertArtifactReader(artifactReader);
  const requiredReview = defineBackendQaProjectAcceptanceRequirement(requirement);
  const reviewerAuthority = normalizeAuthority(reviewer, "project acceptance reviewer");
  const projectVerifier = assertVerifier(verifier);
  const projectEvaluator = assertEvaluator(evaluator);
  const issuer = assertIssuer(attestationIssuer);
  invariant(acceptancePolicy && typeof acceptancePolicy === "object" && !Array.isArray(acceptancePolicy), "project acceptance policy is required");
  invariant(attestationEnvironment && typeof attestationEnvironment === "object", "project acceptance attestation environment is required");
  invariant(typeof now === "function", "project acceptance now must be a function");

  async function persistRoleCompletion({ decision, evidence, label = "role" }) {
    invariant(decision && typeof decision === "object", `${label} completion decision is required`);
    if (decision.verdict !== "ACCEPT") return null;
    return persistCompletionArtifacts(store, { decision, evidence, label });
  }

  async function ensureRequirement({ itemId }) {
    requireText(itemId, "itemId");
    const item = boardItem(await appOrchestrator.readBlackboard(), itemId);
    const existing = item.reviewRequirements.find((candidate) => candidate.key === requiredReview.key) ?? null;
    if (existing != null) {
      invariant(existing.source === requiredReview.source, `project acceptance review ${requiredReview.key} source changed`);
      invariant(existing.reason === requiredReview.reason, `project acceptance review ${requiredReview.key} reason changed`);
      return freezeClone(existing);
    }
    const result = await appOrchestrator.requireReview({
      itemId,
      key: requiredReview.key,
      source: requiredReview.source,
      reason: requiredReview.reason
    });
    return freezeClone(result.result.reviewRequirements.find((candidate) => candidate.key === requiredReview.key));
  }

  async function resolveSubmissionInputs(item) {
    invariant(item.submission?.stage === "QA_COMPLETED", `project acceptance requires QA_COMPLETED submission for ${item.id}`);
    const backend = await resolveDecisionBundle(store, item.submission.backendAcceptanceDecision, "Backend");
    const qa = await resolveDecisionBundle(store, item.submission.qaAcceptanceDecision, "QA");
    const applicationArtifacts = [];
    for (const ref of item.submission.artifactRefs ?? []) {
      const artifact = await appArtifacts.readArtifact({ ref });
      applicationArtifacts.push(freezeClone({ ref, artifact }));
    }
    return freezeClone({ backend, qa, applicationArtifacts });
  }

  async function prepare({ itemId }) {
    requireText(itemId, "itemId");
    const item = boardItem(await appOrchestrator.readBlackboard(), itemId);
    invariant(item.status === BlackboardStatus.PENDING_REVIEW, `project acceptance preparation requires PENDING_REVIEW item; found ${item.status}`);
    const declared = item.reviewRequirements.find((candidate) => candidate.key === requiredReview.key);
    invariant(declared, `project acceptance review requirement is missing: ${requiredReview.key}`);
    invariant(declared.source === ReviewRequirementSource.PM, "project acceptance review requirement is not PM-sourced");
    const inputs = await resolveSubmissionInputs(item);
    return freezeClone({ item, requirement: declared, ...inputs });
  }

  async function executeReview({ itemId, recoveryReason = null }) {
    requireText(itemId, "itemId");
    const before = boardItem(await appOrchestrator.readBlackboard(), itemId);
    let prepared;
    let activeReview;

    if (before.status === BlackboardStatus.REVIEWING) {
      invariant(recoveryReason != null, "project acceptance active review requires explicit recoveryReason");
      const inputs = await resolveSubmissionInputs(before);
      const declared = before.reviewRequirements.find((candidate) => candidate.key === requiredReview.key);
      invariant(declared, `project acceptance review requirement is missing: ${requiredReview.key}`);
      prepared = freezeClone({ item: before, requirement: declared, ...inputs });
      const recovered = await appOrchestrator.recoverReview({
        itemId,
        key: requiredReview.key,
        reviewer: reviewerAuthority.identity,
        reason: requireText(recoveryReason, "recoveryReason")
      });
      activeReview = recovered.result;
    } else {
      prepared = await prepare({ itemId });
      const started = await appOrchestrator.beginReview({
        itemId,
        key: requiredReview.key,
        reviewer: reviewerAuthority.identity
      });
      activeReview = started.result;
    }

    const evidence = await projectVerifier.verify(freezeClone({
      itemId,
      subject: activeReview.subject,
      submission: prepared.item.submission,
      backend: prepared.backend,
      qa: prepared.qa,
      applicationArtifacts: prepared.applicationArtifacts,
      requirement: prepared.requirement
    }));
    invariant(Array.isArray(evidence) && evidence.length > 0, "project acceptance verifier must return grounded evidence artifacts");
    for (const artifact of evidence) {
      invariant(sameSubject(artifact.subject, activeReview.subject), "project acceptance verifier evidence subject mismatch");
    }

    const evaluation = normalizeEvaluation(await projectEvaluator.evaluate(freezeClone({
      itemId,
      subject: activeReview.subject,
      submission: prepared.item.submission,
      backend: prepared.backend,
      qa: prepared.qa,
      applicationArtifacts: prepared.applicationArtifacts,
      evidence,
      requirement: prepared.requirement
    })));

    const decision = createDecisionArtifact({
      subject: activeReview.subject,
      boundary: TrustBoundary.ACCEPTANCE,
      policy: policyRefFromValue("backend-qa-project-acceptance-policy", acceptancePolicy, { version: "1" }),
      evaluator: {
        identity: reviewerAuthority.identity,
        version: reviewerAuthority.version,
        roles: ["reviewer"]
      },
      evidence,
      claims: evaluation.claims,
      unresolved: evaluation.unresolved,
      verdict: evaluation.verdict,
      generatedAt: now(),
      metadata: {
        ...(evaluation.metadata ?? {}),
        findings: evaluation.findings,
        pmRequirementAuthority: requiredReview.authorizedBy
      }
    });

    const attestation = await issuer.issue({
      decision,
      environment: attestationEnvironment,
      issuedAt: now()
    });
    const bundle = validateTrustBundle({ evidence, decision, attestation });

    for (const artifact of bundle.evidence) await store.putEvidence(artifact);
    await store.putDecision(bundle.decision);
    await store.putAttestation(bundle.attestation);

    const assessed = await appOrchestrator.recordAssessment({
      itemId,
      key: requiredReview.key,
      bundle
    });

    return freezeClone({
      item: assessed.result,
      review: activeReview,
      evidence: bundle.evidence.map((artifact) => ({ id: artifact.id, digest: artifact.digest })),
      decision: { id: bundle.decision.id, digest: bundle.decision.digest },
      attestation: { id: bundle.attestation.id, digest: bundle.attestation.digest }
    });
  }

  return Object.freeze({
    requirement: requiredReview,
    persistRoleCompletion,
    ensureRequirement,
    prepare,
    review({ itemId }) {
      return executeReview({ itemId });
    },
    recoverReview({ itemId, reason }) {
      return executeReview({ itemId, recoveryReason: reason });
    }
  });
}
