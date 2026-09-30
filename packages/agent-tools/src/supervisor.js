// Outer supervision of an external CLI coding agent under ExHarness Core.
// ExHarness owns candidate identity (commits in a temporary detached worktree), verification,
// bounded retry with verification feedback and promotion. The agent's exit status and message
// are telemetry only. The CLI itself is not sandboxed: it runs with the user's permissions.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_TOOL_RUN_HANDLE_VERSION,
  RecoveryError,
  createFileSessionStore,
  handlePath,
  readAgentToolRunHandle,
  reopenRecoverableWorkspace,
  verifyAgentToolRunHandle,
  writeAgentToolRunHandle
} from "./recovery.js";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  VerificationStatus,
  createHarness
} from "../../core-harness/src/index.js";
import { createLocalCommandVerifier, createLocalGitWorkspace } from "../../agentic-system/src/index.js";
import { InvocationStatus, runAgentInvocation, runProcess } from "./process-runner.js";
import { projectAgentTaskContext, resolveAgentTaskContext, validateRequiredFiles } from "./task-context.js";
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
  const requiredFiles = validateRequiredFiles(task.requiredFiles);
  return Object.freeze({
    id: task.id,
    repositoryRoot: task.repositoryRoot,
    baseRevision: task.baseRevision,
    prompt: task.prompt,
    verifications: Object.freeze(task.verifications.map((item) => Object.freeze({ name: item.name, command: item.command, args: Object.freeze([...item.args]), timeoutMs: item.timeoutMs }))),
    ...(requiredFiles === undefined ? {} : { requiredFiles })
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
export function createSupervisedAgentStrategy({
  task,
  maxAttempts = 3,
  maxFeedbackChars = 8000,
  startAttempt = 1,
  initialSessionRef = null,
  initialFeedback = "",
  skipFirstAct = false,
  onActCompleted = null,
  onAttemptCompleted = null
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError("maxAttempts must be a positive integer");
  if (!Number.isInteger(maxFeedbackChars) || maxFeedbackChars <= FEEDBACK_HEADER.length) throw new TypeError("maxFeedbackChars must be an integer larger than the feedback header");
  if (!Number.isInteger(startAttempt) || startAttempt < 1 || startAttempt > maxAttempts) throw new TypeError("startAttempt must be an integer between 1 and maxAttempts");
  if (initialSessionRef !== null && (typeof initialSessionRef !== "string" || initialSessionRef.length === 0)) throw new TypeError("initialSessionRef must be null or a non-empty string");
  if (typeof initialFeedback !== "string") throw new TypeError("initialFeedback must be a string");
  if (typeof skipFirstAct !== "boolean") throw new TypeError("skipFirstAct must be a boolean");
  if (onActCompleted !== null && typeof onActCompleted !== "function") throw new TypeError("onActCompleted must be null or a function");
  if (onAttemptCompleted !== null && typeof onAttemptCompleted !== "function") throw new TypeError("onAttemptCompleted must be null or a function");
  return Object.freeze({
    async run({ input, invoke }) {
      let currentCandidate = input.candidate;
      let sessionRef = initialSessionRef;
      let feedback = initialFeedback;
      const attempts = [];
      for (let index = startAttempt; index <= maxAttempts; index += 1) {
        const skipped = skipFirstAct && index === startAttempt;
        if (skipped) {
          // Resume of a crashed attempt whose ACT already completed: the candidate and
          // tool session are durable, so only verification and evaluation re-run.
          const mutated = currentCandidate.version !== task.baseRevision;
          const resume = index === 1 ? null : { sessionRef };
          const attempt = {
            index,
            resume,
            outcome: mutated ? AttemptOutcome.CANDIDATE_CREATED : AttemptOutcome.NO_CHANGE,
            exitCode: null,
            timedOut: false,
            durationMs: 0,
            claimedSuccess: false,
            candidateSha: currentCandidate.version,
            mutated,
            foldedAgentCommits: 0,
            verification: [],
            feedbackChars: feedback.length
          };
          attempts.push(attempt);
          const failures = [];
          for (const verifier of input.verifiers) {
            const artifact = await invoke(verifier.capability, { attemptIndex: index });
            const record = { name: verifier.name, status: artifact.status, reason: verificationReason(artifact) };
            attempt.verification.push(record);
            if (artifact.status !== VerificationStatus.PASS) failures.push({ ...record, output: artifact.summary });
          }
          const evaluation = await invoke(AVOCapability.EVALUATE, { attemptIndex: index });
          if (evaluation.verdict === EvaluationVerdict.PASS && mutated) {
            await invoke(AVOCapability.PROMOTE, null);
            return { status: AgentTaskStatus.ACCEPTED, attempts, acceptedSha: currentCandidate.version };
          }
          if (failures.length > 0) feedback = buildFeedback(failures, maxFeedbackChars);
          if (onAttemptCompleted) await onAttemptCompleted({ attemptIndex: index, candidateSha: currentCandidate.version, toolSessionRef: sessionRef, feedback, mutated });
          continue;
        }
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
        if (onActCompleted) await onActCompleted({ attemptIndex: index, candidateSha: currentCandidate.version, toolSessionRef: sessionRef, feedback, mutated: acted.mutated === true });
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
        if (onAttemptCompleted) await onAttemptCompleted({ attemptIndex: index, candidateSha: currentCandidate.version, toolSessionRef: sessionRef, feedback, mutated: acted.mutated === true });
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
      // Grok reads its prompt from --prompt-file; the file lives in the supervisor log
      // directory (outside the worktree) next to the attempt log. Other adapters ignore it.
      const promptFile = join(logDir, `attempt-${action.attemptIndex}.prompt.txt`);
      await writeFile(promptFile, action.prompt, "utf8");
      const request = { prompt: action.prompt, resume: action.resume, model, permissionProfile, logFile, promptFile, cwd: root };
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

function buildSupervisedVerifiers(task, worktreeRoot) {
  return task.verifications.map((verification) => createLocalCommandVerifier({
    name: verification.name,
    claim: `agent-task.${verification.name}`,
    root: worktreeRoot,
    command: verification.command,
    args: [...verification.args],
    timeoutMs: verification.timeoutMs,
    requireUnchangedTree: true
  }));
}

function supervisedObjective(claims) {
  return {
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
  };
}

function checkSupervisedOutcome(outcome, variation) {
  if ((outcome.status === AgentTaskStatus.ACCEPTED) !== variation.lineage.advanced) {
    throw new Error("supervised agent result disagrees with ExHarness lineage promotion");
  }
  if (outcome.status === AgentTaskStatus.ACCEPTED && variation.lineage.after?.candidate?.version !== outcome.acceptedSha) {
    throw new Error("accepted candidate differs from the promoted lineage head");
  }
}

function freezeSupervisedResult({ taskId, tool, toolVersion, outcome }) {
  return Object.freeze({
    taskId,
    tool: tool.id,
    toolVersion,
    status: outcome.status,
    attempts: outcome.attempts,
    acceptedSha: outcome.acceptedSha
  });
}

/**
 * Runs one AGENT_TASK_V1 under ExHarness supervision and returns AGENT_SUPERVISED_RESULT_V1.
 * The agent runs with cwd at a unique temporary worktree; the source repository's HEAD, branch
 * refs and working tree are not changed by ExHarness's own git operations.
 *
 * Without recoveryDir the run still uses a unique mkdtemp scratch worktree that is disposed
 * in a finally block. With recoveryDir the worktree, logs, Core session and handle survive
 * until disposeRecoverableRun(handle); onHandleWrite(handle) is awaited after each persist.
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
  invocationObserver = null,
  repositoryReader = null,
  maxMaterializedBytes = 1048576,
  snapshotObserve = null,
  recoveryDir = null,
  onHandleWrite = null
}) {
  const task = validateAgentTask(rawTask);
  if (invocationObserver !== null && typeof invocationObserver !== "function") throw new TypeError("invocationObserver must be null or a function");
  // Grounded Oracle context resolves after validation and before any worktree
  // exists. Only tasks that declare requiredFiles construct an Oracle catalog;
  // anything unresolved throws AgentTaskContextError before spawn.
  const agentContext = Array.isArray(task.requiredFiles) && task.requiredFiles.length > 0
    ? await resolveAgentTaskContext(task, { repositoryReader, maxMaterializedBytes, snapshotObserve })
    : null;
  const strategyTask = agentContext?.used === true ? { ...task, prompt: `${agentContext.promptPrefix}\n\n${task.prompt}` } : task;
  if (!Object.values(PermissionProfile).includes(permissionProfile)) throw new TypeError(`unknown permission profile: ${permissionProfile}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  if (recoveryDir !== null && (typeof recoveryDir !== "string" || recoveryDir.length === 0)) throw new TypeError("recoveryDir must be null or a non-empty string");
  if (onHandleWrite !== null && typeof onHandleWrite !== "function") throw new TypeError("onHandleWrite must be null or a function");
  if (recoveryDir !== null) {
    return runRecoverableTask({ tool, task: strategyTask, agentContext, model, maxAttempts, timeoutMs, maxFeedbackChars, permissionProfile, env, eventSinks, tracer, invocationObserver, recoveryDir, onHandleWrite });
  }
  const strategy = createSupervisedAgentStrategy({ task: strategyTask, maxAttempts, maxFeedbackChars });
  const scratch = await mkdtemp(join(tmpdir(), "exharness-agent-"));
  const worktreeRoot = join(scratch, "worktree");
  const logDir = join(scratch, "logs");
  let workspace = null;
  try {
    await mkdir(logDir);
    workspace = await createLocalGitWorkspace({ repositoryRoot: task.repositoryRoot, baseRevision: task.baseRevision, worktreeRoot });
    if (agentContext?.used === true) await projectAgentTaskContext(agentContext, { worktreeRoot: workspace.root });
    const toolVersion = await probeToolVersion(tool, workspace.root, env);
    const verifiers = buildSupervisedVerifiers(task, workspace.root);
    const claims = new Set(verifiers.map((verifier) => `agent-task.${verifier.name}`));
    const harness = createHarness({
      strategy,
      environment: agentToolEnvironment({ workspace, tool, model, permissionProfile, env, timeoutMs, logDir, invocationObserver }),
      verifiers,
      verificationPolicy: { requirements: [...claims].map((claim) => ({ claim })) },
      variationPolicy: { maxCapabilityCalls: maxAttempts * (verifiers.length + 3) },
      objective: supervisedObjective(claims),
      eventSinks,
      tracer
    });
    const sessionId = `agent-task:${task.id}:${randomUUID()}`;
    await harness.start({ sessionId, work: { id: task.id, prompt: strategyTask.prompt }, seedCandidate: { id: task.id, version: task.baseRevision } });
    const variation = await harness.vary(sessionId);
    if (variation.failure) throw new Error(`supervised agent run failed: ${variation.failure.message}`);
    const outcome = variation.result;
    checkSupervisedOutcome(outcome, variation);
    return freezeSupervisedResult({ taskId: task.id, tool, toolVersion, outcome });
  } finally {
    try {
      if (workspace) await workspace.dispose();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function persistRecoverableHandle({ recoveryDir, fields, onHandleWrite }) {
  const handle = await writeAgentToolRunHandle(recoveryDir, fields);
  if (onHandleWrite !== null) await onHandleWrite(handle);
  return handle;
}

/**
 * First run of a recoverable supervised task. The worktree, logs, Core session and
 * handle survive in recoveryDir until disposeRecoverableRun(handle). The worktree is
 * never disposed here, not even on ACCEPTED, EXHAUSTED or throw.
 */
async function runRecoverableTask({ tool, task, agentContext = null, model, maxAttempts, timeoutMs, maxFeedbackChars, permissionProfile, env, eventSinks, tracer, invocationObserver, recoveryDir, onHandleWrite }) {
  const root = resolve(recoveryDir);
  if (existsSync(handlePath(root))) {
    throw new RecoveryError("HANDLE_CURRENT", `a current handle already exists in ${root}`);
  }
  const worktreeRoot = join(root, "worktree");
  const logDir = join(root, "logs");
  const sessionDir = join(root, "core-session");
  await mkdir(logDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const sourceHead = (await git(task.repositoryRoot, ["rev-parse", "HEAD"])).trim();
  const sessionId = `agent-task:${task.id}`;
  const sessionStore = createFileSessionStore({ directory: sessionDir });
  const workspace = await createLocalGitWorkspace({ repositoryRoot: task.repositoryRoot, baseRevision: task.baseRevision, worktreeRoot });
  if (agentContext?.used === true) await projectAgentTaskContext(agentContext, { worktreeRoot: workspace.root });
  const toolVersion = await probeToolVersion(tool, workspace.root, env);
  const verifiers = buildSupervisedVerifiers(task, workspace.root);
  const claims = new Set(verifiers.map((verifier) => `agent-task.${verifier.name}`));
  const baseFields = {
    version: AGENT_TOOL_RUN_HANDLE_VERSION,
    taskId: task.id,
    repositoryRoot: resolve(task.repositoryRoot),
    baseRevision: task.baseRevision,
    sourceHead,
    recoveryDir: root,
    worktreeRoot: resolve(worktreeRoot),
    coreSessionId: sessionId,
    toolId: tool.id,
    toolVersion,
    maxAttempts
  };
  let lastToolSessionRef = null;
  let lastFeedback = "";
  let lastCandidateSha = task.baseRevision;
  let lastAttemptIndex = 1;
  const strategy = createSupervisedAgentStrategy({
    task,
    maxAttempts,
    maxFeedbackChars,
    onActCompleted: async ({ attemptIndex, candidateSha, toolSessionRef, feedback }) => {
      lastToolSessionRef = toolSessionRef;
      lastFeedback = feedback;
      lastCandidateSha = candidateSha;
      lastAttemptIndex = attemptIndex;
      await persistRecoverableHandle({
        recoveryDir: root,
        onHandleWrite,
        fields: { ...baseFields, candidateSha, toolSessionRef, attemptIndex, phase: "ACT_COMPLETED", status: "RUNNING", feedback }
      });
    },
    onAttemptCompleted: async ({ attemptIndex, candidateSha, toolSessionRef, feedback }) => {
      lastToolSessionRef = toolSessionRef;
      lastFeedback = feedback;
      lastCandidateSha = candidateSha;
      lastAttemptIndex = attemptIndex;
      await persistRecoverableHandle({
        recoveryDir: root,
        onHandleWrite,
        fields: { ...baseFields, candidateSha, toolSessionRef, attemptIndex, phase: "ATTEMPT_COMPLETED", status: "RUNNING", feedback }
      });
    }
  });
  const harness = createHarness({
    strategy,
    environment: agentToolEnvironment({ workspace, tool, model, permissionProfile, env, timeoutMs, logDir, invocationObserver }),
    verifiers,
    verificationPolicy: { requirements: [...claims].map((claim) => ({ claim })) },
    variationPolicy: { maxCapabilityCalls: maxAttempts * (verifiers.length + 3) },
    objective: supervisedObjective(claims),
    sessionStore,
    recoveryPolicy: { staleAfterMs: 0 },
    eventSinks,
    tracer
  });
  await harness.start({ sessionId, work: { id: task.id, prompt: task.prompt }, seedCandidate: { id: task.id, version: task.baseRevision } });
  // No try/finally disposal: the worktree and handle stay durable across crashes.
  const variation = await harness.vary(sessionId);
  if (variation.failure) throw new Error(`supervised agent run failed: ${variation.failure.message}`);
  const outcome = variation.result;
  checkSupervisedOutcome(outcome, variation);
  const terminalAttempts = outcome.attempts ?? [];
  const terminalIndex = terminalAttempts.at(-1)?.index ?? lastAttemptIndex;
  const terminalCandidate = outcome.acceptedSha ?? terminalAttempts.at(-1)?.candidateSha ?? lastCandidateSha;
  await persistRecoverableHandle({
    recoveryDir: root,
    onHandleWrite,
    fields: { ...baseFields, candidateSha: terminalCandidate, toolSessionRef: lastToolSessionRef, attemptIndex: terminalIndex, phase: "ATTEMPT_COMPLETED", status: outcome.status, feedback: lastFeedback }
  });
  return freezeSupervisedResult({ taskId: task.id, tool, toolVersion, outcome });
}

/**
 * Resumes a recoverable supervised run after a crash. Reopens the same worktree and
 * Core session, continues the tool session when the adapter supports it, and never
 * mints a second lineage for the handle. Fail-closed with RecoveryError and no
 * mkdtemp when the worktree is missing, a digest mismatches, the source HEAD drifted
 * or the handle is stale or complete.
 *
 * The original task (prompt plus verifications) must be supplied again; its identity
 * (id, repositoryRoot, baseRevision) must match the handle.
 */
export async function resumeSupervisedTask(
  handle,
  {
    tool,
    task: rawTask = null,
    model = null,
    maxAttempts = null,
    timeoutMs = 600000,
    maxFeedbackChars = 8000,
    permissionProfile = PermissionProfile.WORKSPACE_EDIT,
    env = {},
    eventSinks = [],
    tracer = null,
    invocationObserver = null,
    onHandleWrite = null
  } = {}
) {
  if (!tool || typeof tool !== "object") throw new RecoveryError("HANDLE_INVALID", "resumeSupervisedTask requires a tool adapter");
  if (invocationObserver !== null && typeof invocationObserver !== "function") throw new TypeError("invocationObserver must be null or a function");
  if (!Object.values(PermissionProfile).includes(permissionProfile)) throw new TypeError(`unknown permission profile: ${permissionProfile}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  if (onHandleWrite !== null && typeof onHandleWrite !== "function") throw new TypeError("onHandleWrite must be null or a function");
  if (!handle || typeof handle !== "object") throw new RecoveryError("HANDLE_INVALID", "resumeSupervisedTask requires a handle");
  verifyAgentToolRunHandle(handle);
  const root = resolve(handle.recoveryDir);
  let disk;
  try {
    disk = await readAgentToolRunHandle(root);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("HANDLE_INVALID", `cannot read handle in ${root}`);
  }
  verifyAgentToolRunHandle(disk);
  if (disk.digest !== handle.digest) {
    throw new RecoveryError("STALE_HANDLE", "the handle on disk is newer than the provided handle");
  }
  if (["ACCEPTED", "EXHAUSTED", "TOOL_UNAVAILABLE"].includes(handle.status)) {
    throw new RecoveryError("HANDLE_COMPLETE", `handle is already ${handle.status}`);
  }
  if (tool.id !== handle.toolId) {
    throw new RecoveryError("TOOL_MISMATCH", `tool ${tool.id} does not match handle tool ${handle.toolId}`);
  }
  const resolvedMaxAttempts = maxAttempts ?? handle.maxAttempts;
  if (!Number.isInteger(resolvedMaxAttempts) || resolvedMaxAttempts <= 0) throw new TypeError("maxAttempts must be a positive integer");
  const liveHead = await git(handle.repositoryRoot, ["rev-parse", "HEAD"]).catch(() => null);
  if (liveHead === null || liveHead.trim() !== handle.sourceHead) {
    throw new RecoveryError("SOURCE_HEAD_DRIFT", "source repository HEAD drifted from handle.sourceHead");
  }
  const workspace = await reopenRecoverableWorkspace({ repositoryRoot: handle.repositoryRoot, worktreeRoot: handle.worktreeRoot });
  const sessionDir = join(root, "core-session");
  const logDir = join(root, "logs");
  await mkdir(logDir, { recursive: true });
  const sessionStore = createFileSessionStore({ directory: sessionDir });
  const sessionId = handle.coreSessionId;
  // The task body (prompt plus verifications) is not part of the handle; the caller
  // supplies it again and its identity must match the handle.
  let task;
  if (rawTask !== null) {
    task = validateAgentTask(rawTask);
    if (task.id !== handle.taskId || resolve(task.repositoryRoot) !== resolve(handle.repositoryRoot) || task.baseRevision !== handle.baseRevision) {
      throw new RecoveryError("HANDLE_INVALID", "resume task identity does not match the handle");
    }
    if (task.verifications.length === 0) throw new RecoveryError("HANDLE_INVALID", "resume task verifications are required");
  } else {
    throw new RecoveryError("HANDLE_INVALID", "resumeSupervisedTask requires the original task");
  }
  const toolVersion = await probeToolVersion(tool, workspace.root, env);
  const verifiers = buildSupervisedVerifiers(task, workspace.root);
  const claims = new Set(verifiers.map((verifier) => `agent-task.${verifier.name}`));
  const resumeAtCompletion = handle.phase === "ATTEMPT_COMPLETED";
  const startAttempt = resumeAtCompletion ? handle.attemptIndex + 1 : handle.attemptIndex;
  if (startAttempt > resolvedMaxAttempts) {
    await persistRecoverableHandle({
      recoveryDir: root,
      onHandleWrite,
      fields: {
        version: AGENT_TOOL_RUN_HANDLE_VERSION, taskId: handle.taskId, repositoryRoot: handle.repositoryRoot,
        baseRevision: handle.baseRevision, sourceHead: handle.sourceHead, worktreeRoot: handle.worktreeRoot,
        candidateSha: handle.candidateSha, coreSessionId: sessionId, toolId: handle.toolId, toolVersion,
        maxAttempts: resolvedMaxAttempts, attemptIndex: handle.attemptIndex, phase: "ATTEMPT_COMPLETED",
        status: "EXHAUSTED", feedback: handle.feedback, createdAt: handle.createdAt, toolSessionRef: handle.toolSessionRef
      }
    });
    return Object.freeze({ taskId: task.id, tool: tool.id, toolVersion, status: AgentTaskStatus.EXHAUSTED, attempts: [], acceptedSha: null });
  }
  const baseFields = {
    version: AGENT_TOOL_RUN_HANDLE_VERSION,
    taskId: task.id,
    repositoryRoot: resolve(task.repositoryRoot),
    baseRevision: task.baseRevision,
    sourceHead: handle.sourceHead,
    recoveryDir: root,
    worktreeRoot: resolve(handle.worktreeRoot),
    coreSessionId: sessionId,
    toolId: tool.id,
    toolVersion,
    maxAttempts: resolvedMaxAttempts
  };
  let lastToolSessionRef = handle.toolSessionRef;
  let lastFeedback = handle.feedback;
  let lastCandidateSha = handle.candidateSha;
  let lastAttemptIndex = handle.attemptIndex;
  const strategy = createSupervisedAgentStrategy({
    task,
    maxAttempts: resolvedMaxAttempts,
    maxFeedbackChars,
    startAttempt,
    initialSessionRef: handle.toolSessionRef,
    initialFeedback: handle.feedback,
    skipFirstAct: !resumeAtCompletion,
    onActCompleted: async ({ attemptIndex, candidateSha, toolSessionRef, feedback }) => {
      lastToolSessionRef = toolSessionRef;
      lastFeedback = feedback;
      lastCandidateSha = candidateSha;
      lastAttemptIndex = attemptIndex;
      await persistRecoverableHandle({
        recoveryDir: root,
        onHandleWrite,
        fields: { ...baseFields, candidateSha, toolSessionRef, attemptIndex, phase: "ACT_COMPLETED", status: "RUNNING", feedback }
      });
    },
    onAttemptCompleted: async ({ attemptIndex, candidateSha, toolSessionRef, feedback }) => {
      lastToolSessionRef = toolSessionRef;
      lastFeedback = feedback;
      lastCandidateSha = candidateSha;
      lastAttemptIndex = attemptIndex;
      await persistRecoverableHandle({
        recoveryDir: root,
        onHandleWrite,
        fields: { ...baseFields, candidateSha, toolSessionRef, attemptIndex, phase: "ATTEMPT_COMPLETED", status: "RUNNING", feedback }
      });
    }
  });
  const harness = createHarness({
    strategy,
    environment: agentToolEnvironment({ workspace, tool, model, permissionProfile, env, timeoutMs, logDir, invocationObserver }),
    verifiers,
    verificationPolicy: { requirements: [...claims].map((claim) => ({ claim })) },
    variationPolicy: { maxCapabilityCalls: resolvedMaxAttempts * (verifiers.length + 3) },
    objective: supervisedObjective(claims),
    sessionStore,
    recoveryPolicy: { staleAfterMs: 0 },
    eventSinks,
    tracer
  });
  // Never harness.start: the session already exists. Recover the interrupted
  // variation (force: the process died) then run the next variation.
  await harness.recover(sessionId, { force: true });
  const variation = await harness.vary(sessionId);
  if (variation.failure) throw new Error(`supervised agent run failed: ${variation.failure.message}`);
  const outcome = variation.result;
  checkSupervisedOutcome(outcome, variation);
  const terminalAttempts = outcome.attempts ?? [];
  const terminalIndex = terminalAttempts.at(-1)?.index ?? lastAttemptIndex;
  const terminalCandidate = outcome.acceptedSha ?? terminalAttempts.at(-1)?.candidateSha ?? lastCandidateSha;
  await persistRecoverableHandle({
    recoveryDir: root,
    onHandleWrite,
    fields: { ...baseFields, candidateSha: terminalCandidate, toolSessionRef: lastToolSessionRef, attemptIndex: terminalIndex, phase: "ATTEMPT_COMPLETED", status: outcome.status, feedback: lastFeedback }
  });
  return freezeSupervisedResult({ taskId: task.id, tool, toolVersion, outcome });
}
