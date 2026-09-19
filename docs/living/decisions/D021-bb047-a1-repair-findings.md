# D021 — BB-047 A.1 review findings repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0009-repair-review.json
subjectCandidateHeadSha: 2b71c45ca340f45aee0f61cf3ad7e2f1a5b11cae
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5255858892
acceptedAction: REPAIR_EXACT_FINDINGS
```

`verdict: ACCEPT` accepts this bounded repair authorization only. The implementation candidate is not accepted for merge by this decision; g0009 raised findings that must be repaired and re-reviewed.

## Findings to resolve

1. Authority consumers must authorize from a current pointer head that resolves an exact immutable authority artifact; raw head payload is not sufficient authority.
2. Claim/release freshness must bind exact observed authority head revision, generation, and artifact ref across each durable mutation, including ACTIVE -> ACTIVE drift.
3. Post-release stale reconciliation must commit canonical Blackboard invalidation before release-head fencing.
4. Materialization/work-authority loss maps to `WORK_AUTHORIZATION_INVALIDATED -> BLOCKED`; execution-policy/principal loss maps to `EXECUTION_AUTHORITY_INVALIDATED -> REOPENED`.

## Repair boundary

The repair may change only the A.1 authority/currentness implementation and focused tests/projection necessary to close those findings. It may update the materializer because finding 1 applies to its authority consumption path.

This authorization does not authorize DONE, merge, DOMAIN_EXECUTION_CONTROL, BA execution, ProductStateProjection, or Integration B.

## Evidence

- `docs/living/work-context/BB-047/g0009-repair-review.json`
- review evidence `5255858892`
- candidate CI `35444428576`
- review-head CI `35444596096`
- `docs/living/knowledge/bb046-organizational-integration-implementation-artifact-readiness-v7.md`
- `docs/living/knowledge/bb046-trust-transition-research-v7.md`
