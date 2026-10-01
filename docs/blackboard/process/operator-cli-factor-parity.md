# Operator CLI factor parity — BB-139 … BB-141

Status: RESEARCH_SA discovery registration. This brief registers new DRAFT research tasks. It does not implement product source, issue readiness, or reopen existing tasks.

Checked: 2026-10-01 against `4291a4a7900ea3c943a2533581c6abc210b1145f`.

Reproduce: `node docs/blackboard/evidence/BB-139/cli-factor-audit.mjs`.

## Why this wave exists

BB-135..137 register recovery, traces, MCP, and permission/model composition onto `run`/`deliver`. Remaining operator commands still omit options that delivered functions already accept:

- `commandDeliver` already reads `maxAttempts` / `timeoutMs`; `commandDeliverCli` never forwards `--max-attempts` or `--timeout-ms`.
- `DEFAULT_FACTORS` already includes `permissionProfile` and `timeoutMs`; `runAgentToolsEval` already accepts a `factors` overlay; `eval` CLI flags omit both.
- `commandSmoke` already calls `runSupervisedTask` and accepts `--timeout-ms`; it never forwards `model`, `permission`, or `trace-dir`.

A candidate is registered only when (a) current source shows a delivered public option the operator command omits, and (b) no existing task covers that seam.

| Candidate | Evidence | Existing coverage | Decision |
|---|---|---|---|
| Deliver CLI max-attempts / timeout-ms | Audit: `commandDeliverCli` never mentions those flags; `commandDeliver` already forwards them; `run` already exposes both | BB-104 owns the slice; BB-138 owns permission/model on deliver | Register BB-139 |
| Eval permission / timeout factors | Audit: `EVAL_FLAGS` omit permission and timeout-ms; `DEFAULT_FACTORS` and `runAgentToolsEval({ factors })` already exist | BB-099 owns the evaluation protocol, suite, arms, and claim boundary | Register BB-140 |
| Smoke model / permission / traces | Audit: `commandSmoke` calls `runSupervisedTask` without model, permission, or trace-dir; `run` already forwards all three | BB-097 owns smoke; BB-098 owns traces; BB-135..137 own run/deliver composition | Register BB-141 |
| Eval factor `K` / `--max-attempts` | `DEFAULT_FACTORS.K` exists; changing K interacts with `--max-invocations` budget and protocol hash | BB-140 may consume it as a researchGap; not a separate task | Not registered |
| Run recovery, deliver traces, MCP opt-in, deliver permission/model | Already registered | BB-135..137 | Not registered |
| Child/verifier env, grok cost, accounting, resume binding, retry, protected acceptance, tool whitelist, review bundle, durable Board, preview/browser/API | Already registered | BB-107, BB-120..133 | Not registered |
| Application `requiredFiles` grounding on `runSupervisedBackendWork` | BB-100 keeps context bytes out of the agent prompt by design | BB-102 / BB-100 delivered contract | Not registered |
| Durable Board factory recovery | Already owned | BB-121 | Not registered |
| Sandbox, OpenHands, SCM, first-slice, installable support | Broader product | BB-066..073 | Not registered |

## Delivery evaluation

All three compose **already-delivered** options onto existing operator commands. Write scope is agent-tools bin/eval call sites plus tests and Living operator/evaluation/state docs. Direct Worker dependencies are DONE. Independent fixtures can use the fake CLI. Explicit non-goals keep sandbox, SCM, live-value, and protocol redesign out.

Research still has to ratify exact flags, fail-closed cases, and negative bindings before READY. This registration does not claim those designs are finished.

## Per-task contracts

| Task | Useful output | Direct Worker dependencies |
|---|---|---|
| BB-139 | `exharness-agent deliver --max-attempts` / `--timeout-ms` override the Backend stage the same way `run` already does | BB-104 (DONE) |
| BB-140 | `exharness-agent eval --permission` / `--timeout-ms` pin `DEFAULT_FACTORS` without changing suite, arms, or claim boundary | BB-099 (DONE) |
| BB-141 | `exharness-agent smoke --model` / `--permission` / `--trace-dir` reach `runSupervisedTask` | BB-097, BB-098 (DONE) |

Research can run ahead. Worker waits for listed dependencies DONE and a SATISFIED readiness judgment. Existing READY/DONE bodies are unchanged. Application adapter composition is a later wave (BB-142..143) in [application-adapter-composition.md](application-adapter-composition.md). Next allocation after that wave: BB-145.
