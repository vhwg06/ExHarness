#!/usr/bin/env node
// BB-120 plan-defect probe (research only; edits no product code).
// Demonstrates on current main that the READY plan's D2 child-env allowlist,
// applied as specified, drops what the delivered bin-driven tests and live
// CLI authentication need; then proves a corrected rule by pure simulation.
// Hermetic and credential-free: plants tagged fake values in-process only;
// the result stores booleans and variable names, never secret values.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../../../../packages/agent-tools/src/process-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");

// ---- D1 allowlist exactly as the READY plan specifies it ----
const D1_ALLOWLIST = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TERM_PROGRAM", "COLORTERM",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA",
  "LOCALAPPDATA", "PATHEXT", "SYSTEMROOT", "COMSPEC", "WINDIR"
]);

// ---- D2 exactly as the READY plan specifies it, applied to a given parent env ----
function d2ChildEnvironment(env, parentEnv) {
  const inherited = {};
  for (const name of D1_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(parentEnv, name) && typeof parentEnv[name] === "string") {
      inherited[name] = parentEnv[name];
    }
  }
  const result = { ...inherited, ...(env ?? {}) };
  delete result.NODE_TEST_CONTEXT;
  return result;
}

// ---- Corrected rule (pure simulation): allowlist + per-tool declared auth
// passthrough + explicit caller overlay; ambient secrets never leak wholesale ----
const FAKE_AGENT_PREFIX = "FAKE_AGENT_";
function correctedChildEnvironment({ parentEnv, toolAuthNames = [], callerEnv = {} }) {
  const child = {};
  for (const name of D1_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(parentEnv, name) && typeof parentEnv[name] === "string") {
      child[name] = parentEnv[name];
    }
  }
  for (const name of toolAuthNames) {
    if (name === "NODE_TEST_CONTEXT") continue;
    if (Object.prototype.hasOwnProperty.call(parentEnv, name) && typeof parentEnv[name] === "string") {
      child[name] = parentEnv[name];
    }
  }
  for (const [name, value] of Object.entries(callerEnv ?? {})) {
    if (typeof value === "string") child[name] = value;
  }
  delete child.NODE_TEST_CONTEXT;
  return child;
}

// Bin boundary: the bin process cannot distinguish its own ambient env, so it
// forwards an explicit, narrow set — FAKE_AGENT_* test-control vars plus
// repeated --env KEY=VALUE operator flags — into the runSupervisedTask overlay.
function binOverlay({ binProcessEnv, cliEnvFlags = {} }) {
  const forwarded = {};
  for (const [name, value] of Object.entries(binProcessEnv)) {
    if (name.startsWith(FAKE_AGENT_PREFIX) && typeof value === "string") forwarded[name] = value;
  }
  return { ...forwarded, ...cliEnvFlags };
}

// ---- Static facts on current main ----
const binSrc = readFileSync(join(root, "packages/agent-tools/bin/exharness-agent.mjs"), "utf8");
const supervisedSrc = readFileSync(join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const agentToolsTest = readFileSync(join(root, "packages/agent-tools/test/agent-tools.test.js"), "utf8");
const grokTest = readFileSync(join(root, "packages/agent-tools/test/grok-adapter.test.js"), "utf8");
const fakeAgentSrc = readFileSync(join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs"), "utf8");
const fakeGrokSrc = readFileSync(join(root, "packages/agent-tools/test/fixtures/fake-grok.mjs"), "utf8");

// runSupervisedTask calls in the bin's run/smoke paths: do they pass env?
const runCallSites = [...binSrc.matchAll(/runSupervisedTask\(\{([^}]|\}(?!\s*[,);]))*\}/gs)].map((m) => m[0]);
const binRunPassesEnv = runCallSites.some((call) => /\benv\b/.test(call));
// Delivered tests hand FAKE_AGENT_SCENARIO explicitly to the bin process env ...
const deliveredBinScenarios = [
  ...agentToolsTest.matchAll(/runBin\(\[([^\]]*)\],\s*\{([^}]*)\}\)/g)
].map((m) => ({ args: m[1].replace(/\s+/g, " ").trim(), env: m[2].replace(/\s+/g, " ").trim() }));
const binTestsPassScenarioExplicitly =
  deliveredBinScenarios.some((c) => c.env.includes("FAKE_AGENT_SCENARIO")) &&
  [...grokTest.matchAll(/runBin\(\[([^\]]*)\],\s*\{([^}]*)\}\)/g)].some((m) => m[2].includes("FAKE_AGENT_SCENARIO"));
