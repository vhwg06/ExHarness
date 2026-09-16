# D014 — Application artifact manifest adapter

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-039 research-method and application/architecture-boundary reviews passed exact head `5da76553060bb72ff0a69de971f665bd8131fe10`; Actions run #1603 was green and PR #90 merged as `48165251181dff3fecd9af29b8eef55007a2212b`.

## Context

Durable Backend -> QA continuation persists artifact refs plus upstream Backend work-order/revision/acceptance provenance. `resolveQaContext(...)` delegates artifact resolution to an injected `artifactReader` and currently relies on that adapter to honor revision/content identity.

BB-039 reproduced a concrete adapter-level gap with a deterministic weak reader: changed bytes behind a stable ref and a producer-revision mismatch can be accepted when the source ignores those semantics. Deleted content is observable only through the source's generic failure shape.

The application already has a suitable injection boundary. No evidence requires copying payloads into Blackboard, changing Core, or introducing a global artifact registry.

## Decision

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
- PR #90 research-method review PASS on exact head `5da76553060bb72ff0a69de971f665bd8131fe10`;
- PR #90 application/architecture-boundary review PASS on the same exact head;
- exact-head Actions run #1603 green;
- merge commit `48165251181dff3fecd9af29b8eef55007a2212b`.

## Promotion boundary

`ACCEPTED` approves the optional application adapter boundary and implementation handoff. It does **not** claim a manifest adapter is delivered runtime behavior. A later implementation must demonstrate unchanged-valid compatibility, changed-content rejection, producer/revision mismatch rejection, explicit unavailability, partial-set behavior and bounded lookup/hash/retention cost on the concrete Backend -> QA adapter before runtime promotion.
