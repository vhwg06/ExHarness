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


## Accepted implementation-input queue

Research/SA may complete semantic compilation before Implementation/Worker work is allocated.

```text
ACCEPTED IMPLEMENTATION_INPUT
  -> may remain queued here
  -> no active Blackboard item required
  -> no work id consumed
  -> no source mutation authority
  -> later grounded trigger binds the exact artifact into a new IMPLEMENTATION_WORKER item/context
```

The queue is an inventory of accepted semantic handoffs, **not backlog**. Current work still comes only from `docs/blackboard/state.md`.

Accepted unallocated inputs:

- `implementation-input/integration-c-cross-domain-obligation-lineage-v1.json` — typed cross-domain obligations, authoritative semantic lineage and selective invalidation.
- `implementation-input/integration-d-domain-activation-parallel-autonomy-v1.json` — domain-local activation and FE/BE parallel autonomy.
- `implementation-input/integration-ef-deployment-acceptance-snapshot-v1.json` — exact deployment identity, AcceptanceSnapshot, runtime observation and Product QA trust.

Allocated/in-flight input:

- `implementation-input/BB-048-domain-execution-control-v1.json` — bound by active BB-048.
