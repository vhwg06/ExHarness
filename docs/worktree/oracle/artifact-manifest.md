# Optional application-artifact manifest adapter

The current Agentic Application exports an opt-in manifest boundary for Backend -> QA artifact continuation. It implements the bounded D014 runtime slice without changing the default Oracle resolver or the existing `ApplicationArtifactRef`, `QaWorkOrder`, or `QaContext` schemas.

## Producer boundary

A trusted manifest is created from bytes available at the accepted Backend artifact-production boundary:

```text
accepted Backend run
+ exact produced artifact bytes
+ retention policy snapshot
 -> captureAcceptedBackendArtifactManifest(...)
 -> immutable APPLICATION_ARTIFACT_MANIFEST v1
 -> createJsonArtifactManifestStore(...).putManifest(...)
```

The manifest binds:

- artifact `ref/path`;
- Backend producer work-order id;
- accepted producer revision;
- acceptance-decision id + digest;
- stored artifact revision;
- SHA-256 content identity;
- availability metadata;
- retention policy revision + operational pin labels.

Artifact payload bodies are not stored in the manifest.

The first trusted manifest must not be created later by re-reading mutable QA-side bytes. The capture helper therefore requires the producer to provide the exact bytes corresponding to every accepted Backend artifact and rejects missing/extra coverage.

## Durable workflow composition

A manifest-protected `createDurableBackendQaWorkflow(...)` instance receives an explicit application-owned `artifactManifestPublisher`.

```text
Backend/Core accepted result
 -> artifactManifestPublisher.publishAcceptedBackendManifest(...)
    -> producer-side revision-bound bytes
    -> immutable manifest publication
    -> exact manifestRef
 -> QA_PENDING checkpoint
    -> accepted Backend handoff
    -> Backend completion decision
    -> artifactManifestRef
 -> fresh QA
    -> artifactReader.forManifest(artifactManifestRef)
    -> resolveQaContext(...)
```

The direct-reader workflow remains unchanged when no publisher is configured.

If publication fails after Backend execution, the workflow persists the existing Backend stage as `BLOCKED` with `backendRecoveryRequired=true`. After resume, execution re-enters `BackendWorker.recover(...)`; it does not perform a fresh Backend execute merely to recreate manifest state.

If manifest publication succeeds but the following Board checkpoint is interrupted, the durable manifest may be orphaned temporarily. Recovered Backend completion reuses the durable publication receipt when the same producer work-order/revision/artifact set resolves to the same producer bytes. The publication slot is keyed by producer work-order + producer revision + artifact ref/path set; the manifest itself still records the original acceptance-decision provenance. Recovery therefore retains that original provenance instead of treating a newly regenerated completion decision as a new publication identity. Conflicting producer bytes for the same publication slot fail closed.

Direct-reader mode remains unchanged when no publisher is configured.

## QA read boundary

The optional adapter wraps an existing `artifactReader`:

```text
QaWorkOrder required artifact
 -> createManifestArtifactReader
    -> durable manifest lookup by ref/path
    -> exact producer work-order check
    -> exact producer revision check
    -> exact acceptance-decision id/digest check
    -> stored-revision + availability check
    -> underlying artifactReader.readArtifact(...)
    -> content SHA-256 check
 -> ordinary { content, sourceRef }
 -> resolveQaContext(...)
 -> existing QaContext schema
```

The adapter does not widen the Oracle result shape and does not grant correctness or acceptance authority to a digest.

## Failure semantics

The adapter fails closed with source-specific errors:

```text
ARTIFACT_MANIFEST_MISSING
ARTIFACT_MANIFEST_CONFLICT
ARTIFACT_PRODUCER_MISMATCH
ARTIFACT_PRODUCER_REVISION_MISMATCH
ARTIFACT_ACCEPTANCE_DECISION_MISMATCH
ARTIFACT_STORED_REVISION_MISMATCH
ARTIFACT_UNAVAILABLE
ARTIFACT_CONTENT_MISMATCH
```

`resolveQaContext(...)` continues to wrap the source failure with the concrete application-artifact boundary while preserving the adapter error as `cause`.

Enabling the adapter never falls back silently to an unvalidated read.

## Persistence and reconstruction

`createJsonArtifactManifestStore(...)` persists immutable manifests behind an atomic publication slot keyed by accepted Backend producer/revision/artifact identity. Concurrent identical publishers converge on one manifest ref; concurrent conflicting bytes/provenance cannot both publish. Legacy content-addressed `manifest-<digest>.json` files remain readable. A fresh store/reader instance can reconstruct validation only from filesystem state; no producer-side in-memory manifest map is required. Protected workflow checkpoints persist the exact manifest ref and fresh QA scopes the reader through `forManifest(ref)`; switching a protected checkpoint to an ordinary direct reader fails closed.

The implementation test surface covers unchanged content, changed bytes behind a stable ref, missing bytes, partial manifests, wrong producer work order, wrong producer revision, wrong acceptance-decision id/digest, explicit unavailable metadata, conflicting manifests, and fresh-reader reconstruction.

## Cost surface

The reader exposes bounded diagnostic counters for evaluation only:

- manifest lookups;
- underlying reads;
- bytes hashed;
- validation failures.

These counters are not correctness evidence and are not routing/adoption authority.

## Limits

This is optional application infrastructure, not the default artifact path.

It does not establish:

- production artifact-store reliability;
- OS-process restart behavior beyond ordinary persisted filesystem semantics;
- independent authenticity if the same authority can rewrite both payload and manifest;
- semantic correctness of artifact content;
- Backend or QA acceptance correctness;
- infinite payload retention;
- automatic Board-derived retention release;
- proof that every producer source is immutable/revision-bound; protected publication requires an explicitly configured producer reader with that property;
- a generic artifact registry, Oracle provider registry, cache, or retrieval framework.

D014 remains the design authority for this boundary. Default adoption or stronger retention lifecycle automation requires separate evidence.
