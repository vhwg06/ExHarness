# Blackboard

Status: **ORACLE_DETAIL COORDINATION SURFACE**

The Blackboard is the canonical home for every unresolved gap, problem, question, blocker and next piece of non-trivial shared work.

It is shared operational state. It is **not** an actor and it is **not** correctness authority. Agentic Application orchestration owns Board lifecycle transitions.

Living system documents describe current source-backed reality only. If a document discovers something that is not true yet, that item belongs here before another session can work on it.

## Durable project intent root

```text
id: INTENT-exharness-agentic-system
source: USER
objective: Build ExHarness as an agentic system whose project lifecycle can survive and hand off across arbitrary sessions through the Blackboard plus referenced artifacts.
bullets:
  - user defines ideas/objectives/constraints; PM manages rather than invents intent
  - Blackboard remains the canonical work-lifecycle tracker
  - Orchestrator owns lifecycle/dispatch/reconciliation authority
  - specialized work/review remains bounded by concrete context and authority
  - any fresh session must be able to resume from Blackboard + referenced artifacts
constraints:
  - project-critical continuation state must not live only in prior conversation/model context
  - artifacts hold work products; Blackboard stores lifecycle state and refs
  - concrete semantics before generic role/workflow abstractions
```

This root is durable project input, not a generated PM objective and not a correctness claim.

## Session protocol

```text
FRESH SESSION
  -> read durable project intent + Board
  -> recover eligible/pending/blocked/review/reconciliation state
  -> recover current partial-work checkpoint when present
  -> resolve only referenced artifacts/evidence needed for the next context
  -> choose only eligible unresolved work
  -> CLAIM
  -> resolve concrete work context
  -> dispatch/execute bounded Worker work
  -> CHECKPOINT partial continuation OR SUBMIT final result
  -> establish required review work
  -> review now OR leave PENDING_REVIEW for a later/batch session
  -> reconcile assessments/findings
  -> DONE | REOPENED | BLOCKED
  -> reconcile source-synchronized living docs when source changed
```

A Worker submission never self-authorizes `DONE`.

```text
CLAIMED -> DONE
```

is invalid.

A later session must not redo `DONE` work unless new grounded evidence explicitly reopens it.

Session is not project lifecycle. No project-critical continuation state may exist only in previous conversation/model context.

## Session handoff

A handoff-safe project must expose enough durable state for a fresh session to answer:

```text
what project did I open?
what is the user's objective?
what work exists?
what can run now?
what exact partial-work checkpoint should resume?
what is already claimed?
what is pending review or reconciliation?
what is blocked or done?
which artifact/evidence refs must be resolved to continue?
```

The Agentic Application session-handoff surface uses one durable user-intent root and rejects work that cannot trace directly or transitively to that root.

For project-identity handoff safety, `createSessionHandoffSurface({ orchestrator, projectId })` persists the stable project id on the durable user-intent root, exposes it in the handoff projection and fails closed when a fresh session expects another project. Project identity is distinct from store path, session/owner identity, work id and user-intent id.

An unbound legacy reader cannot silently open a project-bound Board. A project-bound reader cannot silently assign identity to a legacy Board. Legacy unbound Boards remain available only for low-level compatibility where project-identity handoff safety is not claimed.

## Review initiation

Review can be initiated from two different sources:

```text
Worker
  -> REQUEST review because the produced change needs specialist verification

PM
  -> REQUIRE review because project scope/dependency/risk/acceptance obligations require it
```

Those sources do not perform the review by implication. The Orchestrator schedules/dispatches the required concrete review role and may run it immediately or defer it.

```text
REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT
```

PM and SA are horizontal roles with different authority:

- PM owns project coordination, sequencing, dependency, timeline and progress semantics;
- SA owns architecture constraints/judgment/review only;
- remaining specialist execution and review is vertical and context-bound.

PM and SA must receive separately resolved context; there is no universal review context.

## Follow-up reconciliation

Unresolved findings are proposals/observations until the Orchestrator reconciles them against current Board state.

