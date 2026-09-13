import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-cognition-eval-"));

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
  assert.equal(result.reference, "observe-memory-act-v1");
  assert.equal(result.success, true);
  const m = result.metrics;
  assert.equal(m.taskSuccess, 1);
  assert.equal(m.modelTurns, 3);
  assert.equal(m.javascriptCells, 3);
  assert.ok(m.hostCalls >= 10);
  assert.equal(m.observations, 2);
  assert.equal(m.episodicMemories, 2);
  assert.equal(m.reflectionMemories, 1);
  assert.equal(m.retrievalCalls, 2);
  assert.equal(m.graphRelations, 2);
  assert.equal(m.finalRecallGraphHit, 1);
  assert.equal(m.evolutionCommits, 1);
  assert.equal(m.contextResolutions, 3);
  assert.equal(m.recallTraceSpans, 2);
  assert.equal(m.observationTraceLinks, 2);
  assert.equal(m.observationMemoryLinks, 2);
  assert.equal(m.earlyPromoteRejected, 1);
  assert.equal(m.evaluationPass, 1);
  assert.equal(m.lineageAdvanced, 1);
  assert.equal(m.falseSuccessCount, 0);
  assert.equal(m.unsafeAcceptCount, 0);
  assert.deepEqual(m.phaseByTurn, ["initial", "mutated", "mutated"]);
  assert.equal(m.historyEventsByTurn.length, 3);
  assert.equal(m.historyEventsByTurn[0], 0);
  assert.ok(m.historyEventsByTurn[1] > m.historyEventsByTurn[0]);
  assert.ok(m.historyEventsByTurn[2] > m.historyEventsByTurn[1]);

  assert.deepEqual(result.provenance.retriever, { name: "cognition-reference-index", version: "v1" });
  assert.equal(result.provenance.retrievalSemantics, "RELEVANCE_ONLY");
  assert.equal(result.provenance.rankingModel, "WEIGHTED_FUSION_V1");
  assert.equal(result.provenance.evolutionAtomicity, "CAS_GUARDED_MULTI_STEP");
  assert.equal(result.provenance.observationIds.length, 2);
  assert.equal(result.provenance.memoryIds.length, 3);
  assert.equal(result.provenance.relationIds.length, 2);
  assert.equal(result.provenance.finalCandidate.version, "v1");
  assert.equal(result.provenance.lineageHead.version, "v1");
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
  await copyFile(join(root, "examples", "cognition-reference-consumer.mjs"), join(temp, "consumer.mjs"));
  await copyFile(join(root, "scripts", "reference-javascript-session-executor.mjs"), join(temp, "reference-executor.mjs"));
  await copyFile(join(root, "scripts", "javascript-codeact-worker.mjs"), join(temp, "worker.mjs"));

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });
  const output = run("node", ["consumer.mjs"], { cwd: temp });
  const lines = output.split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  validate(result);
  console.log(`cognition-eval-candidate:${JSON.stringify(result)}`);

  const expected = JSON.parse(await readFile(join(root, "artifacts", "cognition-eval.json"), "utf8"));
  assert.deepEqual(result, expected, "cognition evaluation drifted from its measured stable artifact");
  console.log(`cognition-eval:${JSON.stringify(result)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
