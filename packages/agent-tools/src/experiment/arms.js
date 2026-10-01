// The three compared arms. Only delivered agent-tools entry points are used:
// runObservedInvocation (direct arms) and runSupervisedTask + createSupervisedObservation.
import { runObservedInvocation, createSupervisedObservation } from "../observation.js";
import { AgentTaskStatus, runSupervisedTask } from "../supervisor.js";
import { InvocationStatus } from "../process-runner.js";
import { PermissionProfile } from "../tool-adapters.js";
import { git, hiddenPresent } from "./suite.js";

export const Arm = Object.freeze({
  DIRECT_SINGLE: "DIRECT_SINGLE",
  DIRECT_RETRY: "DIRECT_RETRY",
  EXHARNESS_SUPERVISED: "EXHARNESS_SUPERVISED"
});
export const ARMS = Object.freeze([Arm.DIRECT_SINGLE, Arm.DIRECT_RETRY, Arm.EXHARNESS_SUPERVISED]);
export const RETRY_PROMPT = "Continue until the task is complete.";
export const DEFAULT_FACTORS = Object.freeze({ K: 3, timeoutMs: 600000, permissionProfile: PermissionProfile.WORKSPACE_EDIT, model: null });
export const FACTOR_KEYS = Object.freeze(["K", "timeoutMs", "permissionProfile", "model"]);

export class HiddenLeakError extends Error {
  constructor(paths) {
    super(`HIDDEN_PRESENT: hidden files reached the agent worktree: ${paths.join(", ")}`);
    this.name = "HiddenLeakError";
    this.code = "HIDDEN_PRESENT";
  }
}

/** Worst-case invocations an arm may spend; attempts are only started when this fits the cap. */
export const maxInvocationsFor = (arm, factors) => (arm === Arm.DIRECT_SINGLE ? 1 : factors.K);

/** Throws FACTOR_MISMATCH when arms of one tool would run under different fixed factors. */
export function assertMatchedFactors(factorsByArm) {
  const arms = Object.keys(factorsByArm);
  const reference = factorsByArm[arms[0]];
  for (const arm of arms.slice(1)) {
    for (const key of FACTOR_KEYS) {
      if (factorsByArm[arm][key] !== reference[key]) {
        const error = new Error(`FACTOR_MISMATCH: ${arm}.${key}=${factorsByArm[arm][key]} differs from ${arms[0]}.${key}=${reference[key]}`);
        error.code = "FACTOR_MISMATCH";
        throw error;
      }
    }
  }
  return reference;
}

async function worktreeState(cwd) {
  return git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]).then(async (status) => `${status}\n${await git(cwd, ["diff", "HEAD"])}`);
}

function checkHidden(fixture, root, checks) {
  const present = hiddenPresent(fixture, root);
  checks.count += 1;
  if (present.length > 0) throw new HiddenLeakError(present);
}

/**
 * Direct arms. DIRECT_SINGLE runs one invocation. DIRECT_RETRY resumes the tool session with
 * RETRY_PROMPT (never verification output) up to K invocations and stops after two consecutive
 * invocations that changed nothing. Producer exit status is telemetry, never quality.
 */
export async function runDirectArm({ arm, tool, fixture, cwd, baseRevision, env, factors, writer, taskId, toolVersion, hiddenChecks }) {
  const limit = arm === Arm.DIRECT_SINGLE ? 1 : factors.K;
  const invocations = [];
  let sessionRef = null;
  let unchangedStreak = 0;
  for (let index = 1; index <= limit; index += 1) {
    checkHidden(fixture, cwd, hiddenChecks);
    const before = await worktreeState(cwd);
    const request = {
      prompt: index === 1 ? fixture.prompt : RETRY_PROMPT,
      permissionProfile: factors.permissionProfile,
      model: factors.model,
      resume: index === 1 ? null : { sessionRef }
    };
    const { invocation, trace } = await runObservedInvocation({
      tool, request, cwd, env, timeoutMs: factors.timeoutMs, baseRevision, taskId, arm, attemptIndex: index, toolVersion, writer
    });
    checkHidden(fixture, cwd, hiddenChecks);
    const parsed = invocation.status === InvocationStatus.TOOL_UNAVAILABLE ? { sessionRef: null } : tool.parseResult({ exitCode: invocation.exitCode, stdout: invocation.stdout, stderr: invocation.stderr });
    sessionRef = parsed.sessionRef ?? sessionRef;
    const changed = before !== (await worktreeState(cwd));
    invocations.push({ index, status: invocation.status, exitCode: invocation.exitCode ?? null, timedOut: invocation.timedOut === true, changed, trace });
    if (invocation.status === InvocationStatus.TOOL_UNAVAILABLE) break;
    unchangedStreak = changed ? 0 : unchangedStreak + 1;
    if (unchangedStreak >= 2) break;
  }
  const last = invocations.at(-1);
  return {
    arm,
    invocations,
    toolUnavailable: last.status === InvocationStatus.TOOL_UNAVAILABLE,
    timedOut: invocations.some((item) => item.timedOut),
    claimedSuccess: last.status === InvocationStatus.COMPLETED && last.exitCode === 0,
    traces: invocations.map((item) => item.trace)
  };
}

/**
 * EXHARNESS_SUPERVISED: runSupervisedTask with only the visible verifications and K attempts.
 * The observer checks, inside every attempt worktree, that no hidden file is present.
 */
export async function runSupervisedArm({ tool, fixture, repositoryRoot, baseRevision, env, factors, writer, taskId, hiddenChecks }) {
  const observation = createSupervisedObservation({ tool, arm: Arm.EXHARNESS_SUPERVISED, taskId, writer, env });
  const invocationObserver = async (observed) => {
    checkHidden(fixture, observed.worktree, hiddenChecks);
    await observation.invocationObserver(observed);
  };
  const result = await runSupervisedTask({
    tool,
    task: { id: taskId, repositoryRoot, baseRevision, prompt: fixture.prompt, verifications: fixture.visibleVerifications.map((item) => ({ ...item })) },
    model: factors.model,
    maxAttempts: factors.K,
    timeoutMs: factors.timeoutMs,
    permissionProfile: factors.permissionProfile,
    env,
    invocationObserver,
    eventSinks: observation.eventSinks,
    tracer: observation.tracer
  });
  const traces = await observation.finalize(result);
  const candidateSha = result.acceptedSha ?? result.attempts.at(-1)?.candidateSha ?? baseRevision;
  return {
    arm: Arm.EXHARNESS_SUPERVISED,
    status: result.status,
    toolVersion: result.toolVersion ?? null,
    toolUnavailable: result.status === AgentTaskStatus.TOOL_UNAVAILABLE,
    timedOut: traces.some((trace) => trace.timedOut === true),
    claimedSuccess: result.status === AgentTaskStatus.ACCEPTED,
    invocations: result.attempts.map((attempt) => ({ index: attempt.index, candidateSha: attempt.candidateSha ?? null })),
    candidateSha,
    traces
  };
}
