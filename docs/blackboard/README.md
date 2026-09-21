# Outer Blackboard

Status: **TYPED WORK GRAPH + EXPLICIT CONTEXT ROUTER**

This directory governs development of ExHarness itself. It is the **outer Blackboard** only; the Blackboard implemented inside the Agentic Application is a separate product/runtime concern and is not changed by this architecture.

Current delivered system truth remains under `docs/living/`.

## Canonical model

```text
work-graph.json
  Topic
    -> Feature | Bug
       -> Task
          -> direct Task dependencies
          -> components[]
          -> artifacts
          -> one current claim when ACTIVE

component-registry.json
  Component
    -> contextOwner
    -> current-system refs
    -> source/test roots
    -> contract refs
    -> progressive search roots

state.md
  = derived human routing projection

context/<TASK_ID>/current.json
  = rebuildable TaskContext projection
  != planning SoT
  != authority
  != history
```

## Semantic units

```text
Topic
  = delivery/consolidation boundary

Feature | Bug
  = bounded problem/capability grouping

Task
  = scheduling + claim + execution unit
  = owns direct dependencies and produced artifacts

Component
  = context-routing unit
  != worker
  != execution owner
  != authorization authority

Worker
  = temporary owner of exactly one ACTIVE Task claim
```

A cross-component task still has one execution owner.

## Dependency semantics

Tasks declare only **direct** dependencies. Transitive closure is derived by the graph; it is not copied into every task.

```text
Task A -> Task B
```

means B cannot become schedulable until the exact direct dependency required by B is terminal/current according to the graph.

For context resolution:

```text
direct dependency ACTIVE/non-DONE
  -> blocks execution context

direct dependency DONE
  -> load dependency consolidatedRefs from Living/current system truth
  -> do not load old implementation transcript by default
```

Task dependency, component dependency and artifact derivation are different semantics and must not be collapsed into one generic edge type.

## Deterministic task context

Default discovery is no longer repository-wide grep.

```text
Task
  -> Topic / Feature
  -> components[]
  -> Component Registry / Context Profiles
  -> task IMPLEMENTATION_INPUT + IMPLEMENTATION_SPEC
  -> direct dependencies
       DONE -> consolidated Living refs
  -> exact source/test/contract scope
  -> WorkerContext<Task>
```

Only after this deterministic seed is loaded may the worker use bounded progressive search for unresolved context.

```text
task
  -> deterministic context
  -> work

unresolved context only
  -> progressive search under declared roots
```

## Context projection invariant

`current.json` is derived state.

A valid implementation must satisfy:

```text
delete current.json
  -> Task + work graph + component registry + explicit artifacts
  -> resolver can reconstruct the semantic context seed
```

The context file is updated in place as execution moves through readiness, execution, candidate judgment and repair. There is no generation chain, parent context chain, stale marker or audit-ref traversal.

## Artifact flow

```text
Worker
  -> Task artifacts
  -> Feature/Bug aggregation
  -> Topic consolidation
  -> Living Docs
```

Delivery evidence may remain as canonical Blackboard artifacts, but future task context does not load terminal implementation transcripts by default. Once a dependency is consolidated, its current semantic truth comes from Living Docs.

## Layout

- `work-graph.json` — canonical outer planning/execution graph;
- `component-registry.json` — canonical component-to-context routing catalog;
- `state.md` — generated routing projection;
- `contracts.md` — graph/context/authority invariants;
- `pipelines.md` — Research/SA and implementation flow;
- `context/<TASK_ID>/current.json` — active task projection only;
- `artifacts/` — semantic input/spec/result/judgment delivery artifacts;
- `process/` — verification process references.

Git is revision history. It is not a context source that a fresh worker must reconstruct.
