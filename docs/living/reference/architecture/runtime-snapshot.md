# NOOA-09 — Runtime snapshot / resume

## Goal

Make NOOA working state resumable without conflating it with AVO persistent engineering memory or serializing live runtime authority.

```text
AgentRuntime
= live execution

ResumableAgentRuntime
= versioned working-state persistence boundary

AVO persistent state
= separate long-horizon engineering memory / lineage / evaluation state
```

## Snapshot contract

Schema v1 stores only:

- version/type/createdAt;
- an integrity digest;
- a safe runtime configuration manifest;
- chronological `AgentEvent` working history;
- AGENT resource state by stable resource name and active/revoked state.

It does **not** serialize:

- live resource values;
- `ResourceRef` registry IDs or authority IDs;
- CALL-scoped resources;
- executor/process/browser sessions;
- provider/model adapter objects or credentials;
- trace recorder state or EventBus history;
- AVO persistent state / K / lineage / verification state.

## Compatibility

`createResumableAgentRuntime()` requires an explicit `runtimeCompatibilityTag`.

The structural runtime configuration manifest also binds:

- strategy shape;
- capability names/contracts;
- context policy and block structure/digests;
- judgment structure and scoped model/context selection;
- model routing defaults/registration names;
- resource policy and resource definition digests.

A snapshot restores only when the configuration digest matches exactly. The explicit compatibility tag is required because executable function implementation compatibility cannot be inferred reliably from JavaScript function objects.

Future/unknown schema versions fail closed.

## Payload policy

Default:

```text
payloadMode = OMIT
```

AgentEvent chronology/identity remains, while event payloads become explicit `PAYLOAD_OMITTED` markers.

For richer resume context:

```text
payloadMode = SANITIZE
sanitizeEventPayload(...)
```

The sanitizer receives an **authority-safe pre-redacted payload**. The kernel removes `ResourceRef` authority before invoking the consumer sanitizer, then validates/sanitizes the returned JSON-style data again. A sanitizer therefore cannot copy raw `registryId` / ref ID into another field.

Payload sanitization is still consumer policy; it is not a general secret classifier.

## Quiescent snapshot boundary

A snapshot is refused while any tracked live operation is active:

- agent run;
- typed judgment invocation;
- resource describe;
- direct resource invoke.

This prevents persistence from pretending an in-flight operation/execution session can be resumed from serialized state.

## Resource restoration

AGENT resources are rebound by **name**, never by old ref identity.

For an active resource in the snapshot:

```text
fresh runtime registers resource
        ↓
fresh ResourceRef
        ↓
explicit resourceRebind(...) === true
        ↓
resource remains active
```

Without explicit approval, restore fails with `RUNTIME_SNAPSHOT_RESOURCE_REBIND_REQUIRED`.

Revoked resources are revoked again in the fresh runtime and do not require rebinding. Old refs remain invalid because the new runtime has a fresh registry identity and fresh ref IDs.

## Integrity vs trust

The snapshot digest detects accidental/stale body changes under the runtime contract. It is **not** an authenticated signature or attestation.

```text
snapshot digest
= structural integrity check

!= producer authenticity
!= trusted provenance
!= correctness proof
```

If snapshot authenticity matters across a trust boundary, it must be signed/attested by the existing trust architecture above this runtime primitive.

## Verification findings

Material findings that changed the implementation:

1. Initial active-call tracking covered agent runs but not direct resource operations. `describeResource` and `invokeResource` are now part of the quiescent snapshot boundary.
2. Initial SANITIZE flow called the consumer sanitizer before ResourceRef redaction. That allowed a sanitizer to copy raw authority identifiers elsewhere. ResourceRef redaction now happens before the sanitizer sees payload data.
3. Structural manifests cannot prove executable function implementation compatibility. Resumable runtimes now require an explicit `runtimeCompatibilityTag`.
4. The first resource restore test assumed `describeResource()` exposed a top-level `name`. N5's contract returns `{ ref, description, metadata, operations }`; the test was corrected instead of changing an established API.

## Residual boundaries

- schema v1 has fail-closed compatibility, not a general runtime-snapshot migration framework;
- SANITIZE mode relies on consumer policy for non-ResourceRef secrets;
- the integrity digest is not authentication;
- live external work cannot be resumed unless its adapter independently supports reconciliation/recovery;
- AVO persistent session recovery remains a separate control-plane concern.
