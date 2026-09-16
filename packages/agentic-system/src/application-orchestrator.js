import {
  BlackboardStatus,
  createApplicationOrchestrator as createBaseApplicationOrchestrator
} from "./blackboard-orchestrator.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
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

export function createApplicationOrchestrator({ store, reviewTrust }) {
  return createBaseApplicationOrchestrator({
    store: guardTerminalCancellation(store),
    reviewTrust
  });
}
