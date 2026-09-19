# D025 — BB-047 execution-policy revision pin repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0017-final-merge-review.json
subjectCandidateHeadSha: 630f9ae9eccb352148ea8c3246a7efd1c9c0442e
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5256568229
acceptedAction: REPAIR_EXACT_FINDING
```

`verdict: ACCEPT` accepts only this bounded repair authorization.

## Finding to resolve

Require the current immutable EXECUTION_AUTHORITY_POLICY to carry the exact `authorityPolicyRevision` pinned by the immutable ORGANIZATION_WORK_CONTRACT/materialization grant. A mismatched ACTIVE execution policy must fail closed as execution-authority invalidity and cannot authorize claim/release.

## Boundary

May modify organization claim authority validation, focused BB-047 tests, and affected worktree projection only. No DOMAIN_EXECUTION_CONTROL / Integration B authority.

## Evidence

- g0017 review evidence `5256568229`
- candidate CI `35453877620`
