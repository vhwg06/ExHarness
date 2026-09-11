# NOOA substrate completion pipeline

This document is the execution authority for completing the NOOA-style programmable-agent substrate in ExHarness.

ExHarness already has a mature AVO long-horizon control plane plus objective verification, trust attestations, process-security attestations, recovery, persistence and execution boundaries. This pipeline finishes the lower-level programmable agent/runtime substrate without copying NOOA's Python syntax.

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
- no pulling later-stage responsibilities into the current stage merely because they are convenient;
- tests and CI are verification artifacts, not the source of truth;
- manual/adversarial findings that change implementation must be recorded in the stage PR;
- a stage is not DONE until the exact PR head passes its full verification gate and the merged `main` remains healthy;
- if the architecture changes materially, patch this pipeline first before continuing implementation.

## Status

```text
NOOA-01 Typed Judgment                         DONE
NOOA-02 Predict Strategy                       DONE
NOOA-03 AgentEvent working history             DONE
AVO-R1  Adaptive useful-range gate             NEXT
NOOA-04 Context blocks + history selection     BLOCKED_ON_AVO-R1
NOOA-05 ResourceRef / live resource semantics  PENDING
NOOA-06 CodeAct execution loop                 PENDING
NOOA-07 Nested tracing                         PENDING
NOOA-08 Model routing / scoped overrides       PENDING
NOOA-09 Runtime snapshot / resume               PENDING
NOOA-10 Reference substrate + adversarial eval PENDING
```

Current checkpoint: `AVO-R1`.

`AVO-R1` is an intentional control-plane correction discovered before NOOA-04. It is not a NOOA substrate feature, but it blocks further substrate work until the long-horizon search budget semantics are explicit.

---

## NOOA-01 — Typed Judgment — DONE

Goal: make one fuzzy/model-backed judgment a first-class typed runtime boundary.

Required semantics:

- named judgment definition;
- input parser/validator;
- output parser/validator;
- optional per-judgment strategy override;
- explicit public runtime invocation;
- generic `run()` remains compatible;
- no retry/model/provider policy in this stage.

Verification gate:

- invalid input never reaches the strategy;
- invalid output never leaks to the caller;
- judgment-local strategy does not mutate runtime default strategy;
- duplicate names fail fast;
- instrumentation preserves the judgment surface;
- generic low-level run remains compatible.

Merged through PR #10.

---

## NOOA-02 — Predict Strategy — DONE

Goal: provide a focused non-tool judgment strategy with structured validation feedback and bounded retry.

Required semantics:

- provider-neutral model adapter contract;
- bounded attempts;
- declared output validation;
- validation failures become model-visible feedback;
- no capability/tool invocation surface;
- provider/model failures are not silently retried as validation failures;
- deterministic attempt history/provenance.

Verification gate:

- invalid first result can recover on a later bounded attempt;
- validation feedback reaches the next attempt;
- validation exhaustion has a stable operational error;
- provider failure propagates distinctly;
- no tool/capability surface leaks into Predict requests;
- successful typed output is not parsed redundantly.

Merged through PR #11.

---

## NOOA-03 — AgentEvent working history — DONE

Goal: separate chronological model working history from runtime telemetry.

Required semantics:

- first-class `AgentEvent` journal owned by agent runtime;
- event kinds for task/model output/validation feedback/error/result;
- every agent invocation receives a call/correlation ID;
- strategy can append model/validation working events through a bounded runtime interface;
- runtime appends task/result/error events deterministically;
- `AgentEvent != TelemetryEvent` in type, storage and lifecycle;
- working history can be inspected without enabling observability sinks;
- observability instrumentation must preserve AgentEvent APIs.

Explicit non-goals:

- history filtering/summarization;
- prompt/context block selection;
- persistence/resume of runtime history;
- CodeAct execution events;
- nested tracing spans.

Verification challenges:

