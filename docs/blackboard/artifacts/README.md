# Blackboard development artifacts

Blackboard artifacts are durable **semantic work products** exchanged between development pipelines. They are not Living Docs, prompts, execution plans or executor-specific context packs.

## Canonical boundary

```text
Blackboard Artifact
  = WHAT / WHY / required behavior / invariants / acceptance

WorkContextSpec
  = bounded refs / source scope / verification / authority

Context Materializer
  = executor-specific projection of that same context

Executor
  = chooses HOW to perform the bounded work
```

A canonical artifact must not encode a preferred file edit sequence, shell commands, model prompt, tool calls, implementation plan or executor profile.

## Implementation input

Canonical `IMPLEMENTATION_INPUT` artifacts are JSON and must pass `scripts/blackboard-artifact-contract.mjs`.

Required semantic content includes stable subject identity, desired outcome/current-state boundary, required behaviors, invariants, acceptance criteria, explicit out-of-scope semantics, affected capabilities/contracts, provenance and acceptance authority.

File paths are permitted only as provenance/current-system references, not as implementation instructions.

## Current enforced type

`IMPLEMENTATION_INPUT` is the accepted semantic handoff consumed by `IMPLEMENTATION_WORKER`.

Research evidence and historical Markdown may remain as provenance, but a new Implementation/Worker context cannot use prose/history as its canonical implementation input.

Current example:

- `implementation-input/BB-048-domain-execution-control-v1.json` — canonical semantic input.
- `implementation-input/BB-048-migrated-readiness.md` — historical migration provenance only.

An accepted artifact does not claim the capability already exists. Living Docs change only when delivered system behavior changes.
