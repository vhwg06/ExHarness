import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";
import {
  TrustBoundary,
  defineTrustPolicy,
  evaluateTrustBoundary,
  subjectFromValue,
  validateTrustBundle
} from "../../core-harness/src/index.js";

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
  PENDING_RECONCILIATION: "PENDING_RECONCILIATION",
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
    decisionRef: requireText(raw.decisionRef, `reviews[${index}].decisionRef`),
    attestationRef: requireText(raw.attestationRef, `reviews[${index}].attestationRef`),
    findingRefs: normalizeTextArray(raw.findingRefs ?? [], `reviews[${index}].findingRefs`)
  };
}

function normalizeReviewFinding(raw, index) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `findings[${index}] must be an object`);
  const disposition = raw.disposition ?? null;
  if (disposition != null) {
    invariant(Object.values(FollowUpDisposition).includes(disposition), `findings[${index}].disposition is invalid`);
  }
  return {
    id: requireText(raw.id, `findings[${index}].id`),
    summary: requireText(raw.summary, `findings[${index}].summary`),
    sourceRef: requireText(raw.sourceRef, `findings[${index}].sourceRef`),
    reviewKey: requireText(raw.reviewKey, `findings[${index}].reviewKey`),
    disposition,
    targetItemId: raw.targetItemId == null ? null : requireText(raw.targetItemId, `findings[${index}].targetItemId`)
  };
}

