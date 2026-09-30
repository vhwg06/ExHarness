// Direct and supervised observation: turns BB-097 invocations into AGENT_TOOL_RUN_TRACE_V1 records.
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTraceRecorder } from "../../core-harness/src/index.js";
import { runAgentInvocation } from "./process-runner.js";
import { createRedactor } from "./redaction.js";
import { TraceMode, buildTraceBody, commitDiffStats, workingTreeDiffStats } from "./run-trace.js";

const nowIso = () => new Date().toISOString();
const mergedEnv = (env) => {
  const { NODE_TEST_CONTEXT, ...inherited } = process.env;
  return { ...inherited, ...env };
};

/**
 * Runs one direct (unsupervised) invocation through BB-097 runAgentInvocation and appends its trace.
 * Timestamps are taken around the call; the diff covers tracked and untracked working-tree changes
 * against baseRevision. Nothing is written into cwd.
 */
export async function runObservedInvocation({
  tool, request, cwd, env = {}, timeoutMs = 600000, maxOutputBytes = 1048576, baseRevision,
  taskId, arm, attemptIndex = 1, toolVersion = null, writer, verification = [], runId = randomUUID()
}) {
  if (!writer) throw new TypeError("runObservedInvocation requires a trace writer");
  if (typeof baseRevision !== "string" || baseRevision.length === 0) throw new TypeError("runObservedInvocation requires baseRevision");
  const startedAt = nowIso();
  // Grok reads its prompt from --prompt-file. A direct caller has no supervisor log directory,
  // so the prompt is staged in a private directory under os.tmpdir() (never inside the
  // worktree) and removed once the invocation settles, whatever its outcome.
  // request.cwd always carries the spawn cwd so the adapter can pass --cwd.
  const effective = { ...request, cwd };
  let stagedDir = null;
  let invocation;
  try {
    if (tool.id === "grok" && (typeof effective.promptFile !== "string" || effective.promptFile.length === 0)) {
      stagedDir = await mkdtemp(join(tmpdir(), "exharness-grok-prompt-"));
      await chmod(stagedDir, 0o700);
      const promptPath = join(stagedDir, "prompt.txt");
      await writeFile(promptPath, String(request.prompt ?? ""), { encoding: "utf8", mode: 0o600 });
      effective.promptFile = promptPath;
    }
    invocation = await runAgentInvocation(tool, effective, { cwd, env, timeoutMs, maxOutputBytes });
  } finally {
    if (stagedDir !== null) await rm(stagedDir, { recursive: true, force: true });
  }
  const endedAt = nowIso();
  const diff = invocation.status === "TOOL_UNAVAILABLE"
    ? { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 }
    : await workingTreeDiffStats(cwd, baseRevision);
  const body = await buildTraceBody({
    runId, taskId, tool, toolVersion, arm, mode: TraceMode.DIRECT, attemptIndex, request: effective, timeoutMs, invocation,
    startedAt, endedAt, diff, verification, harness: null, env: mergedEnv(env)
  });
  const trace = await writer.append(body, { extraEnv: env });
  return { invocation, trace };
}

const RUN_EVENT = /^(HARNESS_|AGENT_RUN_)/;
const RUN_SPAN_KINDS = new Set(["STRATEGY", "AGENT_RUN"]);

/**
 * Captures Core events and spans as type/name summaries only (payload values such as candidate or
 * session ids are never kept). Entries are split into attempt windows opened by avo.act.
 */
export function createHarnessCapture() {
  const events = [];
  const spans = [];
  const eventSink = Object.freeze({
    name: "agent-tool-trace-events",
    write(event) {
      const capability = typeof event?.payload?.name === "string" && String(event.type).startsWith("CAPABILITY_") ? event.payload.name : null;
      events.push({ type: String(event?.type ?? "UNKNOWN"), capability });
    }
  });
  const traceSink = Object.freeze({
    name: "agent-tool-trace-spans",
    write(span) {
      spans.push({ kind: String(span?.kind ?? "UNKNOWN"), name: String(span?.name ?? ""), status: span?.status ?? null, durationMs: Number.isFinite(span?.durationMs) ? span.durationMs : null });
    }
  });
  function windows(attemptCount) {
    const perAttempt = Array.from({ length: attemptCount }, () => ({ events: [], spans: [] }));
    const run = { events: [], spans: [] };
    let current = -1;
    for (const event of events) {
      if (event.type === "CAPABILITY_INVOKED" && event.capability === "avo.act") current += 1;
      if (RUN_EVENT.test(event.type) || current < 0 || current >= attemptCount) run.events.push({ ...event, scope: "RUN" });
      else perAttempt[current].events.push({ ...event, scope: "ATTEMPT" });
    }
    current = -1;
    for (const span of spans) {
      if (span.kind === "CAPABILITY" && span.name === "avo.act") current += 1;
      if (RUN_SPAN_KINDS.has(span.kind) || current < 0 || current >= attemptCount) run.spans.push({ ...span, scope: "RUN" });
      else perAttempt[current].spans.push({ ...span, scope: "ATTEMPT" });
    }
    return { perAttempt, run };
  }
  return Object.freeze({ eventSink, traceSink, snapshot: () => ({ events: events.map((e) => ({ ...e })), spans: spans.map((s) => ({ ...s })) }), windows });
}

/**
 * Supervised observation for BB-097 runSupervisedTask. Pass { invocationObserver, eventSinks, tracer }
 * to runSupervisedTask, then call finalize(result) to append one trace per attempt. The observer
 * redacts, parses and diffs while the attempt worktree and log file still exist.
 */
export function createSupervisedObservation({ tool, arm, taskId, writer, env = {}, createTracer = createTraceRecorder, runId = randomUUID() }) {
  if (!writer) throw new TypeError("createSupervisedObservation requires a trace writer");
  const redactor = createRedactor({ env: mergedEnv(env) });
  const capture = createHarnessCapture();
  const bodies = new Map();
  async function invocationObserver(observed) {
    const { attemptIndex, request, timeoutMs, invocation, startedAt, endedAt, worktree, candidateBefore, candidateAfter } = observed;
    const diff = invocation.status === "TOOL_UNAVAILABLE"
      ? { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 }
      : await commitDiffStats(worktree, candidateBefore, candidateAfter);
    bodies.set(attemptIndex, await buildTraceBody({
      runId, taskId, tool, toolVersion: null, arm, mode: TraceMode.SUPERVISED, attemptIndex, request, timeoutMs, invocation,
      startedAt, endedAt, diff, verification: [], harness: null, env: mergedEnv(env)
    }));
  }
  async function finalize(result) {
    const attempts = result?.attempts ?? [];
    const { perAttempt, run } = capture.windows(attempts.length);
    const traces = [];
    for (const [position, attempt] of attempts.entries()) {
      const body = bodies.get(attempt.index);
      if (!body) throw new Error(`supervised attempt ${attempt.index} was not observed`);
      const last = position === attempts.length - 1;
      body.toolVersion = result.toolVersion ?? null;
      body.verification = attempt.verification.map(({ name, status, reason = null }) => ({ name, status, reason: reason == null ? null : redactor.redact(reason) }));
      body.harness = {
        events: [...perAttempt[position].events, ...(last ? run.events : [])],
        spans: [...perAttempt[position].spans, ...(last ? run.spans : [])]
      };
      traces.push(await writer.append(body, { extraEnv: env }));
    }
    return traces;
  }
  return Object.freeze({
    runId,
    invocationObserver,
    eventSinks: [capture.eventSink],
    tracer: createTracer({ sinks: [capture.traceSink] }),
    finalize,
    capture
  });
}
