# Scoped model routing

NOOA-08 separates interaction strategy from model selection.

The runtime owns route resolution. Predict and CodeAct consume a resolved adapter, but neither strategy decides which scoped model wins.

## Resolution

```text
invocation override
        >
judgment override
        >
runtime default
        >
legacy strategy-bound fallback
```

The first three levels are runtime-owned routing. The final level exists only for backward compatibility with strategies created before routing was first-class.

A scoped override affects one call. It never mutates lower-precedence configuration.

## Registry and lazy loading

A model registry maps a model selector to a provider-neutral model adapter.

Registrations may contain an already-created adapter or a lazy loader. Lazy loaders are:

- resolved only when their selector wins routing;
- single-flight for concurrent resolution of the same model;
- cached only after successful resolution;
- retryable after a failed load;
- required to return an adapter whose identity matches the requested route.

The route boundary re-normalizes adapters returned by custom registries and validates the requested name again. Registry labels are not trusted as adapter identity by themselves.

## Strategy independence

Built-in Predict and CodeAct declare that they accept a routed model per invocation.

```text
strategy behavior
       +
runtime-resolved model
       ↓
one invocation
```

A custom strategy must explicitly declare `acceptsRoutedModel: true` before scoped routing may be used with it. Otherwise the runtime fails before strategy execution. A routing override is never silently ignored.

Ordinary judgment metadata intentionally does not expose its model override. Model routing is runtime configuration, not part of the domain judgment contract unless a consumer explicitly asks for routing reports.

## Route resolution is not model usage

These are separate facts:

```text
model selector
→ what configuration requested

modelRoute
→ which adapter the runtime resolved

modelUsage
→ how many times the runtime-owned routed adapter generate() was actually invoked
```

A model-aware custom strategy may receive a valid routed adapter and never call it. Such an invocation has a valid `modelRoute` and `modelUsage.calls === 0`.

For runtime-routed adapters, the runtime wraps `generate()` and records usage for that invocation. This is stronger evidence than route resolution alone, but it still means only that the local adapter function was called. It does not prove an external provider, runtime, OS, or hardware behaved honestly.

Legacy constructor-bound strategy models retain route provenance for compatibility but expose `modelUsage = null`, because the runtime does not own and wrap that adapter. The kernel does not fabricate usage proof.

## Working history, traces and telemetry

Built-in model strategies record the adapter identity and route in model working events. Nested model spans carry the same route metadata. Production lifecycle telemetry exposes both `modelRoute` and `modelUsage` when available.

These are observability/provenance surfaces, not correctness verdicts.

A model load or route-resolution failure occurs inside the runtime-owned call lifecycle:

```text
TASK
  ↓
route / load failure
  ↓
ERROR
```

Routing failures cannot disappear outside the canonical AgentEvent journal.

## Production composition

`createHarness()` can compose an internal agent runtime with:

```text
models
model
modelRegistry
```

and exposes `modelRouting()` for explicit inspection.

When a consumer supplies a custom `agent`, that agent owns model routing. Passing custom-agent plus production-facade routing configuration fails fast rather than silently dropping configuration.

## Trust boundary

Model route and usage provenance are inputs that higher-level process-trust code may bind into a verification-domain or control-input manifest. The routing layer itself does not establish trust in a provider/model identity.

In particular:

```text
route says model X was selected
usage says routed adapter X was called

neither says:
model X was correct
provider X was uncompromised
policy choosing X was good
```

Those remain separate evaluation and trust questions.

## Non-goals

NOOA-08 does not implement:

- automatic model-quality or cost ranking;
- provider-specific retries, load balancing or credentials;
- model fallback after provider failure;
- acceptance policy for model versions;
- runtime snapshot/resume;
- model identity as correctness authority.

Runtime snapshot/resume of compatible routing configuration belongs to NOOA-09.
