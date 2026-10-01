# Operator CLI composition — BB-135 … BB-138

Status: RESEARCH_SA discovery registration. This brief registers new DRAFT research tasks. It does not implement product source, issue readiness, or reopen existing tasks.

Checked: 2026-10-01 against `4291a4a7900ea3c943a2533581c6abc210b1145f`.

Reproduce: `node docs/blackboard/evidence/BB-135/cli-composition-audit.mjs`.

## Why this wave exists

Delivered supervisor APIs already support durable recovery, observation traces, opt-in MCP verification queries, and permission/model on `runSupervisedTask`. The operator CLI only exposes a subset:

- `exharness-agent run` never passes `recoveryDir` or `mcpVerify`.
- `exharness-agent deliver` hardcodes `invocationObserver: null` and never forwards `permissionProfile` or `model`.

A candidate is registered only when (a) current source shows a delivered public seam that the operator command omits, and (b) no existing task covers that seam.

| Candidate | Evidence | Existing coverage | Decision |
|---|---|---|---|
| Durable recovery on `run` | Audit: `commandRun` never mentions `recoveryDir`; `runSupervisedTask` already accepts it; `deliver` already exposes `--recovery-dir` | BB-101 owns the recovery API; BB-104 owns deliver resume; BB-125 owns resume *contract* drift | Register BB-135 |
| Observation traces on `deliver` | Audit: `runDeliverSlice` / resume path pass `invocationObserver: null`; `run --trace-dir` already writes traces | BB-098 owns traces; BB-104 owns deliver; BB-129 owns portable review bundle | Register BB-136 |
| Opt-in MCP on operator CLI | Audit: bin USAGE has no MCP flag; supervisor `mcpVerify` exists; deliver never forwards it | BB-103 owns the stdio server (verify/status only); promote stays forbidden | Register BB-137 |
| Permission/model on deliver | Audit: `validateDeliverSlice` and `runDeliverSlice` omit `permissionProfile`/`model`; `run` already accepts both | BB-104 owns the slice; BB-128 owns tool-id parity, not run-option parity | Register BB-138 |
| Child/verifier env, grok cost, accounting, resume binding, retry, protected acceptance, tool whitelist, review bundle, durable Board, preview/browser/API | Already registered | BB-107, BB-120..133 | Not registered |
| Sandbox, OpenHands, SCM, first-slice, installable support | Broader product | BB-066..073 | Not registered |
| MCP promote / acceptance tools | Living MCP: query-only | Intentional non-goal | Not registered |

## Delivery evaluation

All four compose **already-delivered** public functions onto the existing operator CLI. Write scope is agent-tools bin/slice/supervisor call sites plus tests and Living operator/observation/mcp docs. Direct Worker dependencies are DONE. Independent fixtures can use the fake CLI. Explicit non-goals keep sandbox, SCM, promote, and live value out.

Research still has to ratify exact flags, manifest fields, fail-closed cases, and negative bindings before READY. This registration does not claim those designs are finished.

## Per-task contracts

| Task | Useful output | Direct Worker dependencies |
|---|---|---|
| BB-135 | `exharness-agent run --recovery-dir` persists and resumes the same supervised attempt | BB-101 (DONE) |
| BB-136 | `exharness-agent deliver --trace-dir` writes digest-chained traces; `report` can read them | BB-098, BB-104 (DONE) |
| BB-137 | Opt-in MCP verify/status on `run` and `deliver`; default remains off; no promote tool | BB-103, BB-104 (DONE) |
| BB-138 | Deliver manifest/CLI accept the same permission and model options as `run` | BB-104 (DONE) |

Research can run ahead. Worker waits for listed dependencies DONE and a SATISFIED readiness judgment. Existing READY/DONE bodies are unchanged. Remaining command factor parity is a later wave (BB-139..140) in [operator-cli-factor-parity.md](operator-cli-factor-parity.md). Application adapter composition is BB-142..143 in [application-adapter-composition.md](application-adapter-composition.md). Next allocation after that wave: BB-145.
