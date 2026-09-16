import { isDeepStrictEqual } from "node:util";
import {
  BlackboardStatus,
  createApplicationOrchestrator as createBaseApplicationOrchestrator
} from "./blackboard-orchestrator.js";

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

function terminalSnapshot(item) {
  return JSON.stringify(item);
}

function findItem(snapshot, itemId) {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
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
        const before = clone(snapshot);
        const result = await mutator(snapshot);
        assertSupersededItemsRemainImmutable(before, snapshot);
        return result;
      });
    }
  });
}

export function createApplicationOrchestrator({ store, reviewTrust }) {
  const guardedStore = guardTerminalCancellation(store);
  const orchestrator = createBaseApplicationOrchestrator({
    store: guardedStore,
    reviewTrust
  });

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

    return freezeClone(await guardedStore.transact((snapshot) => {
      const item = findItem(snapshot, itemId);
      invariant(item.status === BlackboardStatus.BLOCKED, `Blackboard item ${itemId} must be BLOCKED before blocked-checkpoint resolution`);
      invariant(item.owner == null, `Blackboard item ${itemId} cannot resolve a blocked checkpoint while owned`);
      invariant(
        isDeepStrictEqual(item.checkpoint, expectedCheckpoint),
        `Blackboard item ${itemId} blocked checkpoint changed before resolution`
      );

      item.checkpoint = clone(checkpoint);
      item.checkpointedBy = checkpointedBy;
      item.owner = null;
      item.blockers = [];
      item.status = BlackboardStatus.REOPENED;
      return clone(item);
    }));
  }

  return Object.freeze({
    ...orchestrator,
    resolveBlockedCheckpoint
  });
}
