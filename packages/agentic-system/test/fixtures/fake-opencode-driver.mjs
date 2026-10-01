// Fixture: fake opencode driver for BB-066 adapter unit tests.
// The adapter allowlists the driver child env, so the scenario is read from
// <attemptDir>/fake-driver.json: { mode, changedPaths, secret }.
//   success         -> FINISHED envelope, session marker, atomic result.json
//   error-exit      -> exit 3, no result (stderr may carry the secret)
//   forbidden-field -> envelope carries `accepted: true`
//   bad-envelope    -> prints garbage, exit 0
//   hang            -> sleeps forever (adapter must time out / cancel)
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const sha256hex = (d) => createHash("sha256").update(d).digest("hex");
const args = process.argv.slice(2);
const operation = args[0];
const manifestPath = resolve(args[args.indexOf("--manifest") + 1]);
const resultPath = resolve(args[args.indexOf("--result") + 1]);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const attemptDir = dirname(manifestPath);
// Spawn log: the test counts real driver process invocations from this file.
try { writeFileSync(join(attemptDir, "fake-driver-spawns.log"), operation + "\n", { flag: "a" }); } catch { /* ignore */ }
let scenario = { mode: "success", changedPaths: [], secret: null };
const scenarioPath = join(attemptDir, "fake-driver.json");
if (existsSync(scenarioPath)) {
  try { scenario = { ...scenario, ...JSON.parse(readFileSync(scenarioPath, "utf8")) }; } catch { /* defaults */ }
}
const mode = scenario.mode;

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w");
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(tmp, path);
}

if (mode === "hang") {
  // Keep the event loop alive: a bare unsettled top-level await makes
  // Node exit(13) instead of hanging.
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (mode === "error-exit") {
  process.stderr.write("fake driver: simulated failure\n");
  if (scenario.secret) process.stderr.write("leaked=" + scenario.secret + "\n");
  process.exit(3);
}

if (mode === "bad-envelope") {
  process.stdout.write("this is not json\n");
  process.exit(0);
}

const sessionMarkerPath = join(attemptDir, "session-created.json");
let sessionId = "ses_faketest0001";
if (operation === "dispatch") {
  try {
    writeFileSync(sessionMarkerPath, JSON.stringify({ sessionId, createdAt: new Date().toISOString() }), { flag: "wx" });
  } catch (e) {
    if (e?.code === "EEXIST") { process.stderr.write("fake driver: session already exists\n"); process.exit(2); }
    throw e;
  }
} else {
  try { sessionId = JSON.parse(readFileSync(sessionMarkerPath, "utf8")).sessionId; }
  catch { process.stderr.write("fake driver: no session marker\n"); process.exit(2); }
}

const changedPaths = Array.isArray(scenario.changedPaths) ? scenario.changedPaths : [];
const envelope = {
  schemaVersion: 1,
  operation,
  sessionId,
  promptSendCount: operation === "dispatch" ? 1 : 0,
  sessionContinuations: operation === "recover" ? 1 : 0,
  agent: { name: "opencode", version: "1.18.34" },
  model: manifest.modelProfile?.immutableModelId ?? "unknown",
  workspace: {
    startingTree: manifest.workspaceStartingTree,
    resultTree: "sha256:" + sha256hex("fake-tree:" + operation + ":" + changedPaths.join(",")),
    changedPaths,
  },
  events: { count: 7, kinds: { message: 3 }, lastTextDigest: null },
  termination: { kind: "FINISHED", reason: "fake complete" },
  usage: { inputTokens: null, outputTokens: null, costUsd: null },
};
if (mode === "forbidden-field") envelope.accepted = true;

atomicWriteJson(resultPath, envelope);
process.stdout.write(JSON.stringify(envelope) + "\n");
process.exit(0);
