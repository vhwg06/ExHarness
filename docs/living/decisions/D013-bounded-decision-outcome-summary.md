# D013 — Bounded application decision/outcome summary

Status: **PROPOSED**

Review state: the BB-028 application/architecture boundary is accepted, but evaluation-method / anti-laundering review remains open after exact-head audit of the merged PR #110 fixture found that the artifact index still binds fixture slots to hard-coded ref keys. Merge and green CI do not establish the missing exact-artifact-identity proof.

## Context

Core already persists bounded deliberation, ActionIntent authorization/outcome refs, effect truth, fresh evaluation-backed reflection and intent/reflection alignment. The durable Backend/QA remediation path does not currently expose one bounded application correlation artifact linking those pieces for a fresh reviewer.

The original BB-028 fixture showed a compact summary, but it let copied summary fields answer correctness questions without executable proof that stale, tampered, missing or contradictory underlying artifacts fail closed. The remediated probe separates bounded orientation from correctness verification:

```text
summary orientation
  -> bounded discoverability/correlation
  -> no correctness authority
  -> correctness answers remain UNKNOWN

verified summary
  -> resolve exact underlying refs/revisions
  -> derive correctness-relevant answers from underlying artifacts
```

Seven adversarial controls fail closed: tampered authorization, copied success over a failing evaluation, tampered authorization evidence refs, tampered outcome refs, missing evaluation, wrong ActionIntent revision and omitted counterevidence. Evidence remains deterministic/synthetic and explicitly not production-effectiveness evidence.

Those controls still do not prove that every resolved artifact actually has the identity requested by the summary ref: the current fixture index can return an artifact from a hard-coded slot even when the artifact's stored canonical identity differs from the requested ref. That unresolved anti-laundering case keeps this decision review-open.

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
summary orientation != correctness evidence
summary != action authorization
summary != Blackboard transition authority
summary != acceptance evidence by itself
```

Any correctness-relevant conclusion must be derived from exact underlying persisted artifacts. The summary may tell a reviewer **where** to look; it cannot make its copied fields true.

The first pilot must fail closed when:

- a copied summary claim conflicts with its referenced artifact;
- a required artifact is missing;
- an exact artifact identity or revision does not match the requested ref;
- current evaluation contradicts the copied outcome;
- authorization evidence refs or outcome refs drift from the referenced ActionIntent;
- required current counterevidence is omitted;
- grounding/alignment no longer carry the referenced evaluation lineage.

Independent acceptance must still verify the exact evidence/decision/attestation refs required by its trust policy.

## Boundary

Implement the first pilot in Agentic Application only after this decision is accepted. Do not add a generic Core `DecisionOutcomeGraph`, registry, lifecycle facade or reasoning engine unless a second concrete consumer demonstrates repeated semantics.

`DeliberationArtifact.judgment` may carry the bounded structured hypothesis/options/rationale input for the pilot; no raw/private chain-of-thought representation is introduced.

## Consequences if accepted

BB-029 may implement one Backend/QA remediation composition that materializes the summary only after post-action evaluation and grounded reflection/alignment exist, attaches the summary ref to the application review/continuation surface, uses it for bounded orientation, and requires exact underlying resolution for correctness-relevant review.

The BB-028 anti-laundering controls, including exact stored-artifact identity mismatch, become required implementation regression cases. The pilot must keep fixture metrics separate from production claims.

## Evidence

- `docs/living/knowledge/bb028-decision-outcome-chain.md`
- `docs/living/knowledge/bb028-decision-outcome-probe.mjs`
- `artifacts/bb028-decision-outcome-probe.json`
- merged PR #110 and exact-head CI #1778 are implementation/research evidence, not acceptance authority for the unresolved identity case
- exact-head audit: `buildArtifactIndex(...)` still maps fixture slots under hard-coded keys; a stored evaluation identity can differ from the requested ref while the resolver still returns that object
- `packages/core-harness/src/deliberation.js`
- `packages/core-harness/src/deliberation-controller.js`
- `packages/core-harness/src/action-effect.js`
- `packages/core-harness/src/grounded-cognition.js`
- `packages/agentic-system/src/durable-backend-qa.js`

## Promotion gate

Remain `PROPOSED` until BB-028 evaluation-method / anti-laundering review accepts executable proof that every correctness-relevant read resolves an artifact whose canonical identity/revision matches the exact requested ref. Architecture-boundary acceptance alone does not authorize BB-029.
