import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const probePath = "docs/living/knowledge/bb028-exact-artifact-identity-probe.mjs";
const artifactPath = "artifacts/bb028-exact-artifact-identity-probe.json";

test("BB-028 exact artifact identity controls fail closed even when resolver slots are hard-coded", async () => {
  const run = spawnSync(process.execPath, [probePath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const measured = JSON.parse(run.stdout);
  const recorded = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.deepEqual(measured, recorded);
  assert.equal(measured.baselineAccepted, measured.baselineCases);
  assert.equal(measured.escapedControls, 0);
  assert.ok(measured.controls.every((control) => control.failClosed && !control.accepted));
  assert.equal(measured.conclusion.exactArtifactIdentityRequired, true);
  assert.equal(measured.conclusion.hardCodedSlotKeyIsNotIdentityProof, true);
});
