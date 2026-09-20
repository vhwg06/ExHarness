# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The Blackboard describes how ExHarness is currently being developed. It does not describe what ExHarness is; current system truth is under `docs/living/`.

## Project

```text
phase: INTEGRATION
started: 2026-09-18
current-active-debt: 1
next-work-id: BB-050
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
  lane: JUDGMENT
  judgment-kind: READINESS
  stage: IMPLEMENTATION_READINESS_REVIEW
```

The lanes are independent. Future Research/SA work does not need to reconstruct implementation history; future Worker work does not need to reconstruct research history. Each follows its exact context and declared refs.

## Active work

BB-048
pipeline: IMPLEMENTATION_WORKER
lane: JUDGMENT
judgment-kind: READINESS
stage: IMPLEMENTATION_READINESS_REVIEW
question/work: Authorize the first bounded DOMAIN_EXECUTION_CONTROL / Integration B slice from an exact released organizational claim through immutable domain-local execution binding and evidence/publication.
kind: IMPLEMENTATION
priority: P1
status: PENDING_REVIEW
owner:
current-context:
  generation: 12
  ref: docs/blackboard/context/BB-048/g0012-implementation-readiness-judgment.json
implementation-input:
  ref: docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control-v1.json
depends-on: []
scope-boundary:
  - start only from an exact current released organizational claim
  - own HOW/runtime below the organization boundary
  - prove one concrete BA-owned execution slice only
  - do not introduce cross-domain obligation issuance, DOMAIN_ACTIVATION, ProductStateProjection, deployment/Product QA, or Integration C-J
blockers:
  - implementation authority not yet granted; current lane is JUDGMENT/READINESS
next:
  - execute fresh readiness judgment from exact g0012 context
  - on ACCEPT, materialize bounded g0013 EXECUTION/INITIAL context
  - EXECUTION may publish IMPLEMENTATION_RESULT facts only; a later fresh JUDGMENT/CANDIDATE owns correctness

## Accepted semantic input queue

Research/SA has completed semantic handoff for three future slices. These are accepted artifacts, not active work and not ordered backlog:

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

BB-049 Research/SA is terminal. It produced the accepted unallocated Integration G semantic input at `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure-v1.json`. Closure record: `docs/blackboard/history/bb049-integration-g-research-sa-closure-2026-09-20.md`.

BB-047 A.1 is terminal current-system history. Its delivery is represented in Living Docs and accepted by `docs/living/decisions/D027-bb047-a1-merge-acceptance.md`.

Operational closure record: `docs/blackboard/history/bb047-a1-closure-2026-09-19.md`.
