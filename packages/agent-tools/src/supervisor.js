// Outer supervision of an external CLI coding agent under ExHarness Core.
// ExHarness owns candidate identity (commits in a temporary detached worktree), verification,
// bounded retry with verification feedback and promotion. The agent's exit status and message
// are telemetry only. The CLI itself is not sandboxed: it runs with the user's permissions.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  VerificationStatus,
  createHarness
} from "../../core-harness/src/index.js";
import { createLocalCommandVerifier, createLocalGitWorkspace } from "../../agentic-system/src/index.js";
import { InvocationStatus, runAgentInvocation, runProcess } from "./process-runner.js";
import { PermissionProfile } from "./tool-adapters.js";

export const AGENT_TASK_VERSION = "AGENT_TASK_V1";
export const AGENT_SUPERVISED_RESULT_VERSION = "AGENT_SUPERVISED_RESULT_V1";

export const AgentTaskStatus = Object.freeze({
  ACCEPTED: "ACCEPTED",
  EXHAUSTED: "EXHAUSTED",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE"
});

export const AttemptOutcome = Object.freeze({
  CANDIDATE_CREATED: "CANDIDATE_CREATED",
  NO_CHANGE: "NO_CHANGE"
});

export const RUN_AGENT_TOOL = "RUN_AGENT_TOOL";
export const FEEDBACK_HEADER = "ExHarness verification failed:";

export const AGENT_TOOL_IDENTITY = Object.freeze({
  name: "EXHARNESS_AGENT_TOOL",
  email: "exharness-agent-tool@localhost.invalid"
});

const SHA40 = /^[0-9a-f]{40}$/;

/** Validates AGENT_TASK_V1 before any process starts. */
export function validateAgentTask(task) {
  const invalid = (message) => { throw new TypeError(`${AGENT_TASK_VERSION} invalid: ${message}`); };
  if (!task || typeof task !== "object" || Array.isArray(task)) invalid("task must be an object");
  if (typeof task.id !== "string" || task.id.length === 0) invalid("id must be a non-empty string");
  if (typeof task.repositoryRoot !== "string" || task.repositoryRoot.length === 0) invalid("repositoryRoot must be a non-empty string");
  if (typeof task.baseRevision !== "string" || !SHA40.test(task.baseRevision)) invalid("baseRevision must be a 40-hex commit sha");
  if (typeof task.prompt !== "string" || task.prompt.length === 0) invalid("prompt must be a non-empty string");
  if (!Array.isArray(task.verifications) || task.verifications.length === 0) invalid("verifications must be a non-empty array");
  const names = new Set();
  for (const verification of task.verifications) {
    if (!verification || typeof verification !== "object") invalid("each verification must be an object");
    const { name, command, args, timeoutMs } = verification;
    if (typeof name !== "string" || name.length === 0) invalid("verification name must be a non-empty string");
    if (names.has(name)) invalid(`duplicate verification name: ${name}`);
    names.add(name);
    if (typeof command !== "string" || command.length === 0) invalid(`verification ${name} command must be a non-empty string`);
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) invalid(`verification ${name} args must be an array of strings`);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) invalid(`verification ${name} timeoutMs must be a positive integer`);
  }
  return Object.freeze({
    id: task.id,
    repositoryRoot: task.repositoryRoot,
    baseRevision: task.baseRevision,
    prompt: task.prompt,
    verifications: Object.freeze(task.verifications.map((item) => Object.freeze({ name: item.name, command: item.command, args: Object.freeze([...item.args]), timeoutMs: item.timeoutMs })))
  });
}

