# Architecture state

Current implemented architecture projection; not a history of completed stages.

## LAYERS

```text
consumer/domain semantics
        ↓
createHarness()
  composition + recovery/search/supervision/observability/trust
        ↓
AVO control plane
  persistent candidate/variation/evidence/lineage lifecycle
        ↓
AgentRuntime / ObjectAgent substrate
  judgments + capabilities + context + events + model routing
  Predict / CodeAct / JavaScript CodeAct
  resources + live objects + progressive discovery
        ↓
injected infrastructure
  model / environment / executor / durable store / tracer / authorities
```

## STATE AUTHORITIES

- `PersistentWorkState` — long-horizon AVO work/candidate/evidence/lineage state.
- `AgentEvent` / `TurnEvent` — runtime working history and turn lifecycle; distinct from AVO trajectory.
- runtime snapshot — resumable runtime configuration/event state, not AVO work state.
- semantic memory — cognition state; retrieval ranking cannot certify correctness.
- effect journal — operation recovery state; distinct from traces and candidate state.
- evidence/evaluation/trust artifacts — correctness/trust inputs; promotion additionally enforces evaluation freshness.

## CONTEXT MODEL

Context is explicitly selected and bounded by block count, history count and serialized size. History selection can only select canonical events; reduction produces a bounded projection rather than replacing canonical history.

## PUBLIC SURFACE

`exharness` exports the core/runtime/AVO composition. Effect reconciliation and NOOA memory retrieval also have dedicated package subpaths (`exharness/effects`, `exharness/memory-retrieval`), reflecting that they are currently separable primitives rather than automatically composed workflow semantics.

## SOURCE

`package.json`, `index.js`, `state.js`, `context.js`, `agent-runtime.js`, `object-agent.js`, `harness.js`, `avo-harness.js`, `runtime-snapshot.js`, `resumable-agent-runtime.js`.
