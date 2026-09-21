# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The Blackboard describes how ExHarness is currently being developed. It does not describe what ExHarness is; current system truth is under `docs/living/`.

This file is the single current-state source of truth for outer-Blackboard routing. It contains only current delivery state. Previous revisions live in Git history, not in parallel context/history files.

## Project

```text
phase: INTEGRATION
started: 2026-09-18
current-active-debt: 0
next-work-id: BB-052
living-system-root: docs/living/system/state.md
integration-roadmap-ref: docs/living/knowledge/integration-phase-research-to-implementation-readiness.md
```

## Pipeline lanes

```text
RESEARCH_SA
  active: NONE
  terminal-output: ACCEPTED IMPLEMENTATION_INPUT

IMPLEMENTATION_WORKER
  active: NONE
  terminal-output: RECORDED JUDGMENT
```

The lanes are independent. Future Research/SA work does not need to reconstruct implementation history; future Worker work does not need to reconstruct research history. Each follows its exact context and declared refs.

## Active work

NONE

## Accepted semantic input queue

Research/SA has completed semantic handoff for four future slices. These are accepted artifacts, not active work and not ordered backlog:

- Integration C: `docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage.json` + `docs/blackboard/artifacts/implementation-spec/integration-c-cross-domain-obligation-lineage.json`
- Integration D: `docs/blackboard/artifacts/implementation-input/integration-d-domain-activation-parallel-autonomy.json` + `docs/blackboard/artifacts/implementation-spec/integration-d-domain-activation-parallel-autonomy.json`
- Integration E/F: `docs/blackboard/artifacts/implementation-input/integration-ef-deployment-acceptance-snapshot.json` + `docs/blackboard/artifacts/implementation-spec/integration-ef-deployment-acceptance-snapshot.json`
- Integration G: `docs/blackboard/artifacts/implementation-input/integration-g-product-completeness-closure.json`

They do not consume work ids or `current-active-debt`. A future grounded trigger allocates a new IMPLEMENTATION_WORKER item and binds exactly one queued semantic input plus its canonical implementation spec when one exists.

Retained `IMPLEMENTATION_SPEC.provenance.originWorkId` values are globally reserved identity evidence and must not be reused for a different work subject. The current allocator therefore advances past the retained BB-050/BB-051 identities.

## Allocation rules

New Research/SA work is allocated from an explicit problem/question/research need.

New Implementation/Worker work requires an accepted implementation-input artifact from Research/SA, a bounded current-system baseline and an exact current context.

Promoted research knowledge alone is not future backlog. Living Docs never become the work queue.
