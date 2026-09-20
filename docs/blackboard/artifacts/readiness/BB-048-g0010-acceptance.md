# BB-048 g0010 — Integration B implementation readiness acceptance

Status: **ACCEPTED**

Accepted: 2026-09-20

This decision accepts only the transition from the exact current `JUDGMENT/READINESS` subject to one bounded `EXECUTION/INITIAL` generation. It does not accept any implementation candidate.

## Decision subject

```text
subjectContextRef: docs/blackboard/context/BB-048/g0010-implementation-readiness-judgment.json
subjectCandidateHeadSha: c9e4973f14fa7e39c18bc9e57da28c6ccb461e28
verdict: ACCEPT
```

## Readiness assessment

The exact reviewed candidate establishes the execution/judgment authority split required by the current Blackboard pipeline. Producer output is constrained to `IMPLEMENTATION_RESULT` facts, candidate correctness requires a different immutable `JUDGMENT/CANDIDATE` generation, and only a `FINDINGS` judgment can authorize repair.

The candidate's earlier CI failure was caused by the then-stale review pointer after `test/blackboard-artifact-contract.test.mjs` changed. The artifact contract tests themselves passed. The final PR #189 head `688c909fda5261a282bf5e120658cd200015174a` passed workflow run `35483416683`; the only changes after the immutable subject candidate `c9e4973f14fa7e39c18bc9e57da28c6ccb461e28` are the current Blackboard pointer and g0010 readiness context, exactly matching the declared post-target envelope.

The accepted semantic input is sufficient for one bounded Integration B slice because current A.1 source already provides the exact released-claim execution-entry check, while the requested slice owns only domain-local HOW: durable execution-attempt currentness, immutable attempt binding, domain-local policy/strategy resolution, recovery reuse, and factual runtime outcome/evidence.

## Authorized execution boundary

The child execution generation may:

- add one domain-local execution controller;
- add durable domain execution-policy and execution-attempt heads;
- persist immutable execution policy, strategy, attempt-binding, runtime-attestation and attempt-outcome artifacts;
- execute/recover one BUSINESS_ANALYSIS-owned workload only after the exact released organizational claim passes currentness validation;
- add focused Integration B tests;
- reconcile affected current-system Living Docs;
- publish one `IMPLEMENTATION_RESULT` and hand the exact candidate to a fresh `JUDGMENT/CANDIDATE` context.

It must not:

- select or rank another Blackboard work item;
- dispatch another organizational domain;
- mutate ApplicationOrchestrator/Blackboard lifecycle semantics;
- widen Core Harness or Oracle authority;
- equate runtime success with domain acceptance or authoritative publication;
- enter Integration C-J.

## Required verification

- focused BB-048 domain execution-control tests;
- BB-047 organization-bridge regression tests;
- repository `npm run verify`;
- fresh candidate judgment against the exact implementation result and candidate revision.

## Reopen conditions

Reopen Research/SA rather than widening execution if implementation requires cross-domain continuation, organizational scheduling, new acceptance semantics, Core/Oracle authority changes, or a write outside the bounded g0011 source scope.
