// Experiment-owned adapter over the shared benchmark kernel. Every attempt is registered,
// STARTED and SETTLED in AttemptLedger, evaluated on an independent detached checkout that is
// the only place hidden/** ever exists, and audited again in a fresh Node process.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AttemptLedger, createEvidenceManifest, normalizeAccounting, normalizeOutcome } from "@exharness/benchmark";
import { createLocalCommandVerifier, createLocalGitWorkspace } from "../../../agentic-system/src/index.js";
import { InvocationStatus, runProcess } from "../process-runner.js";
import { createRunTraceWriter } from "../run-trace.js";
import { AGENT_TOOL_ADAPTER_VERSION } from "../tool-adapters.js";
import { ARMS, Arm, DEFAULT_FACTORS, maxInvocationsFor, runDirectArm, runSupervisedArm } from "./arms.js";
import { EVALUATOR_IDENTITY, assertToolVersion, createAgentToolsRegistration, persistRegistration } from "./registration.js";
import { DEFAULT_SUITE_ROOT, git, loadSuite, materializeRepository, overlayHidden } from "./suite.js";

export const NotEvaluatedReason = Object.freeze({
  NOT_INSTALLED: "NOT_INSTALLED",
  ADAPTER_NOT_DELIVERED: "ADAPTER_NOT_DELIVERED",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  USD_CAP_UNENFORCEABLE: "USD_CAP_UNENFORCEABLE",
  MAX_INVOCATIONS: "MAX_INVOCATIONS",
  MAX_USD: "MAX_USD"
});
export const RESET_IDENTITY_KIND = "BENCHMARK_RESET_IDENTITY_V1";
export const NORMALIZATION_KIND = "BENCHMARK_NORMALIZATION_INPUT_V1";
export const ARTIFACT_MANIFEST_KIND = "BENCHMARK_ARTIFACT_MANIFEST_V1";
const AUDIT_PROCESS = join(dirname(fileURLToPath(import.meta.url)), "audit-process.js");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bytesOf = (value) => Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);

