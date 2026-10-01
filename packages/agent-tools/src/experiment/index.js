// Agent-tools value evaluation: suite, arms, per-tool pre-registration, kernel runner and reducer.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveExecutable } from "../process-runner.js";
import { AGENT_TOOLS, defineAgentTool } from "../tool-adapters.js";
import { ARMS } from "./arms.js";
import { NotEvaluatedReason, probeToolVersion, runExperiment } from "./runner.js";
import { Verdict, reduceAttempts, renderReportMarkdown, serializeReport } from "./reducer.js";
import { DEFAULT_SUITE_ROOT, loadSuite } from "./suite.js";

export { ARMS, Arm, DEFAULT_FACTORS, RETRY_PROMPT, assertMatchedFactors, runDirectArm, runSupervisedArm } from "./arms.js";
export { DEFAULT_SUITE_ROOT, SuiteError, calibrateSuite, loadSuite, materializeRepository } from "./suite.js";
export { DECISION_RULE, EVALUATOR_IDENTITY, PROTOCOL_ID, RegistrationError, createAgentToolsRegistration } from "./registration.js";
export { NotEvaluatedReason, auditRunInFreshProcess, probeToolVersion, runExperiment, usageObservationFromTraces } from "./runner.js";
export { CLAIM_BOUNDARY, REPORT_KIND, Verdict, createRng, pairedBootstrap, reduceAttempts, renderReportMarkdown, serializeReport } from "./reducer.js";
export { EVAL_FORBIDDEN, EVAL_WRITE_SCOPE, auditPaths } from "./scope.js";

// Credentials the evaluated tool never needs are blanked in its environment.
export const BLANKED_ENV = Object.freeze(["TYPESAFE_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
export const FAKE_SCENARIOS = Object.freeze(["FIX_FIRST", "FIX_AFTER_FEEDBACK", "NEVER_FIX", "CLAIM_SUCCESS_NO_EDIT"]);

export class EvalUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvalUsageError";
  }
}

/**
 * Runs the evaluation for each requested tool and writes <out>/report.json and report.md.
 * A tool id without a delivered adapter is NOT_EVALUATED (ADAPTER_NOT_DELIVERED); a missing
 * executable is NOT_EVALUATED (NOT_INSTALLED). Neither is ever run or counted as a result.
 * fakeScenario is only accepted together with an explicit command (deterministic calibration).
 */
export async function runAgentToolsEval({
  tools, command = null, model = null, out, tasks = null, repeats = 1, maxInvocations = null, maxUsd = null,
  fakeScenario = null, seed = 1, registry = AGENT_TOOLS, suiteRoot = DEFAULT_SUITE_ROOT, factors = {}, env = {}
}) {
  const toolIds = Array.isArray(tools) ? tools : [tools];
  if (toolIds.length === 0 || toolIds.some((id) => typeof id !== "string" || id.length === 0)) throw new EvalUsageError("eval requires --tool");
  if (typeof out !== "string" || out.length === 0) throw new EvalUsageError("eval requires --out");
  if (fakeScenario !== null && command === null) throw new EvalUsageError("--fake-scenario requires --command");
  if (fakeScenario !== null && !FAKE_SCENARIOS.includes(fakeScenario)) throw new EvalUsageError(`unknown --fake-scenario: ${fakeScenario}`);
  const root = resolve(out);
  await mkdir(root, { recursive: true });
  const suite = await loadSuite({ root: suiteRoot, tasks });
  const plannedAttempts = suite.fixtures.length * ARMS.length * repeats;
  const overlay = { ...Object.fromEntries(BLANKED_ENV.map((key) => [key, ""])), ...env, ...(fakeScenario === null ? {} : { FAKE_AGENT_SCENARIO: fakeScenario }) };
  const fixtureEnv = fakeScenario === null ? null : (fixture) => ({ FAKE_AGENT_SOLUTION_PATCH: fixture.solutionPatch });
  const runs = {};
  const context = {};
  const attempts = [];
  for (const toolId of toolIds) {
    const base = Object.hasOwn(registry, toolId) ? registry[toolId] : null;
    if (!base) {
      context[toolId] = { status: Verdict.NOT_EVALUATED, notEvaluatedReason: NotEvaluatedReason.ADAPTER_NOT_DELIVERED, plannedAttempts };
      continue;
    }
    const launch = resolveExecutable(command ?? base.command);
    if (!launch) {
      context[toolId] = { status: Verdict.NOT_EVALUATED, notEvaluatedReason: NotEvaluatedReason.NOT_INSTALLED, plannedAttempts };
      continue;
    }
    const tool = defineAgentTool(base, launch);
    // An explicit --command path that does not start (or a PATH hit that cannot report a
    // version) is NOT_INSTALLED: nothing is registered or run for that tool.
    if (!(await probeToolVersion(tool, { env: overlay })).installed) {
      context[toolId] = { status: Verdict.NOT_EVALUATED, notEvaluatedReason: NotEvaluatedReason.NOT_INSTALLED, plannedAttempts };
      continue;
    }
    const run = await runExperiment({
      tool, out: join(root, toolId), suiteRoot, tasks, repeats, seed, factors: { ...factors, model }, env: overlay, fixtureEnv,
      maxInvocationsTotal: maxInvocations, maxUsd
    });
    runs[toolId] = run;
    attempts.push(...run.attempts);
    context[toolId] = { status: "EVALUATED", toolVersion: run.toolVersion, registrationDigest: run.registration.registrationDigest, usdCap: run.usdCap, plannedAttempts };
  }
  const report = reduceAttempts({ attempts, seed, tools: context });
  await writeFile(join(root, "report.json"), serializeReport(report));
  await writeFile(join(root, "report.md"), renderReportMarkdown(report));
  return { report, runs, out: root };
}
