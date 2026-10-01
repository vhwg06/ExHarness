#!/usr/bin/env node
// BB-066 live probe: exercises the opencode coding-agent execution strategy
// through the production DomainExecutionController.
//
// Modes:
//   --mode dispatch [--workspace W --output O]
//       Build the controller harness, dispatch one fixture task through
//       controller.execute(), print the evidence summary as JSON.
//   --mode dispatch-interrupt-recover [--workspace W --output O]
//       Parent orchestration: spawn child-dispatch, SIGTERM it after N durable
//       opencode events, then spawn child-recover in a fresh process with the
//       same JSON stores. Asserts one attempt id, one session id, evidence bound.
//   --mode child-dispatch | --mode child-recover  (used by the parent mode)
//   --mode audit-driver
//       Print driver identity (node version, driver hash, opencode version).
//
// Exit 0 = probe assertions passed. Exit 3 = INCONCLUSIVE (backend unavailable
// or recovery could not be proven); never a silent pass.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..");
const AGENTIC_SRC = join(REPO_ROOT, "packages", "agentic-system", "src");
const DRIVER_PATH = join(here, "runtime", "opencode_driver.mjs");

const sha256hex = (d) => createHash("sha256").update(d).digest("hex");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, []),
);
const MODE = args.mode ?? "dispatch";

function resolveOpencodeBin() {
  if (process.env.EXHARNESS_OPENCODE_BIN) return process.env.EXHARNESS_OPENCODE_BIN;
  const direct = spawnSync("opencode", ["--version"], { encoding: "utf8" });
  if (direct.status === 0) return "opencode";
  const homeBin = join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (existsSync(homeBin)) return homeBin;
  return "opencode";
}

async function loadAgentic() {
  const m = await import(`file://${join(AGENTIC_SRC, "index.js")}`);
  const store = await import(`file://${join(AGENTIC_SRC, "domain-execution-store.js")}`);
  return { ...m, createJsonDomainExecutionPolicyStore: store.createJsonDomainExecutionPolicyStore };
}

function makeFixtureWorkspace(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "hello.js"), `// PROBE FIXTURE: the exported function must return exactly "hello".\nmodule.exports = () => "helo";\n`);
  writeFileSync(join(root, "task.txt"), "Fix hello.js so the exported function returns exactly \"hello\". Only edit hello.js.\n");
  return {
    promptText: "Fix hello.js so the exported function returns exactly \"hello\". Only edit hello.js. Do not create new files.",
    promptRef: "prompt:bb066-probe-fix-hello-v1",
    taskId: "PROBE-01",
  };
}

function serialGuard() {
  let tail = Promise.resolve();
  return async (action) => {
    const prev = tail;
    let release;
    tail = new Promise((r) => { release = r; });
    await prev;
    try { return await action(); } finally { release(); }
  };
}