function normalizeReviewSubject(raw, name) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${name} must be an object`);
  return freezeClone({
    type: requireText(raw.type, `${name}.type`),
    digest: requireText(raw.digest, `${name}.digest`),
    producer: raw.producer == null ? null : clone(raw.producer),
    metadata: raw.metadata == null ? null : clone(raw.metadata)
  });
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

  const findings = (raw.findings ?? []).map(normalizeReviewFinding);
  const seenFindings = new Set();
  for (const finding of findings) {
    invariant(!seenFindings.has(finding.id), `items[${index}] has duplicate finding ${finding.id}`);
    seenFindings.add(finding.id);
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
    checkpoint: raw.checkpoint == null ? null : clone(raw.checkpoint),
    checkpointedBy: raw.checkpointedBy == null ? null : requireText(raw.checkpointedBy, `items[${index}].checkpointedBy`),
    submission: raw.submission == null ? null : clone(raw.submission),
    submittedBy: raw.submittedBy == null ? null : requireText(raw.submittedBy, `items[${index}].submittedBy`),
    reviewRequirements,
    reviews,
    findings,
    activeReview: raw.activeReview == null ? null : {
      key: requireText(raw.activeReview.key, `items[${index}].activeReview.key`),
      reviewer: requireText(raw.activeReview.reviewer, `items[${index}].activeReview.reviewer`),
      subject: normalizeReviewSubject(raw.activeReview.subject, `items[${index}].activeReview.subject`)
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

export function createJsonBlackboardStore({ path, fs = nodeFs, lockStaleMs = 300_000 }) {
  requireText(path, "Blackboard store path");
  invariant(Number.isInteger(lockStaleMs) && lockStaleMs > 0, "Blackboard lockStaleMs must be a positive integer");
  invariant(
    fs &&
      typeof fs.readFile === "function" &&
      typeof fs.writeFile === "function" &&
      typeof fs.mkdir === "function" &&
      typeof fs.rename === "function" &&
      typeof fs.open === "function" &&
      typeof fs.unlink === "function" &&
      typeof fs.stat === "function",
    "Blackboard store requires filesystem read/write/lock capability"
  );

  const lockPath = `${path}.lock`;

  async function loadUnlocked() {
    try {
      const raw = JSON.parse(await fs.readFile(path, "utf8"));
      return defineBlackboardSnapshot(raw);
    } catch (error) {
      if (error?.code === "ENOENT") return defineBlackboardSnapshot();
      throw error;
    }
  }

  async function saveUnlocked(rawSnapshot) {
    const snapshot = defineBlackboardSnapshot(rawSnapshot);
    await fs.mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, path);
    return snapshot;
  }

  async function createLockHandle() {
    const handle = await fs.open(lockPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify({ createdAt: Date.now() })}\n`, "utf8");
      return handle;
    } catch (error) {
      await handle.close();
      try {
        await fs.unlink(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  }

  async function lockIsStale() {
    try {
      const metadata = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (Number.isFinite(metadata.createdAt)) return Date.now() - metadata.createdAt > lockStaleMs;
    } catch {
      // Fall back to filesystem mtime for a crashed/partial lock write.
    }
    try {
      const stat = await fs.stat(lockPath);
      return Date.now() - stat.mtimeMs > lockStaleMs;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function openMutationLock() {
    await fs.mkdir(dirname(path), { recursive: true });
    try {
      return await createLockHandle();
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!(await lockIsStale())) throw new Error("Blackboard store mutation already in progress");

      try {
        await fs.unlink(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }

      try {
        return await createLockHandle();
      } catch (retryError) {
        if (retryError?.code === "EEXIST") throw new Error("Blackboard store mutation already in progress");
        throw retryError;
      }
    }
  }

  async function withMutationLock(action) {
    const handle = await openMutationLock();
    try {
      return await action();
    } finally {
      await handle.close();
      try {
        await fs.unlink(lockPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  return Object.freeze({
    async load() {
      return loadUnlocked();
    },
    async transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      return withMutationLock(async () => {
        const current = await loadUnlocked();
        const next = clone(current);
        const result = await mutator(next);
        const saved = await saveUnlocked(next);
        return freezeClone({ snapshot: saved, result });
      });
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

function findingFor(item, findingId) {
  const finding = item.findings.find((candidate) => candidate.id === findingId);
  invariant(finding, `Blackboard finding not found: ${findingId}`);
  return finding;
}

function canClaim(status) {
  return status === BlackboardStatus.READY || status === BlackboardStatus.REOPENED;
}

function unresolvedReview(item) {
  return item.reviewRequirements.some((requirement) => reviewFor(item, requirement.key)?.verdict !== ReviewVerdict.ACCEPTED);
}

function nonAcceptedReview(item) {
  return item.reviews.some((review) => review.verdict !== ReviewVerdict.ACCEPTED);
}

function hasPendingFindings(item) {
  return item.findings.some((finding) => finding.disposition == null);
}

function derivePostReviewStatus(item) {
  if (hasPendingFindings(item)) return BlackboardStatus.PENDING_RECONCILIATION;
  if (nonAcceptedReview(item) || item.remainingWork.length > 0) return BlackboardStatus.REOPENED;
  if (unresolvedReview(item)) return BlackboardStatus.PENDING_REVIEW;
  return BlackboardStatus.DONE;
}

function addUnique(target, values) {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

function removeResolvedWork(item, resolvedWork) {
  const resolved = normalizeTextArray(resolvedWork, "resolvedWork");
  for (const work of resolved) {
    invariant(item.remainingWork.includes(work), `resolvedWork is not an outstanding current obligation: ${work}`);
  }
  item.remainingWork = item.remainingWork.filter((work) => !resolved.includes(work));
}

function reviewSubject(item, key) {
  invariant(item.submission != null, `Blackboard item ${item.id} has no submission`);
  invariant(item.submittedBy != null, `Blackboard item ${item.id} has no submission producer`);
  return subjectFromValue({
    itemId: item.id,
    reviewKey: key,
    submission: item.submission
  }, {
    type: "blackboard-review-target",
    producer: {
      identity: item.submittedBy,
      roles: ["producer"]
    },
    metadata: {
      itemId: item.id,
      reviewKey: key
    }
  });
}

function sameSubject(left, right) {
  return left?.type === right?.type && left?.digest === right?.digest;
}

function findingsFromDecision(decision) {
  return normalizeTextArray(decision?.metadata?.findings ?? [], "review decision findings");
}

function blockingReasonsFromDecision(decision) {
  const unresolved = decision?.unresolved ?? [];
  invariant(Array.isArray(unresolved), "review decision unresolved must be an array");
  return unresolved.map((entry, index) => {
    if (typeof entry === "string") return requireText(entry, `review decision unresolved[${index}]`);
    invariant(entry && typeof entry === "object" && !Array.isArray(entry), `review decision unresolved[${index}] must be an object or string`);
    const summary = entry.summary ?? entry.reason ?? entry.finding;
    return requireText(summary, `review decision unresolved[${index}] summary`);
  });
}

function reviewTrustConfig(reviewTrust) {
  invariant(reviewTrust && typeof reviewTrust === "object", "ApplicationOrchestrator requires reviewTrust");
  invariant(typeof reviewTrust.trustPolicyFor === "function", "reviewTrust.trustPolicyFor is required");
  invariant(typeof reviewTrust.verifySignature === "function", "reviewTrust.verifySignature is required");
  invariant(typeof reviewTrust.verifyEvaluatorAuthority === "function", "reviewTrust.verifyEvaluatorAuthority is required");
  invariant(typeof reviewTrust.verifyEvidenceAuthority === "function", "reviewTrust.verifyEvidenceAuthority is required");
  return reviewTrust;
}

async function evaluateReviewBundle({ item, requirement, activeReview, bundle, reviewTrust }) {
  invariant(bundle && typeof bundle === "object" && !Array.isArray(bundle), "review trust bundle is required");
  invariant(Array.isArray(bundle.evidence) && bundle.evidence.length > 0, "review trust bundle requires grounded evidence artifacts");

  const validated = validateTrustBundle({
    evidence: bundle.evidence,
    decision: bundle.decision,
    attestation: bundle.attestation
  });
  invariant(Object.values(ReviewVerdict).includes(validated.decision.verdict), "review decision verdict is invalid");
  invariant(validated.decision.evaluator?.identity === activeReview.reviewer, "review decision evaluator does not match scheduled reviewer");
  invariant(validated.decision.evaluator?.identity !== item.submittedBy, "review evaluator must be independent from submission producer");
  for (const evidence of validated.evidence) {
    invariant(sameSubject(evidence.subject, activeReview.subject), "review evidence subject does not match active review target");
  }

  const findings = findingsFromDecision(validated.decision);
  const blockingReasons = blockingReasonsFromDecision(validated.decision);
  if (validated.decision.verdict === ReviewVerdict.ACCEPTED) {
    invariant(blockingReasons.length === 0, "accepted review decision cannot contain unresolved claims");
  } else {
    invariant(blockingReasons.length > 0, "non-accepted review decision requires at least one unresolved blocking reason");
  }

  const declaredPolicy = await reviewTrust.trustPolicyFor({
    item: freezeClone(item),
    requirement: freezeClone(requirement),
    reviewer: activeReview.reviewer,
    subject: freezeClone(activeReview.subject)
  });
  const trustPolicy = defineTrustPolicy({
    ...declaredPolicy,
    boundary: TrustBoundary.ACCEPTANCE,
    requiredIssuerRoles: [...new Set([...(declaredPolicy?.requiredIssuerRoles ?? []), "attestor"])],
    requiredEvaluatorRoles: [...new Set([...(declaredPolicy?.requiredEvaluatorRoles ?? []), "reviewer"])],
    requiredEvidenceProducerRoles: [...new Set([...(declaredPolicy?.requiredEvidenceProducerRoles ?? []), "verifier"])],
    requireSignature: true,
    requireEvidenceArtifacts: true,
    requireDecisionArtifact: true,
    requireIndependentIssuer: true,
    requireIndependentEvidenceProducers: true
  });

  const trust = await evaluateTrustBoundary({
    attestation: validated.attestation,
    decision: validated.decision,
    evidence: validated.evidence,
    currentSubject: activeReview.subject,
    policy: trustPolicy,
    verifySignature: (input) => reviewTrust.verifySignature({ ...input, item, requirement, reviewer: activeReview.reviewer }),
    verifyEvaluatorAuthority: (input) => reviewTrust.verifyEvaluatorAuthority({ ...input, item, requirement, reviewer: activeReview.reviewer }),
    verifyEvidenceAuthority: (input) => reviewTrust.verifyEvidenceAuthority({ ...input, item, requirement, reviewer: activeReview.reviewer })
  });

  invariant(trust.trusted, `review trust rejected: ${trust.reasons.map((reason) => reason.code).join(", ")}`);
  return freezeClone({
    verdict: validated.decision.verdict,
    reviewer: activeReview.reviewer,
    decisionRef: validated.decision.id,
    attestationRef: validated.attestation.id,
    findings,
    blockingReasons,
    trust
  });
}

function sameActiveReview(left, right) {
  return left?.key === right?.key &&
    left?.reviewer === right?.reviewer &&
    sameSubject(left?.subject, right?.subject);
}

function reviewFindingId(decisionRef, index) {
  return `${decisionRef}:finding:${index + 1}`;
}

export function createApplicationOrchestrator({ store, reviewTrust }) {
  invariant(
    store && typeof store.load === "function" && typeof store.transact === "function",
    "ApplicationOrchestrator requires a transactional Blackboard store"
  );
  const trustedReview = reviewTrustConfig(reviewTrust);

  async function mutate(mutator) {
    return freezeClone(await store.transact(mutator));
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

    async checkpoint({
      itemId,
      owner,
      checkpoint,
      artifactRefs = [],
      evidenceRefs = [],
      remainingWork = [],
      resolvedWork = [],
      status = BlackboardStatus.REOPENED,
      blockers = []
    }) {
      requireText(itemId, "itemId");
      requireText(owner, "owner");
      invariant(checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint), "checkpoint must be an object");
      invariant([BlackboardStatus.REOPENED, BlackboardStatus.BLOCKED].includes(status), "checkpoint status must be REOPENED or BLOCKED");
      const normalizedArtifacts = normalizeTextArray(artifactRefs, "artifactRefs");
      const normalizedEvidence = normalizeTextArray(evidenceRefs, "evidenceRefs");
      const normalizedRemaining = normalizeTextArray(remainingWork, "remainingWork");
      const normalizedBlockers = normalizeTextArray(blockers, "blockers");
      if (status === BlackboardStatus.BLOCKED) invariant(normalizedBlockers.length > 0, "BLOCKED checkpoint requires blockers");

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before checkpoint`);
        invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);
        removeResolvedWork(item, resolvedWork);
        addUnique(item.artifactRefs, normalizedArtifacts);
        addUnique(item.evidenceRefs, normalizedEvidence);
        addUnique(item.remainingWork, normalizedRemaining);
        item.checkpoint = clone(checkpoint);
        item.checkpointedBy = owner;
        item.owner = null;
        item.blockers = normalizedBlockers;
        item.status = status;
        return clone(item);
      });
    },

    async resume({ itemId }) {
      requireText(itemId, "itemId");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.BLOCKED, `Blackboard item ${itemId} must be BLOCKED before resume`);
        item.blockers = [];
        item.status = BlackboardStatus.REOPENED;
        return clone(item);
      });
    },

    async supersede({ itemId, reason }) {
      requireText(itemId, "itemId");
      requireText(reason, "reason");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status !== BlackboardStatus.DONE, `Blackboard item ${itemId} cannot be superseded from DONE`);
        invariant(item.status !== BlackboardStatus.SUPERSEDED, `Blackboard item ${itemId} is already SUPERSEDED`);
        item.owner = null;
        item.activeReview = null;
        item.blockers = [reason];
        item.status = BlackboardStatus.SUPERSEDED;
        return clone(item);
      });
    },

    async submit({ itemId, owner, submission, reviewRequests = [], resolvedWork = [] }) {
      requireText(itemId, "itemId");
      requireText(owner, "owner");
      invariant(submission && typeof submission === "object" && !Array.isArray(submission), "submission must be an object");
      invariant(Array.isArray(reviewRequests), "reviewRequests must be an array");
      invariant(Array.isArray(resolvedWork), "resolvedWork must be an array");
      subjectFromValue({ itemId, submission }, {
        type: "blackboard-submission",
        producer: { identity: owner, roles: ["producer"] }
      });

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before submit`);
        invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);

        removeResolvedWork(item, resolvedWork);

        for (const rawRequirement of reviewRequests) {
          const requirement = normalizeReviewRequirement(rawRequirement, item.reviewRequirements.length);
          invariant(requirement.source === ReviewRequirementSource.WORKER, "submit reviewRequests must be WORKER-sourced");
          if (!requirementFor(item, requirement.key)) item.reviewRequirements.push(requirement);
        }

        item.checkpoint = null;
        item.checkpointedBy = null;
        item.submission = clone(submission);
        item.submittedBy = owner;
        item.owner = null;
        item.activeReview = null;
        item.reviews = [];
        item.findings = [];
        item.status = BlackboardStatus.PENDING_REVIEW;
        return clone(item);
      });
    },

    async requireReview({ itemId, key, source, reason }) {
      requireText(itemId, "itemId");
      const requirement = normalizeReviewRequirement({ key, source, reason }, 0);
      invariant(requirement.source === ReviewRequirementSource.PM, "requireReview must be PM-sourced");
      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status !== BlackboardStatus.DONE && item.status !== BlackboardStatus.SUPERSEDED, `Blackboard item ${itemId} cannot add review from ${item.status}`);
        invariant(!requirementFor(item, requirement.key), `Blackboard item ${itemId} already requires review ${requirement.key}`);
        item.reviewRequirements.push(requirement);
        if (
          item.submission != null &&
          ![BlackboardStatus.CLAIMED, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION].includes(item.status)
        ) {
          item.status = BlackboardStatus.PENDING_REVIEW;
        }
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
        invariant(item.status === BlackboardStatus.PENDING_REVIEW, `Blackboard item ${itemId} is not reviewable from ${item.status}`);
        invariant(requirementFor(item, key), `Blackboard item ${itemId} does not require review ${key}`);
        invariant(reviewFor(item, key) == null, `Blackboard item ${itemId} already has assessment for ${key}`);
        invariant(item.activeReview == null, `Blackboard item ${itemId} already has an active review`);
        invariant(reviewer !== item.submittedBy, "reviewer must be independent from submission producer");
        item.activeReview = {
          key,
          reviewer,
          subject: reviewSubject(item, key)
        };
        item.status = BlackboardStatus.REVIEWING;
        return clone(item.activeReview);
      });
    },

    async recordAssessment({ itemId, key, bundle }) {
      requireText(itemId, "itemId");
      requireText(key, "key");

      const observedBoard = defineBlackboardSnapshot(await store.load());
      const observedItem = findItem(observedBoard, itemId);
      invariant(observedItem.status === BlackboardStatus.REVIEWING, `Blackboard item ${itemId} is not REVIEWING`);
      invariant(observedItem.activeReview?.key === key, `Blackboard item ${itemId} active review does not match assessment`);
      const observedRequirement = requirementFor(observedItem, key);
      invariant(observedRequirement, `Blackboard item ${itemId} does not require review ${key}`);
      const observedReview = freezeClone(observedItem.activeReview);

      const assessment = await evaluateReviewBundle({
        item: observedItem,
        requirement: observedRequirement,
        activeReview: observedReview,
        bundle,
        reviewTrust: trustedReview
      });

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        invariant(item.status === BlackboardStatus.REVIEWING, `Blackboard item ${itemId} changed while assessment trust was evaluated`);
        invariant(sameActiveReview(item.activeReview, observedReview), `Blackboard item ${itemId} review target changed while assessment trust was evaluated`);
        invariant(requirementFor(item, key), `Blackboard item ${itemId} review requirement changed while assessment trust was evaluated`);

        const findingRefs = assessment.findings.map((summary, index) => {
          const finding = normalizeReviewFinding({
            id: reviewFindingId(assessment.decisionRef, index),
            summary,
            sourceRef: assessment.attestationRef,
            reviewKey: key,
            disposition: null,
            targetItemId: null
          }, item.findings.length + index);
          item.findings.push(finding);
          return finding.id;
        });

        item.reviews.push(normalizeReview({
          key,
          reviewer: assessment.reviewer,
          verdict: assessment.verdict,
          decisionRef: assessment.decisionRef,
          attestationRef: assessment.attestationRef,
          findingRefs
        }, item.reviews.length));
        item.activeReview = null;
        addUnique(item.evidenceRefs, [assessment.decisionRef, assessment.attestationRef]);
        addUnique(item.remainingWork, assessment.blockingReasons);
        item.status = derivePostReviewStatus(item);

        return clone(item);
      });
    },

    async reconcileFinding({ itemId, findingId, disposition, existingItemId = null, newItem = null }) {
      requireText(itemId, "itemId");
      requireText(findingId, "findingId");
      invariant(Object.values(FollowUpDisposition).includes(disposition), "follow-up disposition is invalid");

      return mutate((snapshot) => {
        const item = findItem(snapshot, itemId);
        const finding = findingFor(item, findingId);
        invariant(finding.disposition == null, `Blackboard finding already reconciled: ${findingId}`);

        let result = item;
        let targetItemId = null;

        if (disposition === FollowUpDisposition.CURRENT_WORK) {
          addUnique(item.remainingWork, [finding.summary]);
        } else if (disposition === FollowUpDisposition.EXISTING_WORK) {
          const targetId = requireText(existingItemId, "existingItemId");
          invariant(targetId !== itemId, "existing follow-up target must differ from current item");
          findItem(snapshot, targetId);
          addUnique(item.followUpRefs, [targetId]);
          targetItemId = targetId;
        } else if (disposition === FollowUpDisposition.NEW_WORK) {
          invariant(newItem && typeof newItem === "object" && !Array.isArray(newItem), "NEW_WORK disposition requires newItem");
          const child = normalizeItem({
            ...newItem,
            status: newItem.status ?? BlackboardStatus.READY,
            origin: {
              parentItemId: itemId,
              findingId: finding.id,
              finding: finding.summary,
              sourceRef: finding.sourceRef
            }
          }, snapshot.items.length);
          invariant(!snapshot.items.some((candidate) => candidate.id === child.id), `Blackboard item already exists: ${child.id}`);
          snapshot.items.push(child);
          addUnique(item.followUpRefs, [child.id]);
          targetItemId = child.id;
          result = child;
        }

        finding.disposition = disposition;
        finding.targetItemId = targetItemId;
        item.status = derivePostReviewStatus(item);
        return clone(result);
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
