# ExHarness research roadmap: desired state vs delivered truth

Checked: 2026-09-30. Grounded on origin/main `16fbfeea` (roadmap) and `fdb953c1` (defect audit), then updated to the graph at registration: BB-065 and BB-091 are DONE, BB-104 is READY, and BB-100, BB-101 and BB-105 have worker candidates in review.

Classification: **DELIVERED_TRUTH** = living docs + current packages; **PLANNED_CONTRACT** = READY/PLANNED graph tasks; **RESEARCH_DESIRED_STATE** = process briefs not yet tasked.

## Per product area

### Core harness

**Desired end state.** Async-first Core with detached operations, cache-stable result context and steering/wakeup, accepted only after a fixed-factor harness-isolation protocol and held-out ablation (process: `harness-efficiency-phase.md`, `harness-benchmark-program-research.md`).

**Delivered truth.** `packages/core-harness/` — `createHarness` / AVO effect journal (`INTENDED → DISPATCHED → CONFIRMED|UNKNOWN`), `createResumableAgentRuntime`, interrupted-variation recovery, ActionIntent, grounded REFLECTION/INTENT, injected `contextResolver` port. Living: `docs/living/system/core-harness/{state,capabilities,workflow}.md`.

**Gap.** Sync Core is the product path. Async profile is unbuilt.

**Covered by.** BB-077 (harness isolation; RESEARCH returned), BB-078–080 (implementation, blocked on BB-077), BB-081 (held-out ablation; depends BB-077–080). BB-065 (kernel) is DONE.

### Oracle context intelligence

**Desired end state.** Infrastructure-owned context IO with truthful budgets, snapshot-bound Context Graph, Backend/QA facade adoption, then BB-064 `continuationSchedule`: planner ablation → progressive resolution → budget profiles → Core profiles → held-out acceptance (`oracle-post-foundation-discovery.md`, `gate-gap-and-oracle-continuations.md`).

**Delivered truth.** `@exharness/oracle` facade `createOracleContextResolver` (BB-087 accounting/typed failure), Context Graph (BB-088), Backend/QA opt-in adoption (BB-089). Living: `docs/living/system/oracle/{state,capabilities,workflow,artifact-manifest}.md`.

**Gap.** Planner still has a weak retrieval benchmark (BB-062 ranks with its own `rank()`, not the planner). Progressive resolution, budgets, Core profiles and held-out acceptance are unbuilt. Facade still hard-codes step 0.

**Covered by.** BB-091 (DONE: planning strategies), BB-092–095 (blocked in order; BB-094 also waits on BB-081; BB-095 waits on BB-065).

### Agentic application

**Desired end state.** A developer supplies a bounded delivery objective and receives a reviewable, independently verified change, with pause/resume, requirement change, and installable operations (`delivery-product-roadmap.md`). Durable Backend→QA is a product execution path, not only a CodeAct demo.

**Delivered truth.** Backend/QA slices, `createApplicationOrchestrator`, `createDurableBackendQaWorkflow` / `runBackendThenQaObjective`, local git workspace + command verifiers (BB-096), organization A.1 + bounded domain execution (BB-048–054). Living: `docs/living/system/agentic-application/{state,capabilities,workflow}.md`. Probe: durable workflow parameters are `backendWorker` + CodeAct; zero `agent-tools` hits (`docs/blackboard/evidence/BB-121/durable-board-probe-result.json`).

**Gap.** Completeness/closure (BB-055). OpenHands runtime, sandbox, SCM, first slice, lifecycle, ops, pilot (BB-066–076). Supervised agents are not a Board execution strategy (G3). Feedback/self-improve (BB-083–086).

**Covered by.** BB-055, BB-057–059, BB-066–076, BB-083–086, BB-100 (opt-in adapter, WORKER), BB-104 (operator `deliver`, READY), **BB-121 (new)**.

### Agent-tools

