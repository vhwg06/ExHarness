import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-reference-eval-"));

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
  assert.equal(result.reference, "nooa-substrate-v1");
  assert.equal(result.success, true);

  const m = result.metrics;
  assert.equal(m.taskSuccess, 1);
  assert.ok(m.modelCalls > 0);
  assert.ok(m.invalidOutputs > 0);
  assert.ok(m.invalidOutputRate > 0 && m.invalidOutputRate < 1);
  assert.ok(m.correctionRetryCount > 0);
  assert.ok(m.validationErrorEvents > 0);
  assert.ok(m.modelOutputEvents >= m.modelCalls - 1);
  assert.equal(m.capabilityCallsInVariation, 3);
  assert.equal(m.resourceInvocations, 1);
  assert.equal(m.executorCalls, 1);
  assert.equal(m.promptContext.noHistoryEvents, 0);
  assert.equal(m.promptContext.selectedHistoryEvents, 2);
  assert.ok(m.promptContext.selectedHistoryChars > m.promptContext.noHistoryChars);
  assert.ok(m.nestedSpanCount > 0);
  assert.ok(m.traceFailureCount > 0);
  assert.ok(m.observabilityFailureCount > 0);
  assert.equal(m.falseSuccessCount, 0);
  assert.equal(m.unsafeAcceptCount, 0);
  assert.equal(m.resumeFidelity, 1);
  assert.ok(m.snapshotRedactions.resourceRefs > 0);
  assert.equal(m.adversarialPasses, m.adversarialChecks);
  assert.ok(m.adversarialChecks >= 7);
  assert.equal(m.modelLoadsByName["never-loaded"], undefined);

  assert.equal(result.provenance.predictRoute.scope, "JUDGMENT");
  assert.ok(result.provenance.predictUsage.calls > 0);
  assert.equal(result.provenance.invocationOverrideRoute.scope, "INVOCATION");
  assert.equal(result.provenance.invocationOverrideUsage.calls, 1);
  assert.equal(result.provenance.routeOnlyUsage.calls, 0);
  assert.equal(result.provenance.evaluationVerdict, "PASS");
  assert.equal(result.provenance.lineageAdvanced, true);
}

function stableArtifact(result) {
  return {
    schemaVersion: result.schemaVersion,
    reference: result.reference,
    source: "packed-blank-consumer",
    metrics: result.metrics,
    provenance: {
      predictRoute: result.provenance.predictRoute,
      predictUsage: result.provenance.predictUsage,
      invocationOverrideRoute: result.provenance.invocationOverrideRoute,
      invocationOverrideUsage: result.provenance.invocationOverrideUsage,
      routeOnlyRoute: result.provenance.routeOnlyRoute,
      routeOnlyUsage: result.provenance.routeOnlyUsage,
      evaluationVerdict: result.provenance.evaluationVerdict,
      lineageAdvanced: result.provenance.lineageAdvanced
    },
    excludedDynamicFields: [
      "provenance.snapshotDigest",
      "provenance.evaluationId"
    ]
  };
}

try {
  const packOutput = run("npm", ["pack", "./packages/core-harness", "--pack-destination", temp, "--json"]);
  const packed = JSON.parse(packOutput);
  const tarball = join(temp, packed[0].filename);
  await writeFile(join(temp, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { exharness: `file:${tarball}` }
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  await copyFile(
    join(root, "examples", "reference-substrate-consumer.mjs"),
    join(temp, "reference-substrate-consumer.mjs")
  );
  const output = run("node", ["reference-substrate-consumer.mjs"], { cwd: temp });
  const lines = output.split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  validate(result);

  const expected = JSON.parse(await readFile(
    join(root, "artifacts", "nooa-reference-eval.json"),
    "utf8"
  ));
  assert.deepEqual(
    stableArtifact(result),
    expected,
    "reference evaluation drifted from its measured stable artifact"
  );

  console.log(`reference-eval:${JSON.stringify(result)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
