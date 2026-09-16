import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { sessionHandoffFromBlackboard } from "./session-handoff.js";
import {
  PmSaCoordinationArtifactKind,
  isPmSaCoordinationArtifactRef,
  requirePmSaCoordinationArtifactStore
} from "./pm-sa-coordination-store.js";

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

function textArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  const items = [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
  invariant(items.length >= min, `${name} must contain at least ${min} item(s)`);
  return items;
}

function record(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function nonNegativeInteger(value, name) {
  invariant(Number.isInteger(value) && value >= 0, `${name} must be a non-negative integer`);
  return value;
}

function booleanValue(value, name) {
  invariant(typeof value === "boolean", `${name} must be a boolean`);
  return value;
}

function assertAbsentAuthorityFields(raw, fields, label) {
  for (const field of fields) {
    invariant(!(field in raw), `${label} cannot carry ${field} authority`);
  }
}

export const PmSaCoordinationKind = Object.freeze({
  PM_PROPOSAL: PmSaCoordinationArtifactKind.PM_PROPOSAL,
  SA_ASSESSMENT: PmSaCoordinationArtifactKind.SA_ASSESSMENT
});

function parseTargetState(raw, name) {
  const target = record(raw, name);
  return {
    itemId: requireText(target.itemId, `${name}.itemId`),
    status: requireText(target.status, `${name}.status`),
    claimGeneration: nonNegativeInteger(target.claimGeneration ?? 0, `${name}.claimGeneration`),
    reviewGeneration: nonNegativeInteger(target.reviewGeneration ?? 0, `${name}.reviewGeneration`)
  };
}

function parseNewWork(raw, index) {
  const work = record(raw, `newWork[${index}]`);
  assertAbsentAuthorityFields(
    work,
    ["status", "owner", "origin", "submission", "reviews", "findings", "checkpoint"],
    `newWork[${index}]`
  );
  return {
    id: requireText(work.id, `newWork[${index}].id`),
    work: requireText(work.work, `newWork[${index}].work`),
    remainingWork: textArray(work.remainingWork ?? [], `newWork[${index}].remainingWork`)
  };
}

function parseDependencyEdge(raw, index) {
  const edge = record(raw, `dependencyEdges[${index}]`);
  const itemId = requireText(edge.itemId, `dependencyEdges[${index}].itemId`);
  const dependencyId = requireText(edge.dependencyId, `dependencyEdges[${index}].dependencyId`);
  invariant(itemId !== dependencyId, `dependencyEdges[${index}] cannot self-reference`);
  return { itemId, dependencyId };
}

function parseBlocker(raw, index) {
  const blocker = record(raw, `blockers[${index}]`);
  return {
    targetItemId: requireText(blocker.targetItemId, `blockers[${index}].targetItemId`),
    reason: requireText(blocker.reason, `blockers[${index}].reason`),
    existingWorkRef: blocker.existingWorkRef == null
      ? null
      : requireText(blocker.existingWorkRef, `blockers[${index}].existingWorkRef`)
  };
}

function parseReviewRequirement(raw, index) {
  const requirement = record(raw, `reviewRequirements[${index}]`);
  invariant(requirement.source === ReviewRequirementSource.PM, `reviewRequirements[${index}].source must be PM`);
  return {
    targetItemId: requireText(requirement.targetItemId, `reviewRequirements[${index}].targetItemId`),
    key: requireText(requirement.key, `reviewRequirements[${index}].key`),
    source: ReviewRequirementSource.PM,
    reasonRef: requireText(requirement.reasonRef, `reviewRequirements[${index}].reasonRef`)
  };
}

export function defineSaArchitectureAssessment(raw) {
  const value = record(raw, "SA architecture assessment");
  invariant(value.kind === PmSaCoordinationKind.SA_ASSESSMENT, `SA architecture assessment kind must be ${PmSaCoordinationKind.SA_ASSESSMENT}`);
  assertAbsentAuthorityFields(
    value,
    ["dependsOn", "dependencies", "priority", "status", "timeline", "progress", "reviewVerdict", "intentPatch"],
    "SA architecture assessment"
  );
  const assessment = {
    kind: PmSaCoordinationKind.SA_ASSESSMENT,
    projectId: requireText(value.projectId, "SA architecture assessment projectId"),
    rootIntentId: requireText(value.rootIntentId, "SA architecture assessment rootIntentId"),
    targetItemId: requireText(value.targetItemId, "SA architecture assessment targetItemId"),
    targetWork: requireText(value.targetWork, "SA architecture assessment targetWork"),
    evidenceRefs: textArray(value.evidenceRefs, "SA architecture assessment evidenceRefs", { min: 1 }),
    requiresArchitectureReview: booleanValue(value.requiresArchitectureReview, "SA architecture assessment requiresArchitectureReview"),
    finding: requireText(value.finding, "SA architecture assessment finding")
  };
  return freezeClone(assessment);
}

export function definePmCoordinationProposal(raw) {
  const value = record(raw, "PM coordination proposal");
  invariant(value.kind === PmSaCoordinationKind.PM_PROPOSAL, `PM coordination proposal kind must be ${PmSaCoordinationKind.PM_PROPOSAL}`);
  invariant(value.intentPatch == null, "PM coordination proposal cannot rewrite user intent");
  invariant(value.architectureVerdict == null, "PM coordination proposal cannot carry architecture verdict authority");
  assertAbsentAuthorityFields(value, ["reviewVerdict", "completionVerdict", "claimOwner"], "PM coordination proposal");

  const proposal = {
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: requireText(value.projectId, "PM coordination proposal projectId"),
    rootIntentId: requireText(value.rootIntentId, "PM coordination proposal rootIntentId"),
    target: parseTargetState(value.target, "PM coordination proposal target"),
    newWork: (value.newWork ?? []).map(parseNewWork),
    dependencyEdges: (value.dependencyEdges ?? []).map(parseDependencyEdge),
    blockers: (value.blockers ?? []).map(parseBlocker),
    reviewRequirements: (value.reviewRequirements ?? []).map(parseReviewRequirement),
    progress: {
      completed: nonNegativeInteger(value.progress?.completed ?? 0, "PM coordination proposal progress.completed"),
      total: nonNegativeInteger(value.progress?.total ?? 0, "PM coordination proposal progress.total")
    },
    intentPatch: null,
    architectureVerdict: null
  };
  invariant(proposal.progress.completed <= proposal.progress.total, "PM coordination proposal progress.completed cannot exceed total");
  return freezeClone(proposal);
}

function handoffWork(session, itemId) {
  const item = session.workGraph.find((candidate) => candidate.id === itemId);
  invariant(item, `PM/SA coordination target not found in project handoff: ${itemId}`);
  return item;
}

function targetState(item) {
  return freezeClone({
    itemId: item.id,
    status: item.status,
    claimGeneration: item.claimGeneration,
    reviewGeneration: item.reviewGeneration
  });
}

function sameTargetState(expected, current) {
  return expected.itemId === current.itemId &&
    expected.status === current.status &&
    expected.claimGeneration === current.claimGeneration &&
    expected.reviewGeneration === current.reviewGeneration;
}

export function buildSaArchitectureContext(session, {
  targetItemId,
  architectureFacts,
  evidenceRefs
}) {
  invariant(session && typeof session === "object", "SA architecture context requires project handoff");
  const target = handoffWork(session, requireText(targetItemId, "targetItemId"));
  return freezeClone({
    projectId: requireText(session.projectId, "session projectId"),
    intent: {
      id: session.intent.id,
      objective: session.intent.objective,
      constraints: session.intent.constraints
    },
    target: {
      id: target.id,
      work: target.work,
      status: target.status,
      claimGeneration: target.claimGeneration,
      reviewGeneration: target.reviewGeneration
    },
    architectureFacts: architectureFacts == null ? {} : structuredClone(record(architectureFacts, "architectureFacts")),
    evidenceRefs: textArray(evidenceRefs ?? [], "SA architecture context evidenceRefs")
  });
}

export function buildPmCoordinationContext(session, {
  targetItemId,
  coordinationFacts,
  relevantItemIds = null,
  saAssessment = null,
  saAssessmentRef = null
}) {
  invariant(session && typeof session === "object", "PM coordination context requires project handoff");
  const target = handoffWork(session, requireText(targetItemId, "targetItemId"));
  const ids = relevantItemIds == null
    ? [target.id, ...target.dependsOn]
    : textArray(relevantItemIds, "relevantItemIds");
  const work = [...new Set(ids)].map((id) => {
    const item = handoffWork(session, id);
    return {
      id: item.id,
      work: item.work,
      status: item.status,
      dependsOn: item.dependsOn,
      remainingWork: item.remainingWork,
      blockers: item.blockers,
      reviewRequirements: item.reviewRequirements
    };
  });

  let boundedAssessment = null;
  if (saAssessment != null || saAssessmentRef != null) {
    invariant(saAssessment != null && saAssessmentRef != null, "PM context requires both SA assessment and assessment ref");
    const assessment = defineSaArchitectureAssessment(saAssessment);
    boundedAssessment = {
      artifactRef: requireText(saAssessmentRef, "saAssessmentRef"),
      targetItemId: assessment.targetItemId,
      requiresArchitectureReview: assessment.requiresArchitectureReview,
      finding: assessment.finding
    };
  }

  return freezeClone({
    projectId: requireText(session.projectId, "session projectId"),
    intent: session.intent,
    target: targetState(target),
    work,
    coordinationFacts: coordinationFacts == null ? {} : structuredClone(record(coordinationFacts, "coordinationFacts")),
    saAssessment: boundedAssessment
  });
}

function assertOrchestrator(orchestrator) {
  invariant(
    orchestrator &&
      typeof orchestrator.readBlackboard === "function" &&
      typeof orchestrator.extendWorkGraph === "function" &&
      typeof orchestrator.requireReview === "function" &&
      typeof orchestrator.beginReview === "function",
    "PM/SA coordination requires graph/review-capable ApplicationOrchestrator"
  );
  return orchestrator;
}

function assertAssessmentCurrent(assessment, session) {
  invariant(assessment.projectId === session.projectId, "SA assessment project identity is stale or mismatched");
  invariant(assessment.rootIntentId === session.intent.id, "SA assessment root intent is stale or mismatched");
  const target = handoffWork(session, assessment.targetItemId);
  invariant(target.work === assessment.targetWork, "SA assessment target work changed");
  for (const ref of assessment.evidenceRefs) {
    invariant(target.evidenceRefs.includes(ref), `SA assessment evidence is not current on target ${target.id}: ${ref}`);
  }
  return target;
}

function proposalChangesCoordination(proposal) {
  return proposal.newWork.length > 0 ||
    proposal.dependencyEdges.length > 0 ||
    proposal.blockers.length > 0 ||
    proposal.reviewRequirements.length > 0;
}

function requirementFor(item, key) {
  return item.reviewRequirements.find((requirement) => requirement.key === key) ?? null;
}

export function createPmSaCoordinationController({
  orchestrator,
  projectId,
  artifactStore
}) {
  const app = assertOrchestrator(orchestrator);
  const store = requirePmSaCoordinationArtifactStore(artifactStore);
  const expectedProjectId = requireText(projectId, "projectId");

  async function readSession() {
    return sessionHandoffFromBlackboard(await app.readBlackboard(), { projectId: expectedProjectId });
  }

  async function prepareSaContext(input) {
    return buildSaArchitectureContext(await readSession(), input);
  }

  async function persistSaAssessment(rawAssessment) {
    const assessment = defineSaArchitectureAssessment(rawAssessment);
    const session = await readSession();
    assertAssessmentCurrent(assessment, session);
    const ref = await store.putSaAssessment(assessment);
    return freezeClone({ ref, assessment });
  }

  async function preparePmContext({
    targetItemId,
    coordinationFacts,
    relevantItemIds = null,
    saAssessmentRef = null
  }) {
    const session = await readSession();
    let assessment = null;
    if (saAssessmentRef != null) {
      assessment = defineSaArchitectureAssessment(await store.readSaAssessment(saAssessmentRef));
      assertAssessmentCurrent(assessment, session);
    }
    return buildPmCoordinationContext(session, {
      targetItemId,
      coordinationFacts,
      relevantItemIds,
      ...(assessment == null ? {} : { saAssessment: assessment, saAssessmentRef })
    });
  }

  async function validateProposalAgainstCurrent(proposal, session) {
    invariant(proposal.projectId === session.projectId, "PM proposal project identity is stale or mismatched");
    invariant(proposal.rootIntentId === session.intent.id, "PM proposal root intent is stale or mismatched");
    const target = handoffWork(session, proposal.target.itemId);
    invariant(sameTargetState(proposal.target, targetState(target)), "PM proposal target lifecycle state is stale");
    invariant(
      [BlackboardStatus.READY, BlackboardStatus.REOPENED, BlackboardStatus.BLOCKED].includes(target.status),
      `PM proposal target is not coordinatable from ${target.status}`
    );

    const newIds = new Set();
    for (const work of proposal.newWork) {
      invariant(work.id !== session.rootItemId, `PM proposal cannot replace durable user-intent root: ${work.id}`);
      invariant(work.id !== target.id, `PM proposal new work cannot replace target item: ${work.id}`);
      invariant(!newIds.has(work.id), `PM proposal has duplicate new work item: ${work.id}`);
      newIds.add(work.id);
    }

    const knownIds = new Set([session.rootItemId, ...session.workGraph.map((item) => item.id), ...newIds]);
    for (const edge of proposal.dependencyEdges) {
      invariant(knownIds.has(edge.itemId), `PM proposal dependency child is unknown: ${edge.itemId}`);
      invariant(knownIds.has(edge.dependencyId), `PM proposal dependency endpoint is unknown: ${edge.dependencyId}`);
      invariant(edge.itemId === target.id || newIds.has(edge.itemId), `PM proposal cannot rewrite dependencies for unrelated work: ${edge.itemId}`);
    }

    for (const blocker of proposal.blockers) {
      invariant(blocker.targetItemId === target.id, "PM proposal blocker must target the current coordination item");
      if (blocker.existingWorkRef != null) {
        const existing = handoffWork(session, blocker.existingWorkRef);
        invariant(![BlackboardStatus.DONE, BlackboardStatus.SUPERSEDED].includes(existing.status), `PM proposal blocker work is not unresolved: ${existing.id}`);
      }
    }

    const assessments = new Map();
    for (const requirement of proposal.reviewRequirements) {
      invariant(requirement.targetItemId === target.id, "PM proposal review requirement must target the current coordination item");
      invariant(isPmSaCoordinationArtifactRef(requirement.reasonRef), "PM proposal review requirement requires a durable SA assessment ref");
      const assessment = defineSaArchitectureAssessment(await store.readSaAssessment(requirement.reasonRef));
      assertAssessmentCurrent(assessment, session);
      invariant(assessment.targetItemId === target.id, "PM proposal SA assessment targets different work");
      invariant(assessment.requiresArchitectureReview, "PM proposal cannot require architecture review from a non-review SA assessment");
      assessments.set(requirement.reasonRef, assessment);
    }

    return { target, newIds, assessments };
  }

  async function applyPmProposal(rawProposal) {
    const proposal = definePmCoordinationProposal(rawProposal);
    if (!proposalChangesCoordination(proposal)) {
      return freezeClone({ applied: false, fallback: true, proposalRef: null, item: handoffWork(await readSession(), proposal.target.itemId) });
    }

    const session = await readSession();
    const validated = await validateProposalAgainstCurrent(proposal, session);
    const proposalRef = await store.putPmProposal(proposal);
    const blockerEdges = proposal.blockers
      .filter((blocker) => blocker.existingWorkRef != null)
      .map((blocker) => ({ itemId: validated.target.id, dependencyId: blocker.existingWorkRef }));
    const dependencyEdges = [...proposal.dependencyEdges, ...blockerEdges];
    const assessmentRefs = [...validated.assessments.keys()];
    const assessmentEvidence = [...validated.assessments.values()].flatMap((assessment) => assessment.evidenceRefs);
    const newItems = proposal.newWork.map((work) => ({
      id: work.id,
      work: work.work,
      status: BlackboardStatus.READY,
      dependsOn: [session.rootItemId],
      remainingWork: work.remainingWork,
      blockers: [],
      artifactRefs: [proposalRef],
      evidenceRefs: [],
      followUpRefs: [],
      reviewRequirements: [],
      reviews: [],
      findings: [],
      origin: {
        rootIntentId: session.intent.id,
        rootItemId: session.rootItemId,
        parentItemId: validated.target.id,
        coordinationProposalRef: proposalRef
      }
    }));

    await app.extendWorkGraph({
      targetItemId: validated.target.id,
      newItems,
      dependencyEdges,
      artifactRefs: [proposalRef, ...assessmentRefs],
      evidenceRefs: assessmentEvidence,
      blockers: proposal.blockers.map((blocker) => blocker.reason)
    });

    for (const requirement of proposal.reviewRequirements) {
      const current = handoffWork(await readSession(), requirement.targetItemId);
      const existing = requirementFor(current, requirement.key);
      if (existing != null) {
        invariant(existing.source === ReviewRequirementSource.PM, `review requirement ${requirement.key} changed source`);
        invariant(existing.reason === requirement.reasonRef, `review requirement ${requirement.key} changed reason ref`);
        continue;
      }
      await app.requireReview({
        itemId: requirement.targetItemId,
        key: requirement.key,
        source: ReviewRequirementSource.PM,
        reason: requirement.reasonRef
      });
    }

    const current = handoffWork(await readSession(), validated.target.id);
    return freezeClone({
      applied: true,
      fallback: false,
      proposalRef,
      item: current,
      createdItemIds: newItems.map((item) => item.id)
    });
  }

  async function dispatchArchitectureReview({ itemId, key, reviewer }) {
    requireText(itemId, "itemId");
    requireText(key, "key");
    requireText(reviewer, "reviewer");
    const session = await readSession();
    const item = handoffWork(session, itemId);
    const requirement = requirementFor(item, key);
    invariant(requirement, `PM/SA coordination review requirement not found: ${key}`);
    invariant(requirement.source === ReviewRequirementSource.PM, "PM/SA coordination can dispatch only PM-sourced architecture review");
    invariant(isPmSaCoordinationArtifactRef(requirement.reason), "architecture review requirement reason is not a coordination artifact ref");
    const assessment = defineSaArchitectureAssessment(await store.readSaAssessment(requirement.reason));
    assertAssessmentCurrent(assessment, session);
    invariant(assessment.targetItemId === itemId, "architecture review assessment targets different work");
    invariant(assessment.requiresArchitectureReview, "architecture review assessment does not require review");
    return app.beginReview({ itemId, key, reviewer });
  }

  async function recoverCoordination() {
    const session = await readSession();
    const refs = [...new Set(session.references.artifacts
      .map((entry) => entry.ref)
      .filter(isPmSaCoordinationArtifactRef))];
    const artifacts = [];
    for (const ref of refs) artifacts.push(await store.readArtifact(ref));
    return freezeClone({ session, artifacts });
  }

  return Object.freeze({
    prepareSaContext,
    persistSaAssessment,
    preparePmContext,
    applyPmProposal,
    dispatchArchitectureReview,
    recoverCoordination
  });
}
