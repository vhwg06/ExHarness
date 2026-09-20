import { createJsonBlackboardStore as createStructuralBlackboardStore } from "./blackboard-store.js";
import { defineBlackboardSnapshot as defineStructuralBlackboardSnapshot } from "./blackboard-orchestrator.js";

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

export const BlackboardDependencyIssueCode = Object.freeze({
  DANGLING_DEPENDENCY: "DANGLING_DEPENDENCY",
  SELF_DEPENDENCY: "SELF_DEPENDENCY",
  CYCLIC_DEPENDENCY: "CYCLIC_DEPENDENCY"
});

function dependencyIssues(snapshot) {
  const ids = new Set(snapshot.items.map((item) => item.id));
  const issues = [];

  for (const item of snapshot.items) {
    for (const dependency of item.dependsOn) {
      if (dependency === item.id) {
        issues.push({ code: BlackboardDependencyIssueCode.SELF_DEPENDENCY, itemId: item.id, dependencyId: dependency });
      } else if (!ids.has(dependency)) {
        issues.push({ code: BlackboardDependencyIssueCode.DANGLING_DEPENDENCY, itemId: item.id, dependencyId: dependency });
      }
    }
  }

  const state = new Map();
  const stack = [];
  const stackIndex = new Map();

  function visit(itemId) {
    state.set(itemId, "VISITING");
    stackIndex.set(itemId, stack.length);
    stack.push(itemId);
    const item = snapshot.items.find((candidate) => candidate.id === itemId);

    for (const dependency of item.dependsOn) {
      if (dependency === itemId || !ids.has(dependency)) continue;
      const dependencyState = state.get(dependency);
      if (dependencyState == null) {
        visit(dependency);
      } else if (dependencyState === "VISITING") {
        const start = stackIndex.get(dependency);
        issues.push({
          code: BlackboardDependencyIssueCode.CYCLIC_DEPENDENCY,
          itemId,
          dependencyId: dependency,
          cycle: [...stack.slice(start), dependency]
        });
      }
    }

    stack.pop();
    stackIndex.delete(itemId);
    state.set(itemId, "DONE");
  }

  for (const item of snapshot.items) if (state.get(item.id) == null) visit(item.id);
  return issues;
}

export function diagnoseBlackboardDependencyGraph(rawSnapshot = { version: 1, items: [] }) {
  const snapshot = defineStructuralBlackboardSnapshot(rawSnapshot);
  return freezeClone(dependencyIssues(snapshot));
}

function formatIssue(issue) {
  if (issue.code === BlackboardDependencyIssueCode.CYCLIC_DEPENDENCY) {
    return `${issue.code} ${issue.itemId} -> ${issue.dependencyId} (cycle: ${issue.cycle.join(" -> ")})`;
  }
  return `${issue.code} ${issue.itemId} -> ${issue.dependencyId}`;
}

export function defineBlackboardSnapshot(raw = { version: 1, items: [] }) {
  const snapshot = defineStructuralBlackboardSnapshot(raw);
  const issues = dependencyIssues(snapshot);
  invariant(issues.length === 0, `Blackboard dependency graph invalid: ${issues.map(formatIssue).join("; ")}`);
  return snapshot;
}

function normalizeDependencyRepairs(replacements) {
  invariant(Array.isArray(replacements), "Blackboard dependency repair replacements must be an array");
  invariant(replacements.length > 0, "Blackboard dependency repair requires at least one replacement");
  const seen = new Set();
  return replacements.map((replacement, index) => {
    invariant(replacement && typeof replacement === "object" && !Array.isArray(replacement), `Blackboard dependency repair replacements[${index}] must be an object`);
    const itemId = requireText(replacement.itemId, `Blackboard dependency repair replacements[${index}].itemId`);
    invariant(!seen.has(itemId), `Blackboard dependency repair has duplicate item ${itemId}`);
    seen.add(itemId);
    invariant(Array.isArray(replacement.dependsOn), `Blackboard dependency repair replacements[${index}].dependsOn must be an array`);
    return {
      itemId,
      dependsOn: [...new Set(replacement.dependsOn.map((dependency, dependencyIndex) =>
        requireText(dependency, `Blackboard dependency repair replacements[${index}].dependsOn[${dependencyIndex}]`)
      ))]
    };
  });
}

export function createJsonBlackboardStore(options) {
  const store = createStructuralBlackboardStore(options);

  return Object.freeze({
    async load() {
      return defineBlackboardSnapshot(await store.load());
    },

    async transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      return store.transact(async (snapshot) => {
        defineBlackboardSnapshot(snapshot);
        const result = await mutator(snapshot);
        defineBlackboardSnapshot(snapshot);
        return result;
      });
    },

    async withMutationFence(action) {
      invariant(typeof action === "function", "Blackboard store withMutationFence requires an action");
      return store.withMutationFence(async ({ token, snapshot }) => {
        return action(freezeClone({ token, snapshot: defineBlackboardSnapshot(snapshot) }));
      });
    },

    async diagnoseDependencyGraph() {
      return diagnoseBlackboardDependencyGraph(await store.load());
    },

    async repairDependencyGraph({ replacements } = {}) {
      const normalizedReplacements = normalizeDependencyRepairs(replacements);
      return store.transact((snapshot) => {
        const issuesBefore = dependencyIssues(defineStructuralBlackboardSnapshot(snapshot));
        invariant(issuesBefore.length > 0, "Blackboard dependency repair requires an invalid stored graph");

        for (const replacement of normalizedReplacements) {
          const item = snapshot.items.find((candidate) => candidate.id === replacement.itemId);
          invariant(item, `Blackboard dependency repair item not found: ${replacement.itemId}`);
          item.dependsOn = [...replacement.dependsOn];
        }

        defineBlackboardSnapshot(snapshot);
        return freezeClone({ issuesBefore, replacements: normalizedReplacements });
      });
    }
  });
}
