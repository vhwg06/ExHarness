# D026 — BB-047 final authority/recovery race repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0019-policy-revision-review.json
subjectCandidateHeadSha: 7b89e0f4a0e8be05badff7fc91bae161adb76fa3
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5256584644
acceptedAction: REPAIR_EXACT_FINDINGS
```

`verdict: ACCEPT` accepts only this bounded repair authorization.

## Findings to resolve

1. Invalid/inconsistent authority heads must still produce immutable invalidation provenance from exact raw head observations and converge the canonical Board claim to typed BLOCKED/REOPENED before release fencing.
2. release/reconciliation/execution-entry must final re-read the exact canonical Board claim tuple across durable capability boundaries; stale old-generation release capability must fail closed and be fenced without overwriting a newer canonical Board lifecycle.

## Boundary

May modify organization claim controller, focused BB-047 tests, and affected current-system projection only. No DOMAIN_EXECUTION_CONTROL / Integration B authority.

## Evidence

- g0019 review evidence `5256584644`
- candidate CI `35456588137`
