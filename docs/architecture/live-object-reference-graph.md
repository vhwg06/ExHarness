# Live object reference graph

NOOA-F2 extends ExHarness from named `ResourceRef` resources to explicit live-object graph handles while preserving JavaScript object identity, mutation visibility, lifetime boundaries, and snapshot freshness.

The semantic target is NOOA-style live objects by reference, not object serialization and not unrestricted JavaScript reflection.

## Identity model

A live object crosses the runtime boundary as an opaque handle:

```text
JavaScript object identity
        +
explicit authority surface
        +
lifetime / call scope
        ↓
LIVE_OBJECT_REF
```

The stable-identity rule is:

```text
same object + same surface + same lifetime scope
→ same handle

same object + different surface authority
→ different handle
```

`LIVE_OBJECT_REF` is a sibling of the existing `RESOURCE_REF`; F2 does not change the legacy `ResourceRef` contract. AgentRuntime uses the same `registryId` authority domain for both registries while retaining distinct ref kinds so a live-object handle cannot be resolved as a resource ref or vice versa.

## Explicit authority surface

A live object is never exposed by traversing arbitrary fields or prototype members. Consumers declare a bounded surface with explicit methods and properties:

```js
const nodeSurface = defineLiveObjectSurface({
  id: "graph.node",
  type: "Node",
  methods: [
    { name: "child", resultSurface: () => nodeSurface },
    { name: "rename", mutates: true }
  ],
  properties: [
    { name: "name", read: (node) => node.name }
  ]
});
```

Important authority rules:

- undeclared members cannot be invoked/read;
- getters/accessors are not executed during method discovery;
- method implementations are resolved and bound when the object is exposed;
- later application monkeypatching cannot silently replace an already-authorized method body;
- surface IDs cannot alias different definitions inside one registry;
- surface/member descriptions and total handle count are bounded by `LiveObjectPolicy`;
- authorization callbacks may independently deny describe/read/invoke actions.

This preserves the F1 attach-time authority rule for nested live objects.

## Nested graph semantics

A method or property may explicitly declare `resultSurface`. When it returns another live object, the runtime emits another opaque handle instead of serializing the value.

```text
root handle
   ↓ child()
child handle
   ↓ parent()
root handle (same id)
```

Cycles therefore remain cycles of runtime identity rather than serialized object graphs. Mutations through an authorized method affect the original JavaScript object and are visible through later reads/handles.

Nested handles inherit the parent lifetime. A `CALL`-scoped root cannot produce an `AGENT`-scoped child by returning an object.

## Transport and confused-deputy boundary

Ordinary live-object method/property results remain a JSON-compatible transport boundary. A custom/live object may not be silently converted to plain data merely because `structuredClone()` can clone it.

The rule is:

```text
plain JSON-compatible result
→ transport value

live/custom object result
→ requires explicit resultSurface

LIVE_OBJECT_REF in ordinary transport result
→ rejected
```

F2 validates the original object graph before cloning because `structuredClone()` can erase a custom prototype and otherwise launder a live object into a plain object.

Passing one live handle into another live method is also denied by default. A method must opt in with `allowLiveArgs: true`; only then does the registry resolve the referenced live value for that call. This prevents every method from becoming an implicit confused-deputy bridge between authorities.

## Lifetime, revocation, and tombstones

Supported lifetimes reuse `ResourceLifetime`:

- `AGENT` — valid for the runtime lifetime until revoked;
- `CALL` — valid only for the owning invocation/call ID.

`closeCall(callId)` expires all call-scoped live handles, including nested handles created during the call. Revoked/expired refs remain deterministic tombstones so stale callers receive `LIVE_OBJECT_REVOKED` / `LIVE_OBJECT_EXPIRED` instead of an ambiguous missing-ref error.

When authority is retired, the registry removes its identity mapping and drops the raw object plus bound method closures. The tombstone retains only metadata needed to reject stale refs deterministically. Re-exposing the same JavaScript object after revocation or in a later call therefore creates fresh authority with a new handle.

## AgentRuntime surface

AgentRuntime exposes named live roots to strategies without putting raw JavaScript objects into strategy/model context:

