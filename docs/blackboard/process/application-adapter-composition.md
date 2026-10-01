# Application adapter composition — BB-141 … BB-143

Status: RESEARCH_SA discovery registration. This brief registers new DRAFT research tasks. It does not implement product source, issue readiness, or reopen existing tasks.

Checked: 2026-10-01 against `4291a4a7900ea3c943a2533581c6abc210b1145f`.

Reproduce: `node docs/blackboard/evidence/BB-141/adapter-composition-audit.mjs`.

## Why this wave exists

Operator CLI composition (BB-134..140) wires delivered supervisor options onto `run`/`deliver`/`eval`/`smoke`. The Application adapter and one remaining deliver CLI hop still omit options the supervisor and slice API already accept:

- `runSupervisedTask` already accepts `recoveryDir` and `mcpVerify`.
- `runSupervisedBackendWork` already calls `runSupervisedTask` and already forwards model, attempts, timeout, permission, traces, and observer.
- The adapter never forwards `recoveryDir` or `mcpVerify`.
- `commandDeliver` already reads `options.tool`; `commandDeliverCli` never forwards `--tool`.

A candidate is registered only when (a) current source shows a delivered public option the Application or CLI path omits, and (b) no existing task covers that seam.

| Candidate | Evidence | Existing coverage | Decision |
|---|---|---|---|
| Adapter execute persist via `recoveryDir` | Audit: `runSupervisedBackendWork` never mentions `recoveryDir`; supervisor already accepts it | BB-101 owns the recovery API; BB-121 owns the durable Board *factory* recover/`resumeSupervisedTask`; BB-134 owns operator `run --recovery-dir` | Register BB-141 |
| Adapter opt-in `mcpVerify` | Audit: adapter never mentions `mcpVerify`; supervisor already accepts it | BB-103 owns the stdio server; BB-136 owns operator CLI opt-in; promote stays forbidden | Register BB-142 |
| Deliver CLI `--tool` override | Audit: `commandDeliver` reads `options.tool`; `commandDeliverCli` never forwards it; USAGE has no `--tool` on deliver | BB-104 owns the slice; BB-128 owns expanding the tool whitelist | Register BB-143 |
| Adapter `requiredFiles` / Oracle grounding | BB-100 keeps context bytes out of the agent prompt by design | BB-102 / BB-100 delivered contract | Not registered |
| Durable Board factory recover | Already owned | BB-121 | Not registered |
| Operator run recovery, deliver traces, MCP CLI, permission/model, limits, eval factors, smoke options | Already registered | BB-134..140 | Not registered |
| Child/verifier env, grok cost, accounting, resume binding, retry, protected acceptance, tool whitelist, review bundle, preview/browser/API | Already registered | BB-107, BB-120..133 | Not registered |
| Eval factor `K` / `--max-attempts` | Interacts with `--max-invocations` and protocol hash | BB-139 researchGap | Not registered |
| Run `--max-feedback-chars` | Supervisor already accepts `maxFeedbackChars`; CLI never forwards it | Later remaining CLI factor; not this adapter wave | Not registered |
| Sandbox, OpenHands, SCM, first-slice, installable support | Broader product | BB-066..073 | Not registered |

## Delivery evaluation

All three compose **already-delivered** public options onto existing Application/CLI seams. Write scopes are `supervised-backend.js` plus tests and Application living docs for BB-141/142, and the operator bin plus tests and operator living docs for BB-143. Direct Worker dependencies are DONE. Independent fixtures can use the fake CLI. Explicit non-goals keep sandbox, SCM, promote, durable-Board factory recover, and live value out.

Research still has to ratify exact option names, fail-closed cases, and negative bindings before READY. This registration does not claim those designs are finished.

## Per-task contracts

| Task | Useful output | Direct Worker dependencies |
|---|---|---|
| BB-141 | `runSupervisedBackendWork({ recoveryDir })` persists the delivered recovery handle on Application execute; omitted `recoveryDir` still disposes | BB-100, BB-101 (DONE) |
| BB-142 | `runSupervisedBackendWork({ mcpVerify })` starts the delivered verify/status server when opted in; default remains off; no promote tool | BB-100, BB-103 (DONE) |
| BB-143 | `exharness-agent deliver --tool` overrides the manifest tool the same way `--recovery-dir` already overrides; omitted `--tool` keeps the manifest | BB-104 (DONE) |

Research can run ahead. Worker waits for listed dependencies DONE and a SATISFIED readiness judgment. Existing READY/DONE bodies are unchanged. BB-121 recover/`resumeSupervisedTask` stays the durable Board factory owner. Serialize overlapping writes to `supervised-backend.js` and `exharness-agent.mjs` without inventing semantic dependencies. Next allocation: BB-144.
