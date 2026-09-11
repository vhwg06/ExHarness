# NOOA live ResourceRef semantics

NOOA-05 introduces a live-resource boundary for ExHarness. The goal is to let an agent operate on stateful repository/client/session/tool objects without serializing those raw objects into model-visible data.

```text
live object
   |
   v
ResourceRegistry
   |
   +--> ResourceRef
   |      opaque identity only
   |
   +--> describe(ref)
   |      bounded metadata + declared operations
   |
   `--> invoke(ref, operation, input)
          explicit operation allowlist
```

## Authority model

A `ResourceRef` is a runtime authority handle, not a copy of the resource.

Model/strategy-visible refs contain only:

```text
kind
registryId
id
name
lifetime
```

The raw `value`, private fields, prototype methods, credentials and internal implementation are retained inside the registry.

A ref from another registry is invalid even if its resource name and lifetime match. A ref whose visible fields do not match the registry record also fails closed.

The handle itself is not cryptographic proof and does not create trust. Authority comes from the runtime registry record, declared operations, lifetime checks and any consumer authorization policy.

## Explicit operations only

A resource definition exposes an operation allowlist.

```js
defineResource({
  name: "repo",
  value: liveRepository,
  operations: [
    {
      name: "read",
      async execute(repo, input) { ... }
    }
  ]
})
```

The runtime never reflects arbitrary methods or fields from `value`. Asking for an undeclared operation fails with `RESOURCE_OPERATION_NOT_ALLOWED`.

This means a live object may contain methods or secrets that are impossible to reach through the ResourceRef surface unless the consumer explicitly exposes an operation that returns them.

## Progressive discovery

Initial strategy-visible refs do not include metadata or the operation catalog.

```text
resources[]
   -> opaque refs only

explicit describeResource(ref)
   -> description
   -> bounded metadata
   -> declared operation names/descriptions/mutation flags
```

This keeps live-resource context separate from eager prompt/tool-surface dumping.

## Lifetimes

Two lifetimes are supported.

### AGENT

Registered when the runtime is created and remains live until explicitly revoked or the runtime itself is discarded.

### CALL

Registered for one agent invocation. The runtime binds it to that invocation's `callId` and expires it in `finally`, including failure paths.

```text
call starts
   -> register CALL resources
   -> strategy may describe/invoke
call exits (success or error)
   -> closeCall(callId)
   -> handles expire
```

Concurrent calls may use the same CALL resource name because identity is scoped by call. A CALL resource cannot shadow an AGENT resource name.

## Revocation and stale handles

Revocation and expiry are distinct operational states.

```text
revoked AGENT ref -> RESOURCE_REVOKED
expired CALL ref  -> RESOURCE_EXPIRED
foreign/tampered  -> RESOURCE_REF_INVALID
```

Old records remain non-active so stale handles cannot silently resolve to a later resource that reused the same visible name.

## Transport boundary

Resource operation inputs and outputs cross a JSON-style transport boundary:

- null/string/boolean/finite number;
- arrays;
- plain objects with string keys.

`Map`, class instances, symbols, cycles, `BigInt`, functions and raw live objects are rejected at this boundary.

Consumer parsers may validate/canonicalize the request and operation implementations still receive the live resource internally. Parsed outputs are re-checked before they leave the registry.

## Authorization

Consumers may inject a registry authorization callback. The callback can deny description or invocation of a declared operation, including mutation-sensitive policies based on the operation metadata.

This stage treats that callback as an optional coarse authorization boundary. Payload-specific policy can also live in the operation input parser/implementation. NOOA-06 will add the execution-loop policy/budget layer around model-driven repeated resource use.

## Runtime integration

Agent runtime exposes:

```text
resources            opaque refs visible to the strategy
describeResource     explicit progressive discovery
invokeResource       explicit allowed operation invocation
```

Runtime-level introspection also exposes only refs/policy/descriptions, never raw values.

Predict intentionally does not forward the ResourceRef surface to the model adapter. Predict remains a focused no-tool strategy. CodeAct is the later stage that will deliberately expose bounded resource actions to model-generated execution.

## Observability

Instrumentation preserves the public resource APIs but does not unwrap or log live values. Nested per-resource tracing is intentionally deferred to NOOA-07.

## Security invariants

```text
ResourceRef != raw object
ResourceRef != arbitrary reflection
registered resource != automatically serialized prompt context
declared operation != automatically authorized action
CALL ref != reusable cross-call authority
foreign ref != local authority
```

A consumer can still expose a dangerous operation or leak a secret through an operation result. ResourceRef makes that authority explicit and bounded; it cannot prove that a consumer-chosen API is safe.

## Non-goals

NOOA-05 does not implement:

- CodeAct or model-generated execution loops;
- OS/process/container isolation;
- general distributed-object references;
- arbitrary reflection over JavaScript objects;
- snapshot/rebinding of live resources;
- nested tracing spans;
- model routing;
- universal payload authorization policy.

Those responsibilities remain in later pipeline stages or consumer adapters.