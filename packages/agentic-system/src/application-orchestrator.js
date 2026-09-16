import {
  BlackboardStatus,
  createApplicationOrchestrator as createBaseApplicationOrchestrator,
  defineBlackboardSnapshot
} from "./blackboard-orchestrator.js";
import { diagnoseBlackboardDependencyGraph } from "./blackboard-graph.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function normalizeTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

function terminalSnapshot(item) {
  return JSON.stringify(item);
}

function assertSupersededItemsRemainImmutable(before, after) {
  const currentById = new Map(after.items.map((item) => [item.id, item]));

  for (const previous of before.items) {
    if (previous.status !== BlackboardStatus.SUPERSEDED) continue;

    const current = currentById.get(previous.id);
    invariant(current, `Blackboard item ${previous.id} is SUPERSEDED and cannot be removed`);
    invariant(
      terminalSnapshot(current) === terminalSnapshot(previous),
      `Blackboard item ${previous.id} is SUPERSEDED and cannot be mutated`
    );
  }
}

function guardTerminalCancellation(store) {
  invariant(
    store && typeof store.load === "function" && typeof store.transact === "function",
    "ApplicationOrchestrator requires a transactional Blackboard store"
  );

  return Object.freeze({
    load() {
      return store.load();
    },

    transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      return store.transact(async (snapshot) => {
        const before = structuredClone(snapshot);
        const result = await mutator(snapshot);
        assertSupersededItemsRemainImmutable(before, snapshot);
        return result;
      });
    }
  });
}

function findItem(snapshot, itemId) {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

const GRAPH_EXTENSION_STATUS = new Set([
  BlackboardStatus.READY,
  BlackboardStatus.REOPENED,
  BlackboardStatus.BLOCKED
]);

function normalizeFreshWork(raw, index) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `newItems[${index}] must be an object`);
  const item = defineBlackboardSnapshot({
    version: 1,
    items: [{
      ...structuredClone(raw),
      status: raw.status ?? BlackboardStatus.READY
    }]
  }).items[0];
  invariant(item.status === BlackboardStatus.READY, `newItems[${index}] must start READY`);
  invariant(item.owner == null, `newItems[${index}] cannot start claimed`);
  invariant(item.checkpoint == null, `newItems[${index}] cannot start with a checkpoint`);
  invariant(item.submission == null, `newItems[${index}] cannot start with a submission`);
  invariant(item.reviewRequirements.length === 0, `newItems[${index}] cannot start with review requirements`);
  invariant(item.reviews.length === 0, `newItems[${index}] cannot start with reviews`);
  invariant(item.findings.length === 0, `newItems[${index}] cannot start with findings`);
  invariant(item.origin != null, `newItems[${index}] requires explicit origin provenance`);
  return structuredClone(item);
}

function stableWorkSeed(item) {
  return {
    id: item.id,
    work: item.work,
    status: item.status,
    owner: item.owner,
    dependsOn: item.dependsOn,
    remainingWork: item.remainingWork,
    blockers: item.blockers,
    artifactRefs: item.artifactRefs,
    evidenceRefs: item.evidenceRefs,
    followUpRefs: item.followUpRefs,
    checkpoint: item.checkpoint,
    submission: item.submission,
    reviewRequirements: item.reviewRequirements,
    reviews: item.reviews,
    findings: item.findings,
    origin: item.origin
  };
}

function sameFreshWork(left, right) {
  return JSON.stringify(stableWorkSeed(left)) === JSON.stringify(stableWorkSeed(right));
}

function addUnique(target, values) {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

function normalizeDependencyEdges(rawEdges) {
  invariant(Array.isArray(rawEdges ?? []), "dependencyEdges must be an array");
  return (rawEdges ?? []).map((edge, index) => {
    invariant(edge && typeof edge === "object" && !Array.isArray(edge), `dependencyEdges[${index}] must be an object`);
    return Object.freeze({
      itemId: requireText(edge.itemId, `dependencyEdges[${index}].itemId`),
      dependencyId: requireText(edge.dependencyId, `dependencyEdges[${index}].dependencyId`)
    });
  });
}

function assertValidDependencyGraph(snapshot) {
  const issues = diagnoseBlackboardDependencyGraph(snapshot);
  invariant(
    issues.length === 0,
    `Blackboard dependency graph invalid after extension: ${issues.map((issue) => `${issue.code} ${issue.itemId} -> ${issue.dependencyId}`).join("; ")}`
  );
}

export function createApplicationOrchestrator({ store, reviewTrust }) {
  const guardedStore = guardTerminalCancellation(store);
  const base = createBaseApplicationOrchestrator({
    store: guardedStore,
    reviewTrust
  });

  async function extendWorkGraph({
    targetItemId,
    newItems = [],
    dependencyEdges = [],
    artifactRefs = [],
    evidenceRefs = [],
    blockers = []
  }) {
    requireText(targetItemId, "targetItemId");
    invariant(Array.isArray(newItems), "newItems must be an array");
    const edges = normalizeDependencyEdges(dependencyEdges);
    const normalizedArtifacts = normalizeTextArray(artifactRefs, "artifactRefs");
    const normalizedEvidence = normalizeTextArray(evidenceRefs, "evidenceRefs");
    const normalizedBlockers = normalizeTextArray(blockers, "blockers");
    const normalizedNewItems = newItems.map(normalizeFreshWork);

    return guardedStore.transact((snapshot) => {
      const target = findItem(snapshot, targetItemId);
      invariant(
        GRAPH_EXTENSION_STATUS.has(target.status),
        `Blackboard item ${targetItemId} cannot extend its work graph from ${target.status}`
      );

      const createdItemIds = [];
      for (const proposed of normalizedNewItems) {
        const existing = snapshot.items.find((candidate) => candidate.id === proposed.id) ?? null;
        if (existing != null) {
          invariant(sameFreshWork(existing, proposed), `Blackboard work graph extension conflicts with existing item ${proposed.id}`);
          continue;
        }
        snapshot.items.push(structuredClone(proposed));
        createdItemIds.push(proposed.id);
      }

      for (const edge of edges) {
        const item = findItem(snapshot, edge.itemId);
        findItem(snapshot, edge.dependencyId);
        invariant(edge.itemId !== edge.dependencyId, `Blackboard dependency cannot self-reference: ${edge.itemId}`);
        invariant(
          GRAPH_EXTENSION_STATUS.has(item.status),
          `Blackboard item ${edge.itemId} cannot add a dependency from ${item.status}`
        );
        addUnique(item.dependsOn, [edge.dependencyId]);
      }

      addUnique(target.artifactRefs, normalizedArtifacts);
      addUnique(target.evidenceRefs, normalizedEvidence);
      if (normalizedBlockers.length > 0) {
        addUnique(target.blockers, normalizedBlockers);
        target.owner = null;
        target.status = BlackboardStatus.BLOCKED;
      }

      assertValidDependencyGraph(snapshot);
      return structuredClone({
        target,
        createdItemIds,
        dependencyEdges: edges
      });
    });
  }

  return Object.freeze({
    ...base,
    extendWorkGraph
  });
}
