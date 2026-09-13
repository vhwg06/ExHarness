# Effect reconciliation

This slice adds explicit recovery semantics for capability side effects without turning model context, traces, or semantic memory into recovery authority.

## Boundary

```text
AgentEvent
= canonical model-working journal

TurnEvent
= runtime turn lifecycle journal

TraceSpan
= causal execution telemetry

EffectJournal
= durable operation/effect recovery authority
```

The kernel therefore treats these as distinct concerns:

```text
Trace != recovery authority
AgentEvent != effect journal
Semantic memory != effect journal
Evaluation != reconciliation
```

## Why this exists

A process may fail after an external effect is applied but before the runtime records a successful capability result.

```text
INTENT
  ↓
DISPATCH
  ↓
external effect succeeds
  ↓
process / transport fails
  ↓
local outcome is ambiguous
```

Replaying model history or inspecting traces cannot prove whether the external effect happened. Recovery must instead use explicit operation identity and declared side-effect semantics.

## Capability effect contract

Effect-aware capabilities declare:

- a stable `operationKey()`;
- a `replayPolicy`;
- optional desired-effect state;
- an observer when actual state can be inspected.

Supported replay policies:

```text
PURE
  safe to replay after explicit reconciliation

IDEMPOTENT
  retry is safe with the same operation identity

OBSERVABLE
  inspect actual state before deciding whether to retry

NON_RECONCILABLE
  fail closed and escalate; the kernel must not guess
```

The current implementation exposes this contract through `defineEffectCapability()` and an injectable effect journal. The bundled in-memory journal is a reference/testing implementation, not a claim of crash durability.

## Operation state

```text
INTENDED
   ↓
DISPATCHED
   ↓
   ├── CONFIRMED
   └── UNKNOWN
```

`UNKNOWN` is intentionally different from `FAILED`.

An exception after dispatch only proves that the runtime did not receive a confirmed result. It does not prove that the external side effect failed.

A repeated invocation of an `UNKNOWN` or still-`DISPATCHED` operation fails closed with `EFFECT_RECOVERY_REQUIRED`. It cannot silently re-execute the capability.

## Recovery hierarchy

The recovery path is deliberately deterministic-first:

```text
confirmed result
    ↓
CONTINUE

PURE / IDEMPOTENT ambiguous operation
    ↓
explicit reconcile
    ↓
prepare same operation identity for RETRY

OBSERVABLE ambiguous operation
    ↓
probe actual state
    ├── desired effect satisfied → CONFIRMED / CONTINUE
    └── desired effect absent    → RETRY

NON_RECONCILABLE
    ↓
ESCALATE
```

Model judgment is not part of this slice. If a later stage adds semantic escalation, it must only receive a bounded projection after deterministic recovery has failed. Raw effect history, traces, or the whole AgentEvent journal must not be injected merely because recovery occurred.

## WAL semantics

This is intentionally not Kafka-style exactly-once processing.

The journal records what ExHarness knows about the operation boundary. External systems remain separate authority domains. Exactly-once behavior requires cooperation from those systems through idempotency keys, observable desired/actual state, version checks, transactions, or equivalent domain semantics.

The effect journal therefore provides recovery evidence, not a claim that an external effect executed exactly once.

## In-memory journal limitation

`createInMemoryEffectJournal()` exists to prove the contract and support deterministic tests. Production consumers must inject a journal whose writes are durable before dispatch if they rely on crash recovery.

A production journal must preserve at least:

- stable operation identity;
- status transition order;
- replay policy;
- desired effect when declared;
- original capability input required for reconciliation;
- confirmed result/evidence when available.

## Current non-goals

This slice does not add:

- a general workflow engine;
- automatic semantic/model reconciliation;
- a persisted reconciliation-context artifact;
- distributed transactions across capability targets;
- automatic compensation;
- exactly-once claims;
- replacement of AgentEvent, TurnEvent, TraceSpan, Observation, Memory, or Evaluation planes.

Those require separate evidence and benchmarks before entering the kernel.
