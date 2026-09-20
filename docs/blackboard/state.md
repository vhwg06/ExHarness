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
  lane: JUDGMENT
  judgment-kind: CANDIDATE
  stage: IMPLEMENTATION_CANDIDATE_REVIEW
```

The lanes are independent. Future Research/SA work does not need to reconstruct implementation history; future Worker work does not need to reconstruct research history. Each follows its exact context and declared refs.

## Active work

BB-048
pipeline: IMPLEMENTATION_WORKER
lane: JUDGMENT
judgment-kind: CANDIDATE
stage: IMPLEMENTATION_CANDIDATE_REVIEW
question/work: Repair the grounded post-merge Integration B findings without widening BB-048 semantics.
kind: IMPLEMENTATION
priority: P1
status: PENDING_REVIEW
owner:
current-context:
  generation: 18
  ref: docs/blackboard/context/BB-048/g0018-repair-candidate-judgment.json
implementation-input:
  ref: docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json
implementation-result:
  ref: docs/blackboard/artifacts/implementation-result/BB-048-g0017-repair.json
depends-on: []
scope-boundary:
  - fix publication lifecycle/write-authority fencing
  - make canonical publication idempotent under concurrent recovery
  - bind ExecutionAttemptTransition to exact observed CAS head revision
  - do not enter Integration C-J
blockers: []
next:
  - fresh-review exact repair candidate d21dce6934cdf8351ec7d9d860fbbed79a960e3c
  - judge only g0016 findings plus repair-scope/currentness regressions
  - on ACCEPT, close BB-048 repair and merge PR #197 only after exact-head CI/currentness recheck
  - on FINDINGS, materialize bounded next repair generation

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

BB-048 prior g0015 ACCEPT is historical/stale after post-merge review #5260290893 found the final merged tree changed outside its review envelope and identified two additional P1 implementation/evidence gaps. Current repair authority is g0017 from `docs/blackboard/artifacts/judgment/BB-048-g0016.json`.

BB-049 Research/SA is terminal. It produced the accepted unallocated Integration G semantic input at `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure-v1.json`. Closure record: `docs/blackboard/history/bb049-integration-g-research-sa-closure-2026-09-20.md`.

BB-047 A.1 is terminal current-system history. Its delivery is represented in Living Docs and accepted by `docs/living/decisions/D027-bb047-a1-merge-acceptance.md`.

Operational closure record: `docs/blackboard/history/bb047-a1-closure-2026-09-19.md`.
