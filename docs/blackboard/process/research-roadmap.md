# ExHarness research roadmap: delivery value and current truth

Checked: 2026-10-01 at `4291a4a7900ea3c943a2533581c6abc210b1145f`. Scheduling authority is `docs/blackboard/work-graph.json`; this is a value-priority view, not a second work graph.

DELIVERED_TRUTH is grounded in current source/Living and terminal receipts. PLANNED_CONTRACT means an existing plan; RESEARCH_DESIRED_STATE is an unaccepted improvement. Do not collapse these labels.

This revision encodes two operating tracks:

1. **Research-gated add-on features.** Research may promote a feature toward implementation only after it evaluates that the feature can be delivered.
2. **Delivered-surface review.** Review already-delivered capabilities and repair only issues that are already clear.

## Operating rules

### Track 1 — research add-on may become delivery work

Research records all of the following before the feature is treated as a delivery candidate:

1. Current source seam versus desired state, labelled DELIVERED_TRUTH / PLANNED_CONTRACT / RESEARCH_DESIRED_STATE.
2. Executed discriminating evidence of the gap (probe or prototype against current source).
3. A bounded write scope on an existing public seam or a small additive module.
4. Direct dependencies that are already DONE, or a named existing planned contract.
5. Independent acceptance a worker can run: positive case plus named negative cases.
6. Explicit non-goals so the feature cannot expand into sandbox, SCM, installable support, or release.

A survey, a desired-state sketch, an unrun prototype, or a popularity argument is not a delivery evaluation. Items that fail this evaluation stay research.

### Track 2 — delivered-surface change may start

A fix or optimization of delivered behavior may start only when research records:

1. A reproducible failure or waste case on current main.
2. The exact source seam, function, and current behavior.
3. The expected observable after the change.
4. An independent quality or retained-behavior constraint.

Optimizations additionally require a measured baseline, a predeclared target, and a KEEP_BASELINE / INCONCLUSIVE exit. If the problem, target, or measurement is unclear, do not fix and do not optimize.

## Current areas

| Area | Current truth | Remaining gap / existing owner | Canonical task snapshot |
|---|---|---|---|
| Core / benchmark | Neutral benchmark package, harness-isolation protocol, durable detached operations, and cache-stable async context are delivered. No live comparative harness result is claimed. | Async steering/recovery and held-out profile acceptance remain planned. | DONE: BB-065, BB-077, BB-078, BB-079; planned: BB-080, BB-081 |
| Oracle | Foundation, Context Graph, opt-in Backend/QA adoption, planner strategies, progressive resolution, budget profiles, and typed facade failure are delivered. | Planner reservation still rejects files that fit remaining budget. Core conformance / held-out acceptance remain planned. | DONE: BB-060, BB-061, BB-062, BB-063, BB-064, BB-087, BB-088, BB-089, BB-091, BB-092, BB-093, BB-108; planned: BB-094, BB-095, BB-107 |
| Application | Cross-domain authority, activation, exact deployment QA, closure, adversarial recovery, and causal observation are delivered. | HOW evolution remains the remaining Integration phase proof. | DONE: BB-052, BB-053, BB-054, BB-055, BB-057, BB-058; planned: BB-059 |
| Agent tools | Real worktree verification, supervision, traces, Backend adapter, durable recovery, Oracle files, MCP, Grok, OpenCode, and local `deliver` are delivered. Experiment tooling is delivered; live comparative value is unclaimed. | Child env, verifier env, grok-cost/gitignore, accounting, resume binding, durable Board injection, operator tool parity, protected acceptance, review bundle, operator CLI composition of already-delivered recovery/traces/MCP/run-options, remaining CLI factor parity (deliver limits, eval factors, smoke options), Application adapter composition of recovery/MCP, and deliver CLI tool override remain research. | DONE: BB-096, BB-097, BB-098, BB-099, BB-100, BB-101, BB-102, BB-103, BB-104, BB-105, BB-122; planned: BB-120, BB-121, BB-123, BB-124, BB-125, BB-126, BB-127, BB-128, BB-129, BB-130, BB-135, BB-136, BB-137, BB-138, BB-139, BB-140, BB-141, BB-142, BB-143, BB-144 |
| Local web capabilities | Named preview / browser / API profiles are absent from the local deliver manifest. | Prototypes are NOT_RUN; delivery evaluation is incomplete. | planned: BB-131, BB-132, BB-133 |
| Feedback | Existing correctness feedback, routing, and grounded observation binding are delivered primitives. | Feedback Lifecycle / Self-Improve additive plans remain Worker-blocked; no research reopening. | DONE: BB-084; planned: BB-083, BB-085, BB-086 |
| Broader delivery | Real local execution exists; the planned OpenHands/sandbox/SCM path is distinct. | No installed supported product or controlled end-to-end value claim yet. | DONE: none; planned: BB-066, BB-067, BB-068, BB-069, BB-070, BB-071, BB-072, BB-073, BB-074, BB-075, BB-076 |
| Outer Blackboard | Two lanes, objective supersession, negative binding, and standing test wiring are delivered. | No new generic control-plane expansion. | DONE: BB-056, BB-082, BB-090, BB-106 |

