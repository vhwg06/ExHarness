# Outer Blackboard

Status: **DERIVED ROUTING PROJECTION**

> Generated from `docs/blackboard/work-graph.json` and `docs/blackboard/component-registry.json`. Routing facts are derived; edit the canonical graph/catalog, not this projection.

## Canonical sources

```text
work-graph: docs/blackboard/work-graph.json
component-registry: docs/blackboard/component-registry.json
living-system-root: docs/living/system/state.md
integration-roadmap-ref: docs/living/knowledge/integration-phase-research-to-implementation-readiness.md
```

## Project

```text
phase: INTEGRATION
next-work-id: BB-134
execution-unit: TASK
context-routing-unit: COMPONENT
worker-ownership: ONE_TASK_PER_CLAIM
current-active-debt: 0
```

## Pipeline lanes

```text
RESEARCH_SA
  active: NONE

WORKER
  active: NONE
```

## Active work

NONE

## Schedulable tasks

- BB-055 [WORKER/EXECUTION] — Implement product completeness and closure currentness
- BB-078 [WORKER/EXECUTION] — Implement durable detached operation scheduling
- BB-099 [WORKER/EXECUTION] — Measure ExHarness-supervised versus direct agent-tool delivery
- BB-106 [WORKER/EXECUTION] — Wire delivered Oracle and supersession regression tests into npm test and verify
- BB-107 [RESEARCH_SA/RESEARCH] — Reserve planner work from remaining budget so files that fit the requirement materialize
- BB-120 [WORKER/EXECUTION] — Allowlist agent-tools child environment
- BB-122 [WORKER/EXECUTION] — Add OpenCode as a supported agent tool
- BB-123 [RESEARCH_SA/RESEARCH] — Agent-tools correctness follow-ups: observed-only grok cost and worktree-local grounded-context exclusion
- BB-124 [RESEARCH_SA/RESEARCH] — Preserve truthful partial usage and per-field accounting coverage
- BB-125 [RESEARCH_SA/RESEARCH] — Bind supervised resume to the exact task and execution contract
- BB-126 [RESEARCH_SA/RESEARCH] — Stop repeated no-progress retries with evidence-bound feedback
- BB-127 [RESEARCH_SA/RESEARCH] — Add externally pinned acceptance for local delivery slices
- BB-128 [RESEARCH_SA/RESEARCH] — Expose delivered Grok and OpenCode adapters through operator delivery
- BB-129 [RESEARCH_SA/RESEARCH] — Export a durable review bundle for the exact local candidate
- BB-130 [RESEARCH_SA/RESEARCH] — Constrain local verifier child environment
- BB-131 [RESEARCH_SA/RESEARCH] — Prepare a reproducible repository preview for local feature delivery
- BB-132 [RESEARCH_SA/RESEARCH] — Verify local web feature journeys through an independently pinned browser evaluator
- BB-133 [RESEARCH_SA/RESEARCH] — Verify API compatibility and persisted state for local feature changes

## Dependency graph

