# Agent-tool productization — BB-100 … BB-104

Status: RESEARCH_SA brief. Research only; no product source is written by this brief.
Checked: 2026-09-30 against main `7de5761c31d8799021361fb158db756e8e266943` (BB-096 and BB-097 DONE).
Executed probe: `docs/blackboard/evidence/BB-100/productization-probe.mjs` → `productization-probe-result.json`.

## Why this wave exists

RESEARCH_SA had one remaining schedulable task (BB-099), and that task is worker-blocked on BB-098 and BB-065. The delivered foundation already contains three planes that do not meet:

```text
Agentic Application Backend/QA   (BB-096: real git workspace + command verifiers + BackendWorker)
        ×
@exharness/oracle facade         (BB-087: truthful budget/failure; BB-089 planned for Backend/QA only)
        ×
@exharness/agent-tools           (BB-097: outer supervision of Codex, Kiro, agy)
```

A candidate is registered only when (a) a canonical doc, accepted plan, living limitation or executed probe shows the gap, and (b) no existing task covers it.

| Candidate | Evidence | Existing coverage | Decision |
|---|---|---|---|
| Supervised agent as Backend execution | Probe: `createBackendWorker` injects `strategy`/`workspace.act` and PASSes on any `candidate.version` change; `runSupervisedTask` is a closed loop that never imports BackendWorker; no `packages/agentic-system` file imports agent-tools | BB-066 is OpenHands under `DomainExecutionController`; BB-096 is CodeAct BackendWorker; BB-089 is Oracle adoption for context, not execution | Register BB-100 |
| Durable crash/resume of a supervised run | Probe: `runSupervisedTask` always `mkdtemp`, `sessionId = agent-task:${id}:${randomUUID()}`, disposes the worktree in `finally`; no `resumeWorktree` option | BB-066 recovers an OpenHands domain-runtime attempt; Core journals ACT but the worktree/session identity is not persisted | Register BB-101 |
| Oracle-grounded declared context for agent-tools | Probe: `AGENT_TASK_V1` is `{id, repositoryRoot, baseRevision, prompt, verifications}` with no `requiredFiles`/`contextRequirement` | BB-089 adopts the facade for Backend/QA production context; agent-tools is a third consumer | Register BB-102 |
| In-tool MCP verification gate | BB-097 `outOfScope` deferred MCP/hooks; probe: zero MCP symbols in agent-tools; BB-097 CLI probe: Codex `mcp add/list` and Kiro `mcp add/list` exist | None; BB-099 measures outer-supervision value and does not design an MCP server | Register BB-103 |
| Local operator Backend-then-QA slice | Probe: CLI commands are `run` / `report` / `probe` / `smoke`; no `deliver` | BB-069 is the OpenHands + sandbox + preview first slice (blocked on BB-065–068); BB-072/073 are operations/distribution of that product | Register BB-104 |
| Sandbox / network isolation | Living agent-tools: "not a sandbox" | BB-067 | Not registered |
| OpenHands domain runtime | Delivery roadmap | BB-066 | Not registered |
| Generic PM/SA runtime | Living "not implemented" | Intentional non-goal | Not registered |
| Planner / progressive / budget Oracle continuations | BB-064 `continuationSchedule` | BB-091–095 | Not registered |

## Selected architecture

Compose the delivered packages at their existing public seams. Do not merge them into one generic runtime.

```text
BB-100  Application opt-in: BackendWorkOrder -> AGENT_TASK_V1 -> runSupervisedTask
        -> BackendWorkResult. Default CodeAct BackendWorker unchanged.

BB-101  Supervisor recovery: persist worktree path, tool sessionRef, Core sessionId
        and candidate sha; resume the same attempt after process death.

BB-102  Oracle EXACT context on AGENT_TASK.requiredFiles through createOracleContextResolver.
        Unresolved/stale context blocks before the agent starts.

BB-103  Stdio MCP server exposing verify + status only. Promote stays ExHarness-owned.
        Outer supervision remains the authority path.

BB-104  Operator CLI `deliver` composing 100+102+101 into one local Backend-then-QA slice.
        No sandbox, no SCM push, no OpenHands (those remain BB-067/068/066/069).
```

Worker dependencies of BB-100/101/102/103 are already DONE (BB-096, BB-097). Research can run now; after READY, workers are not blocked on BB-054 or BB-065. BB-104 research runs ahead of BB-100/101/102.

## Source classification

| Class | Sources |
|---|---|
| DELIVERED_TRUTH | `createBackendWorker`, `createLocalGitWorkspace`, `createLocalCommandVerifier`; `@exharness/agent-tools` `runSupervisedTask` / `validateAgentTask` / CLI; `createOracleContextResolver`; Core `createHarness` effect journal |
| PLANNED_CONTRACT | BB-098 observation (pass through if present); BB-089 Oracle Backend/QA adoption (different consumer); BB-066 OpenHands domain runtime (different seam) |
| RESEARCH_DESIRED_STATE | this brief; per-task DRAFT plans |

## Per-task research records

- [BB-100](agent-tool-research/BB-100.md)
- [BB-101](agent-tool-research/BB-101.md)
- [BB-102](agent-tool-research/BB-102.md)
- [BB-103](agent-tool-research/BB-103.md)
- [BB-104](agent-tool-research/BB-104.md)

A later operator CLI composition wave (BB-135..137) composes already-delivered recovery, traces, MCP, and run options onto the operator CLI. Remaining command factor parity (BB-139..140) is registered in [operator-cli-factor-parity.md](operator-cli-factor-parity.md). Those waves do not reopen BB-100..104.

Primary sources for BB-103 (eligibility, not adoption):
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (13.5k stars, MIT, spec 2026-07-28). Research must pin a release and compare a zero-dependency stdio implementation against using `@modelcontextprotocol/server` (agent-tools currently has no runtime npm dependencies).
- MCP security practices remain the token-audience / confused-deputy / SSRF baseline already cited on the delivery roadmap. MCP is a transport, not product authority.
