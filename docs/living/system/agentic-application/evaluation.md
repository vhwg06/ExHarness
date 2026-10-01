# Agentic Application current evaluation

Source-synchronized projection of the application evaluation gate that exists in the repository today. Production-evaluation work that does not yet exist remains on `../docs/blackboard/state.md`.

## Runnable gate

Root verification now includes:

```text
npm run eval:agentic
 -> scripts/agentic-backend-qa-eval.mjs
 -> concrete createDurableBackendQaWorkflow(...)
 -> deterministic Backend/QA fixture scenarios
 -> measured result
 -> deep comparison with artifacts/agentic-backend-qa-reference-eval.json
```

The checked artifact is a drift baseline for this deterministic application reference workload. A changed stable result fails the gate until the implementation or baseline is explicitly reconciled.

## Current scenarios

The reference gate executes five deterministic scenarios against the real Agentic Application orchestration code:

1. happy Backend -> QA delivery;
2. process/session restart after accepted Backend and before QA;
3. QA issue -> Backend remediation -> QA re-verification;
4. artifact-source failure -> durable BLOCKED checkpoint -> fresh-session resume;
5. explicit cancellation -> `SUPERSEDED`.

Delivery scenarios must stop at `PENDING_REVIEW`; the fixture does not fabricate application acceptance or Board `DONE`.

## Current measurements

The baseline records:

- scenario count/pass count;
- Backend and QA execution counts;
- repository and application-artifact source reads plus deterministic context character counts;
- accepted-revision/ref-only handoff checks;
- false-completion count;
- whether Worker-provided evidence leaked into acceptance state;
- QA issue/remediation cycles;
- process restart and recovery-resume counts;
- review-gate count;
- Advisor invocation/value-add measurement state.

The current checked artifact requires zero false completion, zero handoff mismatch, zero unexpected source reads and zero accepted Worker-supplied evidence in the measured fixture.

## Evidence class and limitations

The artifact explicitly declares:

```text
evidenceClass: DETERMINISTIC_REFERENCE
productionEvidence: false
```

Current limitations are also machine-readable:

```text
realRepositories: false
externalModelProviders: false
productionLatencyCost: false
advisorValueAdd: false
genericAbstractionJustified: false
```

Therefore this gate establishes deterministic application-contract/regression evidence only. It does **not** establish production effectiveness, model/provider quality, real-repository task success, latency/cost performance, Advisor value-add or justification for a generic Worker/WorkOrder/context/review abstraction.

Those unresolved evidence requirements remain operational work rather than being inferred from fixture success.

## HOW-evolution evaluation protocol

`packages/agentic-system/src/how-evolution.js` adds one evidence-gated HOW-evolution loop over the delivered execution-policy machinery. It is not a generic optimizer, experiment platform or telemetry warehouse.

```text
HOW_EVOLUTION_FINDING (evidence only, from one causal observation projection)
  -> HOW_EVOLUTION_EVALUATION_PROTOCOL/v1 (pinned fixed WHAT + A/B HOW refs)
  -> paired baseline/candidate EVALUATION_RUN receipts (identical cases)
  -> HOW_EVOLUTION_JEV_RECEIPT (semantic rubric only)
  -> HOW_EVOLUTION_EVALUATION_RESULT (PROPOSE_FOR_PROMOTION | KEEP_BASELINE)
  -> HOW_EVOLUTION_PROMOTION_PROPOSAL (independent review only)
  -> EXECUTION_POLICY generation+1 via createDomainExecutionPolicyPublisher
```

Only versioned HOW may vary. The protocol pins the exact work-contract/acceptance refs and digests, the finding ref and digest, the domain/workload scope, the baseline policy head tuple, both strategy refs and digests, the candidate-producer identity, the evaluator identity/revision/model/policy ref and digest, the trigger/regression/evaluator-owned-holdout scenario-set ref/version/digest, the metric-policy ref/digest with its predeclared `minEffect`, the replay budget, the evidence-snapshot refs and digests, and the expected policy-head tuple. Baseline and candidate execute identical pinned cases. Deterministic workloads may run once; stochastic model-backed workloads require at least three paired repeats unless the pinned metric policy declares a stronger sample plan. The candidate producer cannot mutate evaluator-owned recorded holdout membership after protocol creation. A missing case, required measurement, evaluator receipt or evidence ref is `INCONCLUSIVE`, never coerced to zero or pass.

Hard gates are checked before any value comparison: no new failure on any pinned critical product/acceptance regression case, explicit policy/authority compliance with no forbidden external mutation, explicit required evidence/currentness completeness, and no recovery regression on pinned recovery cases. Hard-gate observations are tri-state: an absent observation is unknown and forces `INCONCLUSIVE`, never a pass. Predeclared cost/token/latency regression maxima bind both sides the same way: a missing observation while the maximum is declared is `INCONCLUSIVE`, and a breach beyond it is `FAIL`. The held-out primary-metric delta (candidate minus baseline) must then meet the predeclared `minEffect`. Stochastic protocols require the actual paired repeats per case (`repeats` carries exactly `repeatCount` finite samples whose mean equals the reported metric); declaring a sample plan without the samples is rejected. Aggregate averages are secondary and cannot override a critical-case regression. Stored comparison state keeps paired case-level deltas first.

Evaluation evidence is not promotion authority and is not product acceptance authority. A `PASS` result creates only a promotion proposal. `FAIL`, `INCONCLUSIVE`, stale evidence or an authority mismatch deterministically keeps the baseline current.
