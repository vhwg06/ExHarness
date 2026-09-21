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
next-work-id: BB-057
execution-unit: TASK
context-routing-unit: COMPONENT
worker-ownership: ONE_TASK_PER_CLAIM
current-active-debt: 1
```

## Pipeline lanes

```text
RESEARCH_SA
  active: BB-052

WORKER
  active: NONE
```

## Active work


BB-052
task: Implement cross-domain obligations and selective semantic invalidation
lane: RESEARCH_SA
phase: RESEARCH
current-context: docs/blackboard/context/BB-052/current.json
components: agentic/organization-work, agentic/domain-execution-control, agentic/product-lineage
worker: chatgpt-research-sa

## Schedulable tasks

NONE

## Jev decisions

- BB-056 [WORKER/SATISFIED]
  satisfied: LANES, READINESS, BINDING, CLAIMS, ROUTING, CACHE, API, CONFIDENCE, DELIVERY, MIGRATION, CI, METRICS
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-056.candidate-jev-evaluation.json

## Dependency graph

```text
BB-048 [DONE] <- ROOT
BB-052 [ACTIVE] <- BB-048
BB-053 [BLOCKED_BY BB-052] <- BB-052
BB-054 [BLOCKED_BY BB-053] <- BB-053
BB-055 [BLOCKED_BY BB-054] <- BB-054
BB-056 [DONE] <- ROOT
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