## Track 1 — research add-on delivery evaluation

[Delivery-value discovery](delivery-value-improvement-research.md) and [capability discovery](delivery-capability-discovery.md) remain the source briefs. This table is the delivery-feasibility judgment against current main. All listed plans are DRAFT; none is READY or delivered.

| Task | Kind | Delivery evaluation | Why | Direct Worker dependencies |
|---|---|---|---|---|
| BB-107 | Clear delivered defect | **Can deliver** after research READY | Executed planner probe: a 9000-byte EXACT file under a 40000-byte budget is `BUDGET_EXHAUSTED` from an 8192/1-item reservation. Exact `reserve()` seam, fail-closed oversize, and named tests exist. | BB-087, BB-088, BB-089 (DONE) |
| BB-120 | Clear delivered defect | **Can deliver** after research READY | Executed env probe: agent child inherits planted parent secrets. Allowlist + overlay design is bounded to `process-runner.js`. Not a sandbox. | BB-097 (DONE) |
| BB-121 | Add-on feature over delivered seams | **Can deliver** after BB-120 and research READY | Executed durable-board probe: Board Backend never calls agent-tools. Selected factory injects `createSupervisedBackendWorker` into existing `backendWorker.execute/recover`. Default CodeAct path stays unmodified. | BB-100, BB-101 (DONE), BB-120 |
| BB-123 | Clear delivered defect | **Can deliver** after research READY | Executed follow-up probe: null grok `total_cost_usd` becomes observed `$0`; grounded-context exclusion writes the source `info/exclude`. Observed-only cost guard and worktree-local `.gitignore` are bounded. | BB-105, BB-102 (DONE) |
| BB-124 | Clear delivered defect | **Can deliver** after BB-123 and research READY | Executed local-delivery audit: truncated Codex stream is marked complete; incomplete usage can look like a cheaper complete run. Preserve partial coverage; do not invent totals. | BB-098, BB-105 (DONE), BB-123 |
| BB-125 | Clear delivered defect | **Can deliver** after research READY | Executed probe: same-id resume with a new prompt and always-pass verifier accepts a broken candidate. Bind task/config digest before side effects. | BB-101 (DONE) |
| BB-127 | Add-on feature; confirmed local gap | **Can deliver** as a local slice after BB-130/125 and research READY | Executed probe: deleting a repository test assertion still PASSes Backend and fresh QA. External pinned evaluator plus protected manifest is selected. This does not prove live Product QA or first-slice value. | BB-104 (DONE), BB-130, BB-125 |
| BB-128 | Add-on feature; confirmed operator mismatch | **Can deliver** after research READY | Living operator contract still allows only `codex`/`kiro`/`agy` while Grok and OpenCode adapters are delivered. Capability-parity in `deliver` is a small existing-seam change. | BB-104, BB-122 (DONE) |
| BB-129 | Add-on feature; confirmed handoff gap | **Can deliver** after BB-127 and research READY | Accepted SHA has no named retention ref or exported bundle. Selected git bundle + patch + atomic manifest. GC data loss remains untested and is a researchGap, not a blocker for the export seam. | BB-127 |
| BB-130 | Clear delivered defect | **Can deliver** after BB-120 and research READY | Executed probe: local command verifier child inherits a planted parent-only variable. BB-120 covers the agent runner only. | BB-096 (DONE), BB-120 |
| BB-126 | Unclear optimization | **Do not deliver yet** | Three identical no-edit attempts show a retry mechanism, not that early stopping improves accepted quality. Missing measured baseline, predeclared target, and independent quality controls. Stays a research hypothesis. | BB-125 |
| BB-131 | Desired capability | **Do not deliver yet** | Manifest audit shows the named preview profile is absent. No browser/container/readiness prototype has run. Compare explicit commands versus Dev Container/Testcontainers before READY. | BB-104 (DONE), BB-130 |
| BB-132 | Desired capability | **Do not deliver yet** | Independent browser journeys are a hypothesis. Playwright is an eligible candidate, not an adoption verdict. Discriminating broken-journey fixtures have not run. | BB-054 (DONE), BB-131, BB-127 |
| BB-133 | Desired capability | **Do not deliver yet** | API/data compatibility is a hypothesis. Schema-derived probes and prior-client fixtures have not run. Split or stop if the prototype cannot stay bounded. | BB-054 (DONE), BB-131, BB-127 |
| BB-135 | Add-on over delivered recovery | **Can deliver** after research READY | Executed CLI audit: `commandRun` never passes `recoveryDir`; `runSupervisedTask` already accepts it; `deliver` already exposes `--recovery-dir`. | BB-101 (DONE) |
| BB-136 | Add-on over delivered traces | **Can deliver** after research READY | Executed CLI audit: `runDeliverSlice` / resume pass `invocationObserver: null` at three sites; `run --trace-dir` already writes digest-chained traces. | BB-098, BB-104 (DONE) |
| BB-137 | Add-on over delivered MCP | **Can deliver** after research READY | Executed CLI audit: operator bin never mentions MCP; supervisor `mcpVerify` and the verify/status server already exist. Default stays off; promote stays forbidden. | BB-103, BB-104 (DONE) |
| BB-138 | Add-on over delivered run options | **Can deliver** after research READY | Executed CLI audit: `validateDeliverSlice` / `runDeliverSlice` omit `permissionProfile` and `model`; `run` already forwards both. | BB-104 (DONE) |
| BB-139 | Add-on over delivered deliver limits | **Can deliver** after research READY | Executed CLI audit: `commandDeliver` already reads `maxAttempts`/`timeoutMs`; `commandDeliverCli` never forwards `--max-attempts` or `--timeout-ms`. | BB-104 (DONE) |
| BB-140 | Add-on over delivered eval factors | **Can deliver** after research READY | Executed CLI audit: `DEFAULT_FACTORS` and `runAgentToolsEval({ factors })` already exist; eval CLI omits `--permission` and `--timeout-ms`. | BB-099 (DONE) |
| BB-141 | Add-on over delivered smoke/run options | **Can deliver** after research READY | Executed CLI audit: `commandSmoke` already calls `runSupervisedTask`; it never forwards model, permission, or trace-dir. | BB-097, BB-098 (DONE) |
| BB-142 | Add-on over delivered adapter recovery | **Can deliver** after research READY | Executed adapter audit: `runSupervisedBackendWork` never mentions `recoveryDir`; `runSupervisedTask` already accepts it. Persist-only; recover stays BB-121. | BB-100, BB-101 (DONE) |
| BB-143 | Add-on over delivered adapter MCP | **Can deliver** after research READY | Executed adapter audit: adapter never mentions `mcpVerify`; supervisor already accepts it. Default stays off; promote stays forbidden. | BB-100, BB-103 (DONE) |
| BB-144 | Add-on over delivered deliver tool option | **Can deliver** after research READY | Executed adapter audit: `commandDeliver` already reads `options.tool`; `commandDeliverCli` never forwards `--tool`. | BB-104 (DONE) |