- telemetry disabled while AgentEvent history still works;
- telemetry sink failure cannot erase/alter AgentEvent history;
- validation retries produce chronological model + validation events;
- failed model/provider invocation produces an ERROR event without fabricated RESULT;
- separate invocations cannot accidentally share one call ID;
- generic `run()` and typed judgment invocation remain compatible;
- instrumentation cannot hide or duplicate working-history records.

Exit artifact:

- architecture note for AgentEvent vs TelemetryEvent;
- stage PR containing manual/adversarial findings and residual gaps.

Merged through PR #13.

---

## AVO-R1 — Adaptive useful-range gate — NEXT

Goal: separate the hard safety ceiling from the dynamic question of whether additional long-horizon search is still worth paying for.

Architecture authority: `docs/architecture/adaptive-useful-range.md`.

Control flow:

```text
candidate
   |
   v
objective.evaluate()
   |
   v
append grounded evaluation / verification / cost artifacts
   |
   v
adaptive useful-range gate
   |
   +---- CONTINUE
   +---- STOP
   `---- ESCALATE
```

Required semantics:

- the gate lives in the AVO control plane, outside `strategy.run()`;
- hard capability/time/execution budgets remain independent outer ceilings;
- gate inputs come from grounded persisted artifacts, never agent self-reported progress;
- the gate emits a search-investment decision, not a correctness verdict;
- decisions are freshness-bound to the exact artifact snapshot consumed;
- insufficient history produces explicit warm-up/insufficient-data behavior;
- policy is pluggable rather than hard-coding one universal formula;
- useful policies may use marginal improvement, cost-per-unit-quality, or trajectory/anomaly bands;
- STOP cannot bypass recovery for interrupted variations;
- CONTINUE cannot override hard safety ceilings;
- ESCALATE may request stronger verification/supervision but cannot promote a candidate.

Explicit non-goals:

- replacing objective verification;
- letting the model decide its own budget from prose self-assessment;
- removing hard safety limits;
- claiming one universal optimal threshold/window/sample count;
- silently discarding persisted work or failed directions.

Verification challenges:

- agent says "progress" while grounded artifacts are unchanged -> range state does not move;
- too few samples -> no fabricated trend;
- new evaluation/verification/cost artifact -> previous range decision becomes stale;
- diminishing returns -> search can STOP while objective verdict remains unchanged;
- anomalously large positive movement -> may ESCALATE without self-promoting;
- range STOP cannot skip explicit recovery;
- range CONTINUE cannot exceed the outer hard budget;
- missing metric inputs -> explicit insufficient-data result instead of invented quality/cost;
- replacing range policy does not alter correctness semantics.

Exit artifact:

- first-class persisted search-investment/range decision with input provenance;
- architecture tests for freshness, grounding, recovery separation and hard-cap precedence;
- stage PR recording manual findings and residual threshold-policy gaps.

Only after AVO-R1 merges and post-merge `main` is healthy does NOOA-04 resume.

---

## NOOA-04 — Context blocks + history selection — BLOCKED_ON_AVO-R1

Goal: distinguish deliberate current prompt context from chronological working events.

Required semantics:

- named fixed context blocks;
- named dynamic/expression-backed context blocks;
- trusted instruction/context channel distinct from call data;
- per-judgment context selection;
- history selector/filter hook;
- summarization/reduction hook without mutating authoritative history;
- bounded rendering/dosage controls;
- no automatic dump of full persistent engineering memory.

Explicit non-goals:

- live resource handles;
- CodeAct;
- model routing.

Verification challenges:

- untrusted call data cannot be promoted into trusted instruction blocks implicitly;
- excluded context/history never reaches strategy/model input;
- dynamic blocks are re-evaluated at call time;
- summarization cannot rewrite canonical event history;
- dosage limits fail closed or truncate according to explicit policy.

---

## NOOA-05 — ResourceRef / live resource semantics

Goal: let an agent operate on live resources without serializing raw objects into model context.

Required semantics:

- opaque `ResourceRef` / handle;
- runtime registry resolving handle -> live resource;
- explicit visible operations only;
- raw resource value is never serialized into prompt/model request;
- per-run and/or per-agent lifetime semantics are explicit;
- revoked/expired handles fail deterministically;
- progressive discovery of resource metadata/operations;
- resource authority remains constrained by execution/security policy.

Explicit non-goals:

- general distributed object system;
- arbitrary reflection over raw JS objects;
- OS isolation implemented inside the resource abstraction.

Verification challenges:

- secret/private resource fields never leak through metadata rendering;
- stale handles cannot invoke resources;
- two handles cannot cross-resolve to the wrong resource;
- only declared operations are callable;
- model-visible descriptions stay bounded.

---

## NOOA-06 — CodeAct execution loop

Goal: provide a bounded inspect/execute/observe/return strategy over ExHarness execution boundaries.

Required semantics:

- per-call execution session;
- iterative model turns;
- explicit `execute` and `return_result` actions;
- capability + ResourceRef access;
- execution outputs/errors become AgentEvents;
- typed final output validation;
- text-only response recovery policy;
- iteration/time/capability budgets;
- executor/sandbox is injected and remains the real containment boundary;
- terminal result closes further model/execution actions for that call.

Verification challenges:

- generated execution cannot bypass exposed operations;
- caught budget errors remain visible at outer runtime boundary;
- invalid final result re-enters bounded correction instead of leaking;
- plain-text turn follows configured recovery path;
- terminal return cannot be followed by hidden tool/execution activity;
- executor failure and model failure remain distinguishable.

---

## NOOA-07 — Nested tracing

Goal: record the complete runtime call tree rather than only flat lifecycle telemetry.

Required semantics:

- parent/child spans;
- judgment/model/execution/capability/resource nesting;
- stable correlation IDs shared with AgentEvent calls where appropriate;
- duration/status/error metadata;
- tracing sinks remain observational and cannot silently change correctness behavior;
- trace context propagates across nested runtime calls.

Verification challenges:

- nested calls form one valid tree, not disconnected flat events;
- sibling spans do not share parent/child identity accidentally;
- tracing sink failure follows explicit strict/non-strict policy;
- trace instrumentation preserves runtime public APIs.

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
- domain method contract does not expose model routing unless the consumer intentionally chooses that API.

Verification challenges:

- override precedence is deterministic;
- one invocation override does not mutate defaults;
- unused adapters are not eagerly instantiated;
- routing provenance identifies the actually used model/adapter;
- same strategy can run against different routed models.

---

## NOOA-09 — Runtime snapshot / resume

Goal: make NOOA-style agent runtime state resumable without conflating it with AVO persistent engineering memory.

Required semantics:

- snapshotable AgentEvent working history;
- snapshotable selected context blocks/configuration where safe;
- explicit versioned runtime snapshot schema;
- restore into a compatible fresh runtime instance;
- transient live resources/execution sessions are not fabricated on restore;
- resource restoration requires explicit adapter/rebinding policy;
- snapshot/resume remains distinct from long-term semantic K.

Verification challenges:

- restored runtime preserves working-history ordering;
- incompatible future/unknown schema fails closed;
- secrets/transient handles are not serialized accidentally;
- resume cannot silently re-open an expired execution session;
- AVO persistent memory and runtime snapshot can evolve independently.

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
- AVO variation using this substrate above it without special-case kernel changes.

Evaluation / ablation targets:

- Predict vs CodeAct for simple typed judgments;
- full history vs selected/summarized history;
- raw-context pressure vs bounded context blocks;
- ResourceRef progressive disclosure vs eager tool-surface dump;
- different model-routing policies;
- resume on/off;
- malformed model actions;
- stale resource refs;
- context poisoning attempts;
- observability/tracing sink failures.

Metrics should include at minimum:

- task success;
- invalid output rate;
- correction/retry count;
- model calls;
- execution/capability calls;
- prompt/context size where observable;
- false-success / unsafe-accept rate for the reference workload;
- resume fidelity.

This stage does not claim universal model quality. It validates the substrate contracts and provides a reproducible baseline for consumer harnesses.

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

The final architecture remains:

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
