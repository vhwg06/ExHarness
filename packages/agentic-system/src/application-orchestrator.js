import { isDeepStrictEqual } from "node:util";
import { subjectFromValue } from "../../core-harness/src/index.js";
import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { createApplicationOrchestrator as createBaseApplicationOrchestrator } from "./application-orchestrator-base.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requirePositiveInteger(value, name) {
  invariant(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

function normalizeTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

function findItem(snapshot, itemId) {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function assertClaim(item, itemId, owner, generation) {
  invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before required-review submit`);
  invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);
  invariant(item.claimGeneration === generation, `Blackboard item ${itemId} claim generation is stale`);
}

function removeResolvedWork(item, resolvedWork) {
  const resolved = normalizeTextArray(resolvedWork, "resolvedWork");
  for (const work of resolved) {
    invariant(item.remainingWork.includes(work), `resolvedWork is not an outstanding current obligation: ${work}`);
  }
  item.remainingWork = item.remainingWork.filter((work) => !resolved.includes(work));
}

function normalizeReviewRequirements(rawRequirements) {
  invariant(Array.isArray(rawRequirements), "reviewRequirements must be an array");
  const requirements = rawRequirements.map((raw, index) => {
    invariant(raw && typeof raw === "object" && !Array.isArray(raw), `reviewRequirements[${index}] must be an object`);
    invariant(raw.source === ReviewRequirementSource.PM, `reviewRequirements[${index}].source must be PM`);
    return Object.freeze({
      key: requireText(raw.key, `reviewRequirements[${index}].key`),
      source: ReviewRequirementSource.PM,
      reason: requireText(raw.reason, `reviewRequirements[${index}].reason`)
    });
  });
  invariant(requirements.length > 0, "submitWithRequiredReviews requires at least one PM review requirement");
  invariant(new Set(requirements.map((requirement) => requirement.key)).size === requirements.length, "reviewRequirements must not contain duplicate keys");
  return requirements;
}

function addReviewRequirements(item, requirements) {
  for (const requirement of requirements) {
    const existing = item.reviewRequirements.find((candidate) => candidate.key === requirement.key) ?? null;
    if (existing != null) {
      invariant(existing.source === requirement.source, `review requirement ${requirement.key} changed source`);
      invariant(existing.reason === requirement.reason, `review requirement ${requirement.key} changed reason`);
      continue;
    }
    item.reviewRequirements.push(structuredClone(requirement));
  }
}

export function createApplicationOrchestrator({ store, reviewTrust }) {
  invariant(store && typeof store.load === "function" && typeof store.transact === "function", "ApplicationOrchestrator requires a transactional Blackboard store");
  const base = createBaseApplicationOrchestrator({ store, reviewTrust });

  async function submitWithRequiredReviews({
    itemId,
    owner,
    generation,
    submission,
    resolvedWork = [],
    reviewRequirements
  }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    requirePositiveInteger(generation, "generation");
    invariant(submission && typeof submission === "object" && !Array.isArray(submission), "submission must be an object");
    invariant(Array.isArray(resolvedWork), "resolvedWork must be an array");
    const requirements = normalizeReviewRequirements(reviewRequirements);

    subjectFromValue({ itemId, submission }, {
      type: "blackboard-submission",
      producer: { identity: owner, roles: ["producer"] }
    });

    const result = await store.transact((snapshot) => {
      const item = findItem(snapshot, itemId);
      assertClaim(item, itemId, owner, generation);
      removeResolvedWork(item, resolvedWork);
      addReviewRequirements(item, requirements);

      item.checkpoint = null;
      item.checkpointedBy = null;
      item.submission = structuredClone(submission);
      item.submittedBy = owner;
      item.owner = null;
      item.activeReview = null;
      item.reviews = [];
      item.findings = [];
      item.blockers = [];
      item.status = BlackboardStatus.PENDING_REVIEW;
      return structuredClone(item);
    });

    return Object.freeze(structuredClone(result));
  }


  async function resolveBlockedCheckpoint({
    itemId,
    checkpointedBy,
    expectedCheckpoint,
    checkpoint
  }) {
    requireText(itemId, "itemId");
    requireText(checkpointedBy, "checkpointedBy");
    invariant(expectedCheckpoint && typeof expectedCheckpoint === "object" && !Array.isArray(expectedCheckpoint), "expectedCheckpoint must be an object");
    invariant(checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint), "checkpoint must be an object");

    const result = await store.transact((snapshot) => {
      const item = findItem(snapshot, itemId);
      invariant(item.status === BlackboardStatus.BLOCKED, `Blackboard item ${itemId} must be BLOCKED before blocked-checkpoint resolution`);
      invariant(item.owner == null, `Blackboard item ${itemId} cannot resolve a blocked checkpoint while owned`);
      invariant(
        isDeepStrictEqual(item.checkpoint, expectedCheckpoint),
        `Blackboard item ${itemId} blocked checkpoint changed before resolution`
      );

      item.checkpoint = structuredClone(checkpoint);
      item.checkpointedBy = checkpointedBy;
      item.owner = null;
      item.blockers = [];
      item.status = BlackboardStatus.REOPENED;
      return structuredClone(item);
    });

    return Object.freeze(structuredClone(result));
  }
  return Object.freeze({
    ...base,
    submitWithRequiredReviews,
    resolveBlockedCheckpoint
  });
}