/** Probes `<command> <versionArgs>`; null when the tool is not installed or prints nothing. */
export async function probeToolVersion(tool, { cwd = process.cwd(), env = {} } = {}) {
  const probe = await runProcess(tool.command, [...tool.prefixArgs, ...tool.versionArgs], { cwd, env, timeoutMs: 30000, maxOutputBytes: 65536 });
  if (probe.status === InvocationStatus.TOOL_UNAVAILABLE) return { installed: false, version: null };
  const version = probe.status === InvocationStatus.COMPLETED && probe.exitCode === 0
    ? `${probe.stdout}\n${probe.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
    : null;
  return { installed: true, version };
}

// Six nullable kernel fields: a field is reported only when every trace of the attempt reported
// it; nothing is zero-filled. Grok's reported total_cost_usd becomes providerCostUsd.
export function usageObservationFromTraces(toolId, traces) {
  const mapping = [["inputTokens", "inputTokens"], ["outputTokens", "outputTokens"], ["cachedTokens", "cachedInputTokens"], ["providerCostUsd", "totalCostUsd"]];
  const values = {};
  const reportedFields = [];
  if (traces.length > 0) {
    for (const [field, source] of mapping) {
      const observed = traces.map((trace) => trace.usage?.[source]);
      if (observed.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
        values[field] = observed.reduce((total, value) => total + value, 0);
        reportedFields.push(field);
      }
    }
  }
  return { source: `agent-tools.${toolId}.trace-usage`, reportedFields, values };
}

async function listRelative(root) {
  if (!existsSync(root)) return [];
  const out = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

/** Independent hidden evaluation on a detached checkout of candidateSha plus hidden/**. */
async function evaluateHidden({ fixture, repositoryRoot, candidateSha, scratch }) {
  const workspace = await createLocalGitWorkspace({ repositoryRoot, baseRevision: candidateSha, worktreeRoot: join(scratch, "evaluation") });
  try {
    await overlayHidden(fixture, workspace.root);
    const results = [];
    for (const item of fixture.hiddenVerifications) {
      const verifier = createLocalCommandVerifier({ name: item.name, claim: `agent-tools.hidden.${item.name}`, root: workspace.root, command: item.command, args: [...item.args], timeoutMs: item.timeoutMs, maxOutputBytes: 65536 });
      const record = await verifier.verify({ candidate: { version: candidateSha } });
      results.push({ name: item.name, status: record.status, evidence: record.evidence, summary: record.summary });
    }
    const verdict = results.every((result) => result.status === "PASS") ? "PASS" : results.some((result) => result.status === "FAIL") ? "FAIL" : "ERROR";
    return { verdict, results };
  } finally {
    await workspace.dispose();
  }
}

async function checkpoint(cwd) {
  await git(cwd, ["add", "-A"]);
  const staged = (await git(cwd, ["diff", "--cached", "--name-only"])).trim();
  if (staged.length > 0) await git(cwd, ["commit", "-q", "--no-verify", "-m", "agent-tools-eval checkpoint"]);
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

/**
 * Runs one attempt of one unit and settles it. skipReason (MAX_INVOCATIONS / MAX_USD /
 * TOOL_UNAVAILABLE) settles a NOT_EVALUATED record without starting the producer.
 */
async function runAttempt({ ledger, registration, unit, fixture, tool, toolVersion, factors, env, out, skipReason = null }) {
  const attemptId = `${unit.unitId}.a1`;
  const attemptDir = join(out, "attempts", unit.unitId);
  const evidenceDir = join(attemptDir, "evidence");
  const preexisting = await listRelative(evidenceDir);
  const startedAt = new Date().toISOString();
  ledger.beginAttempt({ unitId: unit.unitId, attemptId, startedAt });
  const trialId = `trial:${attemptId}:${randomUUID()}`;
  const scratch = await mkdtemp(join(tmpdir(), "agent-tools-eval-"));
  const entries = [];
  const put = async (role, ref, value) => {
    const bytes = bytesOf(value);
    await mkdir(dirname(join(evidenceDir, ref)), { recursive: true });
    await writeFile(join(evidenceDir, ref), bytes);
    entries.push({ role, ref, digest: sha(bytes), bytes: bytes.length });
    return entries.at(-1);
  };
  const hiddenChecks = { count: 0 };
  let armResult = null;
  let evaluation = null;
  let candidateSha = null;
  let baseRevision = null;
  let notEvaluatedReason = skipReason;
  let workspaceRef = join(scratch, "worktree");
  try {
    if (skipReason === null) {
      const repositoryRoot = join(scratch, "repository");
      baseRevision = await materializeRepository(fixture, repositoryRoot);
      const writer = createRunTraceWriter({ dir: join(evidenceDir, "trajectory"), env: { ...process.env, ...env } });
      const taskId = fixture.id;
      if (unit.arm === Arm.EXHARNESS_SUPERVISED) {
        workspaceRef = `supervised:${repositoryRoot}`;
        armResult = await runSupervisedArm({ tool, fixture, repositoryRoot, baseRevision, env, factors, writer, taskId, hiddenChecks });
        candidateSha = armResult.candidateSha;
      } else {
        const workspace = await createLocalGitWorkspace({ repositoryRoot, baseRevision, worktreeRoot: workspaceRef });
        try {
          armResult = await runDirectArm({ arm: unit.arm, tool, fixture, cwd: workspace.root, baseRevision, env, factors, writer, taskId, toolVersion, hiddenChecks });
          candidateSha = await checkpoint(workspace.root);
        } finally {
          await workspace.dispose();
        }
      }
      if (armResult.toolUnavailable) notEvaluatedReason = "TOOL_UNAVAILABLE";
      else evaluation = await evaluateHidden({ fixture, repositoryRoot, candidateSha, scratch });
      if (evaluation !== null) {
        const patch = await git(repositoryRoot, ["diff", "--binary", baseRevision, candidateSha]);
        const artifact = await put("ARTIFACT", "artifacts/candidate.patch", patch);
        await put("ARTIFACT_MANIFEST", "artifacts/manifest.json", { kind: ARTIFACT_MANIFEST_KIND, files: [{ ref: artifact.ref, digest: artifact.digest, bytes: artifact.bytes }] });
        await put("VERIFIER_OUTPUT", "verifier/hidden.json", { evaluator: EVALUATOR_IDENTITY, verdict: evaluation.verdict, results: evaluation.results });
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const endedAt = new Date().toISOString();
  const traces = armResult?.traces ?? [];
  const evaluated = evaluation !== null;
  const artifactEntry = entries.find((entry) => entry.role === "ARTIFACT_MANIFEST") ?? null;
  const outcomeInput = {
    producerStatus: armResult === null ? "NOT_STARTED" : unit.arm === Arm.EXHARNESS_SUPERVISED ? `SUPERVISED_${armResult.status}` : `EXIT_${armResult.invocations.at(-1).exitCode ?? armResult.invocations.at(-1).status}`,
    termination: skipReason === "MAX_INVOCATIONS" || skipReason === "MAX_USD" ? "BUDGET_EXHAUSTED" : armResult?.timedOut ? "AGENT_TIMEOUT" : notEvaluatedReason === "TOOL_UNAVAILABLE" ? "AGENT_ERROR" : "COMPLETED",
    providerStatus: "NONE",
    infrastructureStatus: notEvaluatedReason === "TOOL_UNAVAILABLE" ? "ADAPTER_SETUP" : evaluated && evaluation.verdict === "ERROR" ? "VERIFIER_ERROR" : "NONE",
    candidate: { extractionStatus: evaluated ? "EXTRACTED" : "NOT_PRODUCED", evaluable: evaluated },
    evaluator: { verdict: evaluated ? evaluation.verdict : "NOT_RUN", identity: EVALUATOR_IDENTITY, evidenceRef: evaluated ? "verifier/hidden.json" : null }
  };
  const usageObservation = usageObservationFromTraces(tool.id, traces);
  const invocations = armResult?.invocations.length ?? 0;
  const raw = {
    arm: unit.arm, tool: tool.id, toolVersion, taskId: fixture.id, repeatIndex: unit.repeatIndex, attemptId, trialId,
    baseRevision, candidateSha, invocations, claimedSuccess: armResult?.claimedSuccess ?? false,
    supervisedStatus: unit.arm === Arm.EXHARNESS_SUPERVISED ? armResult?.status ?? null : null,
    exitCodes: unit.arm === Arm.EXHARNESS_SUPERVISED ? null : (armResult?.invocations ?? []).map((item) => item.exitCode),
    hiddenChecks: hiddenChecks.count, hiddenPresentInAgentWorktree: false, notEvaluatedReason,
    hiddenVerdict: evaluation?.verdict ?? "NOT_RUN", durationMs: Date.parse(endedAt) - Date.parse(startedAt)
  };
  await put("RAW_RESULT", "raw/result.json", raw);
  await put("RESET_IDENTITY", "reset.json", { kind: RESET_IDENTITY_KIND, attemptId, trialId, workspaceRef, outputRef: `attempts/${unit.unitId}`, preexisting });
  await put("USAGE_OBSERVATION", "usage.json", usageObservation);
  await put("NORMALIZATION", "normalization.json", { kind: NORMALIZATION_KIND, outcomeInput });
  const hasTrajectory = traces.length > 0 && existsSync(join(evidenceDir, "trajectory", "traces.jsonl"));
  if (hasTrajectory) {
    const bytes = await readFile(join(evidenceDir, "trajectory", "traces.jsonl"));
    entries.push({ role: "TRAJECTORY", ref: "trajectory/traces.jsonl", digest: sha(bytes), bytes: bytes.length });
  }
  const manifest = createEvidenceManifest({ experimentId: registration.experimentId, unitId: unit.unitId, attemptId, entries });
  const outcome = normalizeOutcome(outcomeInput);
  const { record } = ledger.settleAttempt({
    experimentId: registration.experimentId, cohortId: null, unitId: unit.unitId, attemptId, retryOfAttemptId: null,
    protocolHash: registration.protocol.hash,
    task: { id: unit.task.id, bundleDigest: unit.task.bundleDigest, environmentIdentity: unit.environmentIdentity, instructionDigest: unit.instructionDigest },
    runtime: { substrate: "agent-tools-local", substrateVersion: AGENT_TOOL_ADAPTER_VERSION, substrateCommit: null, sourceSha: baseRevision ?? "not-materialized", profileHash: registration.producerProfile.hash },
    producer: { kind: unit.arm, identity: `${tool.id}@${toolVersion ?? "unknown"}`, model: factors.model, provider: null },
    budget: { wallMs: factors.timeoutMs * maxInvocationsFor(unit.arm, factors), inputTokens: null, outputTokens: null, costUsd: null, toolCalls: maxInvocationsFor(unit.arm, factors) },
    candidate: evaluated ? { artifactRef: "artifacts/candidate.patch", artifactDigest: artifactEntry.digest, extractionStatus: "EXTRACTED" } : { artifactRef: null, artifactDigest: null, extractionStatus: "NOT_PRODUCED" },
    evidence: {
      substrateTrialRef: trialId, resultRef: "raw/result.json", trajectoryRef: hasTrajectory ? "trajectory/traces.jsonl" : null,
      verifierRefs: evaluated ? ["verifier/hidden.json"] : [], artifactManifestRef: evaluated ? "artifacts/manifest.json" : null, manifestDigest: manifest.manifestDigest
    },
    usage: normalizeAccounting(usageObservation),
    timing: { startedAt, endedAt, elapsedMs: raw.durationMs, providerWaitMs: null, capabilityWaitMs: null },
    quality: outcome.quality, termination: outcome.termination, providerStatus: outcome.providerStatus, infrastructureStatus: outcome.infrastructureStatus,
    failureFingerprint: null
  }, { settledAt: endedAt });
  await writeFile(join(attemptDir, "unit.json"), `${JSON.stringify(unit, null, 2)}\n`);
  await writeFile(join(attemptDir, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(attemptDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    tool: tool.id, unitId: unit.unitId, attemptId, taskId: fixture.id, arm: unit.arm, repeatIndex: unit.repeatIndex,
    quality: record.quality.verdict, claimedSuccess: raw.claimedSuccess, notEvaluatedReason: record.quality.verdict === "NOT_EVALUATED" ? notEvaluatedReason ?? "VERIFIER_ERROR" : null,
    durationMs: raw.durationMs, invocations, hiddenChecks: hiddenChecks.count,
    usage: { inputTokens: record.usage.inputTokens, outputTokens: record.usage.outputTokens, cachedTokens: record.usage.cachedTokens, providerCostUsd: record.usage.providerCostUsd, status: record.usage.status },
    recordDigest: record.recordDigest
  };
}

/** Re-audits every settled attempt of `out` in a fresh Node process (no shared memory). */
export async function auditRunInFreshProcess(out) {
  const result = await runProcess(process.execPath, [AUDIT_PROCESS, resolve(out)], { cwd: process.cwd(), timeoutMs: 300000, maxOutputBytes: 16 * 1024 * 1024 });
  if (result.status !== InvocationStatus.COMPLETED || result.exitCode !== 0) throw new Error(`fresh-process audit failed (exit ${result.exitCode}): ${String(result.stderr).slice(-800)}`);
  return JSON.parse(result.stdout);
}

/**
 * Runs the pre-registered experiment for one tool. factorsByArm defaults to DEFAULT_FACTORS for
 * every arm; any difference between arms aborts before registration (FACTOR_MISMATCH). The
 * registration is written to <out>/registration.json before the first beginAttempt. Attempts
 * whose worst-case invocations no longer fit maxInvocationsTotal (or after maxUsd was spent)
 * are settled NOT_EVALUATED and no producer is started for them.
 */
export async function runExperiment({
  tool, out, suiteRoot = DEFAULT_SUITE_ROOT, tasks = null, repeats = 1, seed = 1, factors = {}, factorsByArm = null,
  env = {}, fixtureEnv = null, maxInvocationsTotal = null, maxUsd = null, expectedToolVersion = null,
  expectedRegistrationDigest = null, audit = true, createdAt = undefined
}) {
  if (!tool || typeof tool.id !== "string") throw new TypeError("runExperiment requires a tool adapter");
  if (typeof out !== "string" || out.length === 0) throw new TypeError("runExperiment requires out");
  if (!Number.isInteger(repeats) || repeats <= 0) throw new TypeError("repeats must be a positive integer");
  if (maxInvocationsTotal !== null && (!Number.isInteger(maxInvocationsTotal) || maxInvocationsTotal <= 0)) throw new TypeError("maxInvocationsTotal must be a positive integer");
  const base = { ...DEFAULT_FACTORS, ...factors };
  const perArm = factorsByArm ?? Object.fromEntries(ARMS.map((arm) => [arm, base]));
  const suite = await loadSuite({ root: suiteRoot, tasks });
  const probe = await probeToolVersion(tool, { env });
  if (probe.installed) assertToolVersion(expectedToolVersion, probe.version);
  const registered = createAgentToolsRegistration({
    toolId: tool.id, suite, factorsByArm: perArm, repeats, seed, expectedToolVersion: expectedToolVersion ?? probe.version,
    maxInvocationsTotal, maxUsd, ...(createdAt === undefined ? {} : { createdAt })
  });
  const { registration, units } = registered;
  await persistRegistration(out, registration, { expectedRegistrationDigest });
  const ledger = new AttemptLedger({ registration });
  for (const { unit } of units) ledger.registerUnit(unit);
  const attempts = [];
  let used = 0;
  let spentUsd = 0;
  let usdReported = true;
  let stopReason = probe.installed ? null : NotEvaluatedReason.TOOL_UNAVAILABLE;
  for (const { unit, fixture } of units) {
    const worst = maxInvocationsFor(unit.arm, registered.factors);
    if (stopReason === null && maxInvocationsTotal !== null && used + worst > maxInvocationsTotal) stopReason = NotEvaluatedReason.MAX_INVOCATIONS;
    if (stopReason === null && maxUsd !== null && usdReported && spentUsd >= maxUsd) stopReason = NotEvaluatedReason.MAX_USD;
    const attemptEnv = { ...env, ...(typeof fixtureEnv === "function" ? fixtureEnv(fixture) : {}) };
    const attempt = await runAttempt({ ledger, registration, unit, fixture, tool, toolVersion: probe.version, factors: registered.factors, env: attemptEnv, out, skipReason: stopReason });
    used += attempt.invocations;
    if (attempt.invocations > 0) {
      if (typeof attempt.usage.providerCostUsd === "number") spentUsd += attempt.usage.providerCostUsd;
      else usdReported = false;
    }
    attempts.push(attempt);
  }
  const ledgerEvents = ledger.events();
  await writeFile(join(out, "ledger-events.json"), `${JSON.stringify(ledgerEvents, null, 2)}\n`);
  const audits = audit ? await auditRunInFreshProcess(out) : null;
  if (audits) for (const attempt of attempts) attempt.audit = audits.find((item) => item.attemptId === attempt.attemptId)?.status ?? "MISSING";
  const usdCap = maxUsd === null ? "NOT_SET" : usdReported ? "ENFORCED" : NotEvaluatedReason.USD_CAP_UNENFORCEABLE;
  return {
    tool: tool.id, toolVersion: probe.version, installed: probe.installed, out, registration, attempts, audits, ledgerEvents,
    invocationsUsed: used, maxInvocationsTotal, maxUsd, spentUsd: usdReported ? spentUsd : null, usdCap
  };
}
