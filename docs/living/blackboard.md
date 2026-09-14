# Blackboard

Status: **ACTIVE COORDINATION SURFACE**

The Blackboard is the first read/write surface for every non-trivial ExHarness work session.

It is not a future runtime component and it is not optional bookkeeping. It is the shared external work state that lets one session constrain what later sessions are allowed to pick up.

## Core rule

```text
READ BOARD
  -> choose only unresolved eligible work
  -> CLAIM before doing it
  -> perform work
  -> WRITE BACK result / evidence / discoveries / blockers
  -> mark DONE, BLOCKED or return to READY
```

A session must not silently do work that is absent from the Blackboard when that work changes shared project state.

## Board semantics

Think of the board literally.

```text
Question A   READY
Question B   READY
Question C   READY
```

Session 1 claims and resolves Question A:

```text
Question A   DONE      result/evidence refs: ...
Question B   READY
Question C   READY
```

Session 2 now has only B or C as eligible choices. It must not independently redo A unless A is explicitly reopened because new evidence invalidated the prior result.

The important property is not the file format. The important property is **shared visible state narrows the next agent's action space**.

## Work-item shape

Use the smallest structure that preserves coordination:

```text
id: BB-XXX
question/work: <what must be resolved or produced>
status: READY | CLAIMED | BLOCKED | DONE | REOPENED | SUPERSEDED
owner: <session/agent identity when claimed, otherwise empty>
depends-on: []
result: <short outcome when resolved>
artifact-refs: []
evidence-refs: []
blockers: []
open-followups: []
```

Do not add leases, queues, event buses, role registries or workflow-engine semantics until real contention proves they are necessary.

## Claim contract

Only `READY` or `REOPENED` work whose dependencies are satisfied is eligible.

Before execution:

```text
READY -> CLAIMED
owner = current session/agent
```

After execution:

```text
CLAIMED -> DONE       when the board question/work is actually resolved
CLAIMED -> BLOCKED    when external dependency/evidence is missing
CLAIMED -> READY      when abandoned without resolution
DONE    -> REOPENED   only when explicit new evidence invalidates/reopens it
```

A later session reads the board and must respect these transitions. `DONE` work is not eligible by default.

## What every session writes back

At minimum, when shared work was attempted:

- status transition;
- concise result or blocker;
- artifact references produced/changed;
- evidence references that matter;
- discoveries that create new board questions;
- follow-up work items when the result exposes unresolved work.

Do not use the Blackboard as a prose diary. It records operational state needed by the next worker.

## Relationship to living knowledge

The Blackboard and promoted living knowledge are both under `docs/living/`, but they have different semantics:

```text
blackboard.md
    = active operational coordination
    = cheap/current/mutable

knowledge/*
    = durable evidence/judgment/audit

architecture.md / pipelines.md / contracts.md / decisions/*
    = promoted accepted knowledge
```

A Blackboard result can feed the knowledge lifecycle:

```text
work result / discovery
  -> evidence
  -> judgment
  -> audit/challenge when needed
  -> decision
  -> promoted architecture/pipeline/contract
```

But finishing a board item does not automatically promote its design conclusion.

## Current board

The repository checkpoint has Waves A, B and C complete in source/tests. Wave D is next.

```text
BB-001
question/work: Prove concrete Backend vertical slice (Wave A)
status: DONE
result: delivered

BB-002
question/work: Ground Backend completion/evidence and bounded Advisor boundary (Wave B)
status: DONE
result: delivered

BB-003
question/work: Add second real role and ref-only Backend -> QA artifact handoff (Wave C)
status: DONE
result: delivered by PR #67

BB-004
question/work: Pressure-test and define minimal durable application workflow state through real persistence/resilience/recovery behavior (Wave D / S9)
status: READY
owner:
depends-on: [BB-003]
artifact-refs: []
evidence-refs: []
blockers: []
open-followups: []

BB-005
question/work: Run production evaluation across the concrete Backend + QA system and promote only evidence-supported generalizations (Wave D / S10)
status: BLOCKED
owner:
depends-on: [BB-004]
artifact-refs: []
evidence-refs: []
blockers: [BB-004 must produce the durable/recovery behavior to evaluate]
open-followups: []
```

Any new non-trivial work discovered while doing BB-004/BB-005 must be added to this board before another session can pick it up.

## Storage note

Today the canonical Blackboard is this living document because it gives sessions a shared durable surface immediately.

The storage/transport mechanism may later change if concurrency or write frequency proves Git-backed coordination insufficient. Such a migration must preserve the Blackboard semantics above; it does not justify ignoring the board until then.
