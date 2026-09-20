import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const probePath = join(repositoryRoot, "scripts/stateful-research-eval.mjs");
const expectedPath = join(repositoryRoot, "artifacts/bb026-stateful-research-probe.json");

test("BB-026 research continuation proof matches checked evidence and measures restart-safe selection", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [probePath], {
    cwd: repositoryRoot,
    maxBuffer: 1024 * 1024
  });
  assert.equal(stderr, "");

  const actual = JSON.parse(stdout);
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  assert.deepEqual(actual, expected);

  assert.equal(actual.metrics.freshProcessArtifactReadCount, 1);
  assert.equal(actual.metrics.actualExperimentDispatchCount, 1);
  assert.equal(actual.metrics.completedExperimentReplayCount, 0);
  assert.deepEqual(actual.continuation.sessionBDispatchExperimentIds, ["E2"]);
  assert.deepEqual(actual.continuation.sessionBSkippedCompletedIds, ["E1"]);
  assert.deepEqual(actual.continuation.sessionCDispatchExperimentIds, []);
  assert.deepEqual(actual.continuation.sessionCSkippedCompletedIds, ["E1", "E2"]);
});
