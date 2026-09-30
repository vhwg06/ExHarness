#!/usr/bin/env node
// Regenerates benchmarks/agent-tools/fixtures from the definitions below. Each fixture is
// repo/** (the agent-visible base with visible tests), hidden/** (held-out tests copied only into
// the independent evaluation checkout), solution.patch (git diff base..solution) and task.json.
// Run: node benchmarks/agent-tools/build-fixtures.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const visible = { name: "visible", command: "node", args: ["--test", "test/visible.test.mjs"], timeoutMs: 60000 };
const hidden = { name: "hidden", command: "node", args: ["--test", "test/hidden.test.mjs"], timeoutMs: 60000 };
const header = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';

const FIXTURES = [
  {
    id: "bug-sum", category: "bug-fix",
    prompt: "sum(a, b) in sum.mjs returns the wrong result. Fix it so it returns the sum of its two arguments. Run `node --test test/visible.test.mjs` to check.",
    base: { "sum.mjs": "export const sum = (a, b) => a - b;\n" },
    solution: { "sum.mjs": "export const sum = (a, b) => a + b;\n" },
    visible: `${header}import { sum } from "../sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n`,
    hidden: `${header}import { sum } from "../sum.mjs";\ntest("sum handles negatives and zero", () => { assert.equal(sum(-4, 1), -3); assert.equal(sum(0, 0), 0); assert.equal(sum(10, 5), 15); });\n`
  },
  {
    id: "bug-clamp", category: "bug-fix",
    prompt: "clamp(value, min, max) in clamp.mjs does not clamp correctly. Fix it so the result is always within [min, max]. Run `node --test test/visible.test.mjs` to check.",
    base: { "clamp.mjs": "export function clamp(value, min, max) {\n  if (value < min) return max;\n  if (value > max) return min;\n  return value;\n}\n" },
    solution: { "clamp.mjs": "export function clamp(value, min, max) {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}\n" },
    visible: `${header}import { clamp } from "../clamp.mjs";\ntest("clamp below min", () => { assert.equal(clamp(-5, 0, 10), 0); });\n`,
    hidden: `${header}import { clamp } from "../clamp.mjs";\ntest("clamp bounds", () => { assert.equal(clamp(15, 0, 10), 10); assert.equal(clamp(4, 0, 10), 4); assert.equal(clamp(0, 0, 10), 0); });\n`
  },
  {
    id: "feat-prefix", category: "feature",
    prompt: "Add and export addPrefix(prefix, value) in strings.mjs. It returns prefix + value, and returns value unchanged when it already starts with prefix. Run `node --test test/visible.test.mjs` to check.",
    base: { "strings.mjs": "export const upper = (value) => value.toUpperCase();\n" },
    solution: { "strings.mjs": "export const upper = (value) => value.toUpperCase();\nexport const addPrefix = (prefix, value) => (value.startsWith(prefix) ? value : prefix + value);\n" },
    visible: `${header}import * as strings from "../strings.mjs";\ntest("addPrefix prefixes", () => { assert.equal(strings.addPrefix("x-", "a"), "x-a"); });\n`,
    hidden: `${header}import { addPrefix, upper } from "../strings.mjs";\ntest("addPrefix is idempotent", () => { assert.equal(addPrefix("x-", "x-a"), "x-a"); assert.equal(addPrefix("", "a"), "a"); assert.equal(upper("a"), "A"); });\n`
  },
  {
    id: "feat-count", category: "feature",
    prompt: "Add and export countWords(text) in text.mjs. It returns the number of whitespace-separated words, and 0 for empty or blank text. Run `node --test test/visible.test.mjs` to check.",
    base: { "text.mjs": "export const trim = (text) => text.trim();\n" },
    solution: { "text.mjs": "export const trim = (text) => text.trim();\nexport const countWords = (text) => (text.trim() === \"\" ? 0 : text.trim().split(/\\s+/).length);\n" },
    visible: `${header}import * as text from "../text.mjs";\ntest("countWords counts", () => { assert.equal(text.countWords("a b c"), 3); });\n`,
    hidden: `${header}import { countWords } from "../text.mjs";\ntest("countWords edge cases", () => { assert.equal(countWords(""), 0); assert.equal(countWords("   "), 0); assert.equal(countWords("  one\\ttwo\\n three "), 3); });\n`
  },
  {
    id: "refactor-extract", category: "test-guided-refactor",
    prompt: "Extract the name formatting in user.mjs into a new module format.mjs that exports formatName(first, last). user.mjs must import and use it, and describe(user) must keep its output. Run `node --test test/visible.test.mjs` to check.",
    base: { "user.mjs": "export function describe(user) {\n  const name = `${user.last.toUpperCase()}, ${user.first}`;\n  return `${name} (${user.age})`;\n}\n" },
    solution: {
      "user.mjs": "import { formatName } from \"./format.mjs\";\n\nexport function describe(user) {\n  return `${formatName(user.first, user.last)} (${user.age})`;\n}\n",
      "format.mjs": "export const formatName = (first, last) => `${last.toUpperCase()}, ${first}`;\n"
    },
    visible: `${header}import { existsSync } from "node:fs";\ntest("format.mjs exists", () => { assert.ok(existsSync(new URL("../format.mjs", import.meta.url))); });\n`,
    hidden: `${header}import { readFileSync } from "node:fs";\nimport { formatName } from "../format.mjs";\nimport { describe } from "../user.mjs";\ntest("extracted formatter is used", () => { assert.equal(formatName("Ada", "Lovelace"), "LOVELACE, Ada"); assert.equal(describe({ first: "Ada", last: "Lovelace", age: 36 }), "LOVELACE, Ada (36)"); assert.match(readFileSync(new URL("../user.mjs", import.meta.url), "utf8"), /format\\.mjs/); });\n`
  },
  {
    id: "refactor-rename", category: "test-guided-refactor",
    prompt: "Rename the exported function calc in cart.mjs to computeTotal, and update checkout.mjs to use the new name. calc must no longer be exported. Run `node --test test/visible.test.mjs` to check.",
    base: {
      "cart.mjs": "export function calc(items) {\n  return items.reduce((total, item) => total + item.price * item.qty, 0);\n}\n",
      "checkout.mjs": "import { calc } from \"./cart.mjs\";\n\nexport const checkout = (items) => `total=${calc(items)}`;\n"
    },
    solution: {
      "cart.mjs": "export function computeTotal(items) {\n  return items.reduce((total, item) => total + item.price * item.qty, 0);\n}\n",
      "checkout.mjs": "import { computeTotal } from \"./cart.mjs\";\n\nexport const checkout = (items) => `total=${computeTotal(items)}`;\n"
    },
    visible: `${header}import * as cart from "../cart.mjs";\ntest("computeTotal is exported", () => { assert.equal(typeof cart.computeTotal, "function"); });\n`,
    hidden: `${header}import * as cart from "../cart.mjs";\nimport { checkout } from "../checkout.mjs";\ntest("rename is complete", () => { assert.equal(cart.calc, undefined); assert.equal(cart.computeTotal([{ price: 2, qty: 3 }, { price: 1, qty: 1 }]), 7); assert.equal(checkout([{ price: 5, qty: 2 }]), "total=10"); });\n`
  },
  {
    id: "multifile-split", category: "multi-file",
    prompt: "Split math.mjs into lib/add.mjs (exports add) and lib/mul.mjs (exports mul). math.mjs must re-export both from those modules and define no arithmetic itself. Run `node --test test/visible.test.mjs` to check.",
    base: { "math.mjs": "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n" },
    solution: {
      "math.mjs": "export { add } from \"./lib/add.mjs\";\nexport { mul } from \"./lib/mul.mjs\";\n",
      "lib/add.mjs": "export const add = (a, b) => a + b;\n",
      "lib/mul.mjs": "export const mul = (a, b) => a * b;\n"
    },
    visible: `${header}import { existsSync } from "node:fs";\ntest("lib modules exist", () => { assert.ok(existsSync(new URL("../lib/add.mjs", import.meta.url))); assert.ok(existsSync(new URL("../lib/mul.mjs", import.meta.url))); });\n`,
    hidden: `${header}import { readFileSync } from "node:fs";\nimport { add } from "../lib/add.mjs";\nimport { mul } from "../lib/mul.mjs";\nimport * as math from "../math.mjs";\ntest("split keeps behaviour", () => { assert.equal(add(2, 3), 5); assert.equal(mul(2, 3), 6); assert.equal(math.add(1, 1), 2); assert.equal(math.mul(3, 3), 9); assert.doesNotMatch(readFileSync(new URL("../math.mjs", import.meta.url), "utf8"), /=>/); });\n`
  },
  {
    id: "multifile-config", category: "multi-file",
    prompt: "greeting.mjs hard-codes the greeting. Add config.json with {\"greeting\": \"Hello\"} and make greet(name) in greeting.mjs read the greeting from config.json via loadConfig() exported from config.mjs. Run `node --test test/visible.test.mjs` to check.",
    base: { "greeting.mjs": "export const greet = (name) => `Hi, ${name}!`;\n" },
    solution: {
      "config.json": "{\n  \"greeting\": \"Hello\"\n}\n",
      "config.mjs": "import { readFileSync } from \"node:fs\";\n\nexport const loadConfig = () => JSON.parse(readFileSync(new URL(\"./config.json\", import.meta.url), \"utf8\"));\n",
      "greeting.mjs": "import { loadConfig } from \"./config.mjs\";\n\nexport const greet = (name) => `${loadConfig().greeting}, ${name}!`;\n"
    },
    visible: `${header}import { greet } from "../greeting.mjs";\ntest("greet uses Hello", () => { assert.equal(greet("Ada"), "Hello, Ada!"); });\n`,
    hidden: `${header}import { readFileSync } from "node:fs";\nimport { loadConfig } from "../config.mjs";\nimport { greet } from "../greeting.mjs";\ntest("greeting comes from config", () => { assert.deepEqual(loadConfig(), { greeting: "Hello" }); assert.equal(JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8")).greeting, "Hello"); assert.equal(greet("Bob"), "Hello, Bob!"); assert.match(readFileSync(new URL("../greeting.mjs", import.meta.url), "utf8"), /loadConfig/); });\n`
  }
];

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function git(cwd, ...args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@localhost.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@localhost.invalid", GIT_CONFIG_NOSYSTEM: "1" };
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

rmSync(ROOT, { recursive: true, force: true });
for (const fixture of FIXTURES) {
  const dir = join(ROOT, fixture.id);
  write(join(dir, "repo"), { ...fixture.base, "package.json": "{\n  \"type\": \"module\",\n  \"private\": true\n}\n", "test/visible.test.mjs": fixture.visible });
  write(join(dir, "hidden"), { "test/hidden.test.mjs": fixture.hidden });
  const scratch = mkdtempSync(join(tmpdir(), "agent-tools-fixture-"));
  try {
    write(scratch, { ...fixture.base, "package.json": "{\n  \"type\": \"module\",\n  \"private\": true\n}\n", "test/visible.test.mjs": fixture.visible });
    git(scratch, "init", "-q");
    git(scratch, "add", "-A");
    git(scratch, "commit", "-q", "-m", "base");
    write(scratch, fixture.solution);
    git(scratch, "add", "-A");
    writeFileSync(join(dir, "solution.patch"), git(scratch, "diff", "--cached", "--binary"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(join(dir, "task.json"), `${JSON.stringify({ id: fixture.id, category: fixture.category, prompt: fixture.prompt, visibleVerifications: [visible], hiddenVerifications: [hidden] }, null, 2)}\n`);
}
writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify({ kind: "AGENT_TOOLS_SUITE_V1", version: 1, fixtures: FIXTURES.map((fixture) => fixture.id) }, null, 2)}\n`);
console.log(`wrote ${FIXTURES.length} fixtures to ${ROOT}`);