```text
BB-048 [DONE] <- ROOT
BB-052 [DONE] <- BB-048
BB-053 [DONE] <- BB-052
BB-054 [DONE] <- BB-053
BB-055 [WORKER_SCHEDULABLE] <- BB-054
BB-056 [DONE] <- ROOT
BB-057 [BLOCKED_BY BB-055] <- BB-055
BB-058 [BLOCKED_BY BB-057] <- BB-057
BB-059 [BLOCKED_BY BB-058] <- BB-058
BB-060 [DONE] <- ROOT
BB-061 [DONE] <- BB-060
BB-062 [DONE] <- BB-061
BB-063 [DONE] <- BB-062
BB-064 [DONE] <- BB-060, BB-061, BB-062, BB-063
BB-065 [DONE] <- ROOT
BB-066 [BLOCKED_BY BB-081] <- BB-065, BB-048, BB-081
BB-067 [BLOCKED_BY BB-066] <- BB-065, BB-066
BB-068 [BLOCKED_BY BB-066,BB-067] <- BB-066, BB-067
BB-069 [BLOCKED_BY BB-068] <- BB-068, BB-064
BB-070 [BLOCKED_BY BB-069,BB-055] <- BB-069, BB-055
BB-071 [BLOCKED_BY BB-070,BB-057] <- BB-070, BB-057
BB-072 [BLOCKED_BY BB-068,BB-058] <- BB-068, BB-058
BB-073 [BLOCKED_BY BB-070,BB-072] <- BB-070, BB-072
BB-074 [BLOCKED_BY BB-071,BB-073,BB-081] <- BB-065, BB-071, BB-073, BB-077, BB-081
BB-075 [BLOCKED_BY BB-074,BB-059] <- BB-074, BB-059
BB-076 [BLOCKED_BY BB-074,BB-075] <- BB-074, BB-075
BB-077 [DONE] <- BB-065
BB-078 [WORKER_SCHEDULABLE] <- BB-077
BB-079 [BLOCKED_BY BB-078] <- BB-077, BB-078
BB-080 [BLOCKED_BY BB-078,BB-079] <- BB-078, BB-079
BB-081 [BLOCKED_BY BB-078,BB-079,BB-080] <- BB-077, BB-078, BB-079, BB-080
BB-082 [DONE] <- ROOT
BB-083 [BLOCKED_BY BB-059] <- BB-059, BB-064, BB-065
BB-084 [BLOCKED_BY BB-058] <- BB-058, BB-064
BB-085 [BLOCKED_BY BB-084] <- BB-084
BB-086 [BLOCKED_BY BB-085,BB-059] <- BB-085, BB-059, BB-065
BB-087 [DONE] <- BB-064
BB-088 [DONE] <- BB-087
BB-089 [DONE] <- BB-087
BB-090 [DONE] <- BB-056
BB-091 [DONE] <- BB-088
BB-092 [DONE] <- BB-091
BB-093 [DONE] <- BB-092
BB-094 [BLOCKED_BY BB-081] <- BB-093, BB-081
BB-095 [BLOCKED_BY BB-094] <- BB-094, BB-065
BB-096 [DONE] <- ROOT
BB-097 [DONE] <- BB-096
BB-098 [DONE] <- BB-097
BB-099 [WORKER_SCHEDULABLE] <- BB-098, BB-065
BB-100 [DONE] <- BB-096, BB-097
BB-101 [DONE] <- BB-097
BB-102 [DONE] <- BB-097
BB-103 [DONE] <- BB-097
BB-104 [DONE] <- BB-100, BB-101, BB-102
BB-105 [DONE] <- BB-097, BB-098
BB-106 [WORKER_SCHEDULABLE] <- BB-082, BB-087, BB-088
BB-107 [RESEARCH_SCHEDULABLE] <- BB-087, BB-088, BB-089
BB-108 [DONE] <- BB-087, BB-088
BB-120 [WORKER_SCHEDULABLE] <- BB-097
BB-121 [BLOCKED_BY BB-120] <- BB-100, BB-101, BB-120
BB-122 [WORKER_SCHEDULABLE] <- BB-097, BB-098
BB-123 [RESEARCH_SCHEDULABLE] <- BB-105, BB-102
BB-124 [RESEARCH_SCHEDULABLE] <- BB-098, BB-105, BB-123
BB-125 [RESEARCH_SCHEDULABLE] <- BB-101
BB-126 [RESEARCH_SCHEDULABLE] <- BB-125
BB-127 [RESEARCH_SCHEDULABLE] <- BB-104, BB-130, BB-125
BB-128 [RESEARCH_SCHEDULABLE] <- BB-104, BB-122
BB-129 [RESEARCH_SCHEDULABLE] <- BB-127
BB-130 [RESEARCH_SCHEDULABLE] <- BB-096, BB-120
BB-131 [RESEARCH_SCHEDULABLE] <- BB-104, BB-130
BB-132 [RESEARCH_SCHEDULABLE] <- BB-054, BB-131, BB-127
BB-133 [RESEARCH_SCHEDULABLE] <- BB-054, BB-131, BB-127
```

## Context semantics

```text
Task = scheduling / claim / execution unit
Component = context-routing unit
Worker = temporary owner of exactly one claimed Task
current.json = rebuildable TaskContext projection

Task
  -> components[]
  -> Component Registry / Context Profiles
  -> task artifacts
  -> direct dependencies
       DONE -> consolidated Living refs
  -> deterministic WorkerContext
  -> progressive search only for unresolved context
```

No task is selected by scanning artifact directories or repository history. Transitive dependency closure is derived from direct graph edges; it is not duplicated into task records.
