# Outer Blackboard pipelines

Status: **CURRENT DEVELOPMENT PIPELINE CONTRACT**

## Pipeline 1 — RESEARCH_SA

Purpose: turn an explicit problem/question into a bounded implementation input.

```text
Blackboard work item
  pipeline: RESEARCH_SA
        |
        v
Research context
  -> exact problem/objective
  -> selected Living Docs refs
  -> existing evidence/input refs
  -> explicit questions
  -> expected ResearchArtifact
        |
        v
Researcher
        |
        v
ResearchArtifact
        |
        v
SA context
  -> ResearchArtifact
  -> selected current-system truth
  -> architecture constraints / decisions
  -> explicit output contract
        |
        v
SA synthesis / review
        |
        v
ACCEPTED IMPLEMENTATION_INPUT
```

Normal outputs live under `docs/blackboard/artifacts/`. Research/SA output is development input; it does not make an undelivered capability appear in Living Docs.

## Pipeline 2 — IMPLEMENTATION_WORKER

Purpose: realize one accepted implementation input against a bounded current-system baseline.

```text
ACCEPTED IMPLEMENTATION_INPUT
        |
        v
Implementation context
  -> exact input artifact
  -> selected Living Docs refs
  -> bounded source/test scope
  -> invariants
  -> verification contract
        |
        v
Worker
  -> implement
  -> test
  -> produce implementation result
        |
        v
independent review / repair
        |
        v
merge
        |
        +-> if current system semantics changed
              reconcile docs/living/system/*
```

Worker may raise a grounded architecture/specification gap, but must not silently invent a new design. That creates/returns Research/SA work.

## Fresh-session loading

```text
state.md
  -> workId
  -> pipeline + stage
  -> exact current-context
  -> requiredCurrentSystemRefs
  -> requiredInputRefs
  -> execute
```

Do not load full Board history or all Living Docs by default.

## Concurrent lanes

Research/SA and Implementation/Worker may both have active items. Context currentness is per work item, not global.

The repository verifier therefore validates every active work item when no explicit item is requested, or validates only `BLACKBOARD_CONTEXT_ITEM` when explicitly selected.

## Research -> implementation boundary

For newly allocated work after this migration:

```text
ResearchArtifact
  -> SA synthesis/review
  -> IMPLEMENTATION_INPUT: ACCEPTED
  -> Implementation/Worker allocation
```

`IMPLEMENTATION_INPUT` conveys the semantic change that should be realized. It is not an implementation plan and not implementation permission by itself; repository implementation authority still requires the exact current implementation context/review decision.

BB-048 predates this split. `artifacts/implementation-input/BB-048-migrated-readiness.md` makes its existing promoted readiness inputs explicit without rewriting Living Docs history.

## Semantic artifact -> execution context

The implementation pipeline preserves this separation:

```text
accepted semantic IMPLEMENTATION_INPUT
        |
        | immutable meaning
        v
WORK_CONTEXT_SPEC
  + current-system refs
  + source/read/write bounds
  + verification contract
        |
        v
Context Materializer(profile)
        |
        +-- RICH_CODING_HARNESS
        |     minimal refs + self-directed exploration within scope
        |
        +-- GENERIC_INTERACTIVE
        |     resolved bounded refs + explicit scope
        |
        +-- WEAK_BOUNDED
              explicit bounded execution projection
```

All profiles receive the exact same semantic artifact. Profile choice changes context presentation only; it cannot add, remove or reinterpret required behavior, invariants or acceptance criteria.

Repository usage:

```text
npm run materialize:blackboard-context -- <context-spec.json> RICH_CODING_HARNESS
npm run materialize:blackboard-context -- <context-spec.json> GENERIC_INTERACTIVE
npm run materialize:blackboard-context -- <context-spec.json> WEAK_BOUNDED
```

For ChatGPT Web/fresh interactive sessions, `GENERIC_INTERACTIVE` is the normal shape. Rich repo-native coding harnesses may use `RICH_CODING_HARNESS`. Smaller/less capable executors should use `WEAK_BOUNDED`.
