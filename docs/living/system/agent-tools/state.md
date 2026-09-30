# Agent tools current state

Source-synchronized projection of `packages/agent-tools` (`@exharness/agent-tools`). Open questions live only in `docs/blackboard/state.md`.

## Current implemented boundary

ExHarness supervises an external CLI coding agent (Codex, Kiro, agy or grok) from outside. The agent only edits a temporary git worktree. ExHarness owns candidate identity, verification, bounded retry with verification feedback, and promotion. The agent's exit status, success claim and final message are recorded as telemetry only and never contribute to acceptance.

```text
AGENT_TASK_V1 { id, repositoryRoot, baseRevision, prompt, verifications[], requiredFiles? }
 -> validateAgentTask (before any process starts; unsafe requiredFiles paths rejected here)
 -> resolveAgentTaskContext only when requiredFiles is non-empty (EXACT Oracle resolution at baseRevision)
 -> createLocalGitWorkspace: detached worktree at baseRevision under os.tmpdir()
 -> projectAgentTaskContext into .exharness/context (git-excluded, never the candidate)
 -> createHarness(strategy = createSupervisedAgentStrategy, environment = agent-tool ACT)
    attempt 1..maxAttempts:
      AVOCapability.ACT { kind: RUN_AGENT_TOOL, attemptIndex, prompt, resume }
        -> runAgentInvocation (spawn, argv array, shell:false, cwd = worktree root)
        -> fold agent commits (git reset --soft <candidate>)
        -> clean tree: NO_CHANGE | dirty tree: one commit authored as EXHARNESS_AGENT_TOOL = new candidate
      verify.<name> for every declared verification (createLocalCommandVerifier, revision-bound, unchanged tree)
      AVOCapability.EVALUATE (PASS only with a PASS record for every declared verifier)
      AVOCapability.PROMOTE only for a mutating ACT whose evaluation is PASS
      otherwise the next prompt = task prompt + "ExHarness verification failed:" block (<= maxFeedbackChars)
 -> AGENT_SUPERVISED_RESULT_V1 { taskId, tool, toolVersion, status ACCEPTED|EXHAUSTED|TOOL_UNAVAILABLE, attempts[], acceptedSha }
 -> worktree disposed
```

The tool process and the candidate commit both run inside Core ACT, so the Core effect journal records the intent before the mutation.

## Tool adapters

`AGENT_TOOL_ADAPTER_V1` adapters build exact argument arrays and parse output. They never read or write CLI configuration or credentials. The argv contract is frozen for codex-cli 0.158.0, kiro-cli-chat 2.24.1, agy 1.1.1 and Grok Build.

| Tool | First invocation | Resume | Session |
| --- | --- | --- | --- |
| `codex` | `exec --json --skip-git-repo-check --sandbox workspace-write [--model m] -`, prompt on stdin | `exec resume <sessionRef> --json -`, prompt on stdin | `thread_id` from the `--json` stream; no session id means a fresh first invocation |
| `kiro` (`kiro-cli`) | `chat --no-interactive --trust-tools=fs_read,fs_write [--model m] <prompt>` | `--resume` after `chat` | resumed by worktree cwd |
| `agy` | `--print <prompt> --mode accept-edits --print-timeout <s>s [--model m] --log-file <path>` | `--continue` first | resumed by worktree cwd |
| `grok` | `--output-format json --model <m, default grok-4.6> [--cwd <dir>] --permission-mode acceptEdits --disable-web-search --no-subagents --no-auto-update --prompt-file <path>`, stdin null | `--resume <sessionId>`, or `--continue` without a session id | `sessionId` from the JSON object; the prompt travels only via `--prompt-file` |

`FULL_AUTO` replaces the permission flags with `--sandbox danger-full-access`, `--trust-all-tools`, `--dangerously-skip-permissions` or `--always-approve` (grok). `WORKSPACE_EDIT` is the default. The agy log file is written outside the worktree. The grok prompt file lives in the supervisor log directory for supervised runs, or in a private directory under `os.tmpdir()` that is removed after the invocation for direct runs, never inside the worktree. Every retry sends the complete task plus the bounded feedback, because Kiro and agy resume by cwd and each task run uses a unique worktree.

`defineAgentTool(base, { command, prefixArgs })` replaces the launch tuple atomically and keeps the adapter's argument builder and result parser.

## Process runner

`runAgentInvocation(tool, request, { cwd, env, timeoutMs, maxOutputBytes })`:

- spawns `tool.command` with `[...prefixArgs, ...args]`, `shell:false`, the prompt on stdin only when the adapter asks for it;
- retains at most `maxOutputBytes` per stream while SHA-256 digests cover the full streams (`truncated` records the cut);
- kills the whole process tree at `timeoutMs` (POSIX process group `SIGKILL`; win32 `taskkill /pid <pid> /T /F` without a shell);
- returns `TOOL_UNAVAILABLE` for a missing executable instead of throwing.

`resolveExecutable(command, { platform, pathEnv })` resolves launches without `cmd.exe` or PowerShell: an absolute `.mjs`/`.js` path runs through `process.execPath`; on win32 an npm `.cmd`/`.ps1` shim next to `node_modules` resolves to its JavaScript entry run through `process.execPath`, and a native `.exe` runs directly.

## CLI

`packages/agent-tools/bin/exharness-agent.mjs`:

