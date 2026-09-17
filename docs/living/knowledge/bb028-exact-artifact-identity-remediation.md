# BB-028 exact-artifact-identity remediation

Status: **EVIDENCE CANDIDATE — REVIEW REQUIRED**

## Finding being closed

The prior BB-028 anti-laundering probe validated copied summary fields against artifacts retrieved from a hard-coded fixture index. That was insufficient because a resolver slot such as `EVALUATION:qa-eval-v2` could still return an artifact whose stored canonical identity was different.

A resolver lookup key is therefore not identity proof.

## Supplemental executable control

`bb028-exact-artifact-identity-probe.mjs` deliberately keeps a hard-coded lookup slot and adds an independent identity/revision check after lookup.

The validator derives canonical identity from the artifact shape used by the corresponding existing Core boundary:

- evaluation: stored evaluation `id`;
- ActionIntent / Deliberation-style artifacts: canonical `artifactRef` plus stored revision when requested;
- effect operation: stored `operationId`;
- semantic memory: `MEMORY` ref namespace plus the record `id`, semantic subtype and revision.

The probe first verifies five matching baseline cases. It then keeps each requested lookup key unchanged while mutating the returned stored identity or revision.

## Adversarial controls

The following resolver-slot laundering attempts must fail closed:

1. requested evaluation ref, returned evaluation has a different stored `id`;
2. requested ActionIntent revision, returned ActionIntent has a different stored revision;
3. requested MEMORY ref, returned semantic-memory record has a different stored `id`;
4. requested Deliberation ref, returned artifact advertises a different canonical `artifactRef.kind`;
5. requested effect-operation ref, returned effect has a different stored `operationId`.

Measured deterministic result:

```text
baselineCases = 5
baselineAccepted = 5
controlCount = 5
escapedControls = 0
```

The normal Agentic Application test suite executes the probe and deep-compares its output with `artifacts/bb028-exact-artifact-identity-probe.json`, so the evidence cannot silently drift from the executable control.

## Authority

This closes only the exact stored-artifact identity/revision proof gap. It does not make a decision/outcome summary correctness authority, acceptance authority, or evidence of production effectiveness.

D013 remains `PROPOSED` until the required evaluation-method review accepts this exact-head evidence. BB-029 remains blocked until that acceptance occurs.
