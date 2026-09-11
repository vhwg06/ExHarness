# NOOA substrate completion pipeline

This document is the execution authority for completing the NOOA-style programmable-agent substrate in ExHarness.

Detailed semantics and historical findings live in stage architecture artifacts and PRs. This file owns stage order, checkpoint, scope and exit gates.

## Execution rule

```text
pipeline authority on main
        ↓
stage N objective + non-goals + verification gate
        ├─ implementation track
        └─ verification track
             ├─ manual vigilance
             ├─ adversarial cases
             ├─ inspectable artifacts
             └─ stable automation when valuable
        ↓
PASS / GAP
   ├─ GAP  → repair same stage
   └─ PASS → merge stage PR to main
                  ↓
               stage N+1
```

Rules:

- every stage branches from current `main` after the prior stage is merged;
- one stage = one implementation PR;
- no stacked downstream implementation PRs;
- do not pull later-stage responsibilities into the current stage for convenience;
- tests/CI are verification artifacts, not the source of truth;
- material manual/adversarial findings must be recorded;
- a stage is DONE only when the exact final PR head passes its full gate and merged `main` remains healthy;
- architecture/order changes must patch this pipeline before downstream implementation continues.

## Status

```text
NOOA-01 Typed Judgment                         DONE
NOOA-02 Predict Strategy                       DONE
NOOA-03 AgentEvent working history             DONE
AVO-R1  Adaptive useful-range gate             DONE
NOOA-04 Context blocks + history selection     DONE
NOOA-05 ResourceRef / live resource semantics  DONE
NOOA-06 CodeAct execution loop                 DONE
NOOA-07 Nested tracing                         DONE
NOOA-08 Model routing / scoped overrides       DONE
NOOA-09 Runtime snapshot / resume              NEXT
NOOA-10 Reference substrate + adversarial eval PENDING
```

Current checkpoint: `NOOA-09`.

---

## Completed stage contracts

### NOOA-01 — Typed Judgment

Typed input/output judgment boundary, judgment-local strategy override, invalid data blocked before caller/strategy escape.

PR #10.

### NOOA-02 — Predict Strategy

Provider-neutral focused model judgment, bounded validation repair, provider failure distinct from validation failure, no tool authority leakage.

PR #11.

### NOOA-03 — AgentEvent working history

Canonical chronological model working journal separated from telemetry; runtime owns terminal lifecycle authority.

Architecture: `docs/architecture/agent-events.md`.
PR #13.

### AVO-R1 — Adaptive useful-range gate

Grounded search-investment control (`CONTINUE / STOP / ESCALATE`) separated from correctness, recovery and hard safety ceilings.

Architecture: `docs/architecture/adaptive-useful-range.md`.
PR #16.

### NOOA-04 — Context blocks + history selection

Named context blocks, explicit per-judgment selection, canonical subset history projection and deterministic prompt bounds.

Architecture: `docs/architecture/context-history.md`.
PR #17.

### NOOA-05 — ResourceRef / live resource semantics

Opaque runtime-scoped live-resource handles with explicit operations, lifetimes, authorization, bounded discovery and stable transport boundaries.

Architecture: `docs/architecture/resource-ref.md`.
PR #18.

### NOOA-06 — CodeAct execution loop

Bounded model → action → observation → typed terminal loop over existing executor/capability/resource authority.

Independent bounds:

- `maxTurns`;
- `maxActionCalls`;
- caller-visible `maxDurationMs`;
- `maxObservationChars`;
- existing runtime capability and executor limits remain authoritative.

Architecture: `docs/architecture/codeact.md`.
PR #19.

### NOOA-07 — Nested tracing

Causal runtime trees without collapsing working history or flat lifecycle telemetry:

```text
AgentEvent = model working history
EventBus   = flat lifecycle telemetry
TraceSpan  = causal runtime tree
```

Key contract:

- explicit `traceId / spanId / parentSpanId / callId`;
- judgment/strategy/model/action/execution/capability/resource nesting;
- async parent propagation and concurrent-call isolation;
- status/error/duration metadata;
- non-strict sinks observational by default;
- strict sink loss is explicit operational failure and cannot become model-recoverable CodeAct feedback;
- default runtime tracer is no-op, so tracing adds no hidden retained span history;
- production facade accepts explicit tracer injection and exposes trace inspection;
- trace shape has no correctness authority.

Architecture: `docs/architecture/nested-tracing.md`.
PR #21.

### NOOA-08 — Model routing / scoped overrides

Separates strategy behavior from scoped model selection.

Resolution precedence:

```text
invocation override
        >
judgment override
        >
runtime default
        >
legacy strategy-bound fallback
```

Key contract:

- lazy, single-flight model adapter registry;
- invocation overrides do not mutate judgment/runtime defaults;
- Predict and CodeAct consume a runtime-routed adapter per call;
- custom strategies must explicitly opt into routed models;
- unknown or mismatched routes fail closed;
- route/load failures remain inside canonical `TASK → ERROR` working history;
- `modelRoute` records resolution provenance;
- `modelUsage` separately records actual runtime-wrapped adapter `generate()` calls;
- route resolution is never treated as proof that the model was actually invoked;
- legacy strategy-bound fallback keeps compatibility but has no fabricated runtime-owned usage proof;
- routing provenance is observable input, not correctness authority.

Architecture: `docs/architecture/model-routing.md`.
Stage PR: #22.

---

## NOOA-09 — Runtime snapshot / resume — NEXT

Goal: make NOOA agent runtime working state resumable without conflating it with AVO persistent engineering memory.

Required semantics:

- versioned runtime snapshot schema;
- snapshotable AgentEvent working history;
- snapshotable safe context/runtime configuration;
- restore into a compatible fresh runtime;
- transient live resources/execution sessions are never fabricated;
- resource restoration requires explicit rebinding policy;
- runtime snapshot remains distinct from long-term semantic K and AVO work state.

Verification gate:

- restored working history preserves chronology;
- incompatible future/unknown schema fails closed;
- secrets/transient handles are not serialized accidentally;
- resume cannot silently reopen expired execution sessions;
- model routing/context configuration restore only under explicit compatible schema;
- AVO persistent state and runtime snapshot evolve independently.

---

## NOOA-10 — Reference substrate + adversarial evaluation

Goal: prove the completed substrate works as a reusable consumer-facing runtime rather than isolated APIs.

Reference scenario must demonstrate:

- typed judgments;
- Predict;
- AgentEvent working history;
- context selection;
- bounded live ResourceRefs;
- CodeAct;
- nested tracing;
- scoped model routing;
- runtime snapshot/resume;
- AVO variation above the substrate without kernel special cases.

Adversarial/evaluation targets include:

- Predict vs CodeAct on simple typed judgments;
- full vs selected history;
- progressive ResourceRef disclosure vs eager exposure;
- routing precedence and invalid routes;
- resume on/off;
- malformed model actions;
- stale resource refs;
- context poisoning;
- observation pressure;
- telemetry/tracing sink failures.

Metrics include at minimum:

- task success;
- invalid output rate;
- correction/retry count;
- model calls;
- execution/capability calls;
- prompt/context size where observable;
- false-success / unsafe-accept rate for the reference workload;
- resume fidelity.

This stage validates substrate contracts; it does not claim universal model quality.

---

## Completion condition

The NOOA substrate is complete when a blank consumer can import ExHarness and, without kernel source changes:

```text
define typed judgments
        +
choose Predict / CodeAct behavior
        +
control context + working history
        +
expose bounded live resources/capabilities
        +
route models by scope
        +
inspect nested traces
        +
snapshot/resume runtime state
        ↓
run under the existing AVO long-horizon control plane
```

Final layering:

```text
AVO
  long-horizon search / lineage / supervision / commit
        ↓
ExHarness NOOA-style substrate
  typed judgment / strategy / context / events / resources / execution
        ↓
Injected infrastructure
  models / tools / sandbox / store / tracing / trust authorities
```
