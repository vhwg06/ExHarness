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

Those unresolved evidence requirements remain operational work on BB-005/BB-022 rather than being inferred from fixture success.