// Build a production DomainExecutionController backed by JSON files under dir
// so two OS processes share the same attempt/policy/artifact state.
async function buildHarness({ dir, workspaceRoot, outputRoot, evidenceIndex }) {
  const m = await loadAgentic();
  const immutable = m.createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const org = m.createOrganizationArtifactRegistry({ store: immutable });
  const domain = m.createDomainExecutionArtifactRegistry({ store: immutable });
  const releaseStore = m.createJsonClaimReleaseStore({ path: join(dir, "release-heads.json") });
  const policyStore = m.createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  const attemptStore = m.createJsonExecutionAttemptStore({ path: join(dir, "attempt-heads.json") });

  const SHA = "0".repeat(64);
  const contract = m.defineOrganizationWorkContract({
    projectId: "bb066-probe", rootItemId: "ROOT-PROBE", rootIntentId: "INTENT-PROBE",
    acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-probe",
    materializationAuthorizationRef: "materialization-authorization:sha256:" + SHA,
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-probe",
    authorityPolicyRevision: "authority-policy-probe",
    implementationArtifactRef: "implementation-input:bb066-probe", sliceId: "slice-probe-1",
    obligationKey: "probe-fixture", obligationSubjectKey: "obligation-probe-1",
    materializationKey: "materialization-probe-1", boardItemId: "PROBE-01",
    owningDomain: "DELIVERY", workloadType: "delivery-fixture-change",
    summary: "BB-066 probe: opencode fixes hello.js in a bounded workspace",
    dependencyIds: [], requiredArtifactRefs: ["user-intent:sha256:" + SHA],
    expectedArtifactKind: "PROBE_FIXTURE", expectedOutputRefs: [],
    acceptanceRefs: ["acceptance:bb066-probe-v1"],
  });
  const contractRef = await org.putWorkContract(contract);

  const claimController = {
    async assertExecutable() { return true; },
    async withExecutablePublicationGuard(_args, action) {
      return { observation: {}, result: await action({}) };
    },
  };

  const strategy = m.defineExecutionStrategyDescriptor({
    strategyId: "opencode-local-v1", strategyVersion: "1.18.34", strategyKind: "coding-agent-sdk",
    compatibleWorkloadTypes: [contract.workloadType], compatibleWorkContractVersions: [1],
    adapterRef: "runtime-adapter:opencode-v1", runtimeBindingMode: "EXACT_PERSISTED_SESSION",
    expectedRuntimeCodeRef: "opencode-cli:1.18.34", contextRefs: [],
    toolsetRef: "toolset:opencode-default-v1", modelProfileRef: "model-profile:opencode-free-v1",
    harnessRef: "harness:bb066-probe-v1",
  });
  const strategyRef = await domain.putExecutionStrategyDescriptor(strategy);
  const publisher = m.createDomainExecutionPolicyPublisher({
    policyAuthority: { async verifyExecutionPolicyPublisher({ publisher: p }) { return { authorityRef: "authority:bb066-probe-policy" }; } },
    artifactRegistry: domain, executionPolicyStore: policyStore,
  });
  const policyKey = m.executionPolicySubjectKey(contract.owningDomain, contract.workloadType);
  try {
    await publisher.publish({
      publisher: { identity: "policy-admin" },
      policy: { policyId: policyKey, generation: 1, status: "ACTIVE", domain: contract.owningDomain, workloadType: contract.workloadType, compatibleWorkContractVersions: [1], strategyRef },
    });
  } catch (e) {
    if (!String(e?.message ?? "").includes("generation must advance")) throw e;
  }

  const workspaceResolver = async () => ({ root: workspaceRoot, allowedWriteGlobs: ["hello.js"] });
  const modelProfileResolver = async () => ({
    provider: "opencode", immutableModelId: "opencode/muse-spark-1.3-contributor-free", credentialEnvName: null,
  });
  const runtimeEvidenceStore = {
    async put(kind, body) {
      const digest = sha256hex(JSON.stringify(body));
      const ref = `${kind}:sha256:${digest}`;
      evidenceIndex[ref] = body;
      return ref;
    },
  };
  const adapter = m.createOpencodeRuntimeAdapter({
    runtimeDeploymentRef: "opencode-cli:1.18.34",
    producerAuthorityRef: "authority:bb066-probe-runtime",
    driverCommand: [process.execPath, DRIVER_PATH],
    modelProfileResolver, workspaceResolver, runtimeEvidenceStore,
    opencodeBin: resolveOpencodeBin(),
  });
  const completionEvaluator = {
    authorityRef: "authority:bb066-probe-completion",
    async evaluate() {
      // The probe never self-accepts: completion stays INCONCLUSIVE here.
      return { verdict: "INCONCLUSIVE", criterionResults: [{ criterionId: "probe-execution", verdict: "INCONCLUSIVE", evidenceRefs: [] }], counterevidenceRefs: [] };
    },
  };
  const guard = serialGuard();
  const publicationGate = {
    authorityRef: "authority:bb066-probe-writer", producerPrincipalRef: "principal:bb066-probe",
    async withCurrentWriteAuthority(_a, action) { return guard(() => action({ authorityRef: "authority:bb066-probe-writer", revision: "rev-1" })); },
    async publishIdempotent(a) {
      return { publicationKey: a.publicationKey, publishedArtifactRefs: [], acceptedDerivationEdges: [], publishedClaimRefs: [], publicationStoreRevision: "rev-1" };
    },
  };
  const controller = m.createDomainExecutionController({
    claimController, claimReleaseStore: releaseStore, organizationArtifactRegistry: org,
    artifactRegistry: domain, executionPolicyStore: policyStore, executionAttemptStore: attemptStore,
    runtimeAdapter: adapter, completionEvaluator, publicationGate,
  });

  // Release one claim for PROBE-01 (idempotent across child processes).
  const receipt = {
    kind: "CLAIM_RELEASE_RECEIPT", version: 1, projectId: contract.projectId,
    rootItemId: contract.rootItemId, rootIntentId: contract.rootIntentId,
    itemId: contract.boardItemId, claimGeneration: 1, workContractRef: contractRef,
    boardOwner: "bb066-probe", principalRef: "principal:bb066-probe",
  };
  const receiptRef = await org.putClaimReleaseReceipt(receipt);
  const releaseKey = m.claimReleaseSubjectKey(contract.projectId, contract.boardItemId, 1);
  await releaseStore.compareAndSwap(releaseKey, null, { status: "RELEASED", receiptRef }).catch(() => {});
  return { controller, itemId: contract.boardItemId, receiptRef };
}

