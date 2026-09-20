# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The Blackboard describes how ExHarness is currently being developed. It does not describe what ExHarness is; current system truth is under `docs/living/`.

This file is the single current-state source of truth for outer-Blackboard routing. It contains only current delivery state. Previous revisions live in Git history, not in parallel context/history files.

## Project

```text
phase: INTEGRATION
started: 2026-09-18
current-active-debt: 1
next-work-id: BB-050
living-system-root: docs/living/system/state.md
integration-roadmap-ref: docs/living/knowledge/integration-phase-research-to-implementation-readiness.md
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
question/work: Repair the remaining lifecycle-publication currentness race without widening Integration B.
kind: IMPLEMENTATION
priority: P1
status: READY
owner:
current-context:
  ref: docs/blackboard/context/BB-048/current.json
implementation-input:
  ref: docs/blackboard/artifacts/implementation-input/BB-048-domain-execution-control.json
implementation-result:
  ref: docs/blackboard/artifacts/implementation-result/BB-048.json
depends-on: []
scope-boundary:
  - use the real shared Blackboard lifecycle/publication fence
  - prove invalidation cannot commit through canonical publication on the production path
  - preserve publication idempotency, writer-authority fencing and transition CAS lineage
  - do not enter Integration C-J
blockers: []
next:
  - run focused production race tests and full repository verification
  - update the current IMPLEMENTATION_RESULT with the exact repair candidate
  - rewrite current context to JUDGMENT/CANDIDATE for fresh independent review

## Accepted semantic input queue

Research/SA has completed semantic handoff for four future slices. These are accepted artifacts, not active work and not ordered backlog:

- `docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage.json`
- `docs/blackboard/artifacts/implementation-input/integration-d-domain-activation-parallel-autonomy.json`
- `docs/blackboard/artifacts/implementation-input/integration-ef-deployment-acceptance-snapshot.json`
- `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure.json`

They do not consume work ids or `current-active-debt`. A future grounded trigger allocates a new IMPLEMENTATION_WORKER item and binds exactly one queued semantic input.

## Allocation rules

New Research/SA work is allocated from an explicit problem/question/research need.

New Implementation/Worker work requires an accepted implementation-input artifact from Research/SA, a bounded current-system baseline and an exact current context.

Promoted research knowledge alone is not future backlog. Living Docs never become the work queue.