The operator CLI composition wave is registered in [operator-cli-composition.md](operator-cli-composition.md). Reproduce with `node docs/blackboard/evidence/BB-135/cli-composition-audit.mjs`. Remaining command factor parity is in [operator-cli-factor-parity.md](operator-cli-factor-parity.md). Reproduce with `node docs/blackboard/evidence/BB-139/cli-factor-audit.mjs`. Application adapter composition and remaining deliver `--tool` are in [application-adapter-composition.md](application-adapter-composition.md). Reproduce with `node docs/blackboard/evidence/BB-142/adapter-composition-audit.mjs`. Research still ratifies exact flags, fail-closed cases, and negative bindings before READY.

Research can run ahead of unfinished Worker dependencies. Worker execution still waits for those dependencies DONE and for a SATISFIED readiness judgment.

## Track 2 — delivered-surface review

Only the rows below are clear enough to repair. No additional delivered-surface optimization is opened from this revision.

| Delivered surface | Clear issue | Owner | Action |
|---|---|---|---|
| Oracle planner `reserve()` | 8192-byte and 1-item cap rejects files that fit remaining requirement budget | BB-107 | Repair after READY |
| Agent-tools child spawn | `process.env` inherit-all leaks planted parent secrets into the agent CLI | BB-120 | Repair after READY |
| Grok cost parser + grounded context | Null cost coerced to `$0`; `.exharness/` exclusion writes source `info/exclude` | BB-123 | Repair after READY |
| Observation accounting | Partial/truncated usage reported as complete; incomplete fields can become zero | BB-124 | Repair after BB-123 |
| Supervised resume | Same-id resume ignores prompt/verifier contract drift | BB-125 | Repair after READY |
| Local command verifier spawn | Verifier child inherits parent-only credentials | BB-130 | Repair after BB-120 |
| Operator `deliver` tool set | Delivered Grok and OpenCode adapters cannot be selected | BB-128 | Add-on after READY |
| Durable Board Backend | Delivered supervised adapter is not injectable on the durable workflow | BB-121 | Add-on after BB-120 |

