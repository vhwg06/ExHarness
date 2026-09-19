# D024 — BB-047 final A.1 acceptance findings repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0015-final-acceptance-review.json
subjectCandidateHeadSha: 692493a215fd2e0e37ef2a50c0ea6abe2af69542
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5256330797
acceptedAction: REPAIR_EXACT_FINDINGS
```

`verdict: ACCEPT` accepts this bounded repair authorization only. The reviewed implementation is not merge-accepted until the repairs receive a fresh clean review.

## Findings to resolve

1. Persist the full accepted ORGANIZATION_WORK_CONTRACT provenance/identity/output/dependency contract.
2. Complete runtime grant/policy pinning: project/root, pinned authority-policy revision, canonical principalRef membership and release provenance.
3. Make stale execution entry commit typed Board invalidation first, then fence the historical release head.
4. Make concurrent identical materializations converge on one logical work identity and deterministic materialization receipt while conflicting same-subject materializations fail closed.
5. Add read-only organization work discovery that resolves exact eligible contracts and filters owningDomain without authentication or mutation.

## Boundary

This is still Integration A.1 only. Repair may modify the existing A.1 application modules/tests/projection already in PR #183. It may not enter DOMAIN_EXECUTION_CONTROL, choose execution strategies, execute role work, or implement product-state authority.

## Evidence

- g0015 review evidence `5256330797`
- candidate CI `35453331740`
- accepted A.1 v7 Sections 5, 7, 8, 12 and 13
