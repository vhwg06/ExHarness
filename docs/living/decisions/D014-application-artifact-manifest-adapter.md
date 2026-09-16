# D014 — Application artifact manifest adapter

Status: **PROPOSED**

## Context

Durable Backend -> QA continuation persists artifact refs plus upstream Backend work-order/revision/acceptance provenance. `resolveQaContext(...)` delegates artifact resolution to an injected `artifactReader` and currently relies on that adapter to honor revision/content identity.

BB-039 reproduced a concrete adapter-level gap with a deterministic weak reader: changed bytes behind a stable ref and a producer-revision mismatch can be accepted when the source ignores those semantics. Deleted content is observable only through the source's generic failure shape.

The application already has a suitable injection boundary. No evidence requires copying payloads into Blackboard, changing Core, or introducing a global artifact registry.

## Proposed decision

For consumers that require restart-safe ref-only continuation across artifact-source changes/loss, use an **optional manifest-validating `artifactReader` adapter** at the Agentic Application artifact boundary.

The first concrete manifest binds:

```text
ref/path
+ producer work-order id
+ producer revision
+ immutable content digest
+ retention/availability metadata
```

The validating reader must fail closed when manifest identity is missing or mismatched, distinguish unavailable payloads from integrity mismatch, and return the existing ordinary artifact payload shape only after validation.

## Authority invariants

- Blackboard remains lifecycle/ref authority; artifact payloads do not move into Blackboard.
- A manifest content digest establishes identity, not correctness or acceptance.
- Artifact availability is not correctness evidence.
- Backend acceptance provenance remains owned by the existing completion/trust path.
- QA still evaluates the resolved content independently.
- Missing manifest, wrong producer/revision, unavailable content and digest mismatch remain distinct failures.
- Enabling the manifest adapter must not silently fall back to unvalidated reads.

## Retention boundary

Operational payload retention is driven by configured policy plus durable nonterminal references. Pending execution/review/reconciliation/blocked continuation may pin payload availability.

When an operational pin is released, immutable manifest/provenance metadata may remain for the configured audit horizon while payload availability becomes `UNAVAILABLE`. The application does not promise infinite retention.

## Compatibility

The first pilot should preserve `ApplicationArtifactRef`, `QaWorkOrder` and `QaContext` schemas. The adapter consumes the existing `readArtifact(...)` request fields and returns the existing `{ content, sourceRef }` contract after validation.

A generic artifact registry, global content-addressed store, Blackboard payload schema expansion or Core abstraction requires separate evidence.

## Evidence

- `docs/living/knowledge/bb039-artifact-manifest-retention.md`
- `docs/living/knowledge/bb039-artifact-manifest-retention-probe.mjs`
- `artifacts/bb039-artifact-manifest-probe.json`
- `packages/agentic-system/src/artifact-ref.js`
- `packages/agentic-system/src/oracle.js`
- `packages/agentic-system/src/session-handoff.js`
- `packages/agentic-system/src/qa-contracts.js`

## Adoption gate

This decision remains **PROPOSED** until research-method and application/architecture-boundary review accept the experiment and implementation handoff.

A later implementation must demonstrate unchanged-valid compatibility, changed-content rejection, producer/revision mismatch rejection, explicit unavailability, partial-set behavior and bounded lookup/hash/retention cost on the concrete Backend -> QA adapter before promotion.
