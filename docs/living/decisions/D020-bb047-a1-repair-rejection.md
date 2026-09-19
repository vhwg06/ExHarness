# D020 — Reject BB-047 A.1 repair candidate

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0009-repair-review.json
subjectCandidateHeadSha: 2b71c45ca340f45aee0f61cf3ad7e2f1a5b11cae
verdict: ACCEPT
acceptedAction: REPAIR_REJECTED_CANDIDATE
reviewEvidence: 5255858892
```

Candidate CI `35444428576` and review-head CI `35444596096` were green. The rejection is semantic.

## Closed from D019

- durable WorkContract resolution through exact immutable ref survives restart;
- same-invalidation replay reconciles the Board-first / release-fence crash window.

## Remaining P1 repair scope

1. Authority consumers must authorize only from a current head that references a verified immutable authority artifact; raw CAS head payload is not authority.
2. Claim/release freshness must bind and compare the exact observed authority head revision/generation/artifact ref across each durable mutation.
3. Post-release stale reconciliation must commit canonical Board invalidation before release-head fencing.
4. Materialization/work-authority loss maps to `WORK_AUTHORIZATION_INVALIDATED -> BLOCKED`; execution-policy/principal loss maps to `EXECUTION_AUTHORITY_INVALIDATED -> REOPENED`.

Generation 9 remains immutable rejected review history. This decision authorizes only these four repairs and does not authorize DONE, merge, DOMAIN_EXECUTION_CONTROL, or Integration B.
