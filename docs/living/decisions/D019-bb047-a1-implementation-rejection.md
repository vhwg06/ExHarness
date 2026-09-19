# D019 — Reject BB-047 A.1 implementation candidate

Status: **REJECTED**

Rejected: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0006-implementation-review.json
subjectCandidateHeadSha: ebec8b38176c50c7848bdf11693d88fcd3fe05d0
verdict: REJECT
reviewEvidence: 5255764112
```

Exact source-candidate CI run `35443072326` and review-envelope head CI run `35443135140` were green. Rejection is semantic, not CI-derived.

## Blocking findings

1. Work/authority artifacts are not durably resolvable from immutable refs. Fresh processes still require caller-supplied raw OrganizationWorkContract and authority payloads.
2. Authority mutation has no trusted publisher/issuer boundary. Raw CAS mutation can self-grant principal/domain authority.
3. Organization-claim invalidation is not replayable across the Board-transition -> release-fence crash window.
4. Claim/release freshness handshakes do not close authority races after Board claim or release-head publication.

## Required repair properties

The repair generation must:

- persist immutable OrganizationWorkContract and materialization/execution authority artifacts behind content/exact refs and resolve them in a fresh process;
- add trusted publisher boundaries that verify materialization-authorization issuers and execution-authority-policy publishers before advancing current heads;
- make organization invalidation replay/reconciliation idempotent after canonical Board transition, including fresh-process recovery of an unfenced historical release;
- add post-claim authority revalidation with canonical invalidation on staleness;
- add post-release publication revalidation/reconciliation so stale release heads are fenced and cannot remain unreconciled;
- preserve Board-first invalidation ordering and A.1's stop-before-DOMAIN_EXECUTION_CONTROL boundary.

## Authority consequence

Generation 6 remains immutable rejected review history. This decision authorizes only a bounded A.1 repair generation for the four findings above. It does not authorize Integration B, DONE, merge, or terminal Blackboard transition.
