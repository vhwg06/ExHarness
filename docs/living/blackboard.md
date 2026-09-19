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
next-work-id: BB-049
phase-scope:
  - integrate Oracle through concrete application/component consumers without widening Oracle authority
  - integrate delivered Agentic Application, Oracle and Core boundaries across real composition seams
  - use contract, recovery and end-to-end verification evidence to expose actual integration gaps
  - reduce implementation risk from model-inferred work context by making bounded context inputs/currentness explicit where evidence justifies it
```

The Oracle-detail phase is terminal and archived. BB-043..045 are no longer active Board state; their current-system results are projected into `docs/worktree/*` and their evidence/history remains referenced by the phase archive and closure note.

The Integration phase now has one explicitly allocated bounded item. Unused later work ids remain non-backlog until separately triggered.

## Active work

BB-048
question/work: Authorize and implement the first bounded DOMAIN_EXECUTION_CONTROL / Integration B slice from an exact released organizational claim through immutable domain-local execution binding and evidence/publication.
kind: IMPLEMENTATION
priority: P1
status: PENDING_REVIEW
owner:
current-context:
  generation: 3
  ref: docs/living/work-context/BB-048/g0003-implementation-readiness-review.json
depends-on: []
target-consumer:
  - post-claim domain-local execution control
entry-trigger:
  - explicit user request to proceed from terminal A.1 into Integration B
  - BB-047 A.1 accepted/closed on main
  - reviewed DOMAIN_EXECUTION_CONTROL readiness merged on main
scope-boundary:
  - start only from an exact current released organizational claim
  - own HOW/runtime below the organization boundary
  - prove one concrete BA-owned execution slice only
  - do not introduce cross-domain obligation issuance, DOMAIN_ACTIVATION, ProductStateProjection, deployment/Product QA, or Integration C-J
acceptance-criteria:
  - ExecutionAttemptHead currentness is resolved before policy/strategy selection
  - immutable ExecutionAttemptBinding pins exact WorkContract/release/policy/strategy/runtime/config before effects
  - same semantic attempt recovery reuses the same binding; process restart cannot mint a new attempt
  - execution result, runtime fact, verification evidence, domain acceptance and authoritative publication remain separate
  - strategy/runtime cannot select other organizational work or dispatch another domain
review-requirements:
  - implementation-readiness review is read-only and bound to the exact canonical integration candidate
  - generation 3 retargets review after BB-047 capability truth was reconciled into the source-synchronized capability maps
  - accepted decision must bind this exact context + candidate before any IMPLEMENT generation exists
  - promoted Integration C/D/E-F research is canonical knowledge only; it does not widen BB-048 scope
blockers:
  - implementation authority not yet granted; current generation is REVIEW only
required-input-refs:
  - docs/living/knowledge/domain-execution-control-implementation-readiness.md
  - docs/living/knowledge/domain-execution-control-judgment-artifacts.md
  - docs/living/decisions/D027-bb047-a1-merge-acceptance.md
origin: explicit Integration B allocation after terminal BB-047 closure and merged #159 implementation-readiness research.

BB-047 A.1 remains terminal and preserved at `docs/living/history/bb047-a1-closure-2026-09-19.md`; its clean merge acceptance is `docs/living/decisions/D027-bb047-a1-merge-acceptance.md`.

## Integration entry rule

Allocate BB-046 or later only when at least one grounded integration trigger exists:

- a concrete component/consumer seam must be wired or fails to compose;
- a current contract is missing, inconsistent or violated across component boundaries;
- crash/recovery/handoff behavior fails when components are composed;
- an integration or end-to-end verification exposes a reproducible gap;
- explicit user intent requests a concrete integration outcome.

Promoted future-slice research on `main` is knowledge, not backlog: it does not allocate a work id, create active debt, or authorize implementation until one of the entry triggers above allocates a concrete Board item. The native repository authority path is `REVIEW context -> accepted decision -> IMPLEMENT context -> READY worker`; no separate `work-artifacts/*` authority layer exists.

Oracle-specific work must still respect the Oracle-detail re-entry triggers. Integration pressure alone does not justify a generic resolver/provider registry, MCP-first Oracle, cache/retrieval framework or another speculative abstraction.

When current behavior changes, update the relevant `docs/worktree/*` projection in the same durable change. When a phase item becomes terminal, keep its operational history out of this active surface and preserve it under `history/*` plus referenced knowledge/decision artifacts.
