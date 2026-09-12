import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerSource = await readFile(join(root, "scripts", "javascript-codeact-worker.mjs"), "utf8");
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
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  const consumer = `
import { spawn } from "node:child_process";
import readline from "node:readline";
import {
  ExHarnessErrorCode,
  createAgentRuntime,
  createJavaScriptCodeActStrategy,
  defineCapability,
  defineLiveObjectSurface
} from "exharness";

function errorFrom(raw) {
  const error = new Error(raw?.message ?? "worker failure");
  error.name = raw?.name ?? "Error";
  error.code = raw?.code ?? null;
  return error;
}

function errorView(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: error?.message ?? String(error) };
}

function createProcessExecutor(workerPath) {
  const metrics = { opens: 0, closes: 0, cells: 0, hostCalls: 0, forcedKills: 0 };
  return {
    metrics,
    async open({ host, bindings }) {
      metrics.opens += 1;
      const child = spawn(process.execPath, [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      const pending = new Map();
      let nextId = 1;
      let stderr = "";
      let intentionalClose = false;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      function send(message) {
        if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + "\\n");
      }

      function request(type, payload = {}) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, type });
          send({ type, id, ...payload });
        });
      }

      function abortError(message) {
        const error = new Error(message);
        error.code = ExHarnessErrorCode.EXECUTION_ABORTED;
        return error;
      }

      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.type === "host") {
          metrics.hostCalls += 1;
          Promise.resolve()
            .then(() => host.request(message.request))
            .then(
              (value) => send({ type: "host_result", id: message.id, ok: true, value }),
              (error) => send({ type: "host_result", id: message.id, ok: false, error: errorView(error) })
            );
          return;
        }
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.type === "execution_error") waiter.reject(errorFrom(message.error));
        else if (message.type === "execute_result") waiter.resolve(message.result);
        else waiter.resolve(message);
      });

      child.on("exit", (code, signal) => {
        if (intentionalClose) return;
        const error = abortError(
          "javascript reference worker exited unexpectedly: " + String(code) + "/" + String(signal) + (stderr ? " " + stderr : "")
        );
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
      });

      await request("init", { bindings });

      return {
        features: ["CELL_ABORT"],
        async execute(cell, { signal } = {}) {
          metrics.cells += 1;
          const operation = request("execute", { code: cell.code });
          if (!signal) return operation;
          if (signal.aborted && signal.reason !== "return_result") {
            metrics.forcedKills += 1;
            child.kill("SIGKILL");
            throw abortError("javascript reference worker aborted before execution");
          }
          return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
              if (signal.reason === "return_result") return;
              if (settled) return;
              settled = true;
              metrics.forcedKills += 1;
              child.kill("SIGKILL");
              reject(abortError("javascript reference worker aborted"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            operation.then(
              (value) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", onAbort);
                resolve(value);
              },
              (error) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", onAbort);
                reject(error);
              }
            );
          });
        },
        async close() {
          metrics.closes += 1;
          if (child.exitCode != null || child.signalCode != null) {
            intentionalClose = true;
            lines.close();
            return;
          }
          intentionalClose = true;
          try {
            await Promise.race([
              request("close"),
              new Promise((resolve) => setTimeout(resolve, 100))
            ]);
          } finally {
            child.kill();
            lines.close();
          }
        }
      };
    }
  };
}

function sequenceModel(outputs) {
  let index = 0;
  return {
    name: "packed-js-codeact",
    version: "1",
    async generate() {
      if (index >= outputs.length) throw new Error("unexpected model call");
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

const executor = createProcessExecutor(new URL("./worker.mjs", import.meta.url));
const strategy = createJavaScriptCodeActStrategy({
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
});
const runtime = createAgentRuntime({
  strategy,
  capabilities: [defineCapability({
    name: "double",
    async execute(value) { return value * 2; }
  })],
  liveObjects: [{ name: "root", value: rootNode, surface: nodeSurface }]
});
const result = await runtime.run();
if (result.total !== 12 || result.name !== "after") throw new Error("real JavaScript CodeAct result mismatch");
if (child.name !== "after") throw new Error("live object mutation hit a clone");
if (executor.metrics.cells !== 2) throw new Error("expected two real JavaScript cells");

const loopingExecutor = createProcessExecutor(new URL("./worker.mjs", import.meta.url));
const loopingRuntime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model: sequenceModel([{ type: "execute_javascript", code: "while (true) {}" }]),
    executor: loopingExecutor,
    maxTurns: 1,
    maxDurationMs: 100
  })
});
let infiniteLoopContained = false;
try {
  await loopingRuntime.run();
} catch (error) {
  infiniteLoopContained = error.code === ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED;
}
if (!infiniteLoopContained) throw new Error("infinite JavaScript loop was not bounded by the parent runtime");
if (loopingExecutor.metrics.forcedKills < 1) throw new Error("hung worker process was not terminated");

console.log(JSON.stringify({
  packed: true,
  result,
  cells: executor.metrics.cells,
  hostCalls: executor.metrics.hostCalls,
  workerOpens: executor.metrics.opens,
  workerCloses: executor.metrics.closes,
  infiniteLoopContained,
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
