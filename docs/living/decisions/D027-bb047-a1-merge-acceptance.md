# D027 — BB-047 A.1 merge acceptance

Status: **ACCEPTED MERGE / CLOSURE**

Accepted: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0022-final-merge-review.json
subjectCandidateHeadSha: d986fc5bf137d4f6e57338d851090b14be056a6d
verdict: ACCEPT
reviewOutcome: CLEAN
reviewEvidence: 5256624928
acceptedAction: MERGE_AND_CLOSE_BB047_A1
```

The acceptance is bound to the exact g0022 candidate. The synchronized concurrent-lane research file is byte-identical to current `main` and is not BB-047 source work.

## Evidence

- source repair CI: `35456829081` — SUCCESS 4/4
- final review-head CI: `35457033378` — SUCCESS 4/4
- final semantic review evidence: `5256624928`
- final review context: `docs/living/work-context/BB-047/g0022-final-merge-review.json`

## Accepted scope

BB-047 Integration A.1 is accepted through the released organizational-claim boundary:

- immutable exact organization work/materialization contracts and receipts;
- trusted authority publisher provenance + pointer-only current heads;
- trusted principalRef / exact domain authorization;
- exact materialization grant + pinned execution policy revision;
- Board claim generation fencing and project-scoped immutable release receipts;
- fresh-process same-generation reconciliation;
- typed Board-first invalidation + release fencing;
- corrupt/missing authority fail-closed reconciliation;
- final Board tuple freshness on released-capability boundaries;
- read-only organization work discovery.

## Explicit non-authority

This decision does **not** authorize `DOMAIN_EXECUTION_CONTROL`, ExecutionPolicy/ExecutionStrategy resolution, ExecutionAttemptBinding, BA workload execution, ProductStateProjection, or Integration B.
