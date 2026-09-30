#!/usr/bin/env node
// Task-context scope audit. As a script it compares the candidate diff against
// the READY plan's sourceScope (write / forbiddenWrite) and exits non-zero on
// any violation. The matcher is reused from scope-audit.mjs, which is the
// shared implementation tests assert against.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditPaths } from "./scope-audit.mjs";

export { auditPaths };

export const PLAN_REF = "docs/blackboard/artifacts/ready-implement-plan/BB-102.json";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const plan = JSON.parse(readFileSync(join(root, PLAN_REF), "utf8"));
  const base = process.env.SCOPE_AUDIT_BASE || git(root, ["merge-base", "HEAD", "origin/main"]);
  const paths = git(root, ["diff", "--name-only", "--no-renames", base, "HEAD"]).split("\n").filter(Boolean);
  const result = auditPaths(paths, plan.sourceScope);
  process.stdout.write(`${JSON.stringify({ base, checked: paths, ...result }, null, 2)}\n`);
  process.exitCode = result.outOfScope.length === 0 && result.forbidden.length === 0 ? 0 : 1;
}
