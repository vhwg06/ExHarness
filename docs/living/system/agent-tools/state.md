# Agent tools current state

Source-synchronized projection of `packages/agent-tools` (`@exharness/agent-tools`). Open questions live only in `docs/blackboard/state.md`.

## Current implemented boundary

ExHarness supervises an external CLI coding agent (Codex, Kiro or agy) from outside. The agent only edits a temporary git worktree. ExHarness owns candidate identity, verification, bounded retry with verification feedback, and promotion. The agent's exit status, success claim and final message are recorded as telemetry only and never contribute to acceptance.

```text
AGENT_TASK_V1 { id, repositoryRoot, baseRevision, prompt, verifications[] }
 -> validateAgentTask (before any process starts)
 -> createLocalGitWorkspace: detached worktree at baseRevision under os.tmpdir()
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

`AGENT_TOOL_ADAPTER_V1` adapters build exact argument arrays and parse output. They never read or write CLI configuration or credentials. The argv contract is frozen for codex-cli 0.158.0, kiro-cli-chat 2.24.1 and agy 1.1.1.

| Tool | First invocation | Resume | Session |
| --- | --- | --- | --- |
| `codex` | `exec --json --skip-git-repo-check --sandbox workspace-write [--model m] -`, prompt on stdin | `exec resume <sessionRef> --json -`, prompt on stdin | `thread_id` from the `--json` stream; no session id means a fresh first invocation |
| `kiro` (`kiro-cli`) | `chat --no-interactive --trust-tools=fs_read,fs_write [--model m] <prompt>` | `--resume` after `chat` | resumed by worktree cwd |
| `agy` | `--print <prompt> --mode accept-edits --print-timeout <s>s [--model m] --log-file <path>` | `--continue` first | resumed by worktree cwd |

`FULL_AUTO` replaces the permission flags with `--sandbox danger-full-access`, `--trust-all-tools` or `--dangerously-skip-permissions`. `WORKSPACE_EDIT` is the default. The agy log file is written outside the worktree. Every retry sends the complete task plus the bounded feedback, because Kiro and agy resume by cwd and each task run uses a unique worktree.

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

- `run --tool <codex|kiro|agy> --task <task.json> [--command <path>] [--max-attempts N] [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M]` prints `AGENT_SUPERVISED_RESULT_V1`; exit 0 only for `ACCEPTED`.
  With `--trace-dir <dir> [--arm <label>]` it also appends one `AGENT_TOOL_RUN_TRACE_V1` line per attempt (see `observation.md`).
- `report <trace-dir>` verifies the trace digest chain and prints the DESCRIPTIVE `AGENT_TOOL_RUN_REPORT_V1`; a broken chain exits 1.
- `probe` prints whether each tool is installed and its version.
- `smoke --tool <t> [--command <path>]` creates a temporary repository with one failing test and runs the supervised loop. It prints `SKIPPED` with `NOT_INSTALLED` when the executable is missing, or `TOOL_FAILED_BEFORE_EDIT` when the tool exits non-zero without an edit on attempt 1 (how a missing login or credential surfaces).

Root scripts: `npm run test:agent-tools` runs the package tests with a deterministic fake CLI and temporary git repositories, and is part of `npm test`. `npm run smoke:agent-tools` is the opt-in live check against an installed, authenticated CLI; it is not part of `npm test` or `npm run verify`.

## Observation

Run observation is described in `observation.md`:

- digest-chained run traces for direct runs (`runObservedInvocation`) and supervised runs (`createSupervisedObservation`);
- per-tool usage limits, where only Codex `turn.completed` usage is observed;
- redaction before any trace byte is written;
- a descriptive per-tool/arm report.

`runSupervisedTask` accepts an optional `invocationObserver` (default null). The supervisor awaits it inside ACT after the candidate commit and before cleanup; with it null, supervision is unchanged.

## Durable recovery

Opt-in crash resume is described in `recovery.md`: `runSupervisedTask` with
`recoveryDir` persists the worktree, the Core session and an
`AGENT_TOOL_RUN_HANDLE_V1` handle until `disposeRecoverableRun(handle)`, and
`resumeSupervisedTask` continues the same attempt after a crash, refusing to
start a second lineage when the worktree, digest, source HEAD or handle currency
does not check out. Without `recoveryDir` the temporary worktree is still
disposed in a `finally` block.

## Trust boundary

The adapters are not a sandbox. A live run executes the agent with the user's CLI permissions and credentials under the user account, with cwd at a temporary git worktree only. The CLI can still read or write paths outside that worktree. ExHarness's own git operations preserve the source repository's HEAD, branch refs and working tree; they do not constrain what the agent process itself does. Sandbox, network and credential isolation is not provided by this package; it is separate open work on the Blackboard.