// ... but the fake CLI reads it from ambient process.env, which D2 cuts one hop down.
const fakeReadsAmbientScenario =
  fakeAgentSrc.includes("process.env.FAKE_AGENT_SCENARIO") && fakeGrokSrc.includes("process.env.FAKE_AGENT_SCENARIO");
const supervisorDefaultsEnvEmpty = /runSupervisedTask\(\{\s*tool,[\s\S]*?env = \{\}/.test(supervisedSrc);

// ---- Representative operator secrets (illustrative names only; the repo
// documents no per-tool auth variable, so the plan must not invent them as
// delivered truth) ----
const REPRESENTATIVE_AUTH = {
  codex: ["OPENAI_API_KEY"],
  kiro: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  agy: ["AGY_API_KEY"],
  grok: ["XAI_API_KEY"],
  opencode: ["ANTHROPIC_API_KEY"]
};
const allRepresentativeAuth = [...new Set(Object.values(REPRESENTATIVE_AUTH).flat())];

// Tagged fake parent env for the simulation (values never leave this process).
const TAG = "bb120-plan-defect-probe-not-a-real-secret";
const simulatedParent = {
  ...process.env,
  EXHARNESS_PLANTED_SECRET: `${TAG}-planted`,
  AWS_SECRET_ACCESS_KEY: `${TAG}-aws`,
  FAKE_AGENT_SCENARIO: "FIX_FIRST",
  FAKE_AGENT_RECORD: "/tmp/bb120-probe-record.json",
  OPENAI_API_KEY: `${TAG}-openai`,
  AWS_ACCESS_KEY_ID: `${TAG}-akia`,
  AGY_API_KEY: `${TAG}-agy`,
  XAI_API_KEY: `${TAG}-xai`,
  ANTHROPIC_API_KEY: `${TAG}-anthropic`,
  NODE_TEST_CONTEXT: "probe-context"
};
const neededByTests = ["FAKE_AGENT_SCENARIO", "FAKE_AGENT_RECORD"];

// D2 with the supervisor default (env = {}): what the bin paths deliver today.
const d2Default = d2ChildEnvironment({}, simulatedParent);
const d2DefaultDroppedTests = neededByTests.filter((name) => !(name in d2Default));
const d2DefaultDroppedAuth = allRepresentativeAuth.filter((name) => !(name in d2Default));
// D2 with an explicit operator overlay: the only path D2 leaves open.
const explicitOverlay = { FAKE_AGENT_SCENARIO: "FIX_FIRST", XAI_API_KEY: `${TAG}-xai` };
const d2Overlay = d2ChildEnvironment(explicitOverlay, simulatedParent);

// Live behavior on current main (real spawn, no D2): overlay channel + leak.
const liveOverlayName = "BB120_PROBE_OVERLAY";
const liveOverlay = await runProcess(
  process.execPath,
  ["-e", `process.stdout.write(JSON.stringify({overlay: process.env.${liveOverlayName} ?? null, planted: "EXHARNESS_PLANTED_SECRET" in process.env, scenario: process.env.FAKE_AGENT_SCENARIO ?? null}))`],
  { cwd: process.cwd(), timeoutMs: 8000, env: { [liveOverlayName]: "yes" } }
);
const liveChild = JSON.parse(liveOverlay.stdout || "{}");
process.env.EXHARNESS_PLANTED_SECRET = `${TAG}-live`;
const liveLeak = await runProcess(
  process.execPath,
  ["-e", 'process.stdout.write(JSON.stringify({planted: "EXHARNESS_PLANTED_SECRET" in process.env}))'],
  { cwd: process.cwd(), timeoutMs: 8000 }
);
delete process.env.EXHARNESS_PLANTED_SECRET;

// ---- Corrected rule, proved by pure simulation ----
const toolAuth = ["XAI_API_KEY"]; // per-tool declared passthrough, e.g. grok
const binEnv = binOverlay({ binProcessEnv: simulatedParent, cliEnvFlags: { XAI_API_KEY: `${TAG}-operator-flag` } });
const corrected = correctedChildEnvironment({ parentEnv: simulatedParent, toolAuthNames: toolAuth, callerEnv: binEnv });
const correctedChecks = {
  plantedSecretDropped: !("EXHARNESS_PLANTED_SECRET" in corrected),
  undeclaredAmbientAuthDropped: !("OPENAI_API_KEY" in corrected) && !("ANTHROPIC_API_KEY" in corrected) && !("AGY_API_KEY" in corrected),
  declaredAuthForwarded: corrected.XAI_API_KEY === `${TAG}-operator-flag`,
  fakeScenarioForwardedViaBinOverlay: corrected.FAKE_AGENT_SCENARIO === "FIX_FIRST",
  fakeRecordForwardedViaBinOverlay: corrected.FAKE_AGENT_RECORD === "/tmp/bb120-probe-record.json",
  nodeTestContextDropped: !("NODE_TEST_CONTEXT" in corrected),
  overlayBeatsAllowlist: correctedChildEnvironment({ parentEnv: { ...simulatedParent, PATH: "/parent-path" }, toolAuthNames: [], callerEnv: { PATH: "/operator-path" } }).PATH === "/operator-path",
  noWholesaleCopy: !("EXHARNESS_PLANTED_SECRET" in corrected) && Object.keys(corrected).length < Object.keys(simulatedParent).length
};
// Declared ambient auth (no operator flag): live CLI authenticates without an overlay.
const correctedAmbientAuth = correctedChildEnvironment({ parentEnv: simulatedParent, toolAuthNames: toolAuth, callerEnv: { FAKE_AGENT_SCENARIO: "FIX_FIRST" } });

const result = {
  kind: "BB-120_PLAN_DEFECT_PROBE_V1",
  staticFacts: {
    binRunOrSmokePassesEnvToSupervisor: binRunPassesEnv,
    supervisorDefaultsEnvToEmpty: supervisorDefaultsEnvEmpty,
    deliveredBinTestsPassScenarioExplicitlyToBin: binTestsPassScenarioExplicitly,
    fakeCliReadsScenarioFromAmbientEnv: fakeReadsAmbientScenario
  },
  defectD2WithSupervisorDefault: {
    overlayUsed: {},
    droppedTestControlVars: d2DefaultDroppedTests,
    droppedRepresentativeAuthVars: d2DefaultDroppedAuth,
    plantedSecretDropped: !("EXHARNESS_PLANTED_SECRET" in d2Default),
    pathStillInherited: "PATH" in d2Default
  },
  d2ExplicitOverlayStillWorks: {
    scenarioPresent: d2Overlay.FAKE_AGENT_SCENARIO === "FIX_FIRST",
    authPresent: d2Overlay.XAI_API_KEY === `${TAG}-xai`
  },
  liveOnCurrentMain: {
    overlayReachesChild: liveChild.overlay === "yes",
    ambientPlantedSecretLeaksToChild: JSON.parse(liveLeak.stdout || "{}").planted === true,
    binScenarioReachesFakeOnlyViaAmbient: liveChild.scenario === null
  },
  affectedDeliveredTests: [
    "AT4 run prints AGENT_SUPERVISED_RESULT_V1 and reports ACCEPTED only after passing verification",
    "AT4 smoke skips missing and unauthenticated tools and never reports ACCEPTED without passing verification",
    "GR3 exharness-agent probe and smoke accept grok"
  ],
  affectedToolsLive: Object.fromEntries(Object.entries(REPRESENTATIVE_AUTH).map(([tool, names]) => [
    tool, { ambientAuthDroppedByD2: names.every((name) => !(name in d2Default)), representativeVars: names }
  ])),
  correctedRule: {
    ...correctedChecks,
    declaredAmbientAuthReachesChildWithoutOverlay: correctedAmbientAuth.XAI_API_KEY === `${TAG}-xai`,
    allCorrectedChecksPass: Object.values(correctedChecks).every(Boolean)
  },
  note: "Representative auth names are illustrative operator-supplied examples, not in-repo documented truth: no adapter or doc in this repo names per-tool auth variables."
};

writeFileSync(join(here, "plan-defect-probe-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
