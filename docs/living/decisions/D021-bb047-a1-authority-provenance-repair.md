# D021 — Authorize BB-047 A.1 authority-provenance repair

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0011-repair-review.json
subjectCandidateHeadSha: 1e5cc2297322f7b2da7e21a6a874cf776d325dcc
reviewHeadSha: d647903b56312fa9ec3bfbea1c73f98561aec2f5
reviewVerdict: REJECT
reviewEvidence: 5256017957
acceptedAction: REIMPLEMENT_D020_REPAIR_WITH_VALID_PROVENANCE
```

The reviewed source semantics contain the intended D020 repairs, but the candidate is rejected because its authority provenance is invalid. D020 remains rejected history and g0010 remains malformed history; neither may be edited into authority.

## Authorized repair

A new implementation generation may re-apply the four D020 semantic repairs from the last valid pre-implementation baseline, with authority established before source mutation.

The write scope explicitly includes `packages/agentic-system/src/organization-work.js`, because immutable materialization-authority resolution crosses that boundary.

No source commit from the rejected #166 candidate is accepted by this decision merely because its code is semantically useful. The new candidate must independently reproduce the authorized changes after this decision and its implementation generation exist.

## Boundary

This decision does not authorize DONE, merge, terminal BB-047 transition, DOMAIN_EXECUTION_CONTROL, or Integration B.
