# D013 — Bounded application decision/outcome summary

Status: **PROPOSED**

## Context

Core already persists bounded deliberation, ActionIntent authorization/outcome refs, effect truth, fresh evaluation-backed reflection and intent/reflection alignment. The durable Backend/QA remediation path does not currently expose one bounded application correlation artifact linking those pieces for a fresh reviewer.

BB-028 deterministic fixture evidence shows three current/proposed review modes:

- current bounded application handoff: small but cannot answer the five decision-chain orientation questions;
- raw full artifact graph: answerable but requires a larger context plus manual cross-artifact correlation;
- one bounded summary projection: answerable from one orientation artifact while retaining exact underlying refs for independent verification.

The evidence is synthetic/replayable and explicitly not production-effectiveness evidence.

## Proposed decision

For the first Backend/QA remediation pilot, introduce one immutable **application-level** artifact per completed remediation attempt:

```text
DECISION_OUTCOME_SUMMARY v1
```

It is a bounded projection/index over existing artifacts, not a new source of truth and not a Core primitive.

It may contain concise structured decision metadata:

```text
objective
hypothesis
alternatives
selected action
concise rationale
uncertainty
```

and exact refs/revisions for:

```text
DeliberationArtifact
ActionIntent + authorization policy/evidence
outcome/effect artifacts
post-action verification/evaluation
grounded reflection
grounding artifact
intent/reflection alignment
counterevidence
```

## Authority

The summary has no independent correctness or lifecycle authority.

```text
rationale != correctness evidence
executed effect != verified success
summary != action authorization
summary != Blackboard transition authority
summary != acceptance evidence by itself
```

Any correctness-relevant conclusion must remain resolvable to the underlying persisted evidence/decision artifacts. Independent acceptance must verify the exact refs required by its trust policy.

Missing, stale or contradictory evidence must remain visible and fail closed; the projection must not replace uncertainty with a synthetic conclusion.

## Boundary

Implement the first pilot in Agentic Application. Do not add a generic Core `DecisionOutcomeGraph`, registry, lifecycle facade or reasoning engine unless a second concrete consumer demonstrates repeated semantics.

`DeliberationArtifact.judgment` may carry the bounded structured hypothesis/options/rationale input for the pilot; no raw/private chain-of-thought representation is introduced.

## Consequences if accepted

BB-029 may implement one Backend/QA remediation composition that materializes the summary only after post-action evaluation and grounded reflection/alignment exist, attaches the summary ref to the application review/continuation surface, and verifies fresh-session reconstruction plus stale/missing/contradictory evidence cases.

The pilot must rerun the BB-028 deterministic comparison and keep fixture metrics separate from production claims.

## Evidence

- `docs/living/knowledge/bb028-decision-outcome-chain.md`
- `docs/living/knowledge/bb028-decision-outcome-probe.mjs`
- `artifacts/bb028-decision-outcome-probe.json`
- `packages/core-harness/src/deliberation.js`
- `packages/core-harness/src/deliberation-controller.js`
- `packages/core-harness/src/action-effect.js`
- `packages/core-harness/src/grounded-cognition.js`
- `packages/agentic-system/src/durable-backend-qa.js`

## Promotion gate

Remain `PROPOSED` until BB-028 architecture-boundary and evaluation-method review accept the application boundary, authority invariants and evidence interpretation.
