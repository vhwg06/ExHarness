# Worker gate gap + Oracle continuations — BB-090 … BB-095

Status: RESEARCH_SA brief. Research only; no product source is written by this brief.
Checked: 2026-09-29 against main `e6be0459`. BB-064 stays DONE and is not reopened.

## T1 — Why the BB-064 Worker gate accepted a defective facade (BB-090)

BB-087 corrects the delivered facade defect itself. BB-090 corrects the gate gap that let it through. Root cause from the executed probe `docs/blackboard/evidence/BB-090/gate-gap-probe-result.json`:

1. The FAIL_CLOSED criterion required "one deterministic negative per class"; the plan's failureMatrix has 8 classes. The only executed fail-closed test has 2 assertions and never calls `createOracleContextResolver`. It exercises `defineContextResolution` (the contract), which is correct; the facade that violates the matrix was never under test.
2. `collectEvidence` binds every criterion to whole passing verification logs. No plan-declared negative case is bound to an executed test identity, so "all logs exit 0" is the only deterministic signal.
3. Jev judges one aggregate question per criterion. The 8-class FAIL_CLOSED claim was a near tie (SATISFIED 0.51 vs INSUFFICIENT_EVIDENCE 0.46). Confidence is telemetry by policy, so the argmax passed.
4. A related vacuous check exists in delivered evidence tooling: `scripts/oracle-context-intelligence/benchmark-profile.mjs` contains an `assert.ok(... || true)` assertion.

Correction: typed negative-case bindings. A plan declares each required negative as `{id, negativeCaseIndex, criterionId, verificationId, testTitle, subjectSymbol}`. Evidence collection deterministically requires the titled test to pass in that verification log, and the titled test body to invoke the subject symbol without vacuous assertions. Worker Jev receives one atomic question per binding with the extracted test body. Enforcement starts at a policy work-id threshold, so no DONE or existing READY plan is retrofitted. Confidence stays telemetry.

## T2 — Remaining BB-064 continuations (BB-091 … BB-095)

BB-064 `continuationSchedule` fixes the order: Context Graph (BB-088) -> planner optimization -> progressive resolution -> adaptive budgeting -> Oracle x Core interaction -> profile acceptance.

Executed probe `docs/blackboard/evidence/BB-091/continuation-probe-result.json`:

- Delivered BB-062 retrieval benchmark ranks with its own `rank()` function rather than the delivered planner/providers. Its lexical, semantic and structural arms produce identical aggregate Recall@3 0.792 / MRR 0.875, it reports `structuralPrimary: true` although BB-062 D15 rejected structural ranking as a primary retriever, and its typed-graph arm (0.542) is below the research figure (1.000). Planner optimization therefore starts with a discriminating ablation executed through the real planner.
- The ContextResolution contract accepts a chained step 1 and rejects a step beyond `maxResolutionSteps`; the delivered facade hard-codes step 0 and its `resolve(rawRequirement, metadata = {})` takes no previous resolution. Progressive resolution is a facade extension, not a contract change.

| Task | Question | Worker dependencies |
|---|---|---|
| BB-091 | Deterministic provider composition vs graph-expanded and rank-fusion strategies, measured through the real planner | BB-088 |
| BB-092 | Bounded explicit multi-step re-resolution without hidden growth or turn drift | BB-091 |
| BB-093 | Model-aware rendered-size budget profiles preserving source identity; tokens only with a declared tokenizer | BB-092 |
| BB-094 | Oracle resolution on each supported Core profile; async cells NOT_EVALUATED unless BB-081 publishes PROMOTE_ASYNC | BB-093, BB-081 |
| BB-095 | Held-out fixed-factor Oracle profile acceptance through @exharness/benchmark with a deterministic reducer | BB-094, BB-065 |

## Source classification

| Class | Sources |
|---|---|
| DELIVERED_TRUTH | `scripts/blackboard-delivery.mjs` collectEvidence, `scripts/blackboard-jev.mjs` materialize, `docs/blackboard/jev-policy.json`; `@exharness/oracle` root exports; Core `resolveContextRequirementBlocks` and `maxSerializedChars` |
| PLANNED_CONTRACT | BB-082 objective supersession (serializes outer-Blackboard writes); BB-087 fixed facade; BB-088 Context Graph; BB-081 PROMOTE_ASYNC / KEEP_SYNC_BASELINE / INCONCLUSIVE; BB-065 @exharness/benchmark |
| RESEARCH_DESIRED_STATE | BB-064 continuationSchedule and benchmarkHandoff; this brief |

## Per-task research records

Each record is derived from the canonical objective, READY plan and readiness judgment and adds no new claims:

- [BB-090](blackboard-control-research/BB-090.md)
- [BB-091](oracle-context-intelligence-research/BB-091.md)
- [BB-092](oracle-context-intelligence-research/BB-092.md)
- [BB-093](oracle-context-intelligence-research/BB-093.md)
- [BB-094](oracle-context-intelligence-research/BB-094.md)
- [BB-095](oracle-context-intelligence-research/BB-095.md)
