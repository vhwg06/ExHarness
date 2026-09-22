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
next-work-id: BB-065
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

- BB-052 [WORKER/EXECUTION] — Implement cross-domain obligations and selective semantic invalidation
- BB-059 [RESEARCH_SA/RESEARCH] — Research evidence-gated HOW evolution and Jev evaluation pipeline
- BB-060 [RESEARCH_SA/RESEARCH] — Reconcile Oracle physical ownership and package boundary
- BB-061 [RESEARCH_SA/RESEARCH] — Define Application to Oracle semantic port and dependency direction
- BB-062 [RESEARCH_SA/RESEARCH] — Define concrete Oracle source connectivity and adapter topology
- BB-063 [RESEARCH_SA/RESEARCH] — Preserve Oracle provenance durability and migration compatibility
- BB-064 [RESEARCH_SA/RESEARCH] — Close Oracle reconciliation with end-to-end connectivity and drift guards

## Jev decisions

- BB-052 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-052.readiness-jev-evaluation.json
- BB-053 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, objective-7, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-053.readiness-jev-evaluation.json
- BB-054 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-054.readiness-jev-evaluation.json
- BB-055 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, objective-7, objective-8, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-055.readiness-jev-evaluation.json
- BB-056 [WORKER/SATISFIED]
  satisfied: LANES, READINESS, BINDING, CLAIMS, ROUTING, CACHE, API, CONFIDENCE, DELIVERY, MIGRATION, CI, METRICS
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-056.candidate-jev-evaluation.json
- BB-057 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, objective-7, objective-8, objective-9, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-057.readiness-jev-evaluation.json
- BB-058 [RESEARCH_SA/SATISFIED]
  satisfied: objective-0, objective-1, objective-2, objective-3, objective-4, objective-5, objective-6, objective-7, objective-8, objective-9, readiness-scope, readiness-constraints, readiness-invariants, readiness-acceptanceCriteria, readiness-architectureDecisions, readiness-sourceSeams, readiness-verificationPlan, readiness-implementationSlices
  unresolved: NONE
  evaluation: docs/blackboard/artifacts/ready-implement-plan/BB-058.readiness-jev-evaluation.json

## Dependency graph

```text
BB-048 [DONE] <- ROOT
BB-052 [WORKER_SCHEDULABLE] <- BB-048
BB-053 [BLOCKED_BY BB-052] <- BB-052
BB-054 [BLOCKED_BY BB-053] <- BB-053
BB-055 [BLOCKED_BY BB-054] <- BB-054
BB-056 [DONE] <- ROOT
BB-057 [BLOCKED_BY BB-055] <- BB-055
BB-058 [BLOCKED_BY BB-057] <- BB-057
BB-059 [RESEARCH_SCHEDULABLE] <- BB-058
BB-060 [RESEARCH_SCHEDULABLE] <- ROOT
BB-061 [RESEARCH_SCHEDULABLE] <- BB-060
BB-062 [RESEARCH_SCHEDULABLE] <- BB-061
BB-063 [RESEARCH_SCHEDULABLE] <- BB-062
BB-064 [RESEARCH_SCHEDULABLE] <- BB-060, BB-061, BB-062, BB-063
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
