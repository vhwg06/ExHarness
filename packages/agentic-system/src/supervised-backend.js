// Opt-in supervised Backend adapter.
//
// mapBackendOrderToAgentTask binds a BackendWorkOrder plus already-resolved
// BackendContext to an AGENT_TASK_V1 for the delivered agent-tools supervised
// loop. runSupervisedBackendWork runs that loop and projects the supervised
// result onto BackendWorkResultSchema, re-grounding ACCEPTED commits with the
// declared Backend verifications before reporting APPLIED.
//
// The default createBackendWorker path is unchanged and never involved here.
// This module must not statically import agent-tools: supervisor.js statically
// imports agentic-system/src/index.js, so the agent-tools seam is a dynamic
// import() inside runSupervisedBackendWork only.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createEvidenceArtifact,
  environmentRefFromValue,
  evidenceFromVerificationArtifact,
  subjectFromValue,
  VerificationStatus
} from "../../core-harness/src/index.js";
import {
  BackendEvidenceClaim,
  BackendWorkResultSchema,
  BackendWorkStatus,
  BackendContextSchema,
  parseBackendWorkOrder
} from "./contracts.js";
import { createLocalGitWorkspace } from "./local-git-workspace.js";
import { createLocalCommandVerifier } from "./local-command-verifier.js";

const run = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/;

export const SUPERVISED_BACKEND_ADAPTER_IDENTITY = "supervised-backend-adapter";
export const SUPERVISED_BACKEND_WORKSPACE_NAME = "supervised-backend-workspace";

function mappingError(message) {
  return new TypeError(`mapBackendOrderToAgentTask invalid: ${message}`);
}

function requireMappingRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw mappingError(`${name} must be an object`);
  return value;
}

function requireMappingText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw mappingError(`${name} must be a non-empty string`);
  return value;
}

/**
 * Maps a BackendWorkOrder plus resolved BackendContext to AGENT_TASK_V1.
 * repositoryRoot is a required caller filesystem path; context bytes stay out
 * of the prompt. Invalid mappings throw TypeError.
 */
export function mapBackendOrderToAgentTask(order, context, options = {}) {
  const parsedOrder = parseBackendWorkOrder(order);
  let parsedContext;
  try {
    parsedContext = BackendContextSchema.parse(context);
  } catch (error) {
    throw mappingError(error?.message ?? "BackendContext is invalid");
  }
  const settings = requireMappingRecord(options, "options");
  const repositoryRoot = requireMappingText(settings.repositoryRoot, "options.repositoryRoot");
  const prompt = settings.prompt === undefined ? parsedOrder.task : requireMappingText(settings.prompt, "options.prompt");

  if (parsedContext.repository.ref !== parsedOrder.repositoryRef || parsedContext.repository.revision !== parsedOrder.revision) {
    throw mappingError("BackendContext repository must match BackendWorkOrder source revision");
  }
  const resolvedPaths = parsedContext.files.map((file) => file.path);
  if (
    resolvedPaths.length !== parsedOrder.requiredFiles.length ||
    resolvedPaths.some((path, index) => path !== parsedOrder.requiredFiles[index])
  ) {
    throw mappingError("BackendContext files must exactly match BackendWorkOrder.requiredFiles");
  }

  const rawVerifications = settings.verifications;
  if (!Array.isArray(rawVerifications) || rawVerifications.length === 0) {
    throw mappingError("options.verifications must be a non-empty array");
  }
  const seenClaims = new Set();
  const verifications = rawVerifications.map((raw, index) => {
    const entry = requireMappingRecord(raw, `options.verifications[${index}]`);
    const name = requireMappingText(entry.name, `options.verifications[${index}].name`);
    const command = requireMappingText(entry.command, `options.verifications[${index}].command`);
    if (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string")) {
      throw mappingError(`options.verifications[${index}].args must be an array of strings`);
    }
    if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0) {
      throw mappingError(`options.verifications[${index}].timeoutMs must be a positive integer`);
    }
    const claim = requireMappingText(entry.claim, `options.verifications[${index}].claim`);
    if (seenClaims.has(claim)) throw mappingError(`duplicate verification claim: ${claim}`);
    seenClaims.add(claim);
    return { name, command, args: Object.freeze([...entry.args]), timeoutMs: entry.timeoutMs, claim };
  });
  if (!seenClaims.has(BackendEvidenceClaim.TYPECHECK)) {
    throw mappingError(`options.verifications must include claim ${BackendEvidenceClaim.TYPECHECK}`);
  }
  if (!seenClaims.has(BackendEvidenceClaim.TESTS)) {
    throw mappingError(`options.verifications must include claim ${BackendEvidenceClaim.TESTS}`);
  }

  return Object.freeze({
    id: parsedOrder.id,
    repositoryRoot,
    baseRevision: parsedOrder.revision,
    prompt,
    verifications: Object.freeze(verifications.map((item) => Object.freeze({
      name: item.name,
      command: item.command,
      args: item.args,
      timeoutMs: item.timeoutMs
    })))
  });
}

