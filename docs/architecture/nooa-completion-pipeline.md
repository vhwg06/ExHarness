# NOOA substrate completion pipeline

This document is the execution authority for completing the NOOA-style programmable-agent substrate in ExHarness.

ExHarness already has the AVO long-horizon control plane plus verification, trust/process attestations, recovery, persistence, execution boundaries, adaptive search investment, and the first six NOOA substrate stages. This pipeline defines stage order and exit gates without duplicating the detailed architecture/history kept in each stage artifact and PR.

## Execution rule

Work proceeds strictly one stage at a time.

```text
pipeline authority on main
        |
        v
stage N objective + non-goals + verification gate
        |
        +---- implementation track
        |
        `---- verification track
                 |- manual vigilance
                 |- adversarial cases
                 |- inspectable artifacts
                 `- stable automation when valuable
        |
        v
PASS / GAP
        |
        +-- GAP  -> repair same stage
        |
        `-- PASS -> merge stage PR to main
                         |
                         v
                      stage N+1
```

Rules:

- every stage branches from the current `main` after the previous stage is merged;
- one stage = one implementation PR;
- no stacked downstream implementation PRs;
- do not pull later-stage responsibilities into the current stage merely because they are convenient;
- tests and CI are verification artifacts, not the source of truth;
- manual/adversarial findings that change implementation must be recorded in the stage PR;
- stage-specific architecture notes hold detailed semantics and residual limits;
- a stage is not DONE until the exact final PR head passes its full verification gate and merged `main` remains healthy;
- if architecture or stage ordering changes materially, patch this pipeline before continuing implementation.

## Status

```text
NOOA-01 Typed Judgment                         DONE
NOOA-02 Predict Strategy                       DONE
NOOA-03 AgentEvent working history             DONE
AVO-R1  Adaptive useful-range gate             DONE
NOOA-04 Context blocks + history selection     DONE
NOOA-05 ResourceRef / live resource semantics  DONE
NOOA-06 CodeAct execution loop                 DONE
NOOA-07 Nested tracing                         NEXT
NOOA-08 Model routing / scoped overrides       PENDING
NOOA-09 Runtime snapshot / resume               PENDING
NOOA-10 Reference substrate + adversarial eval PENDING
```

Current checkpoint: `NOOA-07`.

---

## Completed stages

### NOOA-01 — Typed Judgment — DONE

Goal: make one fuzzy/model-backed judgment a first-class typed runtime boundary.

Key contract:

- named judgment definition;
- typed input/output validation;
- judgment-local strategy override;
- invalid input never reaches strategy;
- invalid output never leaks to caller;
- generic low-level `run()` remains compatible.

Merged through PR #10.

### NOOA-02 — Predict Strategy — DONE

Goal: focused non-tool model judgment with bounded structured validation correction.

Key contract:

- provider-neutral model adapter;
- bounded attempts;
- validation feedback becomes model-visible correction context;
- provider/model failures remain distinct from validation failure;
- no capability/resource authority leaks into Predict.

Merged through PR #11.

### NOOA-03 — AgentEvent working history — DONE

Goal: separate chronological model working history from runtime telemetry.

Key contract:

- runtime-owned canonical AgentEvent journal;
- call/correlation IDs;
- strategy may record model/validation working events;
- runtime owns terminal `TASK` / `RESULT` / `ERROR` lifecycle authority;
- telemetry and AgentEvent storage/lifecycle remain independent.

Architecture: `docs/architecture/agent-events.md`.
Merged through PR #13.

### AVO-R1 — Adaptive useful-range gate — DONE

Goal: separate hard safety ceilings from the dynamic question of whether another long-horizon search step is still worth paying for.

Key contract:

```text
grounded completed work
        |
        v
SearchInvestmentDecision
  CONTINUE / STOP / ESCALATE
```

- runs in AVO control plane outside strategy;
- grounded artifacts only, never agent self-reported progress;
- freshness-bound to exact artifact and policy snapshots;
- cannot issue correctness verdicts or override hard ceilings/recovery.

Architecture: `docs/architecture/adaptive-useful-range.md`.
Merged through PR #16.

### NOOA-04 — Context blocks + history selection — DONE

Goal: separate deliberate prompt context from canonical chronological working history.

Key contract:

- named fixed/dynamic blocks with authority classification;
- per-judgment explicit selection;
- subset-only canonical history projection;
- reducer cannot rewrite canonical history;
- deterministic prompt/context bounds;
- invocation data never silently promotes itself into trusted block namespace.

Architecture: `docs/architecture/context-history.md`.
Merged through PR #17.

### NOOA-05 — ResourceRef / live resource semantics — DONE

Goal: allow agent strategies to operate on live resources without serializing raw objects into model context.

Key contract:

- opaque runtime-scoped ResourceRef;
- AGENT and CALL lifetime semantics;
- declared operations only; no arbitrary reflection;
- bounded progressive discovery;
- JSON-style operation transport;
- revocation/expiry/foreign-ref failures are explicit;
- consumer authorization remains separate from declared operation existence.

Architecture: `docs/architecture/resource-ref.md`.
Merged through PR #18.

### NOOA-06 — CodeAct execution loop — DONE

Goal: bounded inspect/execute/observe/return behavior over existing runtime authority and execution boundaries.

Key contract:

```text
model turn
   |
   +-- EXECUTOR ---------> injected executor boundary
   +-- CAPABILITY -------> runtime capability authority
   +-- RESOURCE ---------> ResourceRef operation authority
   +-- RESOURCE_DESCRIBE-> bounded progressive discovery
   `-- return_result ----> typed terminal validation

ACTION_OUTPUT / ACTION_ERROR
        |
        v
bounded current-call observation replay
        |
        v
next model turn
```

