// Agent-tools value evaluation: owned suite calibration, pre-registration, isolation,
// reducer determinism and NOT_EVALUATED handling. Only the fake CLI and in-test probe
// agents run here; no real coding-agent CLI is ever invoked.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexTool, kiroTool, agyTool, defineAgentTool } from "../src/tool-adapters.js";
import { resolveExecutable } from "../src/process-runner.js";
import {
  ARMS,
  Arm,
  DEFAULT_FACTORS,
  DEFAULT_SUITE_ROOT,
  NotEvaluatedReason,
  Verdict,
  auditPaths,
  calibrateSuite,
  reduceAttempts,
  runAgentToolsEval,
  runExperiment,
  serializeReport
} from "../src/experiment/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const T = { timeout: 120000 };
const NO_GROK_REGISTRY = Object.freeze({ codex: codexTool, kiro: kiroTool, agy: agyTool });

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const fakeCodex = () => defineAgentTool(codexTool, resolveExecutable(FAKE));
const spawnCount = (record) => (existsSync(record) ? JSON.parse(readFileSync(record, "utf8")).length : 0);

/** A one-fixture copy of the owned suite whose hidden test already passes on the base. */
function suiteWithPassingHidden() {
  const root = tempDir("ev1-suite-");
  cpSync(join(DEFAULT_SUITE_ROOT, "bug-sum"), join(root, "bug-sum"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(DEFAULT_SUITE_ROOT, "manifest.json"), "utf8"));
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({ ...manifest, fixtures: ["bug-sum"] }, null, 2)}\n`);
  const hiddenDir = join(root, "bug-sum", "hidden");
  const hiddenTests = readdirSync(hiddenDir, { recursive: true }).filter((path) => String(path).endsWith(".test.mjs"));
  assert.ok(hiddenTests.length > 0, "fixture copy has a hidden test to replace");
  for (const path of hiddenTests) {
    writeFileSync(join(hiddenDir, String(path)), 'import test from "node:test";\ntest("always passes", () => {});\n');
  }
  return root;
}

/** Probe agent: records whether any hidden fixture file is visible in its cwd, then exits 0. */
function probeAgent(dir) {
  const path = join(dir, "probe-agent.mjs");
  writeFileSync(path, [
    "#!/usr/bin/env node",
    'import { appendFileSync, existsSync } from "node:fs";',
    'if (process.argv.includes("--version")) { process.stdout.write("probe-agent 1.0.0\\n"); process.exit(0); }',
    "const hidden = JSON.parse(process.env.PROBE_HIDDEN_FILES);",
    "const seen = hidden.filter((path) => existsSync(path));",
    'appendFileSync(process.env.PROBE_RECORD, `${JSON.stringify({ cwd: process.cwd(), seen })}\\n`);',
    "process.exit(0);",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function attempt({ tool = "codex", taskId, arm, repeatIndex = 1, quality, claimedSuccess = quality === "ACCEPTED" }) {
  return {
    tool, unitId: `${taskId}.${arm}.r${repeatIndex}`, attemptId: `${tool}-${taskId}-${arm}-${repeatIndex}`, taskId, arm, repeatIndex,
    quality, claimedSuccess, notEvaluatedReason: quality === "NOT_EVALUATED" ? "MAX_INVOCATIONS" : null,
    durationMs: 1000, invocations: arm === Arm.DIRECT_SINGLE ? 1 : 2, hiddenChecks: 2,
    usage: { inputTokens: null, outputTokens: null, cachedTokens: null, providerCostUsd: null, status: "UNAVAILABLE" }, recordDigest: "sha256:x"
  };
}

/** Synthetic paired attempts over n tasks: supervised/direct quality per task from the callbacks. */
function synthetic(n, supervisedQuality, directQuality) {
  const out = [];
  for (let index = 0; index < n; index += 1) {
    const taskId = `task-${index}`;
    out.push(attempt({ taskId, arm: Arm.EXHARNESS_SUPERVISED, quality: supervisedQuality(index) }));
    out.push(attempt({ taskId, arm: Arm.DIRECT_SINGLE, quality: directQuality(index) }));
    out.push(attempt({ taskId, arm: Arm.DIRECT_RETRY, quality: directQuality(index) }));
  }
  return out;
}

// ---------------------------------------------------------------- EV1 suite calibration

test("EV1 owned suite calibrates: every base fails and every solution passes", T, async () => {
  const calibration = await calibrateSuite();
  assert.equal(calibration.fixtures.length, 8);
  assert.deepEqual(
    [...new Set(calibration.fixtures.map((fixture) => fixture.category))].sort(),
    ["bug-fix", "feature", "multi-file", "test-guided-refactor"]
  );
  for (const fixture of calibration.fixtures) assert.deepEqual(fixture.reasons, [], `${fixture.id} calibrates`);
  assert.equal(calibration.calibrated, true);
  assert.match(calibration.suiteDigest, /^sha256:[0-9a-f]{64}$/);
});

test("EV1 base that already passes hidden fails calibration", T, async () => {
  const root = suiteWithPassingHidden();
  try {
    const calibration = await calibrateSuite({ root });
    assert.equal(calibration.calibrated, false);
    assert.equal(calibration.fixtures.length, 1);
    assert.ok(calibration.fixtures[0].reasons.includes("BASE_PASSES_HIDDEN"), JSON.stringify(calibration.fixtures[0].reasons));
    assert.equal(calibration.fixtures[0].calibrated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- EV2 isolation and pre-registration

test("EV2 hidden directory is absent from the agent worktree", T, async () => {
  const scratch = tempDir("ev2-hidden-");
  try {
    const record = join(scratch, "probe.jsonl");
    const tool = defineAgentTool(codexTool, resolveExecutable(probeAgent(scratch)));
    const hiddenFiles = ["test/hidden.test.mjs"];
    const run = await runExperiment({
      tool, out: join(scratch, "out"), tasks: ["bug-sum"], repeats: 1, seed: 3,
      factors: { K: 2, timeoutMs: 30000 },
      env: { PROBE_RECORD: record, PROBE_HIDDEN_FILES: JSON.stringify(hiddenFiles) }
    });
    const probes = readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(probes.length >= ARMS.length, "every arm started the agent at least once");
    for (const probe of probes) assert.deepEqual(probe.seen, [], `hidden files visible in ${probe.cwd}`);
    assert.equal(run.attempts.length, ARMS.length);
    for (const item of run.attempts) {
      assert.ok(item.hiddenChecks >= 1, `${item.unitId} checked for hidden files`);
      assert.equal(item.quality, "REJECTED", "the probe edits nothing, so the hidden evaluation rejects it");
      const raw = JSON.parse(readFileSync(join(run.out, "attempts", item.unitId, "evidence", "raw", "result.json"), "utf8"));
      assert.equal(raw.hiddenPresentInAgentWorktree, false);
      assert.equal(raw.hiddenVerdict, "FAIL");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV2 registration digest mismatch refuses start", T, async () => {
  const scratch = tempDir("ev2-digest-");
  try {
    const record = join(scratch, "record.json");
    const out = join(scratch, "out");
    await assert.rejects(
      runExperiment({
        tool: fakeCodex(), out, tasks: ["bug-sum"], repeats: 1,
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
        expectedRegistrationDigest: `sha256:${"0".repeat(64)}`
      }),
      (error) => error.code === "REGISTRATION_MISMATCH"
    );
    assert.equal(spawnCount(record), 0, "no agent attempt started");
    assert.equal(existsSync(join(out, "attempts")), false);
    assert.equal(existsSync(join(out, "ledger-events.json")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV2 mismatched K aborts the run", T, async () => {
  const scratch = tempDir("ev2-k-");
  try {
    const record = join(scratch, "record.json");
    const out = join(scratch, "out");
    const factorsByArm = {
      [Arm.DIRECT_SINGLE]: { ...DEFAULT_FACTORS },
      [Arm.DIRECT_RETRY]: { ...DEFAULT_FACTORS, K: DEFAULT_FACTORS.K + 1 },
      [Arm.EXHARNESS_SUPERVISED]: { ...DEFAULT_FACTORS }
    };
    await assert.rejects(
      runExperiment({ tool: fakeCodex(), out, tasks: ["bug-sum"], factorsByArm, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record } }),
      (error) => error.code === "FACTOR_MISMATCH" && /\.K=/.test(error.message)
    );
    assert.equal(spawnCount(record), 0, "no agent attempt started");
    assert.equal(existsSync(join(out, "registration.json")), false, "nothing is registered under mismatched factors");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV2 every attempt is STARTED then SETTLED and passes the fresh-process audit", T, async () => {
  const scratch = tempDir("ev2-ledger-");
  try {
    const run = await runExperiment({
      tool: fakeCodex(), out: join(scratch, "out"), tasks: ["bug-sum"], repeats: 1, seed: 5,
      factors: { K: 2, timeoutMs: 30000 },
      env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK" },
      fixtureEnv: (fixture) => ({ FAKE_AGENT_SOLUTION_PATCH: fixture.solutionPatch })
    });
    const registration = JSON.parse(readFileSync(join(run.out, "registration.json"), "utf8"));
    assert.equal(registration.registrationDigest, run.registration.registrationDigest);
    for (const item of run.attempts) {
      const events = run.ledgerEvents.filter((event) => event.attemptId === item.attemptId).map((event) => event.type);
      assert.deepEqual(events, ["STARTED", "SETTLED"], item.unitId);
    }
    assert.equal(run.audits.length, run.attempts.length);
    for (const audit of run.audits) assert.equal(audit.status, "PASS", JSON.stringify(audit.findings ?? null));
    const supervised = run.attempts.find((item) => item.arm === Arm.EXHARNESS_SUPERVISED);
    assert.equal(supervised.quality, "ACCEPTED", "feedback-driven fix passes the hidden evaluation");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- EV3 reducer

test("EV3 CLAIM_SUCCESS_NO_EDIT is false success on direct arms", T, async () => {
  const scratch = tempDir("ev3-claim-");
  try {
    const { runs } = await runAgentToolsEval({
      tools: ["codex"], command: FAKE, out: join(scratch, "out"), tasks: ["bug-sum", "feat-prefix"], repeats: 1,
      fakeScenario: "CLAIM_SUCCESS_NO_EDIT", seed: 11, registry: NO_GROK_REGISTRY, factors: { K: 2, timeoutMs: 30000 }
    });
    const report = reduceAttempts({ attempts: runs.codex.attempts, seed: 11 });
    const arms = report.tools.codex.arms;
    assert.equal(arms[Arm.DIRECT_SINGLE].falseSuccessRate, 1);
    assert.equal(arms[Arm.DIRECT_RETRY].falseSuccessRate, 1);
    assert.equal(arms[Arm.EXHARNESS_SUPERVISED].falseSuccessRate, 0, "supervision never accepts an unedited tree");
    for (const arm of ARMS) assert.equal(arms[arm].acceptanceRate, 0);
    for (const comparison of Object.values(report.tools.codex.comparisons)) assert.equal(comparison.verdict, Verdict.INCONCLUSIVE);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV3 identical seed and inputs yield byte-identical report.json", T, () => {
  const attempts = synthetic(8, (index) => (index % 3 === 0 ? "REJECTED" : "ACCEPTED"), (index) => (index % 2 === 0 ? "ACCEPTED" : "REJECTED"));
  const context = { codex: { status: "EVALUATED", toolVersion: "fake 1", registrationDigest: "sha256:r", plannedAttempts: attempts.length } };
  const first = serializeReport(reduceAttempts({ attempts, seed: 42, tools: context }));
  const second = serializeReport(reduceAttempts({ attempts: attempts.map((item) => ({ ...item })), seed: 42, tools: context }));
  assert.equal(first, second);
  const comparison = JSON.parse(first).tools.codex.comparisons[Arm.DIRECT_SINGLE];
  assert.equal(comparison.pairs, 8);
  assert.equal(typeof comparison.lower, "number");
});

test("EV3 reducer reports SUPERIOR, INFERIOR and INCONCLUSIVE from paired deltas", T, () => {
  const superior = reduceAttempts({ attempts: synthetic(8, () => "ACCEPTED", () => "REJECTED"), seed: 1 });
  for (const comparison of Object.values(superior.tools.codex.comparisons)) assert.equal(comparison.verdict, Verdict.SUPERIOR);
  const inferior = reduceAttempts({ attempts: synthetic(8, () => "REJECTED", () => "ACCEPTED"), seed: 1 });
  for (const comparison of Object.values(inferior.tools.codex.comparisons)) assert.equal(comparison.verdict, Verdict.INFERIOR);
  const tie = reduceAttempts({ attempts: synthetic(8, () => "ACCEPTED", () => "ACCEPTED"), seed: 1 });
  for (const comparison of Object.values(tie.tools.codex.comparisons)) assert.equal(comparison.verdict, Verdict.INCONCLUSIVE);
  const skipped = reduceAttempts({ attempts: synthetic(4, () => "NOT_EVALUATED", () => "REJECTED"), seed: 1 });
  const supervisedArm = skipped.tools.codex.arms[Arm.EXHARNESS_SUPERVISED];
  assert.equal(supervisedArm.evaluated, 0);
  assert.equal(supervisedArm.acceptanceRate, null, "NOT_EVALUATED never counts as a failure");
  assert.deepEqual(supervisedArm.notEvaluated, { MAX_INVOCATIONS: 4 });
  assert.equal(skipped.tools.codex.comparisons[Arm.DIRECT_SINGLE].reason, "NO_EVALUATED_PAIRS");
});

test("EV3 calibration scenarios produce the expected per-arm outcomes", T, async () => {
  const scratch = tempDir("ev3-scenarios-");
  try {
    const run = async (scenario) => (await runAgentToolsEval({
      tools: ["codex"], command: FAKE, out: join(scratch, scenario), tasks: ["bug-sum", "feat-prefix"], repeats: 2,
      fakeScenario: scenario, seed: 7, registry: NO_GROK_REGISTRY, factors: { K: 2, timeoutMs: 30000 }
    })).report.tools.codex;
    const afterFeedback = await run("FIX_AFTER_FEEDBACK");
    assert.equal(afterFeedback.arms[Arm.EXHARNESS_SUPERVISED].acceptanceRate, 1);
    assert.equal(afterFeedback.arms[Arm.DIRECT_SINGLE].acceptanceRate, 0);
    for (const comparison of Object.values(afterFeedback.comparisons)) assert.equal(comparison.verdict, Verdict.SUPERIOR);
    const fixFirst = await run("FIX_FIRST");
    for (const arm of ARMS) assert.equal(fixFirst.arms[arm].acceptanceRate, 1);
    for (const comparison of Object.values(fixFirst.comparisons)) assert.equal(comparison.verdict, Verdict.INCONCLUSIVE);
    const neverFix = await run("NEVER_FIX");
    for (const arm of ARMS) assert.equal(neverFix.arms[arm].acceptanceRate, 0);
    assert.equal(neverFix.arms[Arm.EXHARNESS_SUPERVISED].falseSuccessRate, 0);
    for (const comparison of Object.values(neverFix.comparisons)) assert.equal(comparison.verdict, Verdict.INCONCLUSIVE);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- EV4 NOT_EVALUATED and scope

test("EV4 grok without adapter is NOT_EVALUATED with ADAPTER_NOT_DELIVERED", T, async () => {
  const scratch = tempDir("ev4-grok-");
  try {
    const { report } = await runAgentToolsEval({ tools: ["grok"], out: join(scratch, "out"), tasks: ["bug-sum"], registry: NO_GROK_REGISTRY });
    assert.equal(report.tools.grok.status, Verdict.NOT_EVALUATED);
    assert.equal(report.tools.grok.notEvaluatedReason, NotEvaluatedReason.ADAPTER_NOT_DELIVERED);
    assert.deepEqual(report.tools.grok.arms, {}, "no arm ran");
    const written = JSON.parse(readFileSync(join(scratch, "out", "report.json"), "utf8"));
    assert.equal(written.tools.grok.notEvaluatedReason, "ADAPTER_NOT_DELIVERED");
    assert.equal(existsSync(join(scratch, "out", "grok")), false, "nothing was registered or run for grok");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV4 missing executable is NOT_EVALUATED with NOT_INSTALLED", T, async () => {
  const scratch = tempDir("ev4-missing-");
  try {
    const { report } = await runAgentToolsEval({ tools: ["codex"], command: join(scratch, "nonexistent-agent"), out: join(scratch, "out"), tasks: ["bug-sum"], registry: NO_GROK_REGISTRY });
    assert.equal(report.tools.codex.status, Verdict.NOT_EVALUATED);
    assert.equal(report.tools.codex.notEvaluatedReason, NotEvaluatedReason.NOT_INSTALLED);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV4 max-invocations 2 marks remaining attempts NOT_EVALUATED", T, async () => {
  const scratch = tempDir("ev4-cap-");
  try {
    const record = join(scratch, "record.json");
    const { report, runs } = await runAgentToolsEval({
      tools: ["codex"], command: FAKE, out: join(scratch, "out"), tasks: ["bug-sum"], repeats: 1, maxInvocations: 2,
      fakeScenario: "FIX_FIRST", seed: 2, registry: NO_GROK_REGISTRY, factors: { K: 3, timeoutMs: 30000 }, env: { FAKE_AGENT_RECORD: record }
    });
    const attempts = runs.codex.attempts;
    assert.ok(runs.codex.invocationsUsed <= 2, `used ${runs.codex.invocationsUsed}`);
    assert.ok(spawnCount(record) <= 2, "the cap bounds real agent spawns");
    const skipped = attempts.filter((item) => item.quality === "NOT_EVALUATED");
    assert.ok(skipped.length >= 1, "at least one attempt was not started");
    for (const item of skipped) {
      assert.equal(item.notEvaluatedReason, NotEvaluatedReason.MAX_INVOCATIONS);
      assert.equal(item.invocations, 0);
    }
    const firstSkip = attempts.findIndex((item) => item.quality === "NOT_EVALUATED");
    for (const item of attempts.slice(firstSkip)) assert.equal(item.quality, "NOT_EVALUATED", "every later attempt stays unstarted");
    const counted = Object.values(report.tools.codex.arms).reduce((total, arm) => total + (arm.notEvaluated.MAX_INVOCATIONS ?? 0), 0);
    assert.equal(counted, skipped.length);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EV4 --fake-scenario requires --command", T, async () => {
  await assert.rejects(runAgentToolsEval({ tools: ["codex"], out: tempDir("ev4-usage-"), fakeScenario: "FIX_FIRST" }), /--fake-scenario requires --command/);
});

test("EV4 write-scope matcher rejects packages/benchmark", T, () => {
  const benchmark = auditPaths(["packages/benchmark/src/attempt-ledger.js"]);
  assert.equal(benchmark.ok, false);
  assert.deepEqual(benchmark.violations, [{ path: "packages/benchmark/src/attempt-ledger.js", reason: "FORBIDDEN" }]);
  for (const path of ["packages/agent-tools/src/supervisor.js", "packages/core-harness/src/index.js", "docs/blackboard/state.md"]) {
    assert.equal(auditPaths([path]).violations[0].reason, "FORBIDDEN", path);
  }
  assert.equal(auditPaths(["README.md"]).violations[0].reason, "OUTSIDE_WRITE_SCOPE");
  assert.equal(auditPaths([
    "packages/agent-tools/src/experiment/runner.js", "benchmarks/agent-tools/fixtures/manifest.json",
    "packages/agent-tools/test/experiment.test.js", "docs/living/system/agent-tools/evaluation.md"
  ]).ok, true);
});

test("EV4 eval CLI writes the report and exits 64 on usage errors", T, async () => {
  const { spawnSync } = await import("node:child_process");
  const bin = join(here, "..", "bin", "exharness-agent.mjs");
  const scratch = tempDir("ev4-cli-");
  try {
    const usage = spawnSync(process.execPath, [bin, "eval", "--tool", "codex"], { encoding: "utf8" });
    assert.equal(usage.status, 64);
    assert.match(usage.stderr, /--out/);
    const fakeWithoutCommand = spawnSync(process.execPath, [bin, "eval", "--tool", "codex", "--out", join(scratch, "u"), "--fake-scenario", "FIX_FIRST"], { encoding: "utf8" });
    assert.equal(fakeWithoutCommand.status, 64);
    const out = join(scratch, "out");
    const run = spawnSync(process.execPath, [bin, "eval", "--tool", "codex", "--command", join(scratch, "nonexistent-agent"), "--out", out, "--tasks", "bug-sum"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).tools.codex.notEvaluatedReason, "NOT_INSTALLED");
    assert.equal(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).tools.codex.status, "NOT_EVALUATED");
    assert.ok(existsSync(join(out, "report.md")));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
