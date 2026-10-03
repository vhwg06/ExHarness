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
next-work-id: BB-159
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

- BB-066 [WORKER/EXECUTION] — Integrate a real coding-agent execution strategy
- BB-083 [WORKER/EXECUTION] — Research feedback lifecycle and cross-episode learning
- BB-085 [WORKER/EXECUTION] — Implement application-owned feedback episode lifecycle
- BB-094 [WORKER/EXECUTION] — Verify Oracle on supported Core execution profiles
- BB-107 [WORKER/EXECUTION] — Reserve planner work from remaining budget so files that fit the requirement materialize
- BB-121 [RESEARCH_SA/RESEARCH] — Compose supervised agent-tools as durable Backend→QA execution
- BB-123 [WORKER/EXECUTION] — Agent-tools correctness follow-ups: observed-only grok cost and worktree-local grounded-context exclusion
- BB-124 [RESEARCH_SA/RESEARCH] — Preserve truthful partial usage and per-field accounting coverage
- BB-125 [RESEARCH_SA/RESEARCH] — Bind supervised resume to the exact task and execution contract
- BB-127 [RESEARCH_SA/RESEARCH] — Add externally pinned acceptance for local delivery slices
- BB-128 [RESEARCH_SA/RESEARCH] — Expose delivered Grok and OpenCode adapters through operator delivery
- BB-129 [RESEARCH_SA/RESEARCH] — Export a durable review bundle for the exact local candidate
- BB-130 [RESEARCH_SA/RESEARCH] — Constrain local verifier child environment
- BB-131 [RESEARCH_SA/RESEARCH] — Prepare a reproducible repository preview for local feature delivery
- BB-132 [RESEARCH_SA/RESEARCH] — Verify local web feature journeys through an independently pinned browser evaluator
- BB-133 [RESEARCH_SA/RESEARCH] — Verify API compatibility and persisted state for local feature changes
- BB-135 [RESEARCH_SA/RESEARCH] — Expose durable recovery on the operator run command
- BB-136 [RESEARCH_SA/RESEARCH] — Wire observation traces through the local deliver slice
- BB-137 [RESEARCH_SA/RESEARCH] — Opt in delivered MCP verify/status from operator CLI
- BB-138 [WORKER/EXECUTION] — Forward run permission and model options through deliver
- BB-139 [RESEARCH_SA/RESEARCH] — Expose deliver CLI max-attempts and timeout-ms
- BB-140 [WORKER/EXECUTION] — Pin eval permission and timeout factors from the operator CLI
- BB-141 [RESEARCH_SA/RESEARCH] — Forward run model, permission and traces through smoke
- BB-142 [RESEARCH_SA/RESEARCH] — Persist durable recovery through the Application supervised Backend adapter
- BB-143 [RESEARCH_SA/RESEARCH] — Opt in delivered MCP verify/status from the Application adapter
- BB-144 [RESEARCH_SA/RESEARCH] — Expose deliver CLI tool override
- BB-145 [RESEARCH_SA/RESEARCH] — Recovery: re-establish trusted evidence for BB-059 evidence-gated HOW evolution on current main
- BB-146 [RESEARCH_SA/RESEARCH] — Recovery: re-establish trusted evidence for BB-080 async steering, wakeup and recovery on current main
- BB-147 [RESEARCH_SA/RESEARCH] — Recovery: re-establish trusted evidence for BB-081 held-out harness profile acceptance and fault-ablation on current main
- BB-155 [RESEARCH_SA/RESEARCH] — Build Blackboard V2 control plane
- BB-156 [RESEARCH_SA/RESEARCH] — Migrate unfinished work to Blackboard V2 and cut over
- BB-157 [RESEARCH_SA/RESEARCH] — Add JEV supervisory lookback and anti-spam loop to Blackboard V2
- BB-158 [RESEARCH_SA/RESEARCH] — Refactor CI into an agent-native delivery feedback plane

## Dependency graph

