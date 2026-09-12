import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-discovery-consumer-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

try {
  const packed = JSON.parse(run("npm", ["pack", "./packages/core-harness", "--pack-destination", temp, "--json"]));
  const tarball = join(temp, packed[0].filename);
  await writeFile(join(temp, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { exharness: `file:${tarball}` }
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  const consumer = `
import {
  Agent,
  DiscoveryMode,
  agenticMethod,
  createAgentRuntime,
  createObjectAgent,
  defineLiveObjectSurface,
  docLiveObject,
  docObjectAgent
} from "exharness";

class DiscoveryAgent extends Agent {
  alpha() { return 1; }
  beta() { return 2; }
  _secret() { return 3; }
  ask = agenticMethod({
    strategy: {
      async run({ promptContext }) {
        const self = promptContext.blocks.find((item) => item.name === "__exharness_self_doc__");
        if (!self || self.value.mode !== DiscoveryMode.CONCISE) throw new Error("missing concise self doc");
        if (JSON.stringify(self.value).includes("_secret")) throw new Error("hidden member leaked");
        return true;
      }
    }
  });
}
const agent = createObjectAgent(new DiscoveryAgent(), {
  methods: {
    alpha: { description: "A".repeat(80) },
    beta: { description: "B".repeat(80) }
  }
});
if (await agent.ask() !== true) throw new Error("agentic discovery call failed");
const concise = docObjectAgent(agent, { mode: DiscoveryMode.CONCISE });
const full = docObjectAgent(agent, { mode: DiscoveryMode.FULL });
if (!(concise.metrics.chars < full.metrics.chars)) throw new Error("progressive self doc did not reduce disclosure");

const target = { run() { return "ok"; } };
const surface = defineLiveObjectSurface({
  id: "packed.discovery",
  methods: [{ name: "run", description: "Run the target." }]
});
const runtime = createAgentRuntime({
  strategy: { async run() { return true; } },
  liveObjects: [{ name: "target", value: target, surface }]
});
const ref = runtime.liveObjects()[0].ref;
const liveDoc = await docLiveObject(runtime, ref, { mode: DiscoveryMode.FULL });
if (!liveDoc.document.members.some((member) => member.name === "run")) throw new Error("live doc missing method");
console.log(JSON.stringify({
  packed: true,
  conciseChars: concise.metrics.chars,
  fullChars: full.metrics.chars,
  liveMembers: liveDoc.metrics.members
}));
`;
  await writeFile(join(temp, "consumer.mjs"), consumer);
  const output = run("node", ["consumer.mjs"], { cwd: temp });
  const metrics = JSON.parse(output.split("\n").at(-1));
  if (metrics.packed !== true) throw new Error("packed discovery consumer did not pass");
  console.log(JSON.stringify(metrics));
} finally {
  await rm(temp, { recursive: true, force: true });
}
