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

function normalizeTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

export const UserIntentSource = Object.freeze({
  USER: "USER"
});

export const SessionHandoffRootKind = Object.freeze({
  USER_INTENT: "USER_INTENT_ROOT"
});

export function defineUserIntent(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "userIntent must be an object");
  const source = raw.source ?? UserIntentSource.USER;
  invariant(source === UserIntentSource.USER, "userIntent.source must be USER");
  return freezeClone({
    id: requireText(raw.id, "userIntent.id"),
    source,
    objective: requireText(raw.objective, "userIntent.objective"),
    bullets: normalizeTextArray(raw.bullets ?? [], "userIntent.bullets"),
    constraints: normalizeTextArray(raw.constraints ?? [], "userIntent.constraints")
  });
}

function intentRootId(intent) {
  return `INTENT:${intent.id}`;
}

function intentRootItem(intent) {
  return {
    id: intentRootId(intent),
    work: intent.objective,
    status: "DONE",
    owner: null,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    origin: {
      kind: SessionHandoffRootKind.USER_INTENT,
      userIntent: intent
    }
  };
}

function initialWorkItem(raw, intent) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "initial work item must be an object");
  const rootItemId = intentRootId(intent);
  invariant(raw.id !== rootItemId, `work item id is reserved for the user intent root: ${rootItemId}`);
  return {
    ...clone(raw),
    dependsOn: [...new Set([rootItemId, ...(raw.dependsOn ?? [])])],
    origin: {
      ...(raw.origin ?? {}),
      rootIntentId: intent.id,
      rootItemId
    }
  };
}

function rootFromBoard(board) {
  const roots = board.items.filter((item) => item.origin?.kind === SessionHandoffRootKind.USER_INTENT);
  invariant(roots.length === 1, `session handoff requires exactly one durable user-intent root; found ${roots.length}`);
  const root = roots[0];
  const intent = defineUserIntent(root.origin.userIntent);
  invariant(root.id === intentRootId(intent), "user-intent root id does not match its durable intent");
  invariant(root.status === "DONE", "user-intent root must remain established as DONE input state");
  return { root, intent };
}

function tracesToIntent(item, byId, root, intent, visiting = new Set()) {
  if (item.id === root.id) return true;
  if (item.origin?.rootIntentId === intent.id && item.origin?.rootItemId === root.id) return true;
  if ((item.dependsOn ?? []).includes(root.id)) return true;

  const parentId = item.origin?.parentItemId ?? null;
  if (parentId == null) return false;
  invariant(!visiting.has(item.id), `Blackboard origin cycle detected at ${item.id}`);
  const parent = byId.get(parentId);
  if (!parent) return false;
  const next = new Set(visiting);
  next.add(item.id);
  return tracesToIntent(parent, byId, root, intent, next);
}

function dependenciesDone(item, byId) {
  return (item.dependsOn ?? []).every((dependency) => byId.get(dependency)?.status === "DONE");
}

function workSummary(item) {
  return freezeClone({
    id: item.id,
    work: item.work,
    status: item.status,
    owner: item.owner ?? null,
    dependsOn: item.dependsOn ?? [],
    remainingWork: item.remainingWork ?? [],
    blockers: item.blockers ?? [],
    reviewRequirements: item.reviewRequirements ?? [],
    reviews: item.reviews ?? [],
    findings: item.findings ?? [],
    followUpRefs: item.followUpRefs ?? [],
    submission: item.submission ?? null,
    submittedBy: item.submittedBy ?? null,
    origin: item.origin ?? null
  });
}

function referenceValue(value, name) {
  if (typeof value === "string") return requireText(value, name);
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be a string or reference object`);
  return requireText(value.ref, `${name}.ref`);
}

function collectReferences(items, field, submissionField) {
  const seen = new Set();
  const refs = [];

  function add(itemId, value, label) {
    const ref = referenceValue(value, label);
    const key = `${itemId}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(Object.freeze({ itemId, ref }));
  }

  for (const item of items) {
    for (const [index, value] of (item[field] ?? []).entries()) {
      add(item.id, value, `${item.id}.${field}[${index}]`);
    }
    const submitted = item.submission?.[submissionField] ?? [];
    invariant(Array.isArray(submitted), `${item.id}.submission.${submissionField} must be an array when present`);
    for (const [index, value] of submitted.entries()) {
      add(item.id, value, `${item.id}.submission.${submissionField}[${index}]`);
    }
  }

  return Object.freeze(refs);
}

export function sessionHandoffFromBlackboard(board) {
  invariant(board && typeof board === "object" && Array.isArray(board.items), "Blackboard snapshot is required");
  const { root, intent } = rootFromBoard(board);
  const workItems = board.items.filter((item) => item.id !== root.id);
  const byId = new Map(board.items.map((item) => [item.id, item]));

  for (const item of workItems) {
    invariant(
      tracesToIntent(item, byId, root, intent),
      `Blackboard work item is not traceable to durable user intent ${intent.id}: ${item.id}`
    );
  }

  const summaries = workItems.map(workSummary);
  const lifecycle = {
    eligibleWork: summaries.filter((item) => ["READY", "REOPENED"].includes(item.status) && dependenciesDone(byId.get(item.id), byId)),
    claimedWork: summaries.filter((item) => item.status === "CLAIMED"),
    pendingReview: summaries.filter((item) => item.status === "PENDING_REVIEW"),
    reviewing: summaries.filter((item) => item.status === "REVIEWING"),
    pendingReconciliation: summaries.filter((item) => item.status === "PENDING_RECONCILIATION"),
    blocked: summaries.filter((item) => item.status === "BLOCKED"),
    done: summaries.filter((item) => item.status === "DONE"),
    superseded: summaries.filter((item) => item.status === "SUPERSEDED")
  };

  return freezeClone({
    version: 1,
    intent,
    rootItemId: root.id,
    workGraph: summaries,
    lifecycle,
    references: {
      artifacts: collectReferences(workItems, "artifactRefs", "artifactRefs"),
      evidence: collectReferences(workItems, "evidenceRefs", "evidenceRefs")
    }
  });
}

export function createSessionHandoffSurface({ orchestrator }) {
  invariant(
    orchestrator && typeof orchestrator.seed === "function" && typeof orchestrator.readBlackboard === "function",
    "SessionHandoffSurface requires an ApplicationOrchestrator"
  );

  async function read() {
    return sessionHandoffFromBlackboard(await orchestrator.readBlackboard());
  }

  return Object.freeze({
    async initialize({ userIntent, items = [] }) {
      const intent = defineUserIntent(userIntent);
      invariant(Array.isArray(items), "items must be an array");
      const seeded = [intentRootItem(intent), ...items.map((item) => initialWorkItem(item, intent))];
      await orchestrator.seed(seeded);
      return read();
    },
    read
  });
}
