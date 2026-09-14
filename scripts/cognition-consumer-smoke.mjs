import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-cognition-consumer-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
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

  const consumer = `
import {
  ActionIntentStatus,
  ActionIntentTargetKind,
  createDeliberationController
} from "exharness/cognition";
import { verifyReflectionGroundingContract } from "exharness/testing";

const contract = await verifyReflectionGroundingContract();
if (!contract.passed) throw new Error("reflection grounding contract failed");

const controller = createDeliberationController();
const step = controller.deliberate({
  callId: "packed-cognition",
  intent: "inspect before acting",
  expectedOutcome: "observation proves the action result",
  successCondition: "result artifact is linked",
  action: {
    target: ActionIntentTargetKind.CAPABILITY,
    name: "consumer.noop",
    input: { ok: true }
  }
});
const executed = await controller.execute(step.actionIntent.artifactRef, async () => ({
  artifactRef: { kind: "OBSERVATION", id: "packed-observation" },
  ok: true
}));
if (executed.actionIntent.status !== ActionIntentStatus.EXECUTED) {
  throw new Error("packed action intent did not complete");
}
if (executed.actionIntent.outcomeRefs[0]?.id !== "packed-observation") {
  throw new Error("packed action intent lost outcome provenance");
}
console.log("cognition-consumer-smoke:ok");
`;
  await writeFile(join(temp, "consumer.mjs"), consumer);
  const output = run("node", ["consumer.mjs"], { cwd: temp });
  if (!output.includes("cognition-consumer-smoke:ok")) {
    throw new Error(`unexpected cognition consumer output: ${output}`);
  }
  console.log("cognition-consumer-smoke:ok");
} finally {
  await rm(temp, { recursive: true, force: true });
}
