# D013 — Bounded application decision/outcome summary

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-028 architecture-boundary review plus evaluation-method / anti-laundering review passed the remediated exact evidence head `21cdea2ce62c9a1d0c9663a03c5b8b4bc8a4ecfe` on PR #110; Actions run #1778 was green on living-doc-impact and Node 20/22/24. The earlier PR #88 PASS evidence is superseded for this decision because its post-merge anti-laundering blocker was not executable in that head.

Acceptance is research/design authority only. Runtime delivery remains owned by BB-029.

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
- an exact revision does not match;
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

The BB-028 anti-laundering controls become required implementation regression cases. The pilot must keep fixture metrics separate from production claims.

Acceptance of this decision does **not** establish production value, runtime delivery, or a default decision-summary mechanism.

## Evidence

- `docs/living/knowledge/bb028-decision-outcome-chain.md`
- `docs/living/knowledge/bb028-decision-outcome-probe.mjs`
- `artifacts/bb028-decision-outcome-probe.json`
- PR #110 architecture-boundary review PASS on exact evidence head `21cdea2ce62c9a1d0c9663a03c5b8b4bc8a4ecfe`
- PR #110 evaluation-method / anti-laundering review PASS on the same exact evidence head
- exact evidence-head Actions run #1778 green
- PR #88 post-merge anti-laundering finding, superseded by PR #110 executable controls
- `packages/core-harness/src/deliberation.js`
- `packages/core-harness/src/deliberation-controller.js`
- `packages/core-harness/src/action-effect.js`
- `packages/core-harness/src/grounded-cognition.js`
- `packages/agentic-system/src/durable-backend-qa.js`

## Promotion boundary

`ACCEPTED` means the application boundary and authority invariants are approved for the bounded BB-029 pilot. It does **not** mean `DECISION_OUTCOME_SUMMARY v1` is delivered runtime behavior or a production default. Runtime promotion requires BB-029 implementation and verification.