Implemented bounds:

- `maxTurns`;
- `maxActionCalls`;
- `maxDurationMs` caller-visible orchestration deadline;
- `maxObservationChars` aggregate current-call replay bound;
- existing runtime capability and executor limits remain independent outer boundaries.

Authority invariants:

- CodeAct creates no new authority;
- model gets protocol actions, not raw closures/live objects;
- `ACTION_OUTPUT` / `ACTION_ERROR` are working events, not terminal correctness authority;
- runtime still owns terminal `RESULT` / invocation `ERROR`;
- typed invalid terminal output re-enters bounded correction;
- terminal valid return closes later model/action activity;
- capability/CodeAct hard-boundary errors cannot be swallowed as ordinary observations.

Important residual boundary:

`maxDurationMs` bounds the caller by racing model/action awaits, but it does not claim to kill a non-cooperative underlying provider/process. Hard cancellation, process isolation and side-effect reconciliation remain adapter/executor responsibilities.

Architecture: `docs/architecture/codeact.md`.
Stage PR: #19.

---

## NOOA-07 — Nested tracing — NEXT

Goal: record a coherent runtime call tree rather than only flat lifecycle telemetry.

Required semantics:

- explicit trace/span context;
- parent/child spans;
- root agent invocation span;
- judgment/model/execution/capability/resource nesting;
- stable correlation with AgentEvent call IDs where appropriate;
- duration/status/error metadata;
- trace context propagates through nested runtime calls;
- sinks are observational by default and cannot silently change engineering correctness;
- strict trace delivery, if requested, is an explicit operational policy rather than hidden behavior.

Explicit non-goals:

- distributed tracing protocol/vendor lock-in;
- correctness evaluation from trace shape;
- model routing;
- snapshot/resume;
- changing ResourceRef or CodeAct authority semantics.

Verification gate:

- one invocation produces one valid rooted tree;
- model/action/capability/resource spans attach to the correct parent;
- sibling spans cannot accidentally share identities or form cycles;
- concurrent invocations cannot cross-link trace trees;
- AgentEvent call correlation is stable without making telemetry the working-history SoT;
- trace sink failure follows explicit strict/non-strict policy;
- tracing disabled leaves runtime behavior unchanged;
- instrumentation preserves all existing judgment/context/resource/CodeAct public APIs.

Exit artifact:

- architecture note defining trace context, span ownership and observational semantics;
- stage PR with manual/adversarial findings and residual gaps.

---

## NOOA-08 — Model routing / scoped overrides

Goal: separate interaction strategy from model selection and resolve model configuration by scope.

Resolution precedence:

```text
invocation override
        >
judgment override
        >
runtime / agent default
```

Required semantics:

- runtime default model;
- judgment-local override;
- invocation override;
- lazy adapter resolution;
- strategy choice remains independent from model choice;
- resolved model provenance is available to process-trust / verification-domain manifests;
- domain method contract does not expose model routing unless consumer intentionally chooses that API.

Verification gate:

- override precedence is deterministic;
- invocation override does not mutate defaults;
- unused adapters are not eagerly instantiated;
- routing provenance identifies the actually used model/adapter;
- same strategy can run against different routed models.

---

## NOOA-09 — Runtime snapshot / resume

Goal: make NOOA-style agent runtime state resumable without conflating it with AVO persistent engineering memory.

Required semantics:

- snapshotable AgentEvent working history;
- snapshotable context configuration/state where safe;
- explicit versioned runtime snapshot schema;
- restore into a compatible fresh runtime instance;
- transient live resources/execution sessions are never fabricated on restore;
- resource restoration requires explicit adapter/rebinding policy;
- snapshot/resume remains distinct from long-term semantic K.

Verification gate:

- restored runtime preserves working-history ordering;
- incompatible future/unknown schema fails closed;
- secrets/transient handles are not serialized accidentally;
- resume cannot silently re-open expired execution sessions;
- AVO persistent memory and runtime snapshot evolve independently.

---

## NOOA-10 — Reference substrate + adversarial evaluation

Goal: prove the completed substrate works as a reusable consumer-facing runtime rather than a collection of isolated APIs.

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
- AVO variation using this substrate above it without kernel special cases.

Adversarial/evaluation targets:

- Predict vs CodeAct for simple typed judgments;
- full history vs selected/summarized history;
- ResourceRef progressive disclosure vs eager surface exposure;
- model-routing policies;
- resume on/off;
- malformed model actions;
- stale resource refs;
- context poisoning attempts;
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

This stage does not claim universal model quality. It validates substrate contracts and provides a reproducible consumer baseline.

---

## Completion condition

The NOOA substrate is complete when a blank consuming project can import ExHarness and, without modifying kernel source:

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
        |
        v
run under the existing AVO long-horizon control plane
```

Final architecture:

```text
AVO
  long-horizon search / lineage / supervision / commit
        |
        v
ExHarness NOOA-style substrate
  typed judgment / strategy / context / events / resources / execution
        |
        v
Injected infrastructure
  models / tools / sandbox / store / tracing / trust authorities
```