- `run --tool <codex|kiro|agy|grok> --task <task.json> [--command <path>] [--max-attempts N] [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M]` prints `AGENT_SUPERVISED_RESULT_V1`; exit 0 only for `ACCEPTED`.
  With `--trace-dir <dir> [--arm <label>]` it also appends one `AGENT_TOOL_RUN_TRACE_V1` line per attempt (see `observation.md`).
- `report <trace-dir>` verifies the trace digest chain and prints the DESCRIPTIVE `AGENT_TOOL_RUN_REPORT_V1`; a broken chain exits 1.
- `probe` prints whether each tool is installed and its version.
- `smoke --tool <t> [--command <path>]` creates a temporary repository with one failing test and runs the supervised loop. It prints `SKIPPED` with `NOT_INSTALLED` when the executable is missing, or `TOOL_FAILED_BEFORE_EDIT` when the tool exits non-zero without an edit on attempt 1 (how a missing login or credential surfaces).

Root scripts: `npm run test:agent-tools` runs the package tests with a deterministic fake CLI and temporary git repositories, and is part of `npm test`. `npm run smoke:agent-tools` is the opt-in live check against an installed, authenticated CLI; it is not part of `npm test` or `npm run verify`.

## Observation

Run observation is described in `observation.md`:

- digest-chained run traces for direct runs (`runObservedInvocation`) and supervised runs (`createSupervisedObservation`);
- per-tool usage limits, where only Codex `turn.completed` usage and grok `--output-format json` usage/cost are observed;
- redaction before any trace byte is written;
- a descriptive per-tool/arm report.

`runSupervisedTask` accepts an optional `invocationObserver` (default null). The supervisor awaits it inside ACT after the candidate commit and before cleanup; with it null, supervision is unchanged.

## Grounded context

Optional Oracle-grounded inputs are described in `context.md`:

- `AGENT_TASK_V1` may declare `requiredFiles`, resolved as `EXACT` snapshot-bound context at `baseRevision` before spawn through the delivered Oracle facade;
- consumable items reach the agent as a prompt prefix beginning `ExHarness grounded context:` (path, `sourceRef:`, excerpt) plus full-byte copies at worktree `.exharness/context/<path>` that are git-excluded from the candidate;
- missing files, stale snapshots and exhausted budgets throw `AgentTaskContextError` with code `CONTEXT_UNSATISFIED` before any agent process starts;
- tasks without `requiredFiles` never construct an Oracle catalog and behave exactly as before.

This consumer grounds supervised CLI agents. It is distinct from the Backend/QA production context adoption owned by the agentic-system package.

## Durable recovery

Opt-in crash resume is described in `recovery.md`: `runSupervisedTask` with
`recoveryDir` persists the worktree, the Core session and an
`AGENT_TOOL_RUN_HANDLE_V1` handle until `disposeRecoverableRun(handle)`, and
`resumeSupervisedTask` continues the same attempt after a crash, refusing to
start a second lineage when the worktree, digest, source HEAD or handle currency
does not check out. Without `recoveryDir` the temporary worktree is still
disposed in a `finally` block.

## Evaluation

`exharness-agent eval` runs the pre-registered agent-tools value evaluation. It compares `DIRECT_SINGLE`, `DIRECT_RETRY` and `EXHARNESS_SUPERVISED` on the owned eight-fixture suite in `benchmarks/agent-tools/fixtures/`. Hidden tests are applied only at independent evaluation. Records go through the shared benchmark kernel ledger, evidence manifests and fresh-process audit. A seeded paired bootstrap gives per-tool `SUPERIOR`, `INFERIOR` or `INCONCLUSIVE`, plus false-success, time, invocation and token metrics. Deterministic calibration with the fake CLI is part of `npm run test:agent-tools`. No live evaluation has been run. Tools without an adapter or executable are `NOT_EVALUATED`. Method, reasons, the grok pilot procedure and the claim boundary are in `evaluation.md`.

## Operator deliver slice

One local Backend-then-QA delivery slice is available as
`exharness-agent deliver --slice <manifest.json>`. The manifest shape, the QA
binding to the accepted Backend commit, resume through the recovery handle and
missing-tool behavior are described in `operator.md`. The slice is local
composition feasibility only: not first-slice product-value evidence and not a
controlled-benchmark pilot.

## MCP verification queries

The stdio MCP server (`createExharnessMcpVerifyServer` in `mcp-server.js`, details
in `mcp.md`) is a transport for verification queries, not acceptance authority.
It exposes `exharness_verify` (`{ ok, results: [{ name, status, reason }] }`) and
`exharness_status` (`{ attemptIndex, candidateSha, lastVerification }`) only;
there is no promote, accept, merge or credential tool. `runSupervisedTask` opts
in per run with `mcpVerify` (default `false`, so a default run never listens);
when on, the server is bound to that worktree only, reports `protocolVersion:
"2025-03-26"`, never writes user CLI configuration, and stops before the
worktree is disposed. No runtime MCP SDK dependency was added. Outer supervision
remains the only promotion path: a verify call during a no-edit success claim
still leaves the run exhausted without mutating the candidate.

## Trust boundary

The adapters are not a sandbox. A live run executes the agent with the user's CLI permissions and credentials under the user account, with cwd at a temporary git worktree only. The CLI can still read or write paths outside that worktree. ExHarness's own git operations preserve the source repository's HEAD, branch refs and working tree; they do not constrain what the agent process itself does. Sandbox, network and credential isolation is not provided by this package; it is separate open work on the Blackboard.
