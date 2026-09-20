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

Purpose: realize one accepted semantic implementation input while separating producer facts from correctness judgment.

```text
ACCEPTED IMPLEMENTATION_INPUT
        |
        v
JUDGMENT / READINESS
        |
        | exact acceptance authority
        v
EXECUTION / INITIAL
  -> inspect / implement / verify
  -> publish candidate facts only
        |
        v
IMPLEMENTATION_RESULT
  != DONE
  != ACCEPT
        |
        v
fresh JUDGMENT / CANDIDATE
  -> independently reconstruct
  -> assess criteria + invariants
        |
        +---- ACCEPT ----> lifecycle/merge continuation
        |
        +---- FINDINGS --> EXECUTION / REPAIR
                              |
                              +-> new IMPLEMENTATION_RESULT
                                   -> fresh JUDGMENT again
```

The semantic implementation input is unchanged across execution, judgment and repair generations.

### EXECUTION lane

Execution owns HOW within exact bounded mutation authority.

It may produce:

- candidate revision;
- changed-surface facts;
- verification-run facts;
- evidence references;
- observed facts.

It must not claim that the candidate is correct, done, accepted or safe to merge.

### JUDGMENT lane

Judgment owns correctness assessment only. It is read-only for product source.

Candidate judgment receives the exact semantic input + exact implementation result + exact candidate + evidence. It does not require Worker reasoning or chat history.

A candidate judgment publishes `ACCEPT` or typed `FINDINGS`. Findings may authorize a bounded repair generation; they do not widen the semantic input.

### Fresh-session bootstrap

`start implement blackboard` and `continue implement blackboard` mean:

```text
state.md
  -> select active IMPLEMENTATION_WORKER item
  -> exact current-context
  -> exact current lane
  -> semanticArtifactRef
  -> materialize for executor profile
  -> execute only that lane authority
```

They do **not** mean "force EXECUTION". If the current lane is `JUDGMENT`, the fresh session performs judgment first.

Repository bootstrap:

```text
npm run start:blackboard-implementation -- GENERIC_INTERACTIVE [WORK_ID]
npm run start:blackboard-implementation -- RICH_CODING_HARNESS [WORK_ID]
npm run start:blackboard-implementation -- WEAK_BOUNDED [WORK_ID]
```

## Fresh-session loading

```text
state.md
  -> workId
  -> pipeline + stage + lane (for IMPLEMENTATION_WORKER)
  -> exact current-context
  -> requiredCurrentSystemRefs
  -> requiredInputRefs
  -> execute
```

Do not load full Board history or all Living Docs by default.

## Concurrent pipeline families

Research/SA and Implementation/Worker may both have active items. Their pipeline concurrency is separate from the internal `EXECUTION` / `JUDGMENT` lane split inside `IMPLEMENTATION_WORKER`. Context currentness is per work item, not global.

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
