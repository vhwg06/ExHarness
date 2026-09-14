import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function freezeClone(value) {
  return Object.freeze(clone(value));
}

export const BlackboardStatus = Object.freeze({
  READY: "READY",
  CLAIMED: "CLAIMED",
  PENDING_REVIEW: "PENDING_REVIEW",
  REVIEWING: "REVIEWING",
  REOPENED: "REOPENED",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
  SUPERSEDED: "SUPERSEDED"
});

export const ReviewRequirementSource = Object.freeze({
  WORKER: "WORKER",
  PM: "PM"
});

export const ReviewVerdict = Object.freeze({
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export const FollowUpDisposition = Object.freeze({
  CURRENT_WORK: "CURRENT_WORK",
  EXISTING_WORK: "EXISTING_WORK",
  NEW_WORK: "NEW_WORK",
  NON_ACTIONABLE: "NON_ACTIONABLE"
});

function normalizeTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

function normalizeReviewRequirement(raw, index) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `reviewRequirements[${index}] must be an object`);
  invariant(Object.values(ReviewRequirementSource).includes(raw.source), `reviewRequirements[${index}].source is invalid`);
  return {
    key: requireText(raw.key, `reviewRequirements[${index}].key`),
    source: raw.source,
    reason: requireText(raw.reason, `reviewRequirements[${index}].reason`)
  };
}

function normalizeReview(raw, index) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `reviews[${index}] must be an object`);
  invariant(Object.values(ReviewVerdict).includes(raw.verdict), `reviews[${index}].verdict is invalid`);
  return {
    key: requireText(raw.key, `reviews[${index}].key`),
    reviewer: requireText(raw.reviewer, `reviews[${index}].reviewer`),
    verdict: raw.verdict,
    assessmentRef: requireText(raw.assessmentRef, `reviews[${index}].assessmentRef`),
    findings: normalizeTextArray(raw.findings ?? [], `reviews[${index}].findings`)
  };
}

function normalizeItem(raw, index = 0) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `items[${index}] must be an object`);
  const status = raw.status ?? BlackboardStatus.READY;
  invariant(Object.values(BlackboardStatus).includes(status), `items[${index}].status is invalid`);

  const reviewRequirements = (raw.reviewRequirements ?? []).map(normalizeReviewRequirement);
  const seenRequirements = new Set();
  for (const requirement of reviewRequirements) {
    invariant(!seenRequirements.has(requirement.key), `items[${index}] has duplicate review requirement ${requirement.key}`);
    seenRequirements.add(requirement.key);
  }

  const reviews = (raw.reviews ?? []).map(normalizeReview);
  const seenReviews = new Set();
  for (const review of reviews) {
    invariant(!seenReviews.has(review.key), `items[${index}] has duplicate review ${review.key}`);
    seenReviews.add(review.key);
  }

  return {
    id: requireText(raw.id, `items[${index}].id`),
    work: requireText(raw.work, `items[${index}].work`),
    status,
    owner: raw.owner == null ? null : requireText(raw.owner, `items[${index}].owner`),
    dependsOn: normalizeTextArray(raw.dependsOn ?? [], `items[${index}].dependsOn`),
    remainingWork: normalizeTextArray(raw.remainingWork ?? [], `items[${index}].remainingWork`),
    blockers: normalizeTextArray(raw.blockers ?? [], `items[${index}].blockers`),
    artifactRefs: normalizeTextArray(raw.artifactRefs ?? [], `items[${index}].artifactRefs`),
    evidenceRefs: normalizeTextArray(raw.evidenceRefs ?? [], `items[${index}].evidenceRefs`),
    followUpRefs: normalizeTextArray(raw.followUpRefs ?? [], `items[${index}].followUpRefs`),
    submission: raw.submission == null ? null : clone(raw.submission),
    reviewRequirements,
    reviews,
    activeReview: raw.activeReview == null ? null : {
      key: requireText(raw.activeReview.key, `items[${index}].activeReview.key`),
      reviewer: requireText(raw.activeReview.reviewer, `items[${index}].activeReview.reviewer`)
    },
    origin: raw.origin == null ? null : clone(raw.origin)
  };
}

export function defineBlackboardSnapshot(raw = { version: 1, items: [] }) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Blackboard snapshot must be an object");
  invariant(raw.version === 1, "Blackboard snapshot version must be 1");
  invariant(Array.isArray(raw.items), "Blackboard snapshot items must be an array");

  const items = raw.items.map(normalizeItem);
  const ids = new Set();
  for (const item of items) {
    invariant(!ids.has(item.id), `Blackboard snapshot has duplicate item ${item.id}`);
    ids.add(item.id);
  }

  return freezeClone({ version: 1, items });
}

export function createJsonBlackboardStore({ path, fs = nodeFs }) {
  requireText(path, "Blackboard store path");
  invariant(fs && typeof fs.readFile === "function" && typeof fs.writeFile === "function", "Blackboard store requires fs read/write capability");

  return Object.freeze({
    async load() {
      try {
        const raw = JSON.parse(await fs.readFile(path, "utf8"));
        return defineBlackboardSnapshot(raw);
      } catch (error) {
        if (error?.code === "ENOENT") return defineBlackboardSnapshot();
        throw error;
      }
    },
    async save(rawSnapshot) {
      const snapshot = defineBlackboardSnapshot(rawSnapshot);
      await fs.mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, path);
      return snapshot;
    }
  });
}

function findItem(snapshot, itemId) {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function reviewFor(item, key) {
  return item.reviews.find((review) => review.key === key) ?? null;
}

function requirementFor(item, key) {
  return item.reviewRequirements.find((requirement) => requirement.key === key) ?? null;
}

function canClaim(status) {
  return status === BlackboardStatus.READY || status === BlackboardStatus.REOPENED;
}

function unresolvedReview(item) {
  return item.reviewRequirements.some((requirement) => reviewFor(item, requirement.key)?.verdict !== ReviewVerdict.ACCEPTED);
}

function addUnique(target, values) {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

export function createApplicationOrchestrator({ store }) {
  invariant(store && typeof store.load === "function" && typeof store.save === "function", "ApplicationOrchestrator requires a Blackboard store");

  async function mutate(mutator) {
    const current = defineBlackboardSnapshot(await store.load());
    const next = clone(current);
    const result = mutator(next);
    const saved = await store.save(next);
    return freezeClone({ snapshot: saved, result });
  }

  return Object.freeze({
    async readBlackboard() {
      return defineBlackboardSnapshot(await store.load());
    },

    async seed(rawItems) {
      invariant(Array.isArray(rawItems), "seed requires an array");
      return mutate((snapshot) => {
        invariant(snapshot.items.length === 0, "Blackboard seed requires an empty store");
        snapshot.items = rawItems.map(normalizeItem);
        return snapshot.items.map((item) => item.id);
      });
    },

    async claim({ itemId, owner }) {
      requireText(itemId, "itemId");
      requireText(owner, "owner");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(canClaim(item.status), `Blackboard item ${itemId} is not claimable from ${item.status}`);
        for (const dependency of item.dependsOn) {
          invariant(findItem(snapshot, dependency).status === BlackboardStatus.DONE, `Blackboard item ${itemId} dependency is not DONE: ${dependency}`);
        }
        item.status = BlackboardStatus.CLAIMED;
        item.owner = owner;
        item.blockers = [];
        return clone(item);
      });
    },

    async submit({ itemId, owner, submission, reviewRequests = [] }) {
      requireText(itemId, "itemId");
      requireText(owner, "owner");
      invariant(submission && typeof submission === "object" && !Array.isArray(submission), "submission must be an object");
      invariant(Array.isArray(reviewRequests), "reviewRequests must be an array");

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before submit`);
        invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);

        for (const rawRequirement of reviewRequests) {
          const requirement = normalizeReviewRequirement(rawRequirement, item.reviewRequirements.length);
          invariant(requirement.source === ReviewRequirementSource.WORKER, "submit reviewRequests must be WORKER-sourced");
          if (!requirementFor(item, requirement.key)) item.reviewRequirements.push(requirement);
        }

        item.submission = clone(submission);
        item.owner = null;
        item.activeReview = null;
        item.reviews = [];
        item.status = BlackboardStatus.PENDING_REVIEW;
        return clone(item);
      });
    },

    async requireReview({ itemId, key, source, reason }) {
      requireText(itemId, "itemId");
      const requirement = normalizeReviewRequirement({ key, source, reason }, 0);
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status !== BlackboardStatus.DONE && item.status !== BlackboardStatus.SUPERSEDED, `Blackboard item ${itemId} cannot add review from ${item.status}`);
        invariant(!requirementFor(item, requirement.key), `Blackboard item ${itemId} already requires review ${requirement.key}`);
        item.reviewRequirements.push(requirement);
        if (item.submission != null && item.status !== BlackboardStatus.CLAIMED) item.status = BlackboardStatus.PENDING_REVIEW;
        return clone(item);
      });
    },

    async beginReview({ itemId, key, reviewer }) {
      requireText(itemId, "itemId");
      requireText(key, "key");
      requireText(reviewer, "reviewer");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.submission != null, `Blackboard item ${itemId} has no submission to review`);
        invariant(item.status === BlackboardStatus.PENDING_REVIEW || item.status === BlackboardStatus.REVIEWING, `Blackboard item ${itemId} is not reviewable from ${item.status}`);
        invariant(requirementFor(item, key), `Blackboard item ${itemId} does not require review ${key}`);
        invariant(reviewFor(item, key) == null, `Blackboard item ${itemId} already has assessment for ${key}`);
        invariant(item.activeReview == null, `Blackboard item ${itemId} already has an active review`);
        item.activeReview = { key, reviewer };
        item.status = BlackboardStatus.REVIEWING;
        return clone(item);
      });
    },

    async recordAssessment({ itemId, key, reviewer, verdict, assessmentRef, findings = [] }) {
      requireText(itemId, "itemId");
      invariant(Object.values(ReviewVerdict).includes(verdict), "review verdict is invalid");
      const normalizedFindings = normalizeTextArray(findings, "findings");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.REVIEWING, `Blackboard item ${itemId} is not REVIEWING`);
        invariant(item.activeReview?.key === key && item.activeReview?.reviewer === reviewer, `Blackboard item ${itemId} active review does not match assessment`);

        item.reviews.push(normalizeReview({ key, reviewer, verdict, assessmentRef, findings: normalizedFindings }, item.reviews.length));
        item.activeReview = null;

        if (verdict !== ReviewVerdict.ACCEPTED) {
          addUnique(item.remainingWork, normalizedFindings.length > 0 ? normalizedFindings : [`Review ${key} did not accept the submission`]);
          item.status = BlackboardStatus.REOPENED;
        } else if (!unresolvedReview(item) && item.remainingWork.length === 0) {
          item.status = BlackboardStatus.DONE;
        } else {
          item.status = BlackboardStatus.PENDING_REVIEW;
        }

        return clone(item);
      });
    },

    async reconcileFinding({ itemId, finding, disposition, existingItemId = null, newItem = null }) {
      requireText(itemId, "itemId");
      const summary = requireText(finding, "finding");
      invariant(Object.values(FollowUpDisposition).includes(disposition), "follow-up disposition is invalid");

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);

        if (disposition === FollowUpDisposition.CURRENT_WORK) {
          addUnique(item.remainingWork, [summary]);
          item.status = BlackboardStatus.REOPENED;
          return clone(item);
        }

        if (disposition === FollowUpDisposition.EXISTING_WORK) {
          const targetId = requireText(existingItemId, "existingItemId");
          findItem(snapshot, targetId);
          addUnique(item.followUpRefs, [targetId]);
          return clone(item);
        }

        if (disposition === FollowUpDisposition.NEW_WORK) {
          invariant(newItem && typeof newItem === "object" && !Array.isArray(newItem), "NEW_WORK disposition requires newItem");
          const child = normalizeItem({
            ...newItem,
            status: newItem.status ?? BlackboardStatus.READY,
            origin: { parentItemId: itemId, finding: summary }
          }, snapshot.items.length);
          invariant(!snapshot.items.some((candidate) => candidate.id === child.id), `Blackboard item already exists: ${child.id}`);
          snapshot.items.push(child);
          addUnique(item.followUpRefs, [child.id]);
          return clone(child);
        }

        return Object.freeze({ disposition: FollowUpDisposition.NON_ACTIONABLE, finding: summary });
      });
    },

    async block({ itemId, owner, blockers }) {
      requireText(itemId, "itemId");
      const normalizedBlockers = normalizeTextArray(blockers, "blockers");
      invariant(normalizedBlockers.length > 0, "block requires at least one blocker");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before block`);
        invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);
        item.owner = null;
        item.blockers = normalizedBlockers;
        item.status = BlackboardStatus.BLOCKED;
        return clone(item);
      });
    }
  });
}
