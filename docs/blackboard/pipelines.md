# Outer Blackboard pipelines

Status: **CURRENT TASK-GRAPH DELIVERY CONTRACT**

## Planning topology

```text
Topic
  -> Feature | Bug
     -> Task
        -> direct Task dependencies
        -> components[]
        -> explicit artifacts
```

Task is the only schedulable/claimable unit. Component is used only to route context.

## RESEARCH_SA

```text
problem / question
  -> bounded Research Task
  -> research evidence
  -> SA synthesis
  -> canonical IMPLEMENTATION_INPUT
  -> optional canonical IMPLEMENTATION_SPEC
  -> attach artifacts to target implementation Task
```

Research/SA output is implementation input, not delivered system truth and not source mutation authority.

## Task readiness

Readiness is derived from direct graph dependencies.

```text
Task PLANNED
  |
  +-- every direct dependency DONE
  |      -> schedulable
  |
  +-- any direct dependency non-DONE
         -> blocked
```

No task becomes ready because its filename appears later in a queue.

## Context resolution

```text
Task
  |
  +-> Topic / Feature artifacts
  |
  +-> components[]
  |      -> Component Context Profiles
  |           -> current Living refs
  |           -> source/test roots
  |           -> contracts
  |           -> bounded search roots
  |
  +-> task IMPLEMENTATION_INPUT
  +-> task IMPLEMENTATION_SPEC
  |
  +-> direct dependencies
         DONE -> dependency consolidatedRefs
  |
  v
derived TaskContext
  -> current.json only when Task becomes ACTIVE
```

The deterministic seed is loaded before any search. Progressive grep/search is allowed only for unresolved context and only under the declared search roots.

## IMPLEMENTATION_WORKER

```text
schedulable Task
  -> JUDGMENT / READINESS
       context = graph-derived TaskContext
       executionSourceScope = graph/components/spec-derived
  -> READINESS_DECISION
  -> Task ACTIVE / one worker claim
  -> EXECUTION / INITIAL
       reuse executionSourceScope
  -> IMPLEMENTATION_RESULT
  -> JUDGMENT / CANDIDATE
       |
       +-- ACCEPT
       |    -> merge
       |    -> reconcile Task outputs
       |    -> Feature/Topic consolidation
       |    -> Living Docs
       |    -> Task DONE
       |
       +-- FINDINGS
            -> EXECUTION / REPAIR
            -> update IMPLEMENTATION_RESULT
            -> fresh candidate judgment
```

A Task may touch many Components. It still has one execution claim.

## Dependency context after completion

```text
producer Task ACTIVE
  -> consumer cannot execute

producer Task DONE
  -> consumer context loads producer.consolidatedRefs
  -> normally Living/current system truth

producer implementation result/judgment
  -> retained delivery evidence
  -> not default dependency context
```

This prevents future workers from reconstructing current truth from delivery transcript.

## current.json lifecycle

```text
canonical graph/catalog/artifacts
        |
        v
context resolver
        |
        v
context/<TASK_ID>/current.json

READINESS -> EXECUTION -> CANDIDATE JUDGMENT -> REPAIR?
        update same file in place

Task DONE
        remove current.json
```

No generation chain or history traversal exists.

## Worker bootstrap

```text
work-graph.json
  -> ACTIVE Task
  -> task.currentContextRef
  -> verify projection still contains graph-derived refs/components/dependencies
  -> materialize profile
  -> execute declared lane
```

Repository commands:

```text
npm run verify:blackboard-work-graph
npm run resolve:blackboard-task-context -- BB-052
npm run start:blackboard-implementation -- GENERIC_INTERACTIVE [TASK_ID]
```

The internal Agentic Application Blackboard is out of scope for this outer development pipeline. It may adopt this model later only after the outer pipeline produces useful evidence.