async function git(root, args, { env = {} } = {}) {
  const result = await runProcess("git", args, { cwd: root, env: { GIT_CONFIG_NOSYSTEM: "1", ...env }, timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
  if (result.status !== InvocationStatus.COMPLETED || result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.trim().slice(-500)}`);
  }
  return result.stdout;
}

function verificationReason(artifact) {
  const line = (artifact.evidence ?? []).find((item) => typeof item === "string" && item.includes(":reason="));
  return line ? line.slice(line.indexOf(":reason=") + ":reason=".length) : artifact.status;
}

/** Bounded feedback block; the whole block (header included) is at most maxFeedbackChars. */
export function buildFeedback(failures, maxFeedbackChars) {
  if (failures.length === 0) return "";
  const heads = failures.map((failure) => `- ${failure.name}: ${failure.status} ${failure.reason}`);
  const fixed = FEEDBACK_HEADER.length + heads.reduce((sum, head) => sum + 1 + head.length, 0);
  if (fixed > maxFeedbackChars) return `${FEEDBACK_HEADER}\n${heads.join("\n")}`.slice(0, maxFeedbackChars);
  const perTail = Math.floor((maxFeedbackChars - fixed) / failures.length) - 1;
  const parts = [FEEDBACK_HEADER];
  failures.forEach((failure, index) => {
    parts.push(heads[index]);
    const tail = String(failure.output ?? "").trim();
    if (perTail > 0 && tail) parts.push(tail.slice(-perTail));
  });
  return parts.join("\n").slice(0, maxFeedbackChars);
}

/**
 * Core strategy for one supervised task: up to maxAttempts × (ACT, every verifier, EVALUATE),
 * then PROMOTE only for a mutating ACT whose evaluation is PASS.
 */
export function createSupervisedAgentStrategy({ task, maxAttempts = 3, maxFeedbackChars = 8000 }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError("maxAttempts must be a positive integer");
  if (!Number.isInteger(maxFeedbackChars) || maxFeedbackChars <= FEEDBACK_HEADER.length) throw new TypeError("maxFeedbackChars must be an integer larger than the feedback header");
  return Object.freeze({
    async run({ input, invoke }) {
      let currentCandidate = input.candidate;
      let sessionRef = null;
      let feedback = "";
      const attempts = [];
      for (let index = 1; index <= maxAttempts; index += 1) {
        const prompt = feedback ? `${task.prompt}\n\n${feedback}` : task.prompt;
        const resume = index === 1 ? null : { sessionRef };
        const acted = await invoke(AVOCapability.ACT, { kind: RUN_AGENT_TOOL, attemptIndex: index, prompt, resume });
        currentCandidate = acted.candidate;
        const { invocation, outcome, foldedAgentCommits = 0 } = acted.result ?? {};
        const attempt = {
          index,
          resume,
          outcome: outcome === AttemptOutcome.CANDIDATE_CREATED ? AttemptOutcome.CANDIDATE_CREATED : AttemptOutcome.NO_CHANGE,
          exitCode: invocation?.exitCode ?? null,
          timedOut: invocation?.timedOut ?? false,
          durationMs: invocation?.durationMs ?? 0,
          claimedSuccess: invocation?.claimedSuccess ?? false,
          candidateSha: currentCandidate.version,
          mutated: acted.mutated === true,
          foldedAgentCommits,
          verification: [],
          feedbackChars: feedback.length
        };
        attempts.push(attempt);
        if (outcome === InvocationStatus.TOOL_UNAVAILABLE) {
          return { status: AgentTaskStatus.TOOL_UNAVAILABLE, attempts, acceptedSha: null };
        }
        if (invocation?.sessionRef) sessionRef = invocation.sessionRef;
        const failures = [];
        for (const verifier of input.verifiers) {
          const artifact = await invoke(verifier.capability, { attemptIndex: index });
          const record = { name: verifier.name, status: artifact.status, reason: verificationReason(artifact) };
          attempt.verification.push(record);
          if (artifact.status !== VerificationStatus.PASS) failures.push({ ...record, output: artifact.summary });
        }
        const evaluation = await invoke(AVOCapability.EVALUATE, { attemptIndex: index });
        if (evaluation.verdict === EvaluationVerdict.PASS && acted.mutated === true) {
          await invoke(AVOCapability.PROMOTE, null);
          return { status: AgentTaskStatus.ACCEPTED, attempts, acceptedSha: currentCandidate.version };
        }
        if (failures.length > 0) feedback = buildFeedback(failures, maxFeedbackChars);
      }
      return { status: AgentTaskStatus.EXHAUSTED, attempts, acceptedSha: null };
    }
  });
}

function agentToolEnvironment({ workspace, tool, model, permissionProfile, env, timeoutMs, logDir, invocationObserver = null }) {
  return {
    observe: (args) => workspace.observe(args),
    async act({ candidate, action }) {
      if (action?.kind !== RUN_AGENT_TOOL) throw new Error(`unsupported agent action kind: ${action?.kind ?? "null"}`);
      const root = workspace.root;
      const head = (await git(root, ["rev-parse", "HEAD"])).trim();
      if (head !== candidate.version) throw new Error(`agent worktree HEAD ${head} differs from candidate ${candidate.version}`);
      const logFile = join(logDir, `attempt-${action.attemptIndex}.log`);
      const request = { prompt: action.prompt, resume: action.resume, model, permissionProfile, logFile };
      const startedAt = new Date().toISOString();
      const run = await runAgentInvocation(tool, request, { cwd: root, env, timeoutMs });
      const endedAt = new Date().toISOString();
      // Optional BB-098 observation hook: awaited before cleanup, while the worktree and log exist.
      const observe = async (outcome, candidateAfter, foldedAgentCommits) => {
        if (invocationObserver === null) return;
        await invocationObserver({ attemptIndex: action.attemptIndex, request, timeoutMs, invocation: run, startedAt, endedAt, logFile, worktree: root, candidateBefore: candidate.version, candidateAfter, outcome, foldedAgentCommits });
      };
      if (run.status === InvocationStatus.TOOL_UNAVAILABLE) {
        await observe(InvocationStatus.TOOL_UNAVAILABLE, candidate.version, 0);
        return { mutated: false, candidate, result: { outcome: InvocationStatus.TOOL_UNAVAILABLE, invocation: { exitCode: null, timedOut: false, durationMs: run.durationMs, claimedSuccess: false, sessionRef: null } } };
      }
      const parsed = run.timedOut ? { claimedSuccess: false, finalMessage: null, sessionRef: null } : tool.parseResult(run);
      const invocation = {
        exitCode: run.exitCode,
        signal: run.signal,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        claimedSuccess: parsed.claimedSuccess === true,
        finalMessage: typeof parsed.finalMessage === "string" ? parsed.finalMessage.slice(-2000) : null,
        sessionRef: typeof parsed.sessionRef === "string" ? parsed.sessionRef : null,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256,
        truncated: run.truncated
      };
      // Fold any commits the agent made into the candidate's working tree.
      let foldedAgentCommits = 0;
      const after = (await git(root, ["rev-parse", "HEAD"])).trim();
      if (after !== candidate.version) {
        const ancestor = await runProcess("git", ["merge-base", "--is-ancestor", candidate.version, after], { cwd: root, env: { GIT_CONFIG_NOSYSTEM: "1" } });
        foldedAgentCommits = ancestor.exitCode === 0 ? Number((await git(root, ["rev-list", "--count", `${candidate.version}..${after}`])).trim()) : 0;
        await git(root, ["reset", "--soft", candidate.version]);
      }
      const status = await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]);
      if (status === "") {
        await observe(AttemptOutcome.NO_CHANGE, candidate.version, foldedAgentCommits);
        return { mutated: false, candidate, result: { invocation, outcome: AttemptOutcome.NO_CHANGE, foldedAgentCommits } };
      }
      await git(root, ["add", "-A"]);
      await git(root, ["-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", `${RUN_AGENT_TOOL} ${tool.id} attempt ${action.attemptIndex}`], {
        env: {
          GIT_AUTHOR_NAME: AGENT_TOOL_IDENTITY.name,
          GIT_AUTHOR_EMAIL: AGENT_TOOL_IDENTITY.email,
          GIT_COMMITTER_NAME: AGENT_TOOL_IDENTITY.name,
          GIT_COMMITTER_EMAIL: AGENT_TOOL_IDENTITY.email
        }
      });
      const version = (await git(root, ["rev-parse", "HEAD"])).trim();
      await observe(AttemptOutcome.CANDIDATE_CREATED, version, foldedAgentCommits);
      return { mutated: true, candidate: { id: candidate.id, version }, result: { invocation, outcome: AttemptOutcome.CANDIDATE_CREATED, foldedAgentCommits } };
    }
  };
}

async function probeToolVersion(tool, cwd, env) {
  const probe = await runProcess(tool.command, [...tool.prefixArgs, ...tool.versionArgs], { cwd, env, timeoutMs: 30000, maxOutputBytes: 65536 });
  if (probe.status !== InvocationStatus.COMPLETED || probe.exitCode !== 0) return null;
  const line = `${probe.stdout}\n${probe.stderr}`.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ?? null;
}

/**
 * Runs one AGENT_TASK_V1 under ExHarness supervision and returns AGENT_SUPERVISED_RESULT_V1.
 * The agent runs with cwd at a unique temporary worktree; the source repository's HEAD, branch
 * refs and working tree are not changed by ExHarness's own git operations.
 */
export async function runSupervisedTask({
  tool,
  task: rawTask,
  model = null,
  maxAttempts = 3,
  timeoutMs = 600000,
  maxFeedbackChars = 8000,
  permissionProfile = PermissionProfile.WORKSPACE_EDIT,
  env = {},
  eventSinks = [],
  tracer = null,
  invocationObserver = null
}) {
  const task = validateAgentTask(rawTask);
  if (invocationObserver !== null && typeof invocationObserver !== "function") throw new TypeError("invocationObserver must be null or a function");
  if (!Object.values(PermissionProfile).includes(permissionProfile)) throw new TypeError(`unknown permission profile: ${permissionProfile}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  const strategy = createSupervisedAgentStrategy({ task, maxAttempts, maxFeedbackChars });
  const scratch = await mkdtemp(join(tmpdir(), "exharness-agent-"));
  const worktreeRoot = join(scratch, "worktree");
  const logDir = join(scratch, "logs");
  let workspace = null;
  try {
    await mkdir(logDir);
    workspace = await createLocalGitWorkspace({ repositoryRoot: task.repositoryRoot, baseRevision: task.baseRevision, worktreeRoot });
    const toolVersion = await probeToolVersion(tool, workspace.root, env);
    const verifiers = task.verifications.map((verification) => createLocalCommandVerifier({
      name: verification.name,
      claim: `agent-task.${verification.name}`,
      root: workspace.root,
      command: verification.command,
      args: [...verification.args],
      timeoutMs: verification.timeoutMs,
      requireUnchangedTree: true
    }));
    const claims = new Set(verifiers.map((verifier) => `agent-task.${verifier.name}`));
    const harness = createHarness({
      strategy,
      environment: agentToolEnvironment({ workspace, tool, model, permissionProfile, env, timeoutMs, logDir, invocationObserver }),
      verifiers,
      verificationPolicy: { requirements: [...claims].map((claim) => ({ claim })) },
      variationPolicy: { maxCapabilityCalls: maxAttempts * (verifiers.length + 3) },
      objective: {
        // PASS only when every declared verifier recorded PASS for the current candidate;
        // the agent's claim and message never contribute.
        async evaluate({ candidate, verifications }) {
          const passed = new Set(verifications
            .filter((item) => item.status === VerificationStatus.PASS && item.candidate?.version === candidate.version)
            .map((item) => item.claim));
          const missing = [...claims].filter((claim) => !passed.has(claim));
          return {
            validity: EvaluationValidity.VALID,
            verdict: missing.length === 0 ? EvaluationVerdict.PASS : EvaluationVerdict.GAP,
            evidence: missing.length === 0 ? [`agent-task-verified:${candidate.version}`] : missing.map((claim) => `agent-task-unverified:${claim}`)
          };
        }
      },
      eventSinks,
      tracer
    });
    const sessionId = `agent-task:${task.id}:${randomUUID()}`;
    await harness.start({ sessionId, work: { id: task.id, prompt: task.prompt }, seedCandidate: { id: task.id, version: task.baseRevision } });
    const variation = await harness.vary(sessionId);
    if (variation.failure) throw new Error(`supervised agent run failed: ${variation.failure.message}`);
    const outcome = variation.result;
    if ((outcome.status === AgentTaskStatus.ACCEPTED) !== variation.lineage.advanced) {
      throw new Error("supervised agent result disagrees with ExHarness lineage promotion");
    }
    if (outcome.status === AgentTaskStatus.ACCEPTED && variation.lineage.after?.candidate?.version !== outcome.acceptedSha) {
      throw new Error("accepted candidate differs from the promoted lineage head");
    }
    return Object.freeze({
      taskId: task.id,
      tool: tool.id,
      toolVersion,
      status: outcome.status,
      attempts: outcome.attempts,
      acceptedSha: outcome.acceptedSha
    });
  } finally {
    try {
      if (workspace) await workspace.dispose();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
