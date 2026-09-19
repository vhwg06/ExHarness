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
question/work: Research and independently review the Integration-phase organizational architecture plus a Blackboard Context Plane that makes the safe next-action context explicit instead of requiring a fresh model to infer implementation scope from Board prose and arbitrary refs.
kind: RESEARCH / ARCHITECTURE
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
research-hypothesis: A small Board-linked immutable context generation can reduce context-loading and wrong-scope implementation risk without becoming a second Blackboard, correctness authority, scheduler or runtime WorkContract.
target-consumer:
  - repository fresh-session developer/reviewer work
  - Integration A.1 independent readiness review and later implementation handoff
implementation-output: If independently accepted and benchmark-worthy, one repository-local context-plane slice (JSON spec validation, Board binding, resolver/generator, evaluation) before any runtime Blackboard adoption.
value-gate: Explicit-context fixtures must preserve authority/correctness controls, reconstruct the same safe action without chat, and improve irrelevant-read / wrong-scope behavior enough to justify context-management overhead.
current-context-candidate:
  generation: 2
  ref: docs/living/work-context/BB-046/g0002-readiness-review.json
  review-target:
    repository: vhwg06/ExHarness
    candidate-head: d013b6118dccfea67e8615f4624d3a00f6e10b4f
  note: review-envelope candidate only; generation 2 binds one immutable semantic candidate commit and grants no implementation authority.
remaining-work:
  - independent architecture/application review of the Blackboard Context Plane
  - independent readiness review of the exact organizational A.1 trust-transition candidate
  - decide whether the repository-local context implementation slice is justified by the evaluation plan
acceptance-criteria:
  - reviewer can distinguish Blackboard lifecycle, WORK_CONTEXT_SPEC, runtime ORGANIZATION_WORK_CONTRACT and ExecutionPolicy/Strategy without chat reinterpretation
  - current context is an exact Board-linked generation/ref, not inferred from artifact existence or ranking
  - independent review binds exact immutable candidate commit d013b6118dccfea67e8615f4624d3a00f6e10b4f; PR #151 is navigation only
  - required current-system/input refs are explicit while audit/history refs remain lazy and non-authoritative
  - source read/write/forbidden scope is explicit and context producer cannot self-authorize wider mutation or acceptance
  - context generation/currentness has fail-closed stale/recovery semantics and remains distinct from claim/review/execution generations
  - canonical machine context is JSON; proposed validation does not depend on a permissive Markdown/YAML parser
  - first implementation consumer is repository development coordination; runtime JSON Blackboard adoption requires separate evidence
  - organizational A.1 architecture remains PROPOSED until an adequate independent review accepts the exact candidate
submission:
  - PR #151
review-requirements:
  - Blackboard/living-doc architecture review
  - Agentic Application authority-boundary review
  - independent BB-046/A.1 readiness review
reviews: []
artifact-refs:
  - docs/living/knowledge/bb046-blackboard-context-architecture.md
  - docs/living/knowledge/bb046-blackboard-context-contracts.md
  - docs/living/knowledge/bb046-blackboard-context-pipelines.md
  - docs/living/knowledge/bb046-blackboard-context-evaluation.md
  - docs/living/knowledge/bb046-blackboard-context-implementation-readiness.md
  - docs/living/work-context/BB-046/g0001-readiness-review.json
  - docs/living/work-context/BB-046/g0002-readiness-review.json
  - docs/living/knowledge/bb046-organizational-integration-implementation-artifact-readiness-v7.md
  - docs/living/knowledge/bb046-trust-transition-research-v7.md
  - docs/living/knowledge/bb046-execution-strategy-rebase-research-v6.md
  - docs/living/knowledge/integration-phase-research-to-implementation-readiness-v7.md
evidence-refs:
  - INTENT-exharness-agentic-system
  - D008 explicit repository/runtime project-state boundary
  - BB-028 bounded orientation vs exact-underlying-read evidence
  - D009 generation-fenced interrupted recovery
  - source baseline ad36638dd7041a60c224dfe3c9beb252069ecdae
  - semantic review target d013b6118dccfea67e8615f4624d3a00f6e10b4f
  - Kubernetes generation/observed-generation design calibration
  - Bazel hermetic explicit-input design calibration
  - in-toto authorized-step/material/product design calibration
blockers:
  - exact architecture and A.1 candidate at d013b6118dccfea67e8615f4624d3a00f6e10b4f are awaiting independent review under g0002; no implementation authority is granted by this PR
follow-up-refs: []
origin: INTENT-exharness-agentic-system; explicit user Integration-phase request to make work context around the Blackboard durable and implementation-safe
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
