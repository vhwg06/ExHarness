import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { sessionHandoffFromBlackboard } from "./session-handoff.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function record(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function optionalText(value, name) {
  return value == null ? null : requireText(value, name);
}

function nonNegativeInteger(value, name) {
  invariant(Number.isInteger(value) && value >= 0, `${name} must be a non-negative integer`);
  return value;
}

function uniqueTextArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  const result = (value ?? []).map((entry, index) => requireText(entry, `${name}[${index}]`));
  invariant(new Set(result).size === result.length, `${name} must not contain duplicates`);
  invariant(result.length >= min, `${name} must contain at least ${min} item(s)`);
  return result;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function enumValue(value, values, name) {
  invariant(values.includes(value), `${name} is invalid`);
  return value;
}

export const ResearchContinuationKind = "RESEARCH_CONTINUATION";

export const ResearchExperimentStatus = Object.freeze({
  PLANNED: "PLANNED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  INVALIDATED: "INVALIDATED"
});

export const ResearchEvidenceStatus = Object.freeze({
  OBSERVED: "OBSERVED",
  CONFIRMED: "CONFIRMED",
  CONTRADICTED: "CONTRADICTED",
  STALE: "STALE",
  SUPERSEDED: "SUPERSEDED"
});

export const ResearchEvidenceFreshness = Object.freeze({
  CURRENT: "CURRENT",
  REASSESS_REQUIRED: "REASSESS_REQUIRED",
  NON_CURRENT: "NON_CURRENT"
});

const EXPERIMENT_STATUSES = Object.values(ResearchExperimentStatus);
const EVIDENCE_STATUSES = Object.values(ResearchEvidenceStatus);
const ALREADY_NON_CURRENT = new Set([
  ResearchEvidenceStatus.CONTRADICTED,
  ResearchEvidenceStatus.STALE,
  ResearchEvidenceStatus.SUPERSEDED
]);

function normalizeRevision(raw, name) {
  const value = record(raw, name);
  return Object.freeze({
    sourceRevision: requireText(value.sourceRevision, `${name}.sourceRevision`),
    policyRevision: optionalText(value.policyRevision, `${name}.policyRevision`)
  });
}

export function defineResearchContinuationManifest(raw) {
  const value = record(raw, "research continuation manifest");
  invariant(value.version === 1, "research continuation manifest version must be 1");
  invariant(value.kind === ResearchContinuationKind, `research continuation manifest kind must be ${ResearchContinuationKind}`);

  const manifest = {
    version: 1,
    kind: ResearchContinuationKind,
    researchId: requireText(value.researchId, "research continuation researchId"),
    questionRef: requireText(value.questionRef, "research continuation questionRef"),
    planRef: requireText(value.planRef, "research continuation planRef"),
    evidenceLedgerRef: requireText(value.evidenceLedgerRef, "research continuation evidenceLedgerRef"),
    experimentRefs: uniqueTextArray(value.experimentRefs, "research continuation experimentRefs", { min: 1 }),
    activeExperimentId: optionalText(value.activeExperimentId, "research continuation activeExperimentId"),
    sourceRevision: requireText(value.sourceRevision, "research continuation sourceRevision"),
    policyRevision: optionalText(value.policyRevision, "research continuation policyRevision"),
    nextAction: requireText(value.nextAction, "research continuation nextAction")
  };

  return freezeClone(manifest);
}

export function defineResearchExperimentState(raw) {
  const value = record(raw, "research experiment");
  const status = enumValue(value.status, EXPERIMENT_STATUSES, "research experiment status");
  const experiment = {
    id: requireText(value.id, "research experiment id"),
    status,
    sourceRevision: requireText(value.sourceRevision, "research experiment sourceRevision"),
    policyRevision: optionalText(value.policyRevision, "research experiment policyRevision"),
    sourceScopes: uniqueTextArray(value.sourceScopes ?? [], "research experiment sourceScopes"),
    policyScopes: uniqueTextArray(value.policyScopes ?? [], "research experiment policyScopes"),
    resumedFrom: optionalText(value.resumedFrom, "research experiment resumedFrom"),
    resultRefs: uniqueTextArray(value.resultRefs ?? [], "research experiment resultRefs"),
    evidenceRefs: uniqueTextArray(value.evidenceRefs ?? [], "research experiment evidenceRefs")
  };

  if (status === ResearchExperimentStatus.COMPLETED) {
    invariant(experiment.evidenceRefs.length > 0 || experiment.resultRefs.length > 0, "completed research experiment requires resultRefs or evidenceRefs");
  }

  return freezeClone(experiment);
}

