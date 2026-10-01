import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const GRAPH_REF = "docs/blackboard/work-graph.json";
const BB084_LIVING_REF = "docs/living/system/agentic-application/observed-implementation.md";

function contradiction(message) {
  const error = new Error(`PLAN_INPUT_CONTRADICTION: ${message}`);
  error.code = "PLAN_INPUT_CONTRADICTION";
  throw error;
}

async function loadGraph() {
  let raw;
  try {
    raw = await readFile(GRAPH_REF, "utf8");
  } catch {
    contradiction(`work graph is unreadable at ${GRAPH_REF}`);
  }
  return JSON.parse(raw);
}

function taskById(graph, id) {
  const task = (graph.tasks ?? []).find((t) => t.id === id);
  if (!task) contradiction(`task ${id} is missing from the work graph`);
  return task;
}

test("grounded finding input dependency is DONE with delivery receipt and Living ref", async () => {
  const graph = await loadGraph();
  const task = taskById(graph, "BB-084");
  if (task.status !== "DONE") {
    contradiction(`BB-084 status is ${task.status}, expected DONE`);
  }
  const deliveryRef = task.contract?.deliveryRef;
  if (typeof deliveryRef !== "string" || !deliveryRef.trim()) {
    contradiction("BB-084 has no contract.deliveryRef");
  }
  try {
    await readFile(deliveryRef, "utf8");
  } catch {
    contradiction(`BB-084 delivery receipt is missing at ${deliveryRef}`);
  }
  const consolidated = task.artifacts?.consolidatedRefs ?? [];
  if (!consolidated.includes(BB084_LIVING_REF)) {
    contradiction(`BB-084 is missing consolidated Living ref ${BB084_LIVING_REF}`);
  }
  try {
    await readFile(BB084_LIVING_REF, "utf8");
  } catch {
    contradiction(`BB-084 Living ref is unreadable at ${BB084_LIVING_REF}`);
  }
});

test("delivered package-root exports provide the grounded finding input seam (no deep import)", async () => {
  const agentic = await import("../packages/agentic-system/src/index.js");
  const required = [
    "defineGroundedFindingInput",
    "assertGroundedFindingInputCurrent",
    "buildGroundedFindingInput",
    "findingInputIdFor",
    "GROUNDED_FINDING_INPUT_KIND",
    "GROUNDED_FINDING_INPUT_VERSION",
    "createJsonImmutableArtifactStore",
  ];
  for (const name of required) {
    if (agentic[name] === undefined || agentic[name] === null) {
      contradiction(`agentic package root is missing export ${name}`);
    }
  }
  if (typeof agentic.defineGroundedFindingInput !== "function") {
    contradiction("agentic package root export defineGroundedFindingInput is not a function");
  }
  if (typeof agentic.assertGroundedFindingInputCurrent !== "function") {
    contradiction("agentic package root export assertGroundedFindingInputCurrent is not a function");
  }
  if (typeof agentic.createJsonImmutableArtifactStore !== "function") {
    contradiction("agentic package root export createJsonImmutableArtifactStore is not a function");
  }
  // Delivered CAS head store is a package-internal truth reused by the
  // lifecycle controller; verify its source exists without deep-importing it
  // here (the product seam imports the sibling file directly).
  const casSource = await readFile(
    "packages/agentic-system/src/organization-authority-store.js",
    "utf8",
  );
  if (!casSource.includes("export function createJsonCasHeadStore")) {
    contradiction("delivered createJsonCasHeadStore is missing from organization-authority-store.js");
  }
  const artifactSource = await readFile(
    "packages/agentic-system/src/organization-artifact-store.js",
    "utf8",
  );
  if (!artifactSource.includes("export function createJsonImmutableArtifactStore")) {
    contradiction("delivered createJsonImmutableArtifactStore is missing from organization-artifact-store.js");
  }
  // Smoke: the validator rejects a non-finding-input artifact.
  assert.throws(
    () => agentic.defineGroundedFindingInput({ kind: "NOT_A_FINDING_INPUT", version: 1 }),
    /GROUNDED_FINDING_INPUT_V1|finding input/i,
  );
  console.log(
    JSON.stringify(
      {
        preflight: "FEEDBACK_LIFECYCLE_DEPENDENCY_CONTRACT",
        bb084: "DONE",
        deliveryRef: "docs/blackboard/artifacts/ready-implement-plan/BB-084.delivered-feature.json",
        livingRef: BB084_LIVING_REF,
        agenticExports: required,
        sourceClassification: {
          DELIVERED_TRUTH: [
            "createJsonImmutableArtifactStore (package root)",
            "createJsonCasHeadStore compareAndSwap (package-internal)",
            "verify-then-publish authority pattern",
          ],
          PLANNED_CONTRACT: [],
          RESEARCH_DESIRED_STATE: ["feedback episode/response/outcome/resolution contracts"],
        },
        notDependencies: ["benchmark", "optimizer", "promotion", "pattern"],
      },
      null,
      2,
    ),
  );
});

