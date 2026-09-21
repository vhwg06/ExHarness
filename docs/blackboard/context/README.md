# Blackboard current task contexts

Status: **REBUILDABLE TASK CONTEXT PROJECTION**

Each ACTIVE outer-Blackboard Task has at most one canonical helper context:

`docs/blackboard/context/<TASK_ID>/current.json`

The canonical task identity, direct dependencies, components and artifact refs live in `../work-graph.json`. Component context-routing metadata lives in `../component-registry.json`.

The base context is derived in this order:

```text
Task
  -> Topic / Feature
  -> components[]
  -> Component Context Profiles
  -> task artifacts
  -> direct dependencies
       DONE -> consolidated Living refs
  -> deterministic current context
```

The file may then carry the current implementation lane/authority/result refs while work moves through readiness, execution, candidate judgment and repair.

A valid context must preserve all graph-derived refs/components/dependency context. Lane transitions may add exact authority/result refs; they may not drop the deterministic seed.

`current.json` is not authority, planning state, historical record or a context-discovery database. If deleted, its base semantic context must be reconstructable from the graph, component registry and explicit artifacts.

Repository-wide grep/search is not default context resolution. Progressive search is allowed only when deterministic context is insufficient and only under the component-declared search roots.

There are no `generation`, `parentContextRef`, `staleWhen` or `auditRefs` fields. Previous file revisions exist only in Git history and are not consumed by fresh workers.
