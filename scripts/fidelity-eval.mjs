import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-fidelity-eval-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function validate(result) {
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.reference, "nooa-fidelity-v1");
  assert.equal(result.success, true);
  assert.equal(result.baseline.taskSuccess, 1);
  assert.equal(result.fidelity.taskSuccess, 1);
  assert.equal(result.comparison.sameTaskResult, true);
  assert.ok(result.baseline.modelTurns > result.fidelity.modelTurns);
  assert.ok(result.comparison.modelTurnReduction > 0);
  assert.ok(result.fidelity.codeCells >= 2);
  assert.ok(result.fidelity.hostCalls > 0);
  assert.ok(result.fidelity.corrections > 0);
  assert.ok(result.fidelity.initialContextChars < result.fidelity.discoveredContextChars);
  assert.ok(result.fidelity.progressiveDisclosureRatio > 0 && result.fidelity.progressiveDisclosureRatio < 1);
  assert.ok(result.fidelity.handleRejections >= 2);
  assert.ok(result.fidelity.sandboxFailuresObserved >= 2);
  assert.equal(result.fidelity.traceCorrelation, 1);
  assert.ok(result.fidelity.correlatedSpanCount > 0);
  assert.equal(result.fidelity.snapshotRebindFidelity, 1);
  assert.equal(result.fidelity.avoComposition, 1);
  assert.equal(result.fidelity.packedConsumerSuccess, 1);
  assert.equal(result.fidelity.falseSuccessCount, 0);
  assert.equal(result.fidelity.unsafeAcceptCount, 0);
  for (const [name, rubric] of Object.entries(result.rubric)) {
    assert.ok(rubric.score >= 90, `${name} score fell below 90: ${rubric.score}`);
    assert.equal(rubric.passed, rubric.total);
  }
  assert.equal(result.adversarial.passes, result.adversarial.checks);
  assert.ok(result.adversarial.checks >= 8);
  assert.ok(result.adversarial.forcedProcessKills >= 1);
  assert.equal(result.adversarial.outputTruncated, true);
}

try {
  const packed = JSON.parse(run("npm", [
    "pack",
    "./packages/core-harness",
    "--pack-destination",
    temp,
    "--json"
  ]));
  const tarball = join(temp, packed[0].filename);
  await writeFile(join(temp, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { exharness: `file:${tarball}` }
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  await copyFile(join(root, "examples", "fidelity-reference-consumer.mjs"), join(temp, "fidelity-reference-consumer.mjs"));
  await copyFile(join(root, "scripts", "javascript-codeact-worker.mjs"), join(temp, "worker.mjs"));
  await copyFile(join(root, "scripts", "reference-javascript-session-executor.mjs"), join(temp, "reference-executor.mjs"));

  const output = run("node", ["fidelity-reference-consumer.mjs"], { cwd: temp });
  const result = JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
  validate(result);
  console.log(`fidelity-eval:${JSON.stringify(result)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
