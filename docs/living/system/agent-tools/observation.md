# Agent tool run observation

Source-synchronized projection of the observation modules in `packages/agent-tools/src` (`run-trace.js`, `output-parsers.js`, `redaction.js`, `observation.js`, `report.js`). Open questions live only in `docs/blackboard/state.md`.

## What is observed

Every direct or ExHarness-supervised agent-tool invocation can produce one `AGENT_TOOL_RUN_TRACE_V1` line in `<trace-dir>/traces.jsonl`. Traces are evidence only. Neither the trace writer nor the report decides acceptance, superiority or value. Comparisons between tools or arms belong to the benchmark lane on the Blackboard, and attempts, evidence manifests and accounting stay owned by `@exharness/benchmark`.

```text
AGENT_TOOL_RUN_TRACE_V1 {
  kind, version, sequence, prevDigest, digest, traceId, runId, taskId,
  tool, toolVersion, arm (caller label, opaque), mode DIRECT|SUPERVISED, attemptIndex,
  startedAt, endedAt (wall clock around the invocation), durationMs (runner),
  status COMPLETED|TIMED_OUT|TOOL_UNAVAILABLE, exitCode, signal, timedOut,
  promptSha256, argvRedacted,
  stdout|stderr { sha256 (full stream), capturedBytes, truncated, excerpt (<= 4000 chars, redacted) },
  logFile { sha256, bytes, excerpt } | null,        // agy --log-file
  toolEvents { counts by type, invalidLines } | null, // codex --json only
  usage { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, source, unavailableReason },
  diff { filesChanged, insertions, deletions, binaryFiles },
  verification [{ name, status, reason }],
  harness { events [{ type, capability, scope }], spans [{ kind, name, status, durationMs, scope }] } | null
}
```

In `argvRedacted`, an argument equal to the prompt is replaced by `<prompt sha256=… chars=N>`.

## Digest chain

`createRunTraceWriter({ dir })` appends lines one at a time. Each record's `digest` is the SHA-256 of its canonical JSON (sorted keys) without `digest`. `prevDigest` links to the previous line (null for the first), and `sequence` counts from 1.

`verifyTraceFile(path)` and `readTraces(dir)` recompute every digest, sequence and link. An edited, deleted, inserted, reordered or truncated line throws an error with code `TRACE_CHAIN_BROKEN`. The writer verifies the existing file before appending.

## Direct and supervised capture

- **Direct:** `runObservedInvocation({ tool, request, cwd, baseRevision, taskId, arm, writer, … })` wraps `runAgentInvocation`.
  - Its diff is `git diff --numstat <baseRevision>` of the working tree plus untracked files, each counted with its line count.
  - Direct traces have `harness: null`.
  - It writes nothing into the worktree.
- **Supervised:** `createSupervisedObservation({ tool, arm, taskId, writer })` returns `{ invocationObserver, eventSinks, tracer, finalize }` for `runSupervisedTask`.
  - `invocationObserver` is an optional supervisor hook, null by default. With it null, the supervisor behaves exactly as before.
  - The supervisor awaits it inside ACT after the candidate commit and before cleanup, so output, the agy log and the attempt diff (`git diff --numstat candidateBefore candidateAfter`) are read while they still exist.
  - An observer error fails the supervised run; it is not swallowed.
  - `finalize(result)` appends one trace per attempt. Each trace carries that attempt's verification records and its Core event/span window. A window opens at each `CAPABILITY_INVOKED` event and `CAPABILITY` span named `avo.act`.
  - Run-level entries (`HARNESS_*`, `AGENT_RUN_*`, `STRATEGY`, `AGENT_RUN`) go to the last attempt with `scope: RUN`.
  - Only event types, capability names and span kind/name/status/duration are kept, never payload values such as candidate or session ids.

CLI: `exharness-agent run … --trace-dir <dir> [--arm <label>]` writes supervised traces. The default arm label is `EXHARNESS_SUPERVISED`.

## Per-tool observability limits

| Tool | Tool events | Token usage | Unavailable reason |
| --- | --- | --- | --- |
| `codex` | `exec --json` event counts by `type`; malformed lines counted in `invalidLines` | summed only over `turn.completed` events whose `usage` has integer `input_tokens` and `output_tokens`; cached/reasoning fields only when every counted turn reported them | `CODEX_USAGE_NOT_REPORTED`, or `CODEX_STREAM_TRUNCATED` when a truncated stream had none |
| `kiro` | none; the delivered adapter runs plain-text `--no-interactive` | null | `KIRO_TEXT_OUTPUT_NO_USAGE` |
| `agy` | none; the `--log-file` is stored only as digest, size and redacted excerpt | null | `AGY_USAGE_NOT_REPORTED` |
| any | none | null for a timed-out or missing tool | `TIMED_OUT`, `TOOL_UNAVAILABLE` |

Token values are never estimated from text length. A reported zero stays zero, and an unreported value stays null. Kiro documents `--output-format stream-json`, but the delivered adapter does not request it and its usage fields are undocumented, so Kiro usage stays unobserved.

## Redaction

`createRedactor({ env })` replaces every one of the following with `[REDACTED]`:

- the value of any environment variable (process env merged with the invocation env) whose name matches `KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL` and whose value is at least 8 characters;
- the patterns `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `AIza…` and `Bearer …`.

It runs on the full captured text before excerpting. When a capture was truncated, the trailing partial line is dropped first, so a secret cut at the boundary cannot leave a prefix. It also runs on argv, the agy log excerpt and verification reasons.

Before appending, the writer re-checks the serialized line against the same secret set and refuses it with `SECRET_IN_TRACE`. Digests are over raw bytes and are one-way. Redaction is pattern- and environment-based: a secret that is neither in a matching environment variable nor in a known pattern is not recognized.

## Descriptive report

`summarizeTraces(records)` groups by tool, then arm (sorted), and returns counts only:

- traces, distinct tasks and runs;
- status and exit-code counts, timeouts;
- verification status counts and diff totals;
- duration min/median/max;
- token totals over covered traces only, with `coveredTraces`, `uncoveredTraces` and `unavailableReasonCounts`.

`exharness-agent report <trace-dir>` verifies the chain first; a broken chain exits 1. It prints `{ kind: AGENT_TOOL_RUN_REPORT_V1, label: DESCRIPTIVE, traceCount, groups }`. The report has no acceptance, winner, pass-rate or value field.
