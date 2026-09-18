# BB-044 — Durable artifact-manifest publication boundary

Status: **RESEARCH CANDIDATE**

Evidence class: `DETERMINISTIC_REPOSITORY_INTEGRATION_FIXTURE`

Production evidence: `false`

## Question

After BB-043 delivered the optional D014 manifest primitives, where must manifest publication sit in the durable Backend -> QA workflow so that:

- QA never becomes manifest-protected by implication before the exact manifest is durable;
- a crash does not require replaying an effectful Backend mutation merely to recreate manifest state;
- the first trusted manifest is still created from a producer-side identity boundary rather than from later mutable QA-side bytes;
- Oracle remains a source-resolution boundary rather than workflow/lifecycle authority?

## Current source ordering

The current accepted-Backend path in `createDurableBackendQaWorkflow(...)` is:

```text
Backend Worker/Core execution
 -> BackendCompletionAction.ACCEPT
 -> createQaHandoffFromBackendRun(...)
 -> backendCheckpointAfterAccept(..., QA_PENDING)
 -> orchestrator.checkpoint(...)
 -> QA becomes eligible
```

BB-043 adds:

```text
captureAcceptedBackendArtifactManifest(...)
createJsonArtifactManifestStore(...)
createManifestArtifactReader(...)
```

but the durable workflow does not currently compose those primitives into the accepted-Backend transition.

## Executable baseline

`packages/agentic-system/test/bb044-manifest-publication-boundary-research.test.js` runs the real durable workflow with the delivered manifest-validating reader enabled.

It demonstrates:

1. Backend completion is accepted.
2. The workflow persists `QA_PENDING`.
3. The accepted Backend checkpoint contains no `manifestRef`.
4. The durable manifest store is still empty.
5. A fresh session claims the now-visible QA stage.
6. QA context resolution then fails closed with `ARTIFACT_MANIFEST_MISSING` and the workflow becomes `BLOCKED`.

This is not a failure of BB-043 validation: the adapter correctly refuses an unmanifested artifact. The gap is ordering/composition. `QA_PENDING` currently means only that Backend acceptance/handoff is durable; it does not mean the optional manifest protection has been established.

The fixture also shows that manually publishing the manifest after `QA_PENDING` lets a fresh QA session proceed. That proves the adapter and durable store compose technically, while also proving the current Board checkpoint cannot establish **when** the manifest became trusted.

## Crash matrix

### A — crash before Backend effect or before Core records effect truth

Authority remains the existing Backend/Core recovery boundary.

No manifest-specific recovery should infer whether Backend mutation occurred.

### B — Backend accepted in memory, crash before manifest publication

Current Board state has not yet published QA continuation if the future integration moves manifest publication ahead of `QA_PENDING`.

Recovery must first use existing Backend/Core effect/session truth to recover the accepted Backend result. It must not redispatch Backend merely because the manifest is missing.

Manifest publication may resume only from a producer-side capability that can recover the exact accepted artifact identity/bytes under the accepted Backend revision.

### C — manifest publication committed, crash before Blackboard QA checkpoint

This creates an orphan durable manifest, not an invalid Board transition.

Safe recovery requires manifest publication to be idempotent for the same accepted Backend identity. A repeated publish of the same producer/revision/decision/artifact bytes must resolve to the same immutable manifest identity; conflicting bytes/provenance must fail closed.

After the accepted Backend result is recovered through the existing Core path, the application may re-establish the exact manifest ref and only then persist `QA_PENDING`.

### D — manifest durable and `QA_PENDING` checkpoint durable

A fresh session may resolve QA using the optional validating reader.

The checkpoint should retain the exact `manifestRef` as continuation provenance. The Board still stores refs/lifecycle, not artifact payloads.

### E — payload later unavailable or changed

The delivered manifest reader already handles this as source failure/integrity failure. Existing QA blocked-resolution handling may persist the exact `QA_PENDING` checkpoint.

This failure must not reopen Backend effect execution by default.

