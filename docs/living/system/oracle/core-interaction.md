# Oracle ↔ Core interaction

How Oracle requirement blocks resolve through the Core agent runtime on each
supported Core profile, the async rule, and the frozen
`ORACLE_CORE_INTERACTION_V1` protocol. The interaction experiment itself runs
as follow-up work; this document records the conformance rules and the
evaluated / `NOT_EVALUATED` cell matrix.

## Profile cells

| Core profile          | Oracle arm   | Status         | Basis                                                      |
|-----------------------|--------------|----------------|------------------------------------------------------------|
| `CORE_SYNC`           | O1 foundation| EVALUATED      | Conformance suite `test/oracle-core-profile-conformance.test.mjs` |
| `CORE_SYNC`           | O2 candidate | EVALUATED      | Conformance suite                                          |
| `CORE_ASYNC_FIRST_V1` | O1 foundation| NOT_EVALUATED  | No recorded `PROMOTE_ASYNC` decision (async rule)          |
| `CORE_ASYNC_FIRST_V1` | O2 candidate | NOT_EVALUATED  | No recorded `PROMOTE_ASYNC` decision (async rule)          |

Async rule: `CORE_ASYNC_FIRST_V1` cells execute only when the upstream async
decision work is DONE with a recorded `PROMOTE_ASYNC` decision.
`KEEP_SYNC_BASELINE` / `INCONCLUSIVE` / no recorded decision leaves async
`NOT_EVALUATED` — never silently skipped, never executed on assumption. The
profile manifest in the conformance suite reads the Blackboard work graph and
the async decision artifacts to resolve this; today the async work is DONE
but no `PROMOTE_ASYNC` decision is recorded, so the live design is 1x2.

## Once-per-call rule

On every supported Core profile, Oracle requirement blocks resolve exactly
once per agent call through the injected `contextResolver`
(`createOracleContextResolver` over fixture catalog providers):

- A `COMPLETE` resolution renders once per call; a second sequential call
  invokes the resolver again (no cross-call reuse).
- `UNSATISFIED` fails pre-render: the Core projection throws before render,
  so the strategy, the fake model and capabilities see zero calls.
- `STALE_DURING_RESOLUTION` (source drift between pre/post observations)
  fails pre-render the same way.

## Resume rule

A resumed or woken runtime never reuses a projected context block from a
prior call unless it is backed by a `CURRENT` receipt:

- Per-call projected blocks are runtime-local; `createRuntimeSnapshot`
  carries the configuration manifest plus redacted agent events, never
  projected blocks. A runtime restored from a snapshot invokes the resolver
  again on its next call and renders the fresh resolution.
- With durable resolution, a `CURRENT` receipt may be `REUSED` (Oracle reuses
  the durable receipt underneath Core's once-per-call resolution); a changed
  source publishes a new resolution — the stale receipt is never served.

If Core ever rendered a prior projected block without re-resolution, that is
a Core contradiction (`PLAN_INPUT_CONTRADICTION`); Core is not patched to
satisfy the suite.

## Frozen protocol: ORACLE_CORE_INTERACTION_V1

Defined by `scripts/oracle-context-intelligence/core-interaction-protocol.mjs`
(`--mode validate` checks structure and prints the resolved design):

- **Fixed factors** (copied verbatim from `ORACLE_CONTEXT_BENCHMARK_V1`):
  model snapshot and provider route; task + task digest; prompt/instruction;
  initial workspace/source snapshot; Core execution profile; capability/tool
  surface; model/runtime/resource ceilings; artifact extraction; independent
  evaluator; repeat/sample schedule; pricing/accounting semantics.
- **Oracle arms**: O1 foundation (deterministic foundation), O2 candidate
  (candidate under test).
- **Core arms**: `CORE_SYNC`, `CORE_ASYNC_FIRST_V1` (when published).
- **Design**: 2x2 when async is published, otherwise 1x2 with async
  `NOT_EVALUATED`.
- **Prohibitions**: no live model or paid execution in validate mode; the
  protocol defines arms and factors but runs no experiment; no assumed async
  promotion; no Core or Oracle source change.

## Verification

- `node --test test/oracle-core-profile-conformance.test.mjs`
- `node --test test/oracle-core-interaction-protocol.test.mjs`
- `npm run test:core` — Core regression
- `npm run verify` — repository verification
