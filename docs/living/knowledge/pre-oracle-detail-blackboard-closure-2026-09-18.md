# Pre-Oracle-detail Blackboard debt closure

Date: 2026-09-18

This record closes the remaining pre-Oracle-detail Blackboard obligations without converting missing evidence into successful evidence.

`SUPERSEDED` in this closure means **no active project obligation remains in the current phase**. It does not mean the research question was proven, disproven, or production-validated. A superseded item may return only as new work when its explicit re-entry trigger becomes true.

## BB-005 — production Backend -> QA evaluation

Disposition: **SUPERSEDED / NOT EXECUTABLE IN CURRENT PHASE**

The repository still exposes deterministic/reference evaluation only. Current evaluation artifacts explicitly declare `productionEvidence=false`; no versioned representative real-repository/provider workload corpus is present.

No production-effectiveness, provider-quality, latency/cost, Advisor-value, or generic-abstraction conclusion is promoted from the deterministic fixtures.

Re-entry trigger:

- a versioned representative real-repository/provider task corpus exists;
- execution can measure task success, false completion, handoff correctness, context cost, remediation, Advisor value and recovery under representative interruptions.

Until then, production-evidence claims remain forbidden rather than pending as active delivery debt.

## BB-009 — common Oracle resolver contract

Disposition: **SUPERSEDED / NOT ADOPTED**

Current Oracle remains intentionally concrete:

```text
resolveBackendContext(order, { repositoryReader })
resolveQaContext(order, { artifactReader })
```

The two source classes have different lifecycle/provenance semantics. No third concrete Oracle source and no repeated adapter boilerplate currently demonstrates a stable common resolver/provider contract.

Re-entry trigger:

- a third real source boundary is implemented; or
- repeated adapter code creates a measured common-contract pressure.

Protocol support or an abstract provider idea alone is not sufficient.

## BB-010 — structured Oracle diagnostics

Disposition: **SUPERSEDED / NOT ADOPTED**

Current Backend/QA callers still operate with boundary-specific resolution failures. No caller currently needs a stable machine-readable taxonomy for unavailable/auth/not-found/adaptation/schema/optional-absence distinctions.

Re-entry trigger:

- a concrete caller must branch programmatically on multiple resolution failure classes while preserving required-vs-optional context semantics.

Until such a consumer exists, a generic diagnostic schema would be speculative surface area.

## BB-040 — quality/cost model routing research

Disposition: **SUPERSEDED / NOT EXECUTABLE IN CURRENT PHASE**

Core model-routing primitives exist, but the repository does not currently contain the concrete provider configuration, representative versioned task set, measured fixed-route usage/cost/latency baseline, or held-out verified-quality evidence required by BB-040's own value gate.

No route-selection default or quality/cost benefit is claimed.

Re-entry trigger:

- concrete provider/model configurations are available;
- representative tasks and fixed-route measurements exist;
- route provenance, actual usage, latency, independent verification outcomes and escalation reasons can be collected under a predeclared budget.

## BB-035 — bounded self-upgrade pilot

Disposition: **DELIVERED**

PR #130 delivered the D016-bounded application pilot on current main. The final exact implementation head was `5b787d6d3642ab7f157e041ce04f47ab31bcf074`; Actions #2026 passed living-doc-impact and Node 20/22/24; application/code and independent outcome/authority reviews passed before merge.

The delivered boundary remains narrow:

- fixed baseline/candidate and evaluator-policy identity;
- durable research continuation;
- bounded, fenced evaluation recovery;
- FAIL/INCONCLUSIVE keeps the baseline;
- PASS may only become `PROPOSE_FOR_REVIEW`;
- independent review remains mandatory;
- no adoption/merge/deploy/rollout authority;
- `productionEvidence=false` and no generalization claim.

## Phase-closure invariant

After canonical reconciliation:

```text
pre-Oracle-detail ACTIVE debt = 0
READY / REOPENED / CLAIMED / BLOCKED / PENDING_REVIEW /
REVIEWING / PENDING_RECONCILIATION = 0
```

This permits archival of the resolved Blackboard and creation of a fresh Oracle-detail coordination surface without hiding unfinished implementation debt.