## Minimum producer-side capability

The research does **not** support having the durable workflow itself read arbitrary artifact bytes from the QA-side `artifactReader` to mint the first manifest.

The minimum integration surface should be a producer-bound capability with these semantics:

```text
publishAcceptedBackendManifest(acceptedBackendRun)
  -> durable immutable manifestRef

requirements:
  - source is bound to the accepted Backend producer/revision
  - exact artifact refs/paths are covered
  - exact bytes used for digest are producer-side bytes for that accepted revision
  - repeated identical publication is idempotent
  - conflicting identity/bytes fail closed
  - no Board mutation authority
  - no QA acceptance authority
```

For interrupted recovery, either:

1. the same producer capability can reconstruct the exact accepted producer bytes from immutable/revision-bound producer storage; or
2. it exposes its own durable publication-intent/capture state that can finish without re-reading mutable QA-side bytes.

If neither property exists, runtime integration should remain disabled rather than pretending the first manifest is trustworthy.

## Proposed application ordering

```text
Backend/Core execution
 -> accepted Backend result recovered/produced
 -> application producer-manifest publisher
      -> exact producer bytes
      -> immutable manifest publication
      -> manifestRef
 -> application persists QA_PENDING checkpoint
      -> accepted Backend handoff
      -> completion decision ref
      -> manifestRef
 -> fresh QA session
      -> manifest-validating artifactReader
      -> resolveQaContext(...)
```

The publisher is application-owned composition around source storage. Oracle still only resolves the declared QA artifact through the injected reader.

## Required runtime checkpoint change

If implemented, the accepted Backend checkpoint should add an optional exact manifest ref:

```text
acceptedBackend:
  handoff: ...
  completionDecision: ...
  artifactManifestRef: artifact-manifest://sha256:...
```

The field is optional for compatibility because the direct non-manifest reader remains a supported default.

When manifest protection is configured for a workflow instance:

- `QA_PENDING` must not be committed without the exact manifest ref;
- the manifest ref must be added to durable Board artifact refs;
- a fresh session must reconstruct the same manifest requirement;
- switching from protected to unprotected resolution during recovery must fail closed unless the workflow was explicitly configured as direct-reader mode from the beginning.

## What not to do

Do not:

- create the first manifest from later mutable QA-side bytes;
- mark `QA_PENDING` as protected merely because a manifest adapter exists in the package;
- replay Backend execution only to recreate manifest metadata;
- put artifact payload bodies into Blackboard;
- make Oracle own the publish/checkpoint transition;
- treat hash equality as semantic correctness;
- introduce a generic provider/registry abstraction.

## Judgment

**IMPLEMENT, NARROWLY — but only behind explicit manifest-protected workflow configuration.**

The current integration gap is concrete and reproducible: BB-043 can fail closed at QA, but the durable workflow does not establish producer-manifest durability before exposing QA continuation.

A bounded implementation should add one application-owned producer-manifest publisher boundary to `createDurableBackendQaWorkflow(...)`, persist the exact manifest ref in the accepted Backend checkpoint before `QA_PENDING` becomes visible, and preserve existing Core recovery as the only authority for effectful Backend replay/recovery.

The implementation must include a crash matrix proving:

- no manifest configured -> current direct-reader behavior unchanged;
- protected mode -> QA_PENDING requires exact durable manifest ref;
- publisher failure does not produce QA_PENDING;
- interruption after manifest publication but before Board checkpoint is recoverable through idempotent publication + existing Backend recovery, not fresh Backend execution;
- fresh QA uses the same exact manifest ref/protection mode;
- missing/changed payload after QA_PENDING remains a QA/source blocker, not a Backend replay trigger.

## Limits

- deterministic repository integration only;
- no production artifact store;
- no measured outage frequency;
- no network/storage latency or cost claim;
- no proof of independent authenticity when producer storage and manifest storage share an authority;
- no default adoption recommendation beyond workflows that explicitly opt into manifest protection.
