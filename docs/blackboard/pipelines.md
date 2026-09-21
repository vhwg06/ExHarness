# Outer Blackboard pipelines

Status: **CURRENT DEVELOPMENT PIPELINE CONTRACT**

## RESEARCH_SA

```text
explicit problem/question
  -> current context
  -> Researcher
  -> research artifact / evidence
  -> SA synthesis
  -> canonical IMPLEMENTATION_INPUT
```

Research/SA output is implementation input, not delivered system truth.

## IMPLEMENTATION_WORKER

```text
canonical IMPLEMENTATION_INPUT
        +
optional canonical IMPLEMENTATION_SPEC
        |
        v
JUDGMENT / READINESS
        |
        +-> canonical READINESS_DECISION
        |
        v
EXECUTION / INITIAL
        |
        +-> canonical IMPLEMENTATION_RESULT
        |
        v
JUDGMENT / CANDIDATE
        |
        +---- ACCEPT ----> merge / reconcile Living Docs / close
        |
        +---- FINDINGS --> EXECUTION / REPAIR
                              |
                              +-> update IMPLEMENTATION_RESULT
                              +-> update current context to JUDGMENT again
```

The helper context file remains:

`docs/blackboard/context/<WORK_ID>/current.json`

and is overwritten in place as the lane changes.

### Authority flow

```text
current.json
  -> semanticArtifactRef
  -> implementationSpecRef when a canonical worker-ready spec exists
  -> authority.ref / implementationResultRef as needed

READINESS_DECISION
  -> itemId + semanticArtifactRef

IMPLEMENTATION_RESULT
  -> semantic input + candidate + executionAuthorityRef

JUDGMENT
  -> semantic input + implementation result + candidate
```

Context identity is not part of authority.

### Fresh-session bootstrap

```text
state.md
  -> active workId
  -> current-context.ref
  -> exact lane/action
  -> explicit required refs
  -> load IMPLEMENTATION_INPUT + IMPLEMENTATION_SPEC when declared
  -> execute only that lane
```

No prior context generation/history is loaded.

Repository bootstrap:

```text
npm run start:blackboard-implementation -- GENERIC_INTERACTIVE [WORK_ID]
npm run start:blackboard-implementation -- RICH_CODING_HARNESS [WORK_ID]
npm run start:blackboard-implementation -- WEAK_BOUNDED [WORK_ID]
```

## Accepted semantic input queue

Accepted implementation inputs may exist without active work. A semantic input may have one canonical retained `IMPLEMENTATION_SPEC` that preserves worker-ready source seams/slices/negative tests without allocating work. `state.md` names the current queue membership and paired spec when present.

```text
accepted semantic input
  + optional implementation spec
  != active work
  != source mutation authority
  != priority/order
```

Allocation creates/updates one active Board item and one `current.json`; no generation chain is created.
