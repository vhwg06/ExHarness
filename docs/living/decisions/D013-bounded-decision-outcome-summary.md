# D013 — Bounded application decision/outcome summary

Status: **ACCEPTED**

Accepted: 2026-09-17

Acceptance boundary: BB-028 application/architecture review is accepted and the remaining evaluation-method / anti-laundering obligation was closed by PR #116 on exact head `dbf825b0223d646b81513a2e97673c77b15db4c2`. The executable remediation keeps hard-coded lookup slots but independently validates canonical stored artifact identity/revision after lookup; five matching baselines pass, five slot-alias/stored-identity mismatch controls fail closed with `escapedControls=0`, and exact-head Actions #1869 is green. Merge commit `6a53285e84200dc1a126b932b2c5f91c6dfdc669` carries that evidence into main.

Acceptance is research/design authority for the bounded BB-029 implementation handoff only. It does not claim runtime delivery, production effectiveness, or summary correctness authority.

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

Seven adversarial controls fail closed: tampered authorization, copied success over a failing evaluation, tampered authorization evidence refs, tampered outcome refs, missing evaluation, wrong ActionIntent revision and omitted counterevidence. PR #116 adds the missing exact-artifact-identity boundary: a lookup key is not identity proof, and the returned artifact's canonical kind/id/revision must independently match the requested ref. Evidence remains deterministic/synthetic and explicitly not production-effectiveness evidence.

## Decision

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

Implement the first pilot in Agentic Application. Do not add a generic Core `DecisionOutcomeGraph`, registry, lifecycle facade or reasoning engine unless a second concrete consumer demonstrates repeated semantics.

`DeliberationArtifact.judgment` may carry the bounded structured hypothesis/options/rationale input for the pilot; no raw/private chain-of-thought representation is introduced.

## Consequences

BB-029 may implement one Backend/QA remediation composition that materializes the summary only after post-action evaluation and grounded reflection/alignment exist, attaches the summary ref to the application review/continuation surface, uses it for bounded orientation, and requires exact underlying resolution for correctness-relevant review.

The BB-028 anti-laundering controls, including exact stored-artifact identity mismatch, become required implementation regression cases. The pilot must keep fixture metrics separate from production claims.

## Evidence

- `docs/living/system/agentic-application/decision-outcome.md`
- `scripts/decision-outcome-eval.mjs`
- `artifacts/bb028-decision-outcome-probe.json`
- `scripts/exact-artifact-identity-eval.mjs`
- `artifacts/bb028-exact-artifact-identity-probe.json`
- PR #110 architecture-boundary and anti-laundering remediation context; exact-head CI #1778 green
- PR #116 evaluation-method / anti-laundering review PASS on exact head `dbf825b0223d646b81513a2e97673c77b15db4c2`
- PR #116 exact-head Actions #1869 green on living-doc-impact and Node 20/22/24
- five exact-match baselines accepted; five hard-coded-slot alias / stored-identity or revision mismatch controls fail closed; `escapedControls=0`
- merge commit `6a53285e84200dc1a126b932b2c5f91c6dfdc669`
- `packages/core-harness/src/deliberation.js`
- `packages/core-harness/src/deliberation-controller.js`
- `packages/core-harness/src/action-effect.js`
- `packages/core-harness/src/grounded-cognition.js`
- `packages/agentic-system/src/durable-backend-qa.js`

## Promotion boundary

`ACCEPTED` authorizes the bounded BB-029 implementation handoff. It does **not** establish production value, runtime delivery, a default decision-summary mechanism, or independent correctness/acceptance authority for the summary itself.
