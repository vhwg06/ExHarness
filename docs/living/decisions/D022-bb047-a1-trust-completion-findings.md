# D022 — BB-047 A.1 trust-completion findings repair authorization

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0011-repair-review.json
subjectCandidateHeadSha: 022074d3faa4465416361f2c2743bc8f7d5bb263
verdict: ACCEPT
reviewOutcome: FINDINGS_RAISED
reviewEvidence: 5256180921
acceptedAction: REPAIR_EXACT_FINDINGS
```

`verdict: ACCEPT` accepts only this bounded repair authorization. The reviewed implementation still requires repair and fresh review before merge.

## Findings to resolve

1. Replace caller-asserted principal identity with a trusted injected ExecutionPrincipal provider/context and derive Board owner from the verified principal.
2. Persist CLAIM_RELEASE_RECEIPT as an immutable content-addressed artifact; make ClaimReleaseHead ref-only and project/root scoped.
3. Persist and validate immutable CLAIM_AUTHORITY_INVALIDATION artifacts that bind exact project/root, claim tuple, typed cause, observed authority heads, and optional released receipt ref.
4. Bind materialization to exact project/root and authorization observation; revalidate at publication and reconcile any post-publication drift so stale work cannot remain eligible.

## Boundary

This repair is still Integration A.1. It may change the narrow application orchestrator materialization/invalidation primitives, organization artifact/authority/claim/materializer modules, focused tests, and current-system worktree projection. It may not enter DOMAIN_EXECUTION_CONTROL, choose ExecutionPolicy/ExecutionStrategy, execute BA work, or implement ProductStateProjection.

## Evidence

- `docs/living/work-context/BB-047/g0011-repair-review.json`
- review evidence `5256180921`
- source candidate CI `35451622114`
- review-head CI `35451648019`
- accepted A.1 v7 readiness/trust artifacts
