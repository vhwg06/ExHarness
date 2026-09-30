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
next-work-id: BB-106
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
- BB-091 [WORKER/EXECUTION] — Research and ablate retrieval planner strategies
- BB-100 [WORKER/EXECUTION] — Compose supervised agent-tools as an opt-in Backend adapter
- BB-101 [WORKER/EXECUTION] — Resume a supervised agent-tool run after process death
- BB-102 [WORKER/EXECUTION] — Resolve declared agent-tool files through the Oracle facade
- BB-103 [RESEARCH_SA/RESEARCH] — Expose verification and status as stdio MCP tools
- BB-104 [RESEARCH_SA/RESEARCH] — Run one local Backend-then-QA slice from an operator CLI
- BB-105 [RESEARCH_SA/RESEARCH] — Add Grok Build as a supported agent tool

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
BB-065 [PLANNED] <- ROOT
BB-066 [BLOCKED_BY BB-065,BB-081] <- BB-065, BB-048, BB-081
BB-067 [BLOCKED_BY BB-065,BB-066] <- BB-065, BB-066
BB-068 [BLOCKED_BY BB-066,BB-067] <- BB-066, BB-067
BB-069 [BLOCKED_BY BB-068] <- BB-068, BB-064
BB-070 [BLOCKED_BY BB-069,BB-055] <- BB-069, BB-055
BB-071 [BLOCKED_BY BB-070,BB-057] <- BB-070, BB-057
BB-072 [BLOCKED_BY BB-068,BB-058] <- BB-068, BB-058
BB-073 [BLOCKED_BY BB-070,BB-072] <- BB-070, BB-072
BB-074 [BLOCKED_BY BB-065,BB-071,BB-073,BB-077,BB-081] <- BB-065, BB-071, BB-073, BB-077, BB-081
BB-075 [BLOCKED_BY BB-074,BB-059] <- BB-074, BB-059
BB-076 [BLOCKED_BY BB-074,BB-075] <- BB-074, BB-075
BB-077 [BLOCKED_BY BB-065] <- BB-065
BB-078 [BLOCKED_BY BB-077] <- BB-077
BB-079 [BLOCKED_BY BB-077,BB-078] <- BB-077, BB-078
BB-080 [BLOCKED_BY BB-078,BB-079] <- BB-078, BB-079
BB-081 [BLOCKED_BY BB-077,BB-078,BB-079,BB-080] <- BB-077, BB-078, BB-079, BB-080
BB-082 [DONE] <- ROOT
BB-083 [BLOCKED_BY BB-059,BB-065] <- BB-059, BB-064, BB-065
BB-084 [BLOCKED_BY BB-058] <- BB-058, BB-064
BB-085 [BLOCKED_BY BB-084] <- BB-084
BB-086 [BLOCKED_BY BB-085,BB-059,BB-065] <- BB-085, BB-059, BB-065
BB-087 [DONE] <- BB-064
BB-088 [DONE] <- BB-087
BB-089 [DONE] <- BB-087
BB-090 [DONE] <- BB-056
BB-091 [WORKER_SCHEDULABLE] <- BB-088
BB-092 [BLOCKED_BY BB-091] <- BB-091
BB-093 [BLOCKED_BY BB-092] <- BB-092
BB-094 [BLOCKED_BY BB-093,BB-081] <- BB-093, BB-081
BB-095 [BLOCKED_BY BB-094,BB-065] <- BB-094, BB-065
BB-096 [DONE] <- ROOT
BB-097 [DONE] <- BB-096
BB-098 [DONE] <- BB-097
BB-099 [BLOCKED_BY BB-065] <- BB-098, BB-065
BB-100 [WORKER_SCHEDULABLE] <- BB-096, BB-097
BB-101 [WORKER_SCHEDULABLE] <- BB-097
BB-102 [WORKER_SCHEDULABLE] <- BB-097
BB-103 [RESEARCH_SCHEDULABLE] <- BB-097
BB-104 [RESEARCH_SCHEDULABLE] <- BB-100, BB-101, BB-102
BB-105 [RESEARCH_SCHEDULABLE] <- BB-097, BB-098
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