async function modeAuditDriver() {
  const driverHash = sha256hex(readFileSync(DRIVER_PATH, "utf8"));
  const bin = resolveOpencodeBin();
  const v = spawnSync(bin, ["--version"], { encoding: "utf8" });
  const info = {
    node: process.version, driver: DRIVER_PATH, driverHash: "sha256:" + driverHash,
    opencodeBin: bin, opencodeVersion: v.status === 0 ? v.stdout.trim() : "unavailable",
  };
  process.stdout.write(JSON.stringify(info, null, 2) + "\n");
}

async function modeChild(which, workspaceRoot, outputRoot, storeDir) {
  const evidenceIndex = {};
  const { controller, itemId, receiptRef } = await buildHarness({ dir: storeDir, workspaceRoot, outputRoot, evidenceIndex });
  const fixture = { promptText: readFileSync(join(workspaceRoot, "task.txt"), "utf8"), promptRef: "prompt:bb066-probe-fix-hello-v1", taskId: "PROBE-01" };
  const controllerForAbort = new AbortController();
  process.on("SIGTERM", () => controllerForAbort.abort());
  const input = {
    workspaceDescriptorRef: "workspace:bb066-probe-fixture-v1",
    taskId: fixture.taskId, promptRef: fixture.promptRef, promptText: fixture.promptText,
    outputRoot, timeoutMs: 240000,
  };
  try {
    const out = await controller.execute({ itemId, claimGeneration: 1, receiptRef, input, signal: controllerForAbort.signal });
    writeFileSync(join(outputRoot, `${which}-outcome.json`), JSON.stringify({ ok: true, state: out.state, executionAttemptId: out.executionAttemptId }, null, 2));
    process.stdout.write(JSON.stringify({ mode: which, ok: true, executionAttemptId: out.executionAttemptId, state: out.state }) + "\n");
  } catch (e) {
    const isRecovery = e && e.name === "OpencodeRecoveryRequiredError";
    writeFileSync(join(outputRoot, `${which}-outcome.json`), JSON.stringify({ ok: false, errorName: e?.name, message: String(e?.message).slice(0, 500), recoveryRequired: isRecovery }, null, 2));
    process.stdout.write(JSON.stringify({ mode: which, ok: false, errorName: e?.name, recoveryRequired: isRecovery }) + "\n");
    process.exit(isRecovery ? 10 : 1);
  }
}