**Desired end state.** Outer supervision of real CLIs as a product Backend strategy: isolated child env, durable resume, Oracle-declared context, optional MCP verify, operator slice, measured supervised-vs-direct value on two real CLIs.

**Delivered truth.** `packages/agent-tools/` — Codex/Kiro/agy adapters, `runSupervisedTask`, observation traces (BB-097/098). Living: `docs/living/system/agent-tools/{state,observation}.md`. `AGENT_TOOLS = {codex,kiro,agy}`. Host: grok 1.0.44 and opencode 1.18.33 installed off PATH; Codex/Kiro/agy `NOT_INSTALLED`.

**Gap.**

| Gap | Status |
|---|---|
| Grok adapter | Covered: BB-105 WORKER |
| Supervised Backend adapter | Covered: BB-100 WORKER |
| Crash-resume | Covered: BB-101 WORKER |
| Oracle `requiredFiles` | Covered: BB-102 WORKER |
| MCP verify/status | Covered: BB-103 WORKER |
| Operator `deliver` | Covered: BB-104 READY |
| Supervised vs direct eval | Covered: BB-099 READY (BB-065 DONE) |
| Child env inherit-all (`process.env` spread) | **Open → BB-120** |
| Durable Board injection | **Open → BB-121** |
| Second real CLI (opencode) | **Open → BB-122** |
| Kiro/agy token usage (G7) | Open, not registered (no live `kiro-cli`; parser would be fabricated) |

### Benchmark

**Desired end state.** Neutral kernel + Harbor substrate; harness isolation; delivery-value profile (`harness-benchmark-program-research.md`).

**Delivered truth.** `packages/benchmark/` (BB-065 DONE). Harbor adapter, local calibration, Terminal-Bench 2.1 preflight. Living: `docs/living/system/benchmark/state.md`. No comparative harness result.

**Gap.** No comparative harness result yet. Downstream consumers BB-077/074/099/095 are unblocked by BB-065.

**Covered by.** BB-065, BB-077, BB-074, BB-081, BB-095, BB-099.

### Blackboard control plane

**Desired end state.** Two-lane OBJECTIVE → RESEARCH_SA → WORKER → DELIVERED_FEATURE with exact bindings, negative-case tests, objective supersession (`docs/blackboard/contracts.md`, `jev.md`).

**Delivered truth.** BB-056 two-lane Jev, BB-082 supersession, BB-090 negative-case bindings (`negativeCaseBindingsFromWorkId: BB-100`). Living: `docs/living/system/state.md` outer-Blackboard section.

**Gap.** No high-value uncovered control-plane gap. Remaining work is using the gate, not extending it.

**Covered by.** BB-056/082/090 DONE.

## Ranked uncovered gaps (dependency order)

| Rank | Gap | Value | Deps | Already tasked? | New id |
|---|---|---|---|---|---|
| 1 | G4 child-env allowlist | Stops host secrets reaching every agent CLI; unblocks safe G3 | BB-097 DONE | No | **BB-120** |
| 2 | G3 durable Board supervised Backend | Makes Codex/Kiro/agy/grok a product Board strategy, not a CLI demo | BB-100, BB-101, BB-120 | No (BB-100/104 explicitly deferred it) | **BB-121** |
| 3 | OpenCode adapter | Second real CLI on this host; BB-099 can compare two live tools once grok+opencode exist | BB-097, BB-098 DONE | No (BB-105 is grok only) | **BB-122** |
| 4 | G7 Kiro/agy usage | Cost axis of BB-099 stays Codex/grok/opencode-only without it | BB-098; live `kiro-cli` for schema | No | *deferred* |

Do not duplicate: BB-055, BB-066–076, BB-077–081, BB-083–086, BB-091–095, BB-099–105, BB-067 sandbox, BB-069 first slice.

## OpenCode evaluation (rank 3)

