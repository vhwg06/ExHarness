# Blackboard

Status: **INTEGRATION COORDINATION SURFACE**

The Blackboard is the canonical home for unresolved gaps, problems, questions, blockers and next non-trivial shared work. It is shared operational state, not an actor, architecture document or correctness authority.

Stable lifecycle/schema rules have been promoted out of this file:

- `contracts.md` owns Board, handoff, review, reconciliation and work-item invariants;
- `pipelines.md` owns fresh-session resume, work, synchronization, knowledge and reconciliation flows;
- `../worktree/*` owns source-synchronized current-system facts;
- `history/*` preserves terminal phase Board snapshots.

This file intentionally stays small enough for a fresh session to recover project intent, phase state and active work without loading resolved history.

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

# Current board

## Phase

```text
phase: INTEGRATION
started: 2026-09-18
previous-board-archive: docs/living/history/blackboard-oracle-detail-2026-09-18.md
previous-phase-closure: docs/living/knowledge/oracle-detail-closure-2026-09-18.md
previous-terminal-count: 3
previous-done-count: 3
previous-superseded-count: 0
current-active-debt: 1
next-work-id: BB-047
phase-scope:
  - integrate Oracle through concrete application/component consumers without widening Oracle authority
  - integrate delivered Agentic Application, Oracle and Core boundaries across real composition seams
  - use contract, recovery and end-to-end verification evidence to expose actual integration gaps
  - reduce implementation risk from model-inferred work context by making bounded context inputs/currentness explicit where evidence justifies it
```

The Oracle-detail phase is terminal and archived. BB-043..045 are no longer active Board state; their current-system results are projected into `docs/worktree/*` and their evidence/history remains referenced by the phase archive and closure note.

The Integration phase begins deliberately with zero active debt. An unused work id is not backlog.

## Active work

```text
BB-046
question/work: Implement and evaluate the accepted repository-local Blackboard Context Plane so fresh sessions receive an exact safe-next-action context instead of inferring scope/authority from Board prose.
kind: IMPLEMENTATION
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
target-consumer:
  - repository fresh-session developer/reviewer work
implementation-output: JSON context validation, exact Board binding, deterministic resolver/generator, stale/review-subject verification, evaluation fixtures and living-doc promotion.
value-gate: Explicit-context fixtures must preserve authority/correctness controls, reconstruct the same safe action without chat, and improve irrelevant-read / wrong-scope behavior enough to justify context-management overhead.
current-context:
  generation: 4
  ref: docs/living/work-context/BB-046/g0004-implementation-review.json
  implementation-context: docs/living/work-context/BB-046/g0003-implementation.json
  decision-ref: docs/living/decisions/D017-bb046-context-plane-acceptance.md
  reviewed-candidate-head: a602148c2370b4da8406f1d3873f5d79c31b2b07
remaining-work:
  - independent fresh review of g0004 exact candidate
  - independent CI/evaluation evidence review
  - reopen implementation only if review returns grounded blockers
acceptance-criteria:
  - fresh worker reconstructs the same safe action without chat
  - stale generation cannot authorize durable action
  - review context cannot authorize source implementation
  - implementation requires an exact accepted decision bound to parent context + candidate head
  - required refs and audit refs remain distinct
  - missing/duplicate/mismatched Board bindings fail closed
  - write/forbiddenWrite overlap fails closed
  - context resolver does not schedule work or decide acceptance
  - runtime JSON Blackboard adoption remains out of scope
submission:
  - PR #153 exact review target a602148c2370b4da8406f1d3873f5d79c31b2b07
review-requirements:
  - implementation contract review
  - evaluation/value-gate review
reviews:
  - docs/living/decisions/D017-bb046-context-plane-acceptance.md
artifact-refs:
  - docs/living/work-context/BB-046/g0003-implementation.json
  - docs/living/decisions/D017-bb046-context-plane-acceptance.md
  - docs/living/knowledge/bb046-blackboard-context-implementation-readiness.md
  - docs/living/knowledge/bb046-blackboard-context-evaluation.md
evidence-refs:
  - INTENT-exharness-agentic-system
  - exact parent review context docs/living/work-context/BB-046/g0002-readiness-review.json
  - semantic review target d013b6118dccfea67e8615f4624d3a00f6e10b4f
blockers: []
follow-up-refs:
  - Integration A.1 runtime bridge implementation requires a separate exact implementation context after this repository-local slice; Integration B-J remain deferred.
origin: D017 accepted BB-046 generation 2 and authorized the bounded repository context-plane implementation slice.
```

## Integration entry rule

Allocate BB-046 or later only when at least one grounded integration trigger exists:

- a concrete component/consumer seam must be wired or fails to compose;
- a current contract is missing, inconsistent or violated across component boundaries;
- crash/recovery/handoff behavior fails when components are composed;
- an integration or end-to-end verification exposes a reproducible gap;
- explicit user intent requests a concrete integration outcome.

Oracle-specific work must still respect the Oracle-detail re-entry triggers. Integration pressure alone does not justify a generic resolver/provider registry, MCP-first Oracle, cache/retrieval framework or another speculative abstraction.

When current behavior changes, update the relevant `docs/worktree/*` projection in the same durable change. When a phase item becomes terminal, keep its operational history out of this active surface and preserve it under `history/*` plus referenced knowledge/decision artifacts.
