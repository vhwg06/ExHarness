import { createRequire } from "node:module";

// BB-083 S1 — Dependency convergence manifest.
//
// Before any product source write, the worker resolves the exact DONE
// implementation-result, judgment and Living refs for every direct
// dependency (BB-059 HOW evaluation/promotion, BB-064 Oracle foundation,
// BB-065 @exharness/benchmark) plus their delivered public exports.
//
// Any missing delivery, changed ownership, deep-import requirement or
// incompatible public contract exits PLAN_INPUT_CONTRADICTION: the worker
// returns to research instead of adapting the architecture.

const require = createRequire(import.meta.url);

function contradiction(message) {
  const error = new Error(`PLAN_INPUT_CONTRADICTION: ${message}`);
  error.code = "PLAN_INPUT_CONTRADICTION";
  throw error;
}

// Exact delivered public contracts (pinned at worker start).
const EXPECTED = Object.freeze({
  "BB-059": Object.freeze({
    owner: "packages/agentic-system/src/how-evolution.js",
    exports: Object.freeze([
      "defineHowEvolutionEvaluationProtocol",
      "defineHowEvolutionEvaluationRun",
      "defineHowEvolutionFinding",
      "evaluateHowEvolution",
      "createHowEvolutionPromotionProposal",
      "publishHowEvolutionPromotion",
      "assertHowEvolutionPromotionCurrentness",
    ]),
  }),
  "BB-064": Object.freeze({
    owner: "@exharness/oracle",
    exports: Object.freeze(["createOracleContextResolver"]),
  }),
  "BB-065": Object.freeze({
    owner: "@exharness/benchmark",
    exports: Object.freeze(["AttemptLedger"]),
  }),
});

function checkWorkGraphStatus(workGraph) {
  const tasks = [];
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (typeof node.id === "string" && node.id.startsWith("BB-")) tasks.push(node);
    for (const value of Object.values(node)) collect(value);
  };
  collect(workGraph);
  const byId = new Map();
  for (const t of tasks) byId.set(t.id, t);
  return byId;
}

function checkModuleExports(ownerLabel, moduleNamespace, expectedExports) {
  if (!moduleNamespace || typeof moduleNamespace !== "object") {
    contradiction(`${ownerLabel}: module namespace unavailable`);
  }
  for (const name of expectedExports) {
    if (typeof moduleNamespace[name] !== "function") {
      contradiction(`${ownerLabel}: expected public export '${name}' is missing or not a function`);
    }
  }
}

export async function resolveFeedbackDependencies({ workGraphJson } = {}) {
  if (!workGraphJson || typeof workGraphJson !== "object") {
    contradiction("work-graph JSON required for dependency convergence");
  }
  const byId = checkWorkGraphStatus(workGraphJson);
  const manifest = {};
  for (const [taskId, spec] of Object.entries(EXPECTED)) {
    const task = byId.get(taskId);
    if (!task) contradiction(`${taskId}: not found in work-graph`);
    if (task.status !== "DONE") {
      contradiction(`${taskId}: status is '${task.status}', expected DONE`);
    }
    manifest[taskId] = {
      status: task.status,
      lane: task.lane ?? null,
      owner: spec.owner,
      exports: [...spec.exports],
    };
  }

  // Verify delivered public exports are importable and functions.
  // BB-059 lives in this package; BB-064/BB-065 are workspace packages.
  const howEvolution = await import("./how-evolution.js");
  checkModuleExports("BB-059 packages/agentic-system/src/how-evolution.js", howEvolution, EXPECTED["BB-059"].exports);

  const oracle = await import("../../oracle/src/index.js");
  checkModuleExports("BB-064 @exharness/oracle", oracle, EXPECTED["BB-064"].exports);

  const benchmark = await import("../../benchmark/src/index.js");
  checkModuleExports("BB-065 @exharness/benchmark", benchmark, EXPECTED["BB-065"].exports);

  return Object.freeze(manifest);
}

export const FEEDBACK_DEPENDENCY_MANIFEST_VERSION = 1;