Do not start work from these unclear items:

| Topic | Why it stays deferred |
|---|---|
| BB-126 no-progress retry default | Observed waste without quality/target/coverage controls |
| BB-131/132/133 preview, browser, API profiles | Named gap is real; delivery design is unproven |
| Live comparative value from BB-099 tooling | Tooling is delivered; no live evaluation has run |
| Planner/Core/Jev “make it faster” | No current measured baseline or target |
| Treating local fixture success as BB-069/074 value | Different owners, different evidence |

## Delivery queue by useful outcome

1. **Repair delivered truth:** close research for BB-107, BB-120, BB-123, then BB-125, BB-130, BB-124. These are bounded defects with executed probes.
2. **Ship deliverable add-ons on existing seams:** BB-128 operator tool parity (dependencies DONE); BB-121 durable Board injection after BB-120.
3. **Compose already-delivered supervisor APIs onto the operator CLI:** BB-135 run recovery, BB-136 deliver traces, BB-137 MCP opt-in, BB-138 deliver permission/model. Then remaining command factor parity: BB-139 deliver limits, BB-140 eval factors, BB-141 smoke options. Then Application adapter composition: BB-142 execute persist, BB-143 adapter MCP, and remaining deliver `--tool` BB-144. Direct Worker dependencies are DONE; research can start immediately.
4. **Make a local change another developer can trust:** BB-127 protected local acceptance after BB-130/125, then BB-129 review/replay handoff.
5. **Keep unproven capabilities in research:** BB-131 then BB-132/133 only after a discriminating prototype evaluates that a bounded profile can be delivered. Do not implement them from the survey.
6. **Defer unclear optimization:** BB-126 stays research until baseline, target, and independent quality controls are ratified.
7. **Continue the accepted Worker program** without reopening it: BB-059 HOW evolution; BB-080 async steering/recovery (WORKER_SCHEDULABLE after BB-079); BB-085 feedback episode lifecycle (WORKER_SCHEDULABLE after BB-084); then the existing blocked chains BB-066..076, BB-081, BB-083/086, BB-094/095. Release and end-to-end value remain BB-074/076 obligations.

These priorities are not dependency edges. Serialize/rebase overlapping supervisor/recovery/deliver-slice/adapter writes without inventing semantic dependencies. Next allocation is BB-145.

## Existing work to reuse, not duplicate

- BB-106 standing test wiring and BB-108 typed facade boundaries are already DONE.
- BB-067 sandbox, time/token/cost ceilings and cancellation; BB-068 SCM/CI; BB-072 operations; BB-073 installable support. Local add-ons do not claim these capabilities.
- BB-099 owns supervised/direct/DIRECT_RETRY study; BB-074 owns end-to-end value, reviewer/human effort and lifecycle; BB-075/086 own evaluated HOW improvement and promotion.
- BB-083/084/085/086 preserve Observed Implementation -> Feedback Lifecycle -> Self-Improve separation. Single-run retry efficiency is not cross-episode learning.
- Goal/document clarification, live feature feasibility, requirement evolution, supported installation and measured human effort remain with BB-070/069/071/073/074.

## Evidence and research exit

The [source ledger](../evidence/BB-130/research-sources.json) pins primary docs and a 1,000-star-eligible Codex source example. External practices justify discriminating experiments, not an ExHarness productivity claim. Local probes establish reproducible gaps; live provider quality, saved cost and release behavior remain unmeasured.

Research must finish the exact API/compatibility/threat/measurement gaps, objective coverage/source anchors and named subject-invoking negative bindings before fresh Jev. DRAFT tests are proposed implementation outputs, not files claimed to exist now. Keep paid/model experiments optional and budgeted, preserve failed/inconclusive findings, and report accepted quality, observed accounting coverage, elapsed time, reviewer steps and repeated-run reliability separately.
