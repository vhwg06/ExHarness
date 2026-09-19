# Living documentation router

ExHarness separates **current system truth** from **open work**.

## First read for any non-trivial work

1. `blackboard.md` — identify the unresolved/eligible item.
2. When that item has `current-context`, load that exact immutable `WORK_CONTEXT_SPEC`; do not infer another generation from artifact existence.
3. Resolve only its declared required current-system/input refs. `auditRefs` stay lazy and non-authoritative.
4. Inspect source/tests whenever implementation detail matters.
5. After source changes, update the relevant worktree docs and write the Board result back.

For an item without the migrated context binding, use the legacy bounded route: Board -> smallest relevant worktree docs -> source/tests. Runtime JSON Blackboard does not consume this repository context plane.

## Three distinct surfaces

```text
../worktree/*
    = source-synchronized current-system truth

blackboard.md
    = lifecycle / gaps / blockers / exact current-context pointer

work-context/<item>/gNNNN-*.json
    = immutable safe-next-action context for one Board generation
    = not source truth, acceptance authority or a second queue
```

A stale/old context remains history but is not permission for new durable work.

## Durable knowledge

- `knowledge/evidence.md` — observations with provenance.
- `knowledge/judgment.md` — conclusions derived from evidence.
- `knowledge/audit.md` — independent challenge.
- `decisions/` — accepted/promoted choices.
- `architecture.md` / `contracts.md` / `pipelines.md` — documentation/knowledge-system invariants.

These do not replace the Board or current-system source.

## Routing

```text
What should I work on?
    -> blackboard.md
    -> exact current-context when present

What is safe/authorized for this repository work generation?
    -> current WORK_CONTEXT_SPEC
    -> exact accepted decision when action=IMPLEMENT

What does the system currently do?
    -> ../worktree/state.md
    -> smallest relevant child
    -> source/tests when needed

Why do we believe a claim?
    -> knowledge/evidence.md
    -> knowledge/judgment.md
```