```text
liveObjects: [{ name, ref }]
describeLiveObject(ref)
invokeLiveObject(ref, method, args)
readLiveObject(ref, property)
```

Runtime-level APIs provide the same operations for explicit host/application use, plus `revokeLiveObject(ref)` and `liveObjectPolicy()`.

Invocation-scoped roots may be supplied through `run({ liveObjects: [...] })`; they must use `CALL` lifetime and cannot shadow configured agent roots.

Live-object host operations participate in the existing causal trace tree through `LIVE_OBJECT` and `LIVE_OBJECT_DESCRIBE` spans. `instrumentAgentRuntime()` preserves the live-object APIs instead of accidentally dropping them when observability wrapping is enabled.

## Snapshot and restore

Snapshot/resume preserves requirements and state, never transient live authority.

A snapshot with live roots records:

```text
configuration
  ├ liveObjectPolicy
  └ liveObjects
       ├ name
       ├ lifetime
       └ surface / definition digest

state
  └ agentLiveObjects
       ├ name
       └ active
```

It does **not** persist:

```text
raw JavaScript value
bound method/function body
LIVE_OBJECT_REF id
registryId
transient CALL handles
```

Event payload sanitization redacts live refs before a consumer sanitizer can inspect them, just like existing resource authority redaction.

Restoring an active live root requires explicit `liveObjectRebind(...)` approval and creates fresh runtime authority. Old refs cannot resolve in the restored registry. Revoked roots remain revoked and do not require rebinding.

A changed live-object authority surface changes the runtime configuration manifest and fails compatibility before restore.

Backward compatibility is deliberate: when no live objects are configured, pre-F2 runtime configuration/snapshot shape remains unchanged; no empty `liveObjects`, `liveObjectPolicy`, `agentLiveObjects`, or live-ref redaction fields are added merely by upgrading the package.

## Verification findings

The F2 implementation + verification tracks materially changed the candidate:

1. **Prototype laundering through `structuredClone()`.** The first full matrix found that a custom class returned without `resultSurface` could become a plain cloned object before validation. F2 now validates the original graph before cloning and keeps custom/live values behind explicit handles.
2. **Opaque-handle authority escape.** Manual review found that a returned `LIVE_OBJECT_REF` is itself a plain object and could otherwise cross an ordinary JSON result path. Transport validation now rejects direct or nested live refs unless authority is intentionally represented through `resultSurface`.
3. **Retired-handle retention.** Manual review found that stale records could keep raw live values and bound method closures even after authority expired/revoked. Retirement now keeps tombstone metadata but releases the live object/closures and removes identity reuse.
4. **Observability wrapper surface loss.** Runtime review verified that live APIs must survive `instrumentAgentRuntime()` just like resource APIs; F2 adds explicit wrapper preservation and regression coverage.
5. **Snapshot authority freshness.** Live IDs/registry IDs are redacted rather than persisted. Active roots require explicit fresh rebinding; changed surfaces fail compatibility; revoked roots remain revoked.
6. **Packed public-package graph proof.** The blank consumer creates a cyclic root/child graph, mutates the child through a nested handle, returns to the exact root handle through the cycle, and observes the mutation on the original object rather than a clone.

## Residual boundary

F2 deliberately keeps lightweight revoked/expired tombstone metadata for deterministic stale-ref classification. Raw objects and bound closures are released, so tombstones do not retain live authority, but the metadata set is not yet compacted by a bounded-retention policy.

That matters for future high-churn execution sessions. F4 must either use a session lifecycle that disposes call-local registries/handles or introduce an explicit bounded tombstone-retention contract without permitting stale-handle authority resurrection. F2 does not claim zero metadata growth under unbounded handle churn.

## Claim boundary

F2 proves explicit live object identity/graph semantics and safe host-mediated operations. It does not yet claim:

- progressive `doc(self)` / `doc(handle)` discovery;
- model-visible transitive reflection;
- persistent JavaScript CodeAct locals;
- language-native generated JavaScript proxies/host bridge;
- cross-process JavaScript identity without an explicit bridge;
- bounded tombstone metadata under unbounded handle churn.

Those are owned by F3 and F4. In particular, F2 is the host-side live-authority substrate that F4 can expose through sandbox proxies; it is not itself a JavaScript REPL or sandbox.
