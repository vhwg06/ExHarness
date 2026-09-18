# BB-044 — Artifact retention authority boundary

Status: **RESEARCH / PROPOSED DISPOSITION**

Date: 2026-09-18

## Question

Now that BB-043 delivers the optional D014 manifest-validating `artifactReader`, should ExHarness add generic runtime retention/availability state driven directly from Blackboard lifecycle?

The apparent pressure is real:

- the immutable manifest records capture-time retention pins and entry availability;
- D014 allows payload availability to become `UNAVAILABLE` after operational pins are released;
- current immutable candidate matching treats different availability snapshots for the same artifact identity as `ARTIFACT_MANIFEST_CONFLICT`.

But adding mutable retention state creates a second authority question: who may decide that payload bytes are safe to release while Blackboard work may concurrently reopen?

## Executable evidence

Reproduce:

```text
node docs/living/knowledge/bb044-artifact-retention-boundary-probe.mjs
```

Evidence class:

```text
DETERMINISTIC_REPOSITORY_SHAPE
productionEvidence = false
```

The probe exercises three boundaries.

### 1. Lifecycle state encoded as another immutable manifest conflicts

It persists two otherwise identical manifests for the same ref/path/provenance/content identity:

```text
manifest A: availability = AVAILABLE
manifest B: availability = UNAVAILABLE
```

The current validating reader rejects the pair as:

```text
ARTIFACT_MANIFEST_CONFLICT
```

This is expected from the BB-043 identity store: immutable manifests do not define ordering/current-state authority.

### 2. Actual missing payload is already diagnosed without mutating manifest identity

With one valid `AVAILABLE` manifest, the underlying payload reader returns `ENOENT`.

The manifest reader returns:

```text
ARTIFACT_UNAVAILABLE
  cause = ENOENT
```

Therefore current QA continuation does not require a mutable manifest just to distinguish missing bytes. Capture-time manifest identity and actual source availability can remain separate.

### 3. A generic retention sidecar with its own CAS does not fence Blackboard races

The probe models this interleaving:

```text
Board snapshot A
  BB-200 = DONE
  -> no active artifact pin

retention sidecar revision = r4

concurrent Board snapshot B
  BB-200 = REOPENED
  -> artifact is active again

stale retention controller
  still sees sidecar r4
  -> sidecar CAS succeeds
  -> but release decision was derived from stale Board state
```

A revision/CAS mechanism on a separate retention store prevents stale retention writers from overwriting each other, but it does **not** prove that the Board snapshot used to authorize payload release is still current.

That is a cross-authority coordination problem, not merely a persistence implementation detail.

## Repository pressure check

Current `packages/agentic-system/src` has no concrete artifact payload-store authority exposing operations such as:

```text
pinArtifact(...)
unpinArtifact(...)
releaseArtifact(...)
deleteArtifact(...)
```

The current runtime has:

- injected `artifactReader.readArtifact(...)`;
- immutable trust/decision/artifact-like stores for other concerns;
- no concrete Backend -> QA payload store whose retention side effects can be fenced and recovered.

So a generic retention service today would invent the storage authority it is supposed to coordinate.

## Options

### A. Mutate lifecycle state by minting another manifest

Rejected.

It overloads immutable identity/provenance with current lifecycle state and has no ordering authority. BB-043 correctly fails closed on conflicting identity candidates.

### B. Add a generic mutable retention sidecar now

Rejected for current source.

A sidecar CAS can serialize sidecar writers but cannot atomically fence a release decision against a concurrent Blackboard reopen. Without a concrete payload store it also cannot prove what storage effect was performed.

### C. Keep manifest identity immutable and defer runtime retention enforcement to one concrete payload store

Recommended.

Current behavior remains:

```text
manifest
  -> immutable producer/ref/revision/acceptance/content identity

artifactReader
  -> actual source availability now
  -> ARTIFACT_UNAVAILABLE when bytes are missing

Blackboard
  -> project/work lifecycle authority
```

When one real payload store appears, retention work can start from its actual side-effect semantics rather than inventing a global service.

## Re-entry gate

Create a new implementation item only when all three are concrete:

1. one artifact payload store exposes explicit pin/release or deletion authority;
2. there is a lifecycle-to-storage coordination contract that can fence release against current Blackboard state, including reopen/review races;
3. release failure/retry/recovery semantics are defined without turning storage metadata into correctness or acceptance authority.

A later design may use event/outbox, effect reconciliation, store-local leases, or another mechanism. BB-044 does not choose one without the concrete storage consumer.

## Disposition

**NARROW / DEFER RUNTIME RETENTION AUTOMATION.**

No generic retention-state store should be added now.

This result does not roll back BB-043. The optional manifest adapter still provides concrete value:

- producer/provenance/content identity validation;
- fail-closed changed-byte detection;
- explicit missing payload diagnosis;
- fresh-reader reconstruction.

The result only rejects unsupported lifecycle automation at the current evidence boundary.

## Limitations

- deterministic repository-shape evidence only;
- no production payload store;
- no measured storage cost or failure frequency;
- the race model demonstrates an authority gap but does not compare real distributed storage implementations;
- future concrete storage semantics may justify a different coordination mechanism.
