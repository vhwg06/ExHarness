// BB-086 I1 — Dependency preflight (D12, SI5).
//
// Binds ONLY DONE BB-085 (feedback resolution), BB-059 (HOW evolution) and
// BB-065 (benchmark) package-ROOT exports. Any missing/incompatible export,
// forbidden dependency, or forbidden-path write exits PLAN_INPUT_CONTRADICTION.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// Bind through package roots only — no deep imports (D12).
const agentic = await import("../packages/agentic-system/src/index.js");
const benchmark = await import("../packages/benchmark/src/index.js");

function requireExport(ns, name, type, task) {
  const value = ns[name];
  if (typeof value !== type) {
    throw new Error(`PLAN_INPUT_CONTRADICTION: BB-0${task} delivery missing ${name} (expected ${type}, got ${typeof value})`);
  }
  return value;
}

test("BB-085 FEEDBACK_RESOLUTION_V1 package-root exports are bound", () => {
  assert.equal(agentic.FEEDBACK_RESOLUTION_KIND, "FEEDBACK_RESOLUTION_V1");
  requireExport(agentic, "defineFeedbackResolution", "function", 85);
});

test("BB-059 HOW evolution package-root exports are bound", () => {
  requireExport(agentic, "defineHowEvolutionFinding", "function", 59);
  requireExport(agentic, "defineHowEvolutionEvaluationProtocol", "function", 59);
  requireExport(agentic, "publishHowEvolutionPromotion", "function", 59);
  assert.ok(
    agentic.HOW_EVOLUTION_PROTOCOL_VERSION !== undefined,
    "PLAN_INPUT_CONTRADICTION: BB-059 delivery missing HOW_EVOLUTION_PROTOCOL_VERSION",
  );
});

test("BB-065 @exharness/benchmark package-root exports are bound", () => {
  requireExport(benchmark, "createExperimentRegistration", "function", 65);
  requireExport(benchmark, "createBenchmarkUnit", "function", 65);
  requireExport(benchmark, "AttemptLedger", "function", 65);
  requireExport(benchmark, "createEvidenceManifest", "function", 65);
  requireExport(benchmark, "normalizeAccounting", "function", 65);
  requireExport(benchmark, "auditAttempt", "function", 65);
});

function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (p.endsWith(".js") || p.endsWith(".mjs")) out.push(p);
  }
  return out;
}

test("no LangMem/DSPy/LangGraph/gepa dependency in packages/agentic-system/src", () => {
  const tokens = ["langmem", "dspy", "langgraph", "gepa"];
  const hits = [];
  for (const file of walkJs(join(repoRoot, "packages/agentic-system/src"))) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const token of tokens) {
      if (text.includes(token)) hits.push(`${file.split("src/")[1] || file} contains ${token}`);
    }
  }
  assert.deepEqual(hits, [], `PLAN_INPUT_CONTRADICTION: forbidden dependency token found:\n${hits.join("\n")}`);
});

test("docs/blackboard/** and scripts/feedback/** are unmodified vs origin/main merge-base", () => {
  const mergeBase = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const committed = execFileSync(
    "git",
    ["diff", "--name-only", mergeBase, "--", "docs/blackboard", "scripts/feedback"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const untracked = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("??"))
    .map((s) => s.slice(2).trim())
    .filter(
      (s) => s.startsWith("docs/blackboard/") || s.startsWith("scripts/feedback/"),
    );
  const changed = [...committed, ...untracked];
  assert.deepEqual(
    changed,
    [],
    `PLAN_INPUT_CONTRADICTION: forbidden BB-083 ownership paths changed vs merge-base:\n${changed.join("\n")}`,
  );
});
