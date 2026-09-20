# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The Blackboard describes how ExHarness is currently being developed. It does not describe what ExHarness is; current system truth is under `docs/living/`.

This file is the single mutable current-state source of truth for outer-Blackboard routing. Other Blackboard documents may define invariants or retain immutable evidence, but they must not duplicate current active work, queue membership, current-context, blockers or next actions.

## Project

```text
phase: INTEGRATION
started: 2026-09-18
current-active-debt: 1
next-work-id: BB-050
living-system-root: docs/living/system/state.md
integration-roadmap-ref: docs/living/knowledge/integration-phase-research-to-implementation-readiness-v7.md
previous-board-archive: docs/blackboard/history/blackboard-oracle-detail-2026-09-18.md
previous-phase-closure: docs/living/knowledge/oracle-detail-closure-2026-09-18.md
```

## Pipeline lanes

```text
RESEARCH_SA
  active: NONE
  terminal-output: ACCEPTED IMPLEMENTATION_INPUT

IMPLEMENTATION_WORKER
  active: BB-048
  lane: EXECUTION
  execution-mode: REPAIR
  stage: IMPLEMENTATION_REPAIR
```

The lanes are independent. Future Research/SA work does not need to reconstruct implementation history; future Worker work does not need to reconstruct research history. Each follows its exact context and declared refs.

## Active work

BB-048
pipeline: IMPLEMENTATION_WORKER
lane: EXECUTION
execution-mode: REPAIR
stage: IMPLEMENTATION_REPAIR
question/work: Repair the grounded post-merge Integration B findings without widening BB-048 semantics.
kind: IMPLEMENTATION
priority: P1
status: READY
owner:
current-context:
  generation: 19
  ref: docs/blackboard/context/BB-048/g0019-repair-implementation.json
implementation-input:
  ref: docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json
implementation-result:
  ref: docs/blackboard/artifacts/implementation-result/BB-048-g0017-repair.json
depends-on: []
scope-boundary:
  - replace optimistic lifecycle publication guard with a real fail-closed currentness fence
  - verify the production Blackboard store/orchestrator race, not a stronger fixture-only serial lock
  - preserve canonical publication idempotency, writer-authority fencing, and transition CAS lineage
  - do not enter Integration C-J
blockers: []
next:
  - repair only g0018 P1 lifecycle-publication fence
  - add production-path race verification using the real Blackboard store/orchestrator/claim controller
  - run focused tests plus full repository verify
  - publish factual BB-048-g0019 repair result and materialize fresh g0020 JUDGMENT/CANDIDATE

## Accepted semantic input queue

Research/SA has completed semantic handoff for four future slices. These are accepted artifacts, not active work and not ordered backlog:

- `docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage-v1.json`
- `docs/blackboard/artifacts/implementation-input/integration-d-domain-activation-parallel-autonomy-v1.json`
- `docs/blackboard/artifacts/implementation-input/integration-ef-deployment-acceptance-snapshot-v1.json`
- `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure-v1.json`

They do not consume work ids or `current-active-debt`. A future grounded trigger allocates a new IMPLEMENTATION_WORKER item and binds exactly one queued semantic input.

## Allocation rules

New Research/SA work is allocated from an explicit problem/question/research need.

New Implementation/Worker work requires an accepted implementation-input artifact from Research/SA, a bounded current-system baseline and an exact current context.

Promoted research knowledge alone is not future backlog. Living Docs never become the work queue.

## Terminal lineage

BB-048 prior g0015 ACCEPT remains historical/stale. g0018 fresh repair judgment on exact candidate `d21dce6934cdf8351ec7d9d860fbbed79a960e3c` recorded FINDINGS: writer-authority/idempotency and transition-revision repairs are closed, but the production lifecycle publication guard is still optimistic and can detect a Blackboard conflict only after an authoritative publication side effect. Current bounded repair authority is g0019 from `docs/blackboard/artifacts/judgment/BB-048-g0018.json`.

BB-049 Research/SA is terminal. It produced the accepted unallocated Integration G semantic input at `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure-v1.json`. Closure record: `docs/blackboard/history/bb049-integration-g-research-sa-closure-2026-09-20.md`.

BB-047 A.1 is terminal current-system history. Its delivery is represented in Living Docs and accepted by `docs/living/decisions/D027-bb047-a1-merge-acceptance.md`.

Operational closure record: `docs/blackboard/history/bb047-a1-closure-2026-09-19.md`.