```text
finding is still part of current item's acceptance obligation
  -> REOPEN current item and narrow remaining work

finding already exists elsewhere on Board
  -> LINK existing item

finding is genuinely independent actionable work
  -> CREATE child/follow-up with origin/dependency provenance

finding is speculative/non-actionable/no concrete pressure
  -> do not create Board work
```

Invariant:

```text
Do not generate new work when the finding is evidence that the current work is not done.
```

## Work-item shape

The current runtime slice persists the following semantics; this Markdown projection keeps the same authority model without requiring byte-for-byte JSON identity.

```text
id: BB-XXX
question/work: <gap/problem/work to resolve>
status: READY | CLAIMED | PENDING_REVIEW | REVIEWING | PENDING_RECONCILIATION | BLOCKED | DONE | REOPENED | SUPERSEDED
owner: <session/agent only while claimed>
depends-on: []
remaining-work: []
checkpoint: <durable partial-work continuation state, when present>
checkpointed-by: <last session/agent that persisted partial work>
submission: <immutable submitted result refs, when present>
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers: []
follow-up-refs: []
origin: <root-intent or parent/finding provenance>
```

A checkpoint is continuation state, not acceptance state. Persisting a checkpoint never means the work is complete.

The Board is operational state, not a diary and not an architecture document.

## Completion invariants

- Worker result/submission is not completion authority.
- partial checkpoint is not completion authority.
- `DONE` requires all required reviews/acceptance obligations to be satisfied.
- rejected or inconclusive review reopens/narrows the current work unless the finding is independently scoped work;
- Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct;
- role-local completion (for example Backend or QA completion) does not automatically mean the enclosing Blackboard problem is done.

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

## Phase

```text
phase: ORACLE_DETAIL
started: 2026-09-18
previous-board-archive: docs/living/history/blackboard-pre-oracle-detail-2026-09-18.md
previous-phase-closure: docs/living/knowledge/pre-oracle-detail-blackboard-closure-2026-09-18.md
previous-terminal-count: 42
previous-done-count: 38
previous-superseded-count: 4
next-work-id: BB-044
```

The previous coordination phase is fully terminal and archived. Historical items are not copied into this active surface.

## Active work

```text
BB-043
question/work: Deliver the accepted D014 optional application-artifact manifest adapter for ref-only Backend -> QA continuation.
kind: IMPLEMENTATION
priority: P1
status: DONE
owner:
depends-on: []
remaining-work: []
acceptance-criteria:
  - unchanged valid artifacts still resolve through resolveQaContext with existing QA schemas
  - changed bytes behind a stable ref are rejected before QA receives context
  - producer work-order, revision and acceptance-decision mismatches fail closed
  - unavailable payload and missing manifest are distinguishable adapter failures while Oracle preserves their cause
  - the manifest contains identity/provenance/retention metadata but no artifact payload body
  - the adapter grants no correctness, acceptance, lifecycle or retention authority to Oracle
submission:
  - PR #133
review-requirements: [application/code review, Oracle architecture-boundary review]
reviews:
  - application/code review PASS on exact head 07276b1d13b06a3fb55a8b7ef6a4bb5a6fca6638
  - Oracle architecture-boundary review PASS on exact head 07276b1d13b06a3fb55a8b7ef6a4bb5a6fca6638
artifact-refs:
  - docs/living/decisions/D014-application-artifact-manifest-adapter.md
  - docs/living/knowledge/bb039-artifact-manifest-research.md
  - docs/worktree/oracle/artifact-manifest.md
  - packages/agentic-system/src/artifact-manifest.js
  - packages/agentic-system/test/bb043-artifact-manifest-adapter.test.js
evidence-refs:
  - BB-039 accepted research
  - D014 ACCEPTED
  - Actions #2054 green on living-doc-impact and Node 20/22/24
  - application/code review id 5244789001
  - Oracle architecture-boundary review id 5244789380
  - merge commit 9511b5a196bc5442a3a3b91db39ee706ae5438dc
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; ORACLE_DETAIL phase implementation handoff from accepted D014
```

New work belongs here only when it is a concrete unresolved Oracle-detail gap/problem/question with source-backed scope or explicit user intent. Historical re-entry triggers create a new work item rather than mutating the archive.
