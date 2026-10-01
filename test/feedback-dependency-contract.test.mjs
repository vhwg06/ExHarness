import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveFeedbackDependencies,
  FEEDBACK_DEPENDENCY_MANIFEST_VERSION,
} from "../packages/agentic-system/src/feedback-dependencies.js";

async function loadWorkGraph() {
  const text = await readFile(
    new URL("../docs/blackboard/work-graph.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(text);
}

test("dependency convergence: BB-059/BB-064/BB-065 are DONE with exact public contracts", async () => {
  const workGraphJson = await loadWorkGraph();
  const manifest = await resolveFeedbackDependencies({ workGraphJson });
  assert.equal(FEEDBACK_DEPENDENCY_MANIFEST_VERSION, 1);
  for (const taskId of ["BB-059", "BB-064", "BB-065"]) {
    assert.equal(manifest[taskId].status, "DONE", `${taskId} must be DONE`);
    assert.ok(manifest[taskId].exports.length > 0, `${taskId} must declare exports`);
  }
  assert.deepEqual(manifest["BB-059"].exports, [
    "defineHowEvolutionEvaluationProtocol",
    "defineHowEvolutionEvaluationRun",
    "defineHowEvolutionFinding",
    "evaluateHowEvolution",
    "createHowEvolutionPromotionProposal",
    "publishHowEvolutionPromotion",
    "assertHowEvolutionPromotionCurrentness",
  ]);
  assert.deepEqual(manifest["BB-064"].exports, ["createOracleContextResolver"]);
  assert.deepEqual(manifest["BB-065"].exports, ["AttemptLedger"]);
  assert.ok(Object.isFrozen(manifest));
});

test("dependency convergence: non-DONE dependency exits PLAN_INPUT_CONTRADICTION", async () => {
  const workGraphJson = await loadWorkGraph();
  // Simulate BB-065 not DONE by patching the parsed graph.
  const patched = JSON.parse(JSON.stringify(workGraphJson));
  const stack = [patched];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node.id === "BB-065") node.status = "PLANNED";
    for (const value of Object.values(node)) stack.push(value);
  }
  await assert.rejects(
    () => resolveFeedbackDependencies({ workGraphJson: patched }),
    /PLAN_INPUT_CONTRADICTION.*BB-065/,
  );
});

test("dependency convergence: missing work-graph exits PLAN_INPUT_CONTRADICTION", async () => {
  await assert.rejects(
    () => resolveFeedbackDependencies({}),
    /PLAN_INPUT_CONTRADICTION/,
  );
});
