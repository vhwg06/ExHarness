// Write-scope matcher for the evaluation deliverable. The experiment may only add its own
// modules, fixtures, test, CLI command and docs; kernel, Core, Oracle, agentic-system and the
// delivered agent-tools runtime modules are read-only for it.
export const EVAL_WRITE_SCOPE = Object.freeze([
  "packages/agent-tools/src/experiment/**",
  "packages/agent-tools/src/index.js",
  "packages/agent-tools/bin/exharness-agent.mjs",
  "packages/agent-tools/test/experiment.test.js",
  "benchmarks/agent-tools/**",
  "package.json",
  "docs/living/system/agent-tools/evaluation.md",
  "docs/living/system/agent-tools/state.md"
]);
export const EVAL_FORBIDDEN = Object.freeze([
  "packages/core-harness/**",
  "packages/oracle/**",
  "packages/agentic-system/**",
  "packages/benchmark/**",
  "packages/agent-tools/src/supervisor.js",
  "packages/agent-tools/src/run-trace.js",
  "packages/agent-tools/src/observation.js",
  "packages/agent-tools/src/output-parsers.js",
  "packages/agent-tools/src/redaction.js",
  "packages/agent-tools/src/report.js",
  "packages/agent-tools/src/tool-adapters.js",
  "packages/agent-tools/src/process-runner.js",
  "packages/agent-tools/test/agent-tools.test.js",
  "packages/agent-tools/test/run-trace.test.js",
  "packages/agent-tools/test/fixtures/fake-agent.mjs",
  ".github/**",
  "docs/blackboard/**"
]);

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}
const matches = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path));

/** Classifies changed paths; ok only when every path is inside the write scope and none is forbidden. */
export function auditPaths(paths, { allowed = EVAL_WRITE_SCOPE, forbidden = EVAL_FORBIDDEN } = {}) {
  if (!Array.isArray(paths)) throw new TypeError("auditPaths requires an array of repository-relative paths");
  const violations = [];
  for (const raw of paths) {
    const path = String(raw).replace(/\\/g, "/").replace(/^\.\//, "");
    if (matches(path, forbidden)) violations.push({ path, reason: "FORBIDDEN" });
    else if (!matches(path, allowed)) violations.push({ path, reason: "OUTSIDE_WRITE_SCOPE" });
  }
  return { ok: violations.length === 0, violations };
}