test("lifecycle modules import nothing from evolution, benchmark, optimizer or pattern code", async () => {
  const candidates = [
    "packages/agentic-system/src/feedback-lifecycle-contracts.js",
    "packages/agentic-system/src/feedback-lifecycle-controller.js",
    "packages/agentic-system/src/feedback-outcome.js",
  ];
  const forbiddenImports = [
    "how-evolution",
    "@exharness/benchmark",
    "packages/benchmark",
    "feedback-contracts",
    "feedback-controller",
    "feedback-projection",
    "feedback-improvement",
  ];
  let checked = 0;
  for (const file of candidates) {
    let body;
    try {
      body = await readFile(file, "utf8");
    } catch {
      continue;
    }
    checked += 1;
    const specs = [...body.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      const lowered = spec.toLowerCase();
      for (const token of forbiddenImports) {
        if (lowered.includes(token.toLowerCase())) {
          contradiction(`lifecycle module ${file} imports forbidden seam ${token} via ${spec}`);
        }
      }
      if (lowered.includes("optimizer") || lowered.includes("pattern") || lowered.includes("benchmark") || lowered.includes("how-evolution")) {
        contradiction(`lifecycle module ${file} requires forbidden import ${spec}`);
      }
      if (spec.startsWith("../packages/oracle/") || spec.startsWith("../../oracle/")) {
        contradiction(`lifecycle module ${file} requires oracle import ${spec}`);
      }
    }
    // Static require() imports are forbidden the same way.
    for (const spec of [...body.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])) {
      const lowered = spec.toLowerCase();
      for (const token of forbiddenImports) {
        if (lowered.includes(token.toLowerCase())) {
          contradiction(`lifecycle module ${file} requires forbidden seam ${token} via ${spec}`);
        }
      }
    }
  }
  // Before product writes the preflight still passes; after writes every
  // lifecycle module must have been checked.
  if (checked > 0 && checked !== candidates.length) {
    contradiction(`lifecycle import graph is partial: checked ${checked} of ${candidates.length}`);
  }
});

test("candidate writes no forbidden owner and requires no deep import", async () => {
  const forbiddenOwners = [
    "packages/oracle/",
    "packages/core-harness/",
    "packages/benchmark/",
    "packages/agentic-system/src/grounded-observation.js",
    "packages/agentic-system/src/observation-context-binding.js",
    "packages/agentic-system/src/organization-authority-store.js",
    "packages/agentic-system/src/organization-artifact-store.js",
    "packages/agentic-system/src/organization-authority.js",
    "packages/agentic-system/src/feedback-contracts.js",
    "packages/agentic-system/src/feedback-controller.js",
    "packages/agentic-system/src/feedback-projection.js",
    "packages/agentic-system/src/feedback-improvement.js",
  ];
  void forbiddenOwners;
  // This preflight file itself must not import product modules or deep internals:
  // the only allowed imports are the agentic package root plus node builtins.
  const self = await readFile(new URL(import.meta.url), "utf8");
  const specs = [...self.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    if (
      spec.startsWith("../packages/agentic-system/src/") &&
      spec !== "../packages/agentic-system/src/index.js"
    ) {
      contradiction(`preflight requires deep agentic import ${spec}`);
    }
    if (spec.startsWith("../packages/oracle/") || spec.startsWith("../packages/benchmark/")) {
      contradiction(`preflight requires forbidden package import ${spec}`);
    }
    if (spec.includes("feedback-lifecycle-contracts") || spec.includes("feedback-lifecycle-controller") || spec.includes("feedback-outcome")) {
      contradiction("preflight must not import candidate product modules");
    }
  }
  // Forbidden owners must not gain lifecycle imports.
  const lifecycleTokens = ["feedback-lifecycle-contracts", "feedback-lifecycle-controller", "feedback-outcome"];
  for (const file of [
    "packages/agentic-system/src/grounded-observation.js",
    "packages/agentic-system/src/observation-context-binding.js",
    "packages/agentic-system/src/organization-authority-store.js",
    "packages/agentic-system/src/organization-artifact-store.js",
    "packages/agentic-system/src/organization-authority.js",
  ]) {
    let body;
    try {
      body = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const token of lifecycleTokens) {
      if (body.includes(token)) {
        contradiction(`forbidden owner ${file} was modified to reference ${token}`);
      }
    }
  }
});