function normalizeInvalidation(raw, name) {
  if (raw == null) return null;
  const value = record(raw, name);
  return Object.freeze({
    fromRevision: requireText(value.fromRevision, `${name}.fromRevision`),
    toRevision: requireText(value.toRevision, `${name}.toRevision`),
    reason: requireText(value.reason, `${name}.reason`)
  });
}

function defineResearchEvidenceEntry(raw, index) {
  const value = record(raw, `research evidence[${index}]`);
  const status = enumValue(value.status, EVIDENCE_STATUSES, `research evidence[${index}].status`);
  const invalidatedBy = normalizeInvalidation(value.invalidatedBy, `research evidence[${index}].invalidatedBy`);
  if (status === ResearchEvidenceStatus.STALE || status === ResearchEvidenceStatus.SUPERSEDED) {
    invariant(invalidatedBy != null, `research evidence[${index}] ${status} requires invalidatedBy provenance`);
  }

  return Object.freeze({
    id: requireText(value.id, `research evidence[${index}].id`),
    status,
    sourceRevision: requireText(value.sourceRevision, `research evidence[${index}].sourceRevision`),
    policyRevision: optionalText(value.policyRevision, `research evidence[${index}].policyRevision`),
    sourceScopes: uniqueTextArray(value.sourceScopes ?? [], `research evidence[${index}].sourceScopes`),
    policyScopes: uniqueTextArray(value.policyScopes ?? [], `research evidence[${index}].policyScopes`),
    observationRef: optionalText(value.observationRef, `research evidence[${index}].observationRef`),
    summary: optionalText(value.summary, `research evidence[${index}].summary`),
    supports: uniqueTextArray(value.supports ?? [], `research evidence[${index}].supports`),
    contradicts: uniqueTextArray(value.contradicts ?? [], `research evidence[${index}].contradicts`),
    invalidatedBy
  });
}

export function defineResearchEvidenceLedger(raw) {
  const value = record(raw, "research evidence ledger");
  invariant(value.kind === "EVIDENCE_LEDGER", "research evidence ledger kind must be EVIDENCE_LEDGER");
  const revision = nonNegativeInteger(value.revision, "research evidence ledger revision");
  invariant(revision > 0, "research evidence ledger revision must be greater than 0");
  invariant(Array.isArray(value.evidence), "research evidence ledger evidence must be an array");
  const evidence = value.evidence.map(defineResearchEvidenceEntry);
  invariant(new Set(evidence.map((entry) => entry.id)).size === evidence.length, "research evidence ledger ids must be unique");

  const ids = new Set(evidence.map((entry) => entry.id));
  for (const entry of evidence) {
    for (const target of entry.contradicts) {
      invariant(ids.has(target), `research evidence ${entry.id} contradicts unknown evidence ${target}`);
      invariant(target !== entry.id, `research evidence ${entry.id} cannot contradict itself`);
    }
  }

  return freezeClone({
    kind: "EVIDENCE_LEDGER",
    revision,
    supersedes: optionalText(value.supersedes, "research evidence ledger supersedes"),
    evidence
  });
}

function intersects(scopes, changed) {
  return scopes.some((scope) => changed.has(scope));
}

export function assessResearchEvidenceFreshness({
  evidenceLedger,
  currentRevision,
  changedSourceScopes = [],
  changedPolicyScopes = []
}) {
  const ledger = defineResearchEvidenceLedger(evidenceLedger);
  const revision = normalizeRevision(currentRevision, "currentRevision");
  const sourceChanges = new Set(uniqueTextArray(changedSourceScopes, "changedSourceScopes"));
  const policyChanges = new Set(uniqueTextArray(changedPolicyScopes, "changedPolicyScopes"));

  return freezeClone(ledger.evidence.map((entry) => {
    if (ALREADY_NON_CURRENT.has(entry.status)) {
      return {
        id: entry.id,
        freshness: ResearchEvidenceFreshness.NON_CURRENT,
        reasons: [`evidence status is ${entry.status}`]
      };
    }

    const reasons = [];
    if (
      entry.sourceRevision !== revision.sourceRevision &&
      intersects(entry.sourceScopes, sourceChanges)
    ) {
      reasons.push(`source revision changed for declared scope: ${entry.sourceRevision} -> ${revision.sourceRevision}`);
    }
    if (
      entry.policyRevision !== revision.policyRevision &&
      intersects(entry.policyScopes, policyChanges)
    ) {
      reasons.push(`policy revision changed for declared scope: ${entry.policyRevision ?? "<none>"} -> ${revision.policyRevision ?? "<none>"}`);
    }

    return {
      id: entry.id,
      freshness: reasons.length > 0
        ? ResearchEvidenceFreshness.REASSESS_REQUIRED
        : ResearchEvidenceFreshness.CURRENT,
      reasons
    };
  }));
}

