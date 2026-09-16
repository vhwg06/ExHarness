# D014 — Application artifact manifest adapter

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-039 corrected fresh-session research evidence in PR #108 passed application/architecture-boundary and research-method review on exact research head `fcf5bbd5357543bf3308b668f499804937ed7e22`; exact-head Actions run #1753 was green. The corrected fixture closes the earlier same-process and missing provenance-negative coverage gaps. Acceptance remains a design boundary, not delivery of a runtime manifest adapter.

## Context

Durable Backend -> QA continuation persists artifact refs plus upstream Backend work-order/revision/acceptance provenance. `resolveQaContext(...)` delegates artifact resolution to an injected `artifactReader` and currently relies on that adapter to honor revision/content identity.

BB-039 reproduced a concrete adapter-level gap with a deterministic weak reader: changed bytes behind a stable ref and producer/provenance mismatches can be accepted when the source ignores those semantics. Deleted content is observable through the source's ordinary missing-artifact failure shape.

The corrected BB-039 fixture exercises the boundary after an actual fresh-session reconstruction using a JSON Blackboard plus separately reconstructed filesystem-backed artifact and manifest stores. The application already has a suitable injection boundary. No evidence requires copying payloads into Blackboard, changing Core, or introducing a global artifact registry.

## Decision

For consumers that require restart-safe ref-only continuation across artifact-source changes/loss, use an **optional manifest-validating `artifactReader` adapter** at the Agentic Application artifact boundary.

The first concrete manifest binds:

```text
ref/path
+ producer work-order id
+ producer revision
+ acceptance-decision id/digest
+ stored artifact revision
+ immutable content digest
+ retention/availability metadata
```

The validating reader must fail closed when manifest identity is missing or mismatched, distinguish unavailable payloads from integrity/provenance mismatch, and return the existing ordinary artifact payload shape only after validation.

## Authority invariants

- Blackboard remains lifecycle/ref authority; artifact payloads do not move into Blackboard.
- A manifest content digest establishes identity, not correctness or acceptance.
- Artifact availability is not correctness evidence.
- Backend acceptance provenance remains owned by the existing completion/trust path.
- QA still evaluates the resolved content independently.
- Missing manifest, wrong producer work order, wrong producer/revision, wrong acceptance-decision id/digest, unavailable content and digest mismatch remain distinct failures.
- Enabling the manifest adapter must not silently fall back to unvalidated reads.

## Retention boundary

Operational payload retention is driven by configured policy plus durable nonterminal references. Pending execution/review/reconciliation/blocked continuation may pin payload availability.

When an operational pin is released, immutable manifest/provenance metadata may remain for the configured audit horizon while payload availability becomes `UNAVAILABLE`. The application does not promise infinite retention.

## Compatibility

The first pilot should preserve `ApplicationArtifactRef`, `QaWorkOrder` and `QaContext` schemas. The adapter consumes the existing `readArtifact(...)` request fields and returns the existing `{ content, sourceRef }` contract after validation.

A generic artifact registry, global content-addressed store, Blackboard payload schema expansion or Core abstraction requires separate evidence.

## Corrected evidence

- `docs/living/knowledge/bb039-artifact-manifest-research.md`;
- `docs/living/knowledge/bb039-artifact-manifest-probe.mjs`;
- project-bound `SessionHandoffSurface` fresh-session reconstruction through a durable JSON Blackboard;
- filesystem-backed artifact and manifest stores reconstructed independently from the producer session;
- nine deterministic scenarios including changed bytes, wrong stored revision, missing/partial content, missing manifest, wrong producer work-order id, wrong acceptance-decision id and wrong acceptance-decision digest;
- weak baseline accepts five identity/provenance violations while the manifest reader rejects all five;
- evidence class `DETERMINISTIC_FRESH_SESSION_FIXTURE`, `productionEvidence=false`;
- PR #108 application/architecture-boundary review PASS on exact head `fcf5bbd5357543bf3308b668f499804937ed7e22`;
- PR #108 research-method review PASS on the same exact head;
- exact-head Actions run #1753 green.

Earlier PR #90 evidence remains historical precursor evidence but is no longer the sole acceptance basis for D014.

## Promotion boundary

`ACCEPTED` approves the optional application adapter boundary and implementation handoff. It does **not** claim a manifest adapter is delivered runtime behavior. A later implementation must demonstrate unchanged-valid compatibility, changed-content rejection, producer/revision/provenance mismatch rejection, explicit unavailability, partial-set behavior and bounded lookup/hash/retention cost on the concrete Backend -> QA adapter before runtime promotion.
