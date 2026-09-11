# NOOA completion pipeline

ExHarness already has a mature AVO/control-plane, objective-verification, trust, and process-security model. The remaining work is to complete the NOOA-style programmable agent substrate without copying NOOA's Python syntax.

The implementation proceeds as eight sequential slices. Each slice must merge to `main` before the next slice starts.

```text
NOOA-01 Typed Judgment
        |
        v
NOOA-02 Predict Strategy
        |
        v
NOOA-03 AgentEvent working history
        |
        v
NOOA-04 Context blocks + history selection
        |
        v
NOOA-05 ResourceRef / live capability semantics
        |
        v
NOOA-06 CodeAct execution loop
        |
        v
NOOA-07 Nested tracing
        |
        v
NOOA-08 Model routing / scoped overrides
```

## Process rule

Every slice forks implementation and objective verification.

```text
objective
   |
   +---- implementation candidate
   |
   `---- verification track
          |- manual vigilance
          |- adversarial cases
          |- inspectable artifacts
          `- stable checks where valuable

                |
                v
            PASS / GAP
```

A green test suite is a regression artifact, not the source of truth for the slice.

## NOOA-01 — Typed Judgment

Goal: make one fuzzy/model-backed judgment a first-class typed runtime boundary.

Required semantics:

- named judgment definition;
- input parser/validator;
- output parser/validator;
- optional per-judgment strategy override;
- explicit public runtime invocation;
- existing generic `run()` remains compatible;
- no retry/model/provider policy yet.

Verification challenges:

- invalid input never reaches the strategy;
- invalid output never leaks to the caller;
- judgment-local strategy does not mutate the runtime default;
- duplicate judgment names fail fast;
- low-level generic run remains unchanged.

## NOOA-02 — Predict Strategy

Goal: provide a focused non-tool judgment strategy with structured validation feedback/retry.

Required semantics:

- model adapter contract;
- bounded attempts;
- declared output validation;
- validation failures become model-visible feedback;
- no capability/tool loop;
- deterministic attempt history.

## NOOA-03 — AgentEvent working history

Goal: separate model working history from telemetry.

Required semantics:

- `AgentEvent` is chronological cognition/work history;
- task/model/validation/error/result event kinds;
- `TelemetryEvent != AgentEvent`;
- working history can be selected independently of observability sinks.

## NOOA-04 — Context blocks + history selection

Goal: distinguish deliberate prompt context from chronological events.

Required semantics:

- named fixed and dynamic context blocks;
- trusted instruction/context channel distinct from call data;
- per-judgment context selection;
- history filtering/summarization hook;
- bounded rendering/dosage.

## NOOA-05 — ResourceRef / live capability semantics

Goal: let an agent operate on live resources without serializing raw objects into the model context.

Required semantics:

- opaque `ResourceRef`/handle;
- explicit visible operations;
- no raw resource serialization;
- per-run/per-agent lifetime rules;
- progressive capability/resource discovery;
- security boundary stays explicit.

## NOOA-06 — CodeAct execution loop

Goal: provide a bounded inspect/execute/observe/return strategy over the execution boundary.

Required semantics:

- per-call execution session;
- iterative model turns;
- execute and return-result actions;
- capability/resource access;
- typed final output validation;
- text-only recovery policy;
- iteration/time/capability budgets;
- OS isolation remains an injected executor responsibility.

## NOOA-07 — Nested tracing

Goal: record the complete runtime call tree rather than flat lifecycle telemetry.

Required semantics:

- parent/child spans;
- judgment/model/execution/capability nesting;
- stable correlation IDs;
- tracing failure cannot silently alter correctness policy.

## NOOA-08 — Model routing / scoped overrides

Goal: separate interaction strategy from model selection and resolve model configuration by scope.

Required semantics:

- runtime default model;
- judgment override;
- invocation override;
- lazy adapter resolution;
- routing provenance available to process-trust manifests;
- no model selection leaked into a judgment's domain contract unless explicitly requested.

## Completion condition

The NOOA substrate is complete when a consuming project can define typed judgments, choose Predict or CodeAct behavior, expose bounded live resources/capabilities, control context/history, route models by scope, and inspect nested traces while AVO remains the long-horizon control plane above it.