function requireOrchestrator(orchestrator) {
  invariant(
    orchestrator &&
      typeof orchestrator.readBlackboard === "function" &&
      typeof orchestrator.checkpoint === "function" &&
      typeof orchestrator.submit === "function" &&
      typeof orchestrator.requireReview === "function",
    "research continuation requires readBlackboard/checkpoint/submit/requireReview ApplicationOrchestrator capability"
  );
  return orchestrator;
}

function requireArtifactReader(artifactReader) {
  invariant(
    artifactReader && typeof artifactReader.readArtifact === "function",
    "research continuation requires artifactReader.readArtifact()"
  );
  return artifactReader;
}

function workFromSession(session, itemId) {
  const item = session.workGraph.find((candidate) => candidate.id === itemId);
  invariant(item, `research continuation item not found: ${itemId}`);
  return item;
}

function decodedArtifact(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.prototype.hasOwnProperty.call(raw, "content") &&
    Object.prototype.hasOwnProperty.call(raw, "sourceRef")
  ) {
    return raw.content;
  }
  return raw;
}

function requiredManifestArtifactRefs(manifest) {
  return [
    manifest.questionRef,
    manifest.planRef,
    ...manifest.experimentRefs,
    manifest.evidenceLedgerRef
  ];
}

function assertContainsAll(actual, required, name) {
  const values = new Set(actual);
  for (const ref of required) invariant(values.has(ref), `${name} must include manifest ref ${ref}`);
}