Installed at `~/.opencode/bin/opencode` 1.18.33, not on PATH (same pattern as grok). `opencode run --help`: `--format json`, `--dir`, `--model`, `--auto`, `--continue`, `--session`, positional `message`. `--prompt` is TUI-only. Missing binary ENOENT. Research performed **no model call**. Parser is fixture-driven from documented JSONL `step_finish` tokens/cost. Mirrors BB-105. Lets BB-099 (which already iterates `AGENT_TOOLS` keys) compare two real CLIs on this host.

## Registered tasks

| Id | One-line objective | Dependencies |
|---|---|---|
| BB-120 | Allowlist agent-tools child env so `process.env` secrets are not inherited | BB-097 (DONE) |
| BB-121 | Inject `createSupervisedBackendWorker` into durable Backend→QA | BB-100, BB-101, BB-120 |
| BB-122 | OpenCode first-class adapter (`opencode run --format json`) | BB-097, BB-098 (DONE) |

The roadmap took ids from BB-120 and the defect audit took BB-106..BB-108, so BB-109..BB-119 are unused. `allocation.nextWorkId` is `BB-123`.

## Delivered-task defect audit

Every WORKER task with status DONE was audited against its claims. Probes are under `docs/blackboard/evidence/BB-106..108/`.

| Lead | Result | Fix task |
|---|---|---|
| Facade throws `TypeError` when CONTEXT_GRAPH evidence has no snapshot authority (and on 1-byte budgets); the planner alone reports `CURRENTNESS_UNVERIFIABLE` | Confirmed | **BB-108**: typed `UNSATISFIED` reasons |
| Planner reserves one item and `min(8192, remaining)` bytes, so a file above 8 KiB is `BUDGET_EXHAUSTED` under any budget (inherited by opt-in Backend/QA adoption) | Confirmed | **BB-107**: reserve from the remaining budget |
| Planner `execute()` drops a provider error's extra `code` | Confirmed, mitigated: `detail` keeps the message and the application reader prefixes `error.code` | Not registered (low) |
| Delivered regression suites not in any standing script: objective supersession, facade accounting, context-graph boundary, Oracle contract/provider/durability/foundation suites | Confirmed (8 files) | **BB-106**: wire them into `npm test` / verify / kernel CI |
| `test/delivery` unwired | Refuted: the directory was retired | none |
| Weak Living Docs Jev for the integration-EF delivery (0.48) | Refuted as a product defect: the named APIs exist and match the docs | none |

Evaluator defect found while delivering: in bounded worker batches, negative-case questions received no bound evidence, so they always returned `INSUFFICIENT_EVIDENCE`. Fixed at the root in `NEGATIVE_CASE_EVIDENCE_V1` (`docs/blackboard/jev.md`).

## Prioritized RESEARCH_SA → WORKER queue

| Priority | Task | Why first | Depends on | Worker note |
|---|---|---|---|---|
| 1 | BB-106 test wiring | Cheap; protects every delivered Oracle and Blackboard guarantee from silent regression | BB-082, BB-087, BB-088 (DONE) | none |
| 2 | BB-108 facade typed failures | A raw throw breaks the facade's typed-failure contract | BB-087, BB-088 (DONE) | Shares `test/oracle-context-graph-boundary.test.mjs` with BB-107; serialize the two |
| 3 | BB-107 planner reservation | A user-visible budget hole on the opt-in Oracle path | BB-087, BB-088, BB-089 (DONE) | After BB-108 |
| 4 | BB-120 child-env allowlist | Host secrets currently reach every agent CLI | BB-097 (DONE) | After BB-105 lands (`process-runner.js`) |
| 5 | BB-122 OpenCode adapter | Second real CLI on this host, so BB-099 can compare two live tools | BB-097, BB-098 (DONE) | After BB-105 lands (same adapter files) |
| 6 | BB-121 durable Board supervised Backend | Makes supervised agents a product Board strategy | BB-100, BB-101, BB-120 | Last |
