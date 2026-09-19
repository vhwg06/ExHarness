# D023 — BB-047 A.1 final-completion findings repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0013-trust-completion-review.json
subjectCandidateHeadSha: ee94a318e953d16f5e9cd5d8ecb64b2a8340f659
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5256232254
acceptedAction: REPAIR_EXACT_FINDINGS
```

`verdict: ACCEPT` accepts only this bounded repair authorization. The reviewed source remains subject to repair and fresh review.

## Findings to resolve

1. Organization claim/release/recovery must revalidate the exact materialization authorization subject that created the Board item; caller input cannot substitute another matching grant. Execution policy subject is controller configuration, not caller authority.
2. Add fresh-process `reconcileOrganizationClaimAuthority({ itemId })` for same-generation release completion/reconstruction/invalidation from durable Board + artifacts + current heads.
3. Separate logical `obligationSubjectKey` from grant-bound `materializationKey` and enforce at most one live Board item per logical obligation subject.
4. Persist canonical verified issuer/publisher provenance in immutable materialization-authorization and execution-policy artifacts; caller-supplied provenance cannot grant authority.

## Boundary

This remains Integration A.1 only. Repair may change organization authority/artifact/work/claim modules, the narrow ApplicationOrchestrator materialization primitive, focused tests, and affected worktree projection. No DOMAIN_EXECUTION_CONTROL, ExecutionStrategy, BA execution, ProductStateProjection, or cross-domain activation is authorized.

## Evidence

- `docs/living/work-context/BB-047/g0013-trust-completion-review.json`
- review evidence `5256232254`
- source candidate CI `35452310956`
- review-head CI `35452372847`
- accepted A.1 v7 readiness/trust artifacts
