# Blackboard development artifacts

Blackboard artifacts are durable work products exchanged by development pipelines. They are not Living Docs, prompts or session transcripts.

## Canonical semantic input

```text
IMPLEMENTATION_INPUT
  = WHAT / WHY / required behavior / invariants / acceptance

WorkContextSpec
  = bounded refs / source scope / verification / authority

Context Materializer
  = executor-specific projection

Executor
  = HOW
```

Canonical `IMPLEMENTATION_INPUT` remains semantic-only. It must not encode preferred edit sequences, commands, prompts, tool calls, implementation plans or executor profiles.

## Implementation lane artifacts

```text
IMPLEMENTATION_INPUT
        |
        v
EXECUTION
        |
        +--> IMPLEMENTATION_RESULT
               candidateRef
               changedSurfaces
               verificationRuns
               observedFacts
               evidenceRefs
               |
               |  no correctness verdict
               v
JUDGMENT
        |
        +--> JUDGMENT
               criterion assessments
               invariant assessments
               findings
               verdict: ACCEPT | FINDINGS
```

### IMPLEMENTATION_RESULT

This is a producer observation artifact. It can state what changed, what was run and what was observed.

It cannot claim `ACCEPT`, `DONE`, correctness, requirement satisfaction or safe-to-merge. The repository schema rejects those authority claims.

### JUDGMENT

This is the independent correctness artifact for an exact candidate. It binds:

- exact work id;
- exact semantic implementation input;
- exact implementation result;
- exact candidate revision;
- exact source baseline;
- exact judgment context.

`ACCEPT` requires every criterion/invariant assessment to be satisfied and zero findings. `FINDINGS` requires concrete typed findings.

A finding is classified as one of:

- `IMPLEMENTATION_FINDING`;
- `EVIDENCE_INSUFFICIENT`;
- `CONTEXT_STALE`;
- `INPUT_CONTRADICTION`.

Only grounded `FINDINGS` can authorize a bounded repair execution.

## Current enforced artifacts

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