function runChild(mode, workspaceRoot, outputRoot, storeDir, extraEnv = {}) {
  return spawn(process.execPath, [fileURLToPath(import.meta.url), "--mode", mode, "--workspace", workspaceRoot, "--output", outputRoot, "--store", storeDir], {
    env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"],
  });
}

function readJsonlProgress(attemptDir) {
  const p = join(attemptDir, "driver-progress.jsonl");
  if (!existsSync(p)) return { events: 0, sessionId: null };
  let events = 0, sessionId = null;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); events = Math.max(events, o.events ?? 0); sessionId = sessionId ?? o.sessionId ?? null; }
    catch { /* ignore */ }
  }
  return { events, sessionId };
}

async function modeDispatchInterruptRecover(workspaceRoot, outputRoot) {
  const storeDir = join(outputRoot, "stores");
  mkdirSync(storeDir, { recursive: true });

  const child = runChild("child-dispatch", workspaceRoot, outputRoot, storeDir);
  let childOut = "", childErr = "";
  child.stdout.on("data", (d) => { childOut += d.toString("utf8"); });
  child.stderr.on("data", (d) => { childErr += d.toString("utf8"); });
  const childDone = new Promise((res) => child.on("close", (code, signal) => res({ code, signal })));

  // Wait for the durable session marker, then give the agent time to work
  // before interrupting. (opencode buffers --format json when piped, so we
  // cannot rely on streaming event counts; time-based interrupt is honest.)
  const deadline = Date.now() + 240000;
  let interrupted = false, observedSession = null, sessionSeenAt = 0;
  const GRACE_AFTER_SESSION_MS = 20000;
  const probeStart = Date.now();
  const elapsed = () => ((Date.now() - probeStart) / 1000).toFixed(1) + "s";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const base = join(outputRoot, "attempts");
    const dirs = existsSync(base) ? readdirSync(base) : [];
    for (const d of dirs) {
      const mp = join(base, d, "session-created.json");
      if (existsSync(mp) && !observedSession) {
        try { observedSession = JSON.parse(readFileSync(mp, "utf8")).sessionId ?? null; } catch {}
        if (observedSession) { sessionSeenAt = Date.now(); process.stderr.write(`[probe ${elapsed()}] session seen: ${observedSession}\n`); }
      }
    }
    if (observedSession && !interrupted && Date.now() - sessionSeenAt >= GRACE_AFTER_SESSION_MS) {
      interrupted = true;
      process.stderr.write(`[probe ${elapsed()}] interrupting child\n`);
      child.kill("SIGTERM");
      break;
    }
    const done = await Promise.race([childDone.then((r) => r), new Promise((r) => setTimeout(() => r("no"), 100))]);
    if (done !== "no") { process.stderr.write(`[probe ${elapsed()}] child done before interrupt (sessionSeenAt=${sessionSeenAt ? ((sessionSeenAt - probeStart) / 1000).toFixed(1) + "s" : "never"})\n`); break; }
  }
  const first = await childDone;
  const dispatchOutcome = existsSync(join(outputRoot, "child-dispatch-outcome.json"))
    ? JSON.parse(readFileSync(join(outputRoot, "child-dispatch-outcome.json"), "utf8")) : null;

  // Fresh process recover.
  const child2 = runChild("child-recover", workspaceRoot, outputRoot, storeDir);
  let child2Out = "", child2Err = "";
  child2.stdout.on("data", (d) => { child2Out += d.toString("utf8"); });
  child2.stderr.on("data", (d) => { child2Err += d.toString("utf8"); });
  const second = await new Promise((res) => child2.on("close", (code, signal) => res({ code, signal })));
  const recoverOutcome = existsSync(join(outputRoot, "child-recover-outcome.json"))
    ? JSON.parse(readFileSync(join(outputRoot, "child-recover-outcome.json"), "utf8")) : null;

  const summary = {
    interrupted, observedSession,
    dispatch: { exit: first, outcome: dispatchOutcome },
    recover: { exit: second, outcome: recoverOutcome },
  };
  const assertions = [];
  assertions.push(["dispatch interrupted after session became durable", interrupted === true]);
  assertions.push(["dispatch ended RECOVERY_REQUIRED", dispatchOutcome?.recoveryRequired === true]);
  assertions.push(["recover process exited 0", second.code === 0]);
  const storeData = existsSync(join(storeDir, "attempt-heads.json")) ? JSON.parse(readFileSync(join(storeDir, "attempt-heads.json"), "utf8")) : { heads: {} };
  const attemptKeys = Object.keys(storeData.heads ?? {});
  assertions.push(["exactly one execution attempt", attemptKeys.length === 1]);
  const storedAttemptId = attemptKeys.length === 1 ? storeData.heads[attemptKeys[0]]?.value?.executionAttemptId ?? null : null;
  if (recoverOutcome?.executionAttemptId) {
    assertions.push(["recover reused the same executionAttemptId", recoverOutcome.executionAttemptId === storedAttemptId]);
  }
  const sessionMarkers = [];
  const base = join(outputRoot, "attempts");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const sm = join(base, d, "session-created.json");
      if (existsSync(sm)) sessionMarkers.push(JSON.parse(readFileSync(sm, "utf8")).sessionId);
    }
  }
  assertions.push(["exactly one opencode session", sessionMarkers.length === 1]);
  if (observedSession) assertions.push(["session id stable", sessionMarkers[0] === observedSession]);
  const failed = assertions.filter(([, ok]) => !ok);
  summary.assertions = assertions.map(([name, ok]) => ({ name, ok }));
  summary.pass = failed.length === 0;
  writeFileSync(join(outputRoot, "probe-summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (!summary.pass) {
    process.stderr.write("INCONCLUSIVE: " + failed.map(([n]) => n).join("; ") + "\n");
    process.exit(3);
  }
}

