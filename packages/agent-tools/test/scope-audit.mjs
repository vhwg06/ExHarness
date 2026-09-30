#!/usr/bin/env node
// BB-098 scope audit. As a script it compares the candidate diff against the READY plan's
// sourceScope (write / forbiddenWrite) and exits non-zero on any violation. The matcher is
// exported for tests, which need no git history.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLAN_REF = "docs/blackboard/artifacts/ready-implement-plan/BB-098.json";

export function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") { pattern += ".*"; index += 1; }
    else if (char === "*") pattern += "[^/]*";
    else pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/** Returns { allowed, outOfScope, forbidden } for a list of changed repository paths. */
export function auditPaths(paths, { write, forbiddenWrite }) {
  const matches = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path));
  const forbidden = paths.filter((path) => matches(path, forbiddenWrite));
  const outOfScope = paths.filter((path) => !matches(path, write) && !forbidden.includes(path));
  return { allowed: paths.filter((path) => matches(path, write) && !forbidden.includes(path)), outOfScope, forbidden };
}

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
