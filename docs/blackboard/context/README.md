# Blackboard work contexts

Status: **CURRENT REPOSITORY CONTEXT ROUTER**

Each active Blackboard work item binds exactly one immutable `WORK_CONTEXT_SPEC` generation through `docs/blackboard/state.md`.

Context answers only what role/action is being executed, which refs must be loaded, what scope/authority applies, what output is expected, and when the context becomes stale.

Context is not current-system truth, a work queue or acceptance authority.

```text
context file exists
  != current

state.md current-context.ref + generation
  = current for that work item
```

Multiple work items may be current simultaneously because currentness is per work item.

BB-046/BB-047 and early BB-048 generations were produced before the `docs/blackboard/*` namespace migration. Their bodies are retained as historical artifacts; old embedded paths are provenance and must not be interpreted as current routing.

New generations use the current namespace and explicit pipeline metadata.
