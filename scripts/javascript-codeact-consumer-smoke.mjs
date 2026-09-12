import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerSource = await readFile(join(root, "scripts", "javascript-codeact-worker.mjs"), "utf8");
const executorSource = await readFile(join(root, "scripts", "reference-javascript-session-executor.mjs"), "utf8");
const temp = await mkdtemp(join(tmpdir(), "exharness-js-codeact-consumer-"));

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
  await writeFile(join(temp, "worker.mjs"), workerSource);
  await writeFile(join(temp, "reference-executor.mjs"), executorSource);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  const consumer = `
import {
  ExHarnessErrorCode,
  createAgentRuntime,
  createJavaScriptCodeActStrategy,
  defineCapability,
  defineLiveObjectSurface
} from "exharness";
import { createReferenceJavaScriptExecutor } from "./reference-executor.mjs";

function sequenceModel(outputs) {
  let index = 0;
  return {
    name: "packed-js-codeact",
    version: "1",
    async generate(request) {
      if (index >= outputs.length) {
        throw new Error("unexpected model call after observations: " + JSON.stringify(request.observations?.slice(-3) ?? []));
      }
      return outputs[index++];
    }
  };
}

let nodeSurface;
nodeSurface = defineLiveObjectSurface({
  id: "packed.js-codeact.node",
  type: "PackedNode",
  methods: [
    { name: "child", resultSurface: () => nodeSurface },
    { name: "rename", mutates: true },
    { name: "getName" }
  ]
});

const child = {
  name: "before",
  child() { return null; },
  rename(name) { this.name = name; return this.name; },
  getName() { return this.name; }
};
const rootNode = {
  childNode: child,
  child() { return this.childNode; },
  rename(name) { this.name = name; return name; },
  getName() { return "root"; }
};

const executor = createReferenceJavaScriptExecutor("./worker.mjs", {
  abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED
});
const runtime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([
      {
        type: "execute_javascript",
        code: \`total = 0;
for (const n of [1, 2, 3]) total += await self.double(n);
childRef = await root.child();
childDoc = await doc(childRef, "FULL");
await childRef.rename("after");
name = await childRef.getName();
console.log("total", total);\`
      },
      {
        type: "execute_javascript",
        code: \`if (total !== 12) throw new Error("persistent total lost");
if (name !== "after") throw new Error("live mutation lost");
if (!childDoc.document.members.some((member) => member.name === "rename")) throw new Error("doc missing method");
await return_result({ total, name, discoveredMembers: childDoc.document.members.length });
afterTerminal = true;\`
      }
    ]),
    executor,
    maxDurationMs: 2_000
  }),
  capabilities: [defineCapability({
    name: "double",
    async execute(value) { return value * 2; }
  })],
  liveObjects: [{ name: "root", value: rootNode, surface: nodeSurface }]
});
const result = await runtime.run();
if (result.total !== 12 || result.name !== "after") {
  throw new Error("real JavaScript CodeAct result mismatch: " + JSON.stringify(result));
}
if (child.name !== "after") throw new Error("live object mutation hit a clone");
if (executor.metrics.cells !== 2) throw new Error("expected two real JavaScript cells");

const loopingExecutor = createReferenceJavaScriptExecutor("./worker.mjs", {
  abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED
});
const loopingRuntime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([{ type: "execute_javascript", code: "while (true) {}" }]),
    executor: loopingExecutor,
    maxTurns: 1,
    maxDurationMs: 100
  })
});
let infiniteLoopContained = false;
let infiniteLoopCode = null;
try {
  await loopingRuntime.run();
} catch (error) {
  infiniteLoopCode = error.code ?? null;
  infiniteLoopContained = [
    ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED,
    ExHarnessErrorCode.EXECUTION_ABORTED
  ].includes(infiniteLoopCode);
}
if (!infiniteLoopContained) throw new Error("infinite JavaScript loop was not bounded by the parent runtime");
if (loopingExecutor.metrics.forcedKills < 1) throw new Error("hung worker process was not terminated");

console.log(JSON.stringify({
  packed: true,
  result,
  cells: executor.metrics.cells,
  hostCalls: executor.metrics.hostCalls,
  executionErrors: executor.metrics.executionErrors,
  workerOpens: executor.metrics.opens,
  workerCloses: executor.metrics.closes,
  infiniteLoopContained,
  infiniteLoopCode,
  forcedKills: loopingExecutor.metrics.forcedKills,
  childName: child.name
}));
`;

  await writeFile(join(temp, "consumer.mjs"), consumer);
  const output = run("node", ["consumer.mjs"], { cwd: temp });
  const metrics = JSON.parse(output.split("\n").at(-1));
  if (metrics.packed !== true || metrics.infiniteLoopContained !== true) {
    throw new Error("packed JavaScript CodeAct consumer did not pass");
  }
  console.log(JSON.stringify(metrics));
} finally {
  await rm(temp, { recursive: true, force: true });
}
