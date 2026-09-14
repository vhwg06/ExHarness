# Blackboard

Status: **ACTIVE COORDINATION SURFACE**

The Blackboard is the canonical home for every unresolved gap, problem, question, blocker and next piece of non-trivial shared work.

Living system documents must describe current source-backed reality only. If a document discovers something that is not true yet, that item belongs here before another session can work on it.

## Session protocol

```text
READ BOARD
  -> choose only eligible unresolved work
  -> CLAIM
  -> execute / investigate
  -> WRITE BACK result, artifacts, evidence, discoveries
  -> DONE | BLOCKED | READY
  -> reconcile living docs to source when source changed
```

A later session must not redo `DONE` work unless new evidence explicitly reopens it.

## Work-item shape

```text
id: BB-XXX
question/work: <gap/problem/work to resolve>
status: READY | CLAIMED | BLOCKED | DONE | REOPENED | SUPERSEDED
owner: <session/agent when claimed>
depends-on: []
result: <outcome when resolved>
artifact-refs: []
evidence-refs: []
blockers: []
open-followups: []
```

The Board is operational state, not a diary and not an architecture document.

## Migration rule

When reconciling an old/current document:

```text
statement
  -> true in source now?               -> living document
  -> unresolved real gap/problem?      -> Blackboard
  -> deliberately absent / no pressure -> living non-goal/constraint, not fake work
  -> stale/resolved?                   -> remove or rewrite as current fact
```

No `gaps.md`, `TODO`, `next`, `remaining`, candidate future API or unresolved design question may live in the source-synchronized `docs/worktree/` projection.

# Current board

## Delivered history

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
```

## Agentic Application

```text
BB-004
question/work: Pressure-test and implement the minimal durable application workflow state for Backend accepted -> QA pending/running/completed, including restart/recovery behavior.
status: READY
owner:
depends-on: [BB-003]
artifact-refs: []
evidence-refs: []
blockers: []
open-followups:
  - determine which objective/result/artifact/acceptance-decision refs survive restart
  - define retry semantics when QA reports issues after accepted Backend work
  - define block/cancel/resume semantics across Backend -> QA
  - compose application state with ExHarness interrupted-variation/effect recovery without duplicating Core authority
  - define artifact lookup failure/retry behavior at the application boundary
```

```text
BB-005
question/work: Production-evaluate the concrete Backend -> QA system and generalize only evidence-supported repeated semantics.
status: BLOCKED
owner:
depends-on: [BB-004]
artifact-refs: []
evidence-refs: []
blockers:
  - BB-004 must produce real durable/recovery behavior to evaluate
open-followups:
  - task success across Backend -> QA
  - false-completion rate at both role boundaries
  - artifact handoff correctness
  - context precision/cost for repository vs internal artifacts
  - QA issue/remediation rate
  - Advisor invocation/value-add
  - recovery correctness
  - re-test whether generic Worker/WorkOrder/context/orchestration abstractions are justified
```

## ExHarness Core

Migrated from the former Core `gaps.md`; delivered facts remain in Core living docs.

```text
BB-006
question/work: Close the built-in external-effect/persistence crash window so candidate/trace/variation state can never be mistaken for proof that an externally visible action completed.
status: READY
owner:
depends-on: []
artifact-refs: []
evidence-refs: []
blockers: []
open-followups:
  - decide how built-in avo.act crosses the effect-aware action-intent boundary
  - ensure core.act persistence ordering does not infer completion from pre-persistence runtime state
  - preserve separation between effect state, evaluation, semantic memory and application completion
```

```text
BB-007
question/work: Compose deterministic restore -> pending-effect reconciliation -> evidence restoration -> explicit resume for a concrete recovery consumer.
status: BLOCKED
owner:
depends-on: [BB-004, BB-006]
artifact-refs: []
evidence-refs: []
blockers:
  - requires real application recovery pressure from BB-004
  - external-effect boundary from BB-006 must be trustworthy
open-followups:
  - order interrupted-variation recovery, AgentRuntime snapshot/restore and effect reconciliation
  - keep safe replay/observation machine-first
  - fail closed or escalate NON_RECONCILABLE ambiguity
```

```text
BB-008
question/work: Determine whether a higher-level executable Core lifecycle surface is justified after recovery composition is concrete.
status: BLOCKED
owner:
depends-on: [BB-007]
artifact-refs: []
evidence-refs: []
blockers:
  - do not invent a lifecycle facade before BB-007 demonstrates required sequencing
open-followups:
  - if justified, compose existing deliberation/action/effect/observe/verify/evaluate/cognition/promotion boundaries without absorbing Agentic Application orchestration
```

## Oracle

Migrated from the former Oracle `gaps.md` after source reconciliation.

Resolved during Waves A/C and therefore **not open work**:

- first concrete Backend context slice exists;
- internal application-artifact context slice exists for QA;
- stable `sourceRef` is carried by resolved Backend/QA context;
- internal artifact provenance carries `APPLICATION_ARTIFACT`, producer work-order id and acceptance-decision provenance;
- failures already identify the concrete repository vs application-artifact source boundary.

Current unresolved questions:

```text
BB-009
question/work: Determine whether Oracle needs a common resolver contract beyond the two current concrete functions/adapters.
status: BLOCKED
owner:
depends-on: []
artifact-refs: []
evidence-refs: []
blockers:
  - two current source classes still have materially different lifecycle/provenance semantics
  - no repeated pressure yet justifies Resolver<I,O>, registry or provider lifecycle
open-followups:
  - reopen when a third real source or repeated adapter boilerplate demonstrates a common contract
```

```text
BB-010
question/work: Determine whether callers need structured Oracle resolution diagnostics beyond the current boundary-specific errors.
status: BLOCKED
owner:
depends-on: []
artifact-refs: []
evidence-refs: []
blockers:
  - current Backend/QA callers do not yet demonstrate a machine-readable diagnostic requirement
open-followups:
  - if pressure appears, distinguish source unavailable/auth/not-found/adaptation/schema/optional absence without fabricating required context
```

Caching/freshness, MCP-first integration and semantic retrieval are not Board gaps merely because they are absent. They become Board work only when a concrete source demonstrates latency/cost/freshness or discovery pressure.

## Storage

Today this file is the canonical Board. Storage/transport can change later, but any replacement must preserve the read -> claim -> work -> write-back semantics and the reduced action space seen by later sessions.