export function createResearchContinuationController({
  orchestrator,
  projectId,
  artifactReader
}) {
  const app = requireOrchestrator(orchestrator);
  const reader = requireArtifactReader(artifactReader);
  const expectedProjectId = requireText(projectId, "projectId");

  async function readSession() {
    return sessionHandoffFromBlackboard(await app.readBlackboard(), { projectId: expectedProjectId });
  }

  async function readArtifact(ref) {
    return decodedArtifact(await reader.readArtifact({ ref }));
  }

  async function resume({
    itemId,
    currentRevision,
    changedSourceScopes = [],
    changedPolicyScopes = []
  }) {
    requireText(itemId, "itemId");
    const revision = normalizeRevision(currentRevision, "currentRevision");
    const session = await readSession();
    const item = workFromSession(session, itemId);
    invariant(item.checkpoint != null, `research continuation item ${itemId} has no checkpoint`);
    const manifest = defineResearchContinuationManifest(item.checkpoint);

    const [question, plan, ledgerRaw, ...experimentRaw] = await Promise.all([
      readArtifact(manifest.questionRef),
      readArtifact(manifest.planRef),
      readArtifact(manifest.evidenceLedgerRef),
      ...manifest.experimentRefs.map(readArtifact)
    ]);
    record(question, "research question artifact");
    record(plan, "research plan artifact");
    const evidenceLedger = defineResearchEvidenceLedger(ledgerRaw);
    const experiments = experimentRaw.map(defineResearchExperimentState);
    invariant(new Set(experiments.map((experiment) => experiment.id)).size === experiments.length, "research experiment ids must be unique");

    const completed = experiments.filter((experiment) => experiment.status === ResearchExperimentStatus.COMPLETED);
    const incomplete = experiments.filter((experiment) => [
      ResearchExperimentStatus.PLANNED,
      ResearchExperimentStatus.IN_PROGRESS
    ].includes(experiment.status));

    let resumeExperiment = null;
    if (manifest.activeExperimentId == null) {
      invariant(incomplete.length === 0, "research continuation has incomplete experiment but no activeExperimentId");
    } else {
      invariant(incomplete.length === 1, "research continuation must expose exactly one active/incomplete experiment");
      invariant(incomplete[0].id === manifest.activeExperimentId, `research continuation activeExperimentId does not match incomplete experiment ${incomplete[0].id}`);
      resumeExperiment = incomplete[0];
    }

    const evidenceFreshness = assessResearchEvidenceFreshness({
      evidenceLedger,
      currentRevision: revision,
      changedSourceScopes,
      changedPolicyScopes
    });

    return freezeClone({
      session,
      item,
      manifest,
      question,
      plan,
      experiments,
      evidenceLedger,
      completedExperimentIds: completed.map((experiment) => experiment.id),
      resumeExperiment,
      evidenceFreshness,
      reassessmentEvidenceIds: evidenceFreshness
        .filter((entry) => entry.freshness === ResearchEvidenceFreshness.REASSESS_REQUIRED)
        .map((entry) => entry.id),
      revisionChanged: manifest.sourceRevision !== revision.sourceRevision || manifest.policyRevision !== revision.policyRevision
    });
  }

  async function persistContinuation({
    itemId,
    owner,
    generation,
    manifest: rawManifest,
    artifactRefs,
    evidenceRefs,
    resolvedWork = [],
    status = BlackboardStatus.REOPENED,
    blockers = []
  }) {
    const manifest = defineResearchContinuationManifest(rawManifest);
    const artifacts = uniqueTextArray(artifactRefs, "artifactRefs");
    const evidence = uniqueTextArray(evidenceRefs, "evidenceRefs");
    assertContainsAll(artifacts, requiredManifestArtifactRefs(manifest), "artifactRefs");
    invariant(evidence.includes(manifest.evidenceLedgerRef), "evidenceRefs must include manifest evidenceLedgerRef");

    return app.checkpoint({
      itemId: requireText(itemId, "itemId"),
      owner: requireText(owner, "owner"),
      generation: nonNegativeInteger(generation, "generation"),
      checkpoint: manifest,
      artifactRefs: artifacts,
      evidenceRefs: evidence,
      resolvedWork: uniqueTextArray(resolvedWork, "resolvedWork"),
      status,
      blockers: uniqueTextArray(blockers, "blockers")
    });
  }

  async function submitProposal({
    itemId,
    owner,
    generation,
    resultRef,
    currentRevision,
    changedSourceScopes = [],
    changedPolicyScopes = [],
    resolvedWork = [],
    reviewKey = "research-workflow",
    reviewReason
  }) {
    const continuation = await resume({
      itemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    invariant(continuation.resumeExperiment == null, "research continuation cannot submit while an experiment remains active");
    invariant(continuation.reassessmentEvidenceIds.length === 0, `research continuation cannot submit with evidence awaiting freshness reassessment: ${continuation.reassessmentEvidenceIds.join(", ")}`);

    const normalizedResultRef = requireText(resultRef, "resultRef");
    const key = requireText(reviewKey, "reviewKey");
    const reason = requireText(reviewReason, "reviewReason");
    const artifactRefs = [...new Set([
      ...requiredManifestArtifactRefs(continuation.manifest),
      normalizedResultRef
    ])];

    const submitted = await app.submit({
      itemId: requireText(itemId, "itemId"),
      owner: requireText(owner, "owner"),
      generation: nonNegativeInteger(generation, "generation"),
      submission: {
        resultRef: normalizedResultRef,
        artifactRefs,
        evidenceRefs: [continuation.manifest.evidenceLedgerRef],
        decisionStatus: "PROPOSED",
        researchId: continuation.manifest.researchId,
        sourceRevision: continuation.manifest.sourceRevision,
        policyRevision: continuation.manifest.policyRevision
      },
      resolvedWork: uniqueTextArray(resolvedWork, "resolvedWork")
    });

    const afterSubmit = workFromSession(await readSession(), itemId);
    const existing = afterSubmit.reviewRequirements.find((requirement) => requirement.key === key) ?? null;
    if (existing == null) {
      await app.requireReview({
        itemId,
        key,
        source: ReviewRequirementSource.PM,
        reason
      });
    } else {
      invariant(existing.source === ReviewRequirementSource.PM, `research review requirement ${key} must be PM-sourced`);
      invariant(existing.reason === reason, `research review requirement ${key} reason changed`);
    }

    const finalItem = workFromSession(await readSession(), itemId);
    invariant(finalItem.status === BlackboardStatus.PENDING_REVIEW, "research proposal must remain PENDING_REVIEW after submission");
    return freezeClone({ submitted: submitted.result, item: finalItem });
  }

  return Object.freeze({
    resume,
    persistContinuation,
    submitProposal
  });
}