```text
BB-048 [DONE] <- ROOT
BB-052 [DONE] <- BB-048
BB-053 [DONE] <- BB-052
BB-054 [DONE] <- BB-053
BB-055 [DONE] <- BB-054
BB-056 [DONE] <- ROOT
BB-057 [DONE] <- BB-055
BB-058 [DONE] <- BB-057
BB-059 [DONE] <- BB-058
BB-060 [DONE] <- ROOT
BB-061 [DONE] <- BB-060
BB-062 [DONE] <- BB-061
BB-063 [DONE] <- BB-062
BB-064 [DONE] <- BB-060, BB-061, BB-062, BB-063
BB-065 [DONE] <- ROOT
BB-066 [WORKER_SCHEDULABLE] <- BB-065, BB-048, BB-081
BB-067 [BLOCKED_BY BB-066] <- BB-065, BB-066
BB-068 [BLOCKED_BY BB-066,BB-067] <- BB-066, BB-067
BB-069 [BLOCKED_BY BB-068] <- BB-068, BB-064
BB-070 [BLOCKED_BY BB-069] <- BB-069, BB-055
BB-071 [BLOCKED_BY BB-070] <- BB-070, BB-057
BB-072 [BLOCKED_BY BB-068] <- BB-068, BB-058
BB-073 [BLOCKED_BY BB-070,BB-072] <- BB-070, BB-072
BB-074 [BLOCKED_BY BB-071,BB-073] <- BB-065, BB-071, BB-073, BB-077, BB-081
BB-075 [BLOCKED_BY BB-074] <- BB-074, BB-059
BB-076 [BLOCKED_BY BB-074,BB-075] <- BB-074, BB-075
BB-077 [DONE] <- BB-065
BB-078 [DONE] <- BB-077
BB-079 [DONE] <- BB-077, BB-078
BB-080 [DONE] <- BB-078, BB-079
BB-081 [DONE] <- BB-077, BB-078, BB-079, BB-080
BB-082 [DONE] <- ROOT
BB-083 [WORKER_SCHEDULABLE] <- BB-059, BB-064, BB-065
BB-084 [DONE] <- BB-058, BB-064
BB-085 [WORKER_SCHEDULABLE] <- BB-084
BB-086 [BLOCKED_BY BB-085] <- BB-085, BB-059, BB-065
BB-087 [DONE] <- BB-064
BB-088 [DONE] <- BB-087
BB-089 [DONE] <- BB-087
BB-090 [DONE] <- BB-056
BB-091 [DONE] <- BB-088
BB-092 [DONE] <- BB-091
BB-093 [DONE] <- BB-092
BB-094 [WORKER_SCHEDULABLE] <- BB-093, BB-081
BB-095 [BLOCKED_BY BB-094] <- BB-094, BB-065
BB-096 [DONE] <- ROOT
BB-097 [DONE] <- BB-096
BB-098 [DONE] <- BB-097
BB-099 [DONE] <- BB-098, BB-065
BB-100 [DONE] <- BB-096, BB-097
BB-101 [DONE] <- BB-097
BB-102 [DONE] <- BB-097
BB-103 [DONE] <- BB-097
BB-104 [DONE] <- BB-100, BB-101, BB-102
BB-105 [DONE] <- BB-097, BB-098
BB-106 [DONE] <- BB-082, BB-087, BB-088
BB-107 [WORKER_SCHEDULABLE] <- BB-087, BB-088, BB-089
BB-108 [DONE] <- BB-087, BB-088
BB-120 [PLANNED] <- BB-097
BB-121 [RESEARCH_SCHEDULABLE] <- BB-100, BB-101, BB-120
BB-122 [DONE] <- BB-097, BB-098
BB-123 [WORKER_SCHEDULABLE] <- BB-105, BB-102
BB-124 [RESEARCH_SCHEDULABLE] <- BB-098, BB-105, BB-123
BB-125 [RESEARCH_SCHEDULABLE] <- BB-101
BB-126 [BLOCKED_BY BB-125] <- BB-125
BB-127 [RESEARCH_SCHEDULABLE] <- BB-104, BB-130, BB-125
BB-128 [RESEARCH_SCHEDULABLE] <- BB-104, BB-122
BB-129 [RESEARCH_SCHEDULABLE] <- BB-127
BB-130 [RESEARCH_SCHEDULABLE] <- BB-096, BB-120
BB-131 [RESEARCH_SCHEDULABLE] <- BB-104, BB-130
BB-132 [RESEARCH_SCHEDULABLE] <- BB-054, BB-131, BB-127
BB-133 [RESEARCH_SCHEDULABLE] <- BB-054, BB-131, BB-127
BB-134 [DONE] <- BB-056
BB-135 [RESEARCH_SCHEDULABLE] <- BB-101
BB-136 [RESEARCH_SCHEDULABLE] <- BB-098, BB-104
BB-137 [RESEARCH_SCHEDULABLE] <- BB-103, BB-104
BB-138 [WORKER_SCHEDULABLE] <- BB-104
BB-139 [RESEARCH_SCHEDULABLE] <- BB-104
BB-140 [WORKER_SCHEDULABLE] <- BB-099
BB-141 [RESEARCH_SCHEDULABLE] <- BB-097, BB-098
BB-142 [RESEARCH_SCHEDULABLE] <- BB-100, BB-101
BB-143 [RESEARCH_SCHEDULABLE] <- BB-100, BB-103
BB-144 [RESEARCH_SCHEDULABLE] <- BB-104
BB-145 [RESEARCH_SCHEDULABLE] <- BB-058
BB-146 [RESEARCH_SCHEDULABLE] <- BB-077, BB-078, BB-079
BB-147 [RESEARCH_SCHEDULABLE] <- BB-077, BB-078, BB-079
BB-148 [BLOCKED] <- BB-059, BB-064, BB-065
BB-149 [BLOCKED] <- BB-084
BB-150 [BLOCKED] <- BB-097
BB-151 [BLOCKED] <- BB-105, BB-102
BB-152 [BLOCKED] <- BB-056
BB-153 [BLOCKED] <- BB-056, BB-059
BB-154 [BLOCKED] <- BB-056
BB-155 [RESEARCH_SCHEDULABLE] <- BB-056
BB-156 [RESEARCH_SCHEDULABLE] <- BB-155
BB-157 [RESEARCH_SCHEDULABLE] <- BB-155
BB-158 [RESEARCH_SCHEDULABLE] <- BB-155, BB-157
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
