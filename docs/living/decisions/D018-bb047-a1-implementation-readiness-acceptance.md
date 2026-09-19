# D018 — Accept BB-047 Integration A.1 implementation readiness

Status: **ACCEPTED**

Accepted: 2026-09-19

Acceptance boundary: fresh review of BB-047 generation 4 on exact PR #156 head `662a2a21511cca6c7ad55ddee23db8251ae52ecd`, with immutable implementation-readiness candidate `3a109db42befb9e0e207038a9c349048e602c461`.

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0004-implementation-readiness-review.json
subjectCandidateHeadSha: 3a109db42befb9e0e207038a9c349048e602c461
verdict: ACCEPT
```

Review evidence: PR #156 review `5255704166`; CI run `35442462874` completed successfully across living-doc-impact and Node 20/22/24.

## Choice

Authorize the next bounded Integration A.1 source implementation context.

The implementation may deliver only the accepted trust/organization bridge through released/authorized organizational claim semantics:

- immutable `ORGANIZATION_WORK_CONTRACT`;
- exact accepted obligation -> deterministic materialization boundary;
- trusted execution principal -> authorized domain mapping;
- durable/current execution-authority policy head;
- materialization authorization currentness;
- Board claim generation fencing;
- durable `CLAIM_RELEASE_RECEIPT` / `ClaimReleaseHead`;
- canonical organization-claim recovery/invalidation semantics;
- focused bridge fixture that stops before domain-local execution/HOW resolution.

## Hard boundary

This acceptance does **not** authorize:

- `DOMAIN_EXECUTION_CONTROL` or Integration B source implementation;
- ExecutionPolicy / ExecutionStrategy selection;
- BA requirement-analysis execution;
- ProductStateProjection;
- cross-domain dispatch hidden inside a strategy;
- widening `packages/core-harness/**` or Oracle authority;
- treating Board `CLAIMED` as executable capability;
- treating `ClaimReleaseHead.FENCED` as a Blackboard lifecycle transition.

## Required safety properties

Implementation must fail closed when:

- principal is not authorized for the work contract owning domain;
- materialization obligation is outside the exact accepted authorization scope;
- execution-authority/materialization-authority head is stale or revoked;
- claim generation is stale;
- release receipt/head does not match the exact current claim subject;
- duplicate release conflicts instead of converging on the same receipt;
- organization claim invalidation races with recovery/reclaim.

Canonical lifecycle invalidation must commit the Board consequence before release-head fencing. A crash between those steps remains safe because execution entry rechecks the exact Board claim tuple.

## Source authorization

The child IMPLEMENT context must carry an exact write scope limited to A.1 application-domain modules/tests, current-system projection, and Blackboard/context handoff. Any required write outside that scope reopens review rather than silently widening authority.

## Evidence

- `docs/living/work-context/BB-047/g0004-implementation-readiness-review.json`
- `docs/living/knowledge/bb046-organizational-integration-implementation-artifact-readiness-v7.md`
- `docs/living/knowledge/bb046-trust-transition-research-v7.md`
- `docs/living/knowledge/integration-phase-research-to-implementation-readiness-v7.md`
- PR #156 review evidence `5255704166`
- CI run `35442462874`

## Reopen conditions

Reopen if implementation requires post-claim execution ownership, cross-domain scheduling, Core/Oracle authority widening, a different claim-release/invalidation ordering, or a write surface outside the authorized A.1 slice.
