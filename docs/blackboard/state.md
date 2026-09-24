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
next-work-id: BB-077
execution-unit: TASK
context-routing-unit: COMPONENT
worker-ownership: ONE_TASK_PER_CLAIM
current-active-debt: 1
```

## Pipeline lanes

```text
RESEARCH_SA
  active: BB-064

WORKER
  active: NONE
```

## Active work


BB-064
task: Close Oracle reconciliation with end-to-end connectivity and drift guards
lane: RESEARCH_SA
phase: RESEARCH
current-context: docs/blackboard/context/BB-064/current.json
components: oracle/infrastructure, outer/blackboard
worker: codex-research-bb064

## Schedulable tasks

- BB-052 [WORKER/EXECUTION] — Implement cross-domain obligations and selective semantic invalidation
- BB-059 [RESEARCH_SA/RESEARCH] — Research evidence-gated HOW evolution and Jev evaluation pipeline
- BB-060 [WORKER/EXECUTION] — Reconcile Oracle physical ownership and package boundary
- BB-065 [WORKER/EXECUTION] — Define delivery profile and executable value baseline
- BB-068 [RESEARCH_SA/RESEARCH] — Connect real repository changes to CI and review evidence
- BB-069 [RESEARCH_SA/RESEARCH] — Prove first useful agent delivery through Oracle and independent QA
- BB-070 [RESEARCH_SA/RESEARCH] — Deliver product from goal and partial artifacts across owned domains
- BB-071 [RESEARCH_SA/RESEARCH] — Prove requirement change and failure recovery on a live product
- BB-072 [RESEARCH_SA/RESEARCH] — Make delivery runs observable recoverable and cost bounded
- BB-073 [RESEARCH_SA/RESEARCH] — Ship an installable supported delivery profile
- BB-074 [RESEARCH_SA/RESEARCH] — Measure real delivery value against direct-agent baseline
- BB-075 [RESEARCH_SA/RESEARCH] — Validate one useful HOW improvement on held-out delivery tasks
- BB-076 [RESEARCH_SA/RESEARCH] — Accept supported product release with independently reproducible value

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
BB-060 [WORKER_SCHEDULABLE] <- ROOT
BB-061 [BLOCKED_BY BB-060] <- BB-060
BB-062 [BLOCKED_BY BB-061] <- BB-061
BB-063 [BLOCKED_BY BB-062] <- BB-062
BB-064 [ACTIVE] <- BB-060, BB-061, BB-062, BB-063
BB-065 [WORKER_SCHEDULABLE] <- ROOT
BB-066 [BLOCKED_BY BB-065] <- BB-065, BB-048
BB-067 [BLOCKED_BY BB-065,BB-066] <- BB-065, BB-066
BB-068 [RESEARCH_SCHEDULABLE] <- BB-066, BB-067
BB-069 [RESEARCH_SCHEDULABLE] <- BB-068, BB-064
BB-070 [RESEARCH_SCHEDULABLE] <- BB-069, BB-055
BB-071 [RESEARCH_SCHEDULABLE] <- BB-070, BB-057
BB-072 [RESEARCH_SCHEDULABLE] <- BB-068, BB-058
BB-073 [RESEARCH_SCHEDULABLE] <- BB-070, BB-072
BB-074 [RESEARCH_SCHEDULABLE] <- BB-071, BB-073
BB-075 [RESEARCH_SCHEDULABLE] <- BB-074, BB-059
BB-076 [RESEARCH_SCHEDULABLE] <- BB-074, BB-075
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
