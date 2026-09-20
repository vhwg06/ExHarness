# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The Blackboard describes how ExHarness is currently being developed. It does not describe what ExHarness is; current system truth is under `docs/living/`.

## Project

```text
phase: INTEGRATION
started: 2026-09-18
current-active-debt: 1
next-work-id: BB-049
living-system-root: docs/living/system/state.md
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
  stage: IMPLEMENTATION_READINESS_REVIEW
```

The lanes are independent. Future Research/SA work does not need to reconstruct implementation history; future Worker work does not need to reconstruct research history. Each follows its exact context and declared refs.

## Active work

BB-048
pipeline: IMPLEMENTATION_WORKER
stage: IMPLEMENTATION_READINESS_REVIEW
question/work: Authorize the first bounded DOMAIN_EXECUTION_CONTROL / Integration B slice from an exact released organizational claim through immutable domain-local execution binding and evidence/publication.
kind: IMPLEMENTATION
priority: P1
status: PENDING_REVIEW
owner:
current-context:
  generation: 8
  ref: docs/blackboard/context/BB-048/g0008-implementation-readiness-review.json
implementation-input:
  ref: docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json
depends-on: []
scope-boundary:
  - start only from an exact current released organizational claim
  - own HOW/runtime below the organization boundary
  - prove one concrete BA-owned execution slice only
  - do not introduce cross-domain obligation issuance, DOMAIN_ACTIVATION, ProductStateProjection, deployment/Product QA, or Integration C-J
blockers:
  - implementation authority not yet granted; current generation is REVIEW only
next:
  - execute fresh review from exact g0008 context
  - on ACCEPT, materialize bounded g0009 IMPLEMENT context for Worker

## Allocation rules

New Research/SA work is allocated from an explicit problem/question/research need.

New Implementation/Worker work requires an accepted implementation-input artifact from Research/SA, a bounded current-system baseline and an exact current context.

Promoted research knowledge alone is not future backlog. Living Docs never become the work queue.

## Terminal lineage

BB-047 A.1 is terminal current-system history. Its delivery is represented in Living Docs and accepted by `docs/living/decisions/D027-bb047-a1-merge-acceptance.md`.

Operational closure record: `docs/blackboard/history/bb047-a1-closure-2026-09-19.md`.
