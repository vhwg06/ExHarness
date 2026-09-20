# Blackboard current contexts

Status: **HELPFUL CURRENT CONTEXT ONLY**

Each active Blackboard work item may have exactly one context file:

`docs/blackboard/context/<WORK_ID>/current.json`

The Board binds it with:

```text
current-context:
  ref: docs/blackboard/context/<WORK_ID>/current.json
```

The context answers only:

- what action/lane is current;
- which semantic/authority/result refs are needed;
- which current-system/input refs must be loaded;
- what source scope applies;
- what verification/output is expected.

It is updated in place as work moves between readiness, execution, judgment and repair.

There are no `generation`, `parentContextRef`, `staleWhen` or `auditRefs` fields. Previous context revisions live only in Git history.

Context is not authority. Readiness decisions, implementation results and judgments bind the semantic work/candidate subjects directly.