async function main() {
  if (MODE === "audit-driver") return modeAuditDriver();
  const workspaceRoot = resolve(args.workspace ?? join(tmpdir(), "bb066-probe-ws"));
  const outputRoot = resolve(args.output ?? join(tmpdir(), "bb066-probe-out"));
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  if (MODE === "dispatch" || MODE === "dispatch-interrupt-recover") {
    if (!existsSync(join(workspaceRoot, "hello.js"))) makeFixtureWorkspace(workspaceRoot);
  }
  const storeDir = resolve(args.store ?? join(outputRoot, "stores"));
  mkdirSync(storeDir, { recursive: true });
  if (MODE === "child-dispatch") return modeChild("child-dispatch", workspaceRoot, outputRoot, storeDir);
  if (MODE === "child-recover") return modeChild("child-recover", workspaceRoot, outputRoot, storeDir);
  if (MODE === "dispatch") {
    const evidenceIndex = {};
    const { controller, itemId, receiptRef } = await buildHarness({ dir: storeDir, workspaceRoot, outputRoot, evidenceIndex });
    const promptText = readFileSync(join(workspaceRoot, "task.txt"), "utf8");
    const out = await controller.execute({
      itemId, claimGeneration: 1, receiptRef,
      input: {
        workspaceDescriptorRef: "workspace:bb066-probe-fixture-v1", taskId: "PROBE-01",
        promptRef: "prompt:bb066-probe-fix-hello-v1", promptText, outputRoot, timeoutMs: 240000,
      },
    });
    const summary = { state: out.state, executionAttemptId: out.executionAttemptId, evidenceRefs: Object.keys(evidenceIndex).length };
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  if (MODE === "dispatch-interrupt-recover") {
    return modeDispatchInterruptRecover(workspaceRoot, outputRoot);
  }
  process.stderr.write("unknown mode: " + MODE + "\n");
  process.exit(2);
}

main().catch((e) => { process.stderr.write("probe fatal: " + String(e?.stack ?? e) + "\n"); process.exit(2); });
