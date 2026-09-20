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