function failedResult(order, summary) {
  return BackendWorkResultSchema.parse({
    status: BackendWorkStatus.FAILED,
    summary,
    revision: null,
    artifacts: [],
    evidence: [],
    gaps: [],
    blockers: []
  });
}

function blockedResult(summary, blockers) {
  return BackendWorkResultSchema.parse({
    status: BackendWorkStatus.BLOCKED,
    summary,
    revision: null,
    artifacts: [],
    evidence: [],
    gaps: [],
    blockers: [...blockers]
  });
}

async function gitDiffNameOnly(repositoryRoot, baseRevision, candidateRevision) {
  const { stdout } = await run("git", ["diff", "--name-only", baseRevision, candidateRevision], {
    cwd: repositoryRoot,
    shell: false,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  });
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Runs Backend work through the delivered supervised agent-tools loop and
 * projects the supervised result onto BackendWorkResultSchema.
 *
 * APPLIED requires an ACCEPTED supervised result whose acceptedSha re-grounds:
 * every declared Backend verification must PASS at that exact commit and the
 * commit must advance the order revision. Everything else is fail-closed:
 * TOOL_UNAVAILABLE projects to BLOCKED, EXHAUSTED (including AUTH_FAIL,
 * NEVER_FIX and NO_CHANGE attempts) projects to FAILED, and failed re-ground
 * never reports APPLIED. Agent claimedSuccess is telemetry only.
 */
export async function runSupervisedBackendWork({
  tool,
  order,
  context,
  repositoryRoot,
  verifications,
  prompt,
  model = null,
  maxAttempts = 3,
  timeoutMs = 600000,
  maxFeedbackChars = 8000,
  permissionProfile,
  env = {},
  eventSinks = [],
  tracer = null,
  invocationObserver = null
} = {}) {
  const parsedOrder = parseBackendWorkOrder(order);
  const task = mapBackendOrderToAgentTask(order, context, { repositoryRoot, verifications, prompt });
  const verificationByName = new Map(verifications.map((entry) => [entry.name, entry]));

  // Leaf-module dynamic imports only: supervisor.js statically imports
  // agentic-system/src/index.js, so a static import here would cycle.
  const supervisor = await import("../../agent-tools/src/supervisor.js");
  const adapters = await import("../../agent-tools/src/tool-adapters.js");
  const { runSupervisedTask, AgentTaskStatus, AttemptOutcome } = supervisor;
  const resolvedPermissionProfile = permissionProfile === undefined
    ? adapters.PermissionProfile.WORKSPACE_EDIT
    : permissionProfile;

  const supervised = await runSupervisedTask({
    tool,
    task,
    model,
    maxAttempts,
    timeoutMs,
    maxFeedbackChars,
    permissionProfile: resolvedPermissionProfile,
    env,
    eventSinks,
    tracer,
    invocationObserver
  });

  if (supervised.status === AgentTaskStatus.TOOL_UNAVAILABLE) {
    return blockedResult(`supervised backend tool unavailable for work order ${parsedOrder.id}`, ["TOOL_UNAVAILABLE"]);
  }

  if (supervised.status !== AgentTaskStatus.ACCEPTED) {
    return failedResult(parsedOrder, `supervised backend exhausted without acceptance for work order ${parsedOrder.id}`);
  }

  const acceptedSha = supervised.acceptedSha;
  if (typeof acceptedSha !== "string" || !SHA40.test(acceptedSha)) {
    return failedResult(parsedOrder, `supervised backend accepted without a committable revision for work order ${parsedOrder.id}`);
  }
  const attempts = Array.isArray(supervised.attempts) ? supervised.attempts : [];
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  if (lastAttempt && lastAttempt.outcome === AttemptOutcome.NO_CHANGE) {
    return failedResult(parsedOrder, `supervised backend produced no change for work order ${parsedOrder.id}`);
  }

  // Re-ground the accepted commit in an isolated worktree: the source
  // repository HEAD, branch refs and working tree are never touched.
  const scratch = await mkdtemp(join(tmpdir(), "exharness-supervised-backend-"));
  const worktreeRoot = join(scratch, "worktree");
  const workspace = await createLocalGitWorkspace({
    repositoryRoot,
    baseRevision: acceptedSha,
    worktreeRoot
  });
  try {
    const records = [];
    for (const verification of task.verifications) {
      const declared = verificationByName.get(verification.name);
      const record = await createLocalCommandVerifier({
        name: verification.name,
        claim: declared.claim,
        root: workspace.root,
        command: verification.command,
        args: [...verification.args],
        timeoutMs: verification.timeoutMs,
        requireUnchangedTree: true
      }).verify({ candidate: { id: parsedOrder.repositoryRef, version: acceptedSha } });
      records.push(record);
    }
    const byClaim = new Map(records.map((record) => [record.claim, record]));
    const typecheck = byClaim.get(BackendEvidenceClaim.TYPECHECK);
    const tests = byClaim.get(BackendEvidenceClaim.TESTS);
    if (!typecheck || typecheck.status !== VerificationStatus.PASS || !tests || tests.status !== VerificationStatus.PASS) {
      return failedResult(parsedOrder, `supervised backend re-ground verification did not pass at ${acceptedSha}`);
    }

    let changedPaths = [];
    try {
      changedPaths = await gitDiffNameOnly(repositoryRoot, parsedOrder.revision, acceptedSha);
    } catch {
      return failedResult(parsedOrder, `supervised backend could not diff accepted revision ${acceptedSha}`);
    }
    if (changedPaths.length === 0) {
      return failedResult(parsedOrder, `supervised backend accepted revision does not advance ${parsedOrder.revision}`);
    }

    const generatedAt = new Date().toISOString();
    const subject = subjectFromValue({
      repositoryRef: parsedOrder.repositoryRef,
      revision: acceptedSha
    }, {
      type: "backend-candidate",
      producer: {
        identity: SUPERVISED_BACKEND_ADAPTER_IDENTITY,
        roles: ["executor"]
      },
      metadata: {
        objectiveId: parsedOrder.objectiveId,
        workOrderId: parsedOrder.id
      }
    });
    const environment = environmentRefFromValue({
      repositoryRef: parsedOrder.repositoryRef,
      baseRevision: parsedOrder.revision,
      resultRevision: acceptedSha
    }, {
      name: SUPERVISED_BACKEND_WORKSPACE_NAME
    });
    const mutation = createEvidenceArtifact({
      subject,
      kind: "BACKEND_MUTATION",
      producer: {
        identity: SUPERVISED_BACKEND_ADAPTER_IDENTITY,
        roles: ["executor"]
      },
      environment,
      generatedAt,
      metadata: {
        claim: BackendEvidenceClaim.MUTATION,
        verificationStatus: VerificationStatus.PASS
      },
      content: {
        beforeRevision: parsedOrder.revision,
        afterRevision: acceptedSha,
        lineageAdvanced: true
      }
    });
    const verificationEvidence = records
      .filter((record) => record.claim === BackendEvidenceClaim.TYPECHECK || record.claim === BackendEvidenceClaim.TESTS)
      .map((record) => evidenceFromVerificationArtifact(record, { subject, environment, generatedAt }));
    const artifacts = parsedOrder.requiredFiles.map((path) => ({ ref: `git:${acceptedSha}:${path}`, path }));

    return BackendWorkResultSchema.parse({
      status: BackendWorkStatus.APPLIED,
      summary: `supervised backend applied work order ${parsedOrder.id} at ${acceptedSha}`,
      revision: acceptedSha,
      artifacts,
      evidence: [mutation, ...verificationEvidence],
      gaps: [],
      blockers: []
    });
  } finally {
    try {
      await workspace.dispose();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
