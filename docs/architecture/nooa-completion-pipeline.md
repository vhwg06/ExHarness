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
AVO-R1  Adaptive useful-range gate             DONE
NOOA-04 Context blocks + history selection     DONE
NOOA-05 ResourceRef / live resource semantics  DONE
NOOA-06 CodeAct execution loop                 NEXT
NOOA-07 Nested tracing                         PENDING
NOOA-08 Model routing / scoped overrides       PENDING
NOOA-09 Runtime snapshot / resume               PENDING
NOOA-10 Reference substrate + adversarial eval PENDING
```

Current checkpoint: `NOOA-06`.

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

## AVO-R1 — Adaptive useful-range gate — DONE

Goal: separate the hard safety ceiling from the dynamic question of whether additional long-horizon search is still worth paying for.

Architecture authority: `docs/architecture/adaptive-useful-range.md`.

Implemented control flow:

```text
completed variation
   |
   v
persist grounded evaluations / verifications / activity / capability-call cost proxy
   |
   v
SearchInvestmentDecision
   |
   +---- CONTINUE -> next variation may open
   +---- STOP     -> next variation is gated before strategy execution
   `---- ESCALATE -> stronger external verification/supervision is required before search resumes
```

Required semantics now enforced:

- the gate lives in the AVO control plane, outside `strategy.run()`;
- hard capability/time/execution budgets remain independent outer ceilings;
- gate inputs come from grounded persisted artifacts, never agent self-reported progress;
- the gate emits a search-investment decision, not a correctness verdict;
- decisions are freshness-bound to the exact artifact snapshot consumed;
- decision freshness is also bound to explicit policy revision/configuration;
- insufficient history produces explicit warm-up behavior;
- stale/missing current objective evaluation produces explicit insufficient-data behavior;
- policy is pluggable rather than hard-coding one universal formula;
- the kernel ships one reference marginal-improvement policy, while cost-per-unit-quality and other policies can use the same grounded history contract;
- STOP cannot bypass recovery for interrupted variations;
- CONTINUE cannot override hard safety ceilings;
- ESCALATE cannot promote a candidate or fabricate correctness.

Manual/adversarial findings that changed implementation:

1. Pre-first-variation gating initially would have persisted a meaningless WARMUP decision. The final controller does not create a decision until grounded work exists or status is explicitly requested.
2. A new verification/observation initially could have recomputed ROI using a stale objective score. The final gate refuses trend-based control until the current evaluation is fresh again.
3. Artifact freshness alone was insufficient: a policy threshold/implementation revision could change while history stayed identical. Decisions now bind to policy revision/configuration and are recomputed when that control input changes.

Verification challenges covered by the stage:

- agent says "progress" while grounded artifacts are unchanged -> no grounded range sample is fabricated;
- too few evaluations -> WARMUP rather than invented trend;
- new relevant artifacts -> old decision becomes stale;
- stale current evaluation -> INSUFFICIENT_DATA until re-evaluated;
- diminishing returns -> search STOP while objective verdict remains GAP;
- anomalously large positive movement -> ESCALATE without self-promotion;
- range STOP cannot skip explicit recovery;
- range CONTINUE cannot exceed the hard capability budget;
- missing quality metrics -> explicit insufficient-data result;
- policy revision change -> otherwise artifact-fresh decision becomes stale.

Residual gaps remain explicit:

- ExHarness does not claim one universal quality/cost metric;
- the reference marginal-improvement helper is not a benchmark-derived optimal policy;
- richer cost-per-unit-quality or statistical control policies belong above the same pluggable contract and require workload evidence;
- token/provider cost is only available when the consumer records it as grounded evaluation/usage metadata; completed variations always expose deterministic capability-call counts.

Merged through PR #16.

---

## NOOA-04 — Context blocks + history selection — DONE

Goal: distinguish deliberate current prompt context from chronological working events without collapsing invocation data into trusted instruction channels.

Architecture authority: `docs/architecture/context-history.md`.

Implemented semantics:

- named fixed and dynamic context blocks;
- explicit trusted/untrusted authority classification;
- dynamic blocks re-evaluated at invocation time;
- dynamic resolvers do not receive invocation input/context implicitly;
- per-judgment block selection with empty-by-default prompt context;
- canonical AgentEvent journal remains authoritative and separate from prompt history;
- selector is subset-only: no fabricated/duplicate IDs, no event-body replacement, canonical chronological order preserved;
- optional reducer/summarizer receives cloned selected history and cannot rewrite canonical events;
- reduced history keeps source-event provenance while omitting raw events from prompt context;
- `maxBlocks`, `maxHistoryEvents`, and `maxSerializedChars` enforce deterministic bounds;
- `maxHistoryEvents: 0` means exactly zero history;
- history can fail closed or truncate oldest selected events;
- trusted blocks/reduced summaries are never silently truncated to satisfy size limits;
- prompt-visible values are restricted to stable JSON-style data;
- Predict receives `callContext`, selected `promptContext`, selected raw `agentEvents`, and history metadata as separate channels;
- observability instrumentation preserves context introspection APIs;
- NOOA-01 public judgment metadata remains backward compatible.

Manual/adversarial findings that changed implementation:

1. Dynamic block normalization was not idempotent because a normalized dynamic definition looked like it also contained a fixed value; normalized block shape was corrected.
2. Shallow freezing left nested trusted values mutable inside a strategy call; rendered prompt context is now deep-frozen.
3. Exposing context details through `judgments()` broke the previously verified NOOA-01 public metadata contract; context selection remains internal.
4. `maxHistoryEvents: 0` hit JavaScript `slice(-0)` semantics and retained all history; zero now projects no events.
5. A selector could fabricate/tamper event objects while appearing to preserve provenance; it now selects canonical IDs and the runtime restores canonical bodies.
6. Structured-cloneable data was broader than stable model/prompt data; prompt-visible blocks/history/summary now require JSON-style values.
7. Selectors could reorder the working journal; selected output now preserves canonical chronology.
8. Model-visible block descriptions are normalized to text/null.

Verification challenges covered:

- malicious invocation data cannot shadow selected trusted blocks;
- registered but unselected blocks/history do not reach strategy/model input;
- dynamic blocks are fresh per call and not given call input implicitly;
- selector/reducer mutation cannot rewrite canonical AgentEvent history;
- selector cannot fabricate provenance or reorder chronology;
- zero-history and bounded-history semantics are deterministic;
- strict overflow emits stable `CONTEXT_LIMIT_EXCEEDED` and an ERROR AgentEvent;
- oversized trusted blocks fail closed instead of being silently truncated;
- non-JSON prompt values such as `BigInt`/`Map` are rejected;
- Predict receives only selected prompt surfaces;
- instrumentation cannot hide context APIs;
- prior typed-judgment API behavior remains intact.

Residual limits:

- `TRUSTED` is consumer-declared authority, not cryptographic proof or prompt-injection sanitization;
- a custom downstream strategy/model adapter can still deliberately merge `callContext` back into trusted prompt channels;
- consumer reducers may create semantically poor summaries even though canonical history remains protected;
- default bounds are containment defaults, not benchmark-derived optima;
- resolver closures inherit whatever authority the consumer gives them;
- context/runtime snapshot persistence remains NOOA-09.

Stage PR: #17.

---

## NOOA-05 — ResourceRef / live resource semantics — DONE

Goal: let an agent operate on live resources without serializing raw objects into model context.

Architecture authority: `docs/architecture/resource-ref.md`.

Implemented semantics:

- opaque `ResourceRef` identity tied to one runtime registry;
- registry resolves refs to live resource values without serializing those values into strategy/model data;
- AGENT resources remain live for the runtime lifetime until revoked;
- CALL resources are bound to one `callId` and expire deterministically in `finally`;
- stale/foreign/tampered/revoked/expired refs fail with distinct stable resource errors;
- explicit operation allowlists prevent reflection over undeclared live methods or fields;
- progressive discovery keeps initial refs minimal; metadata and operation catalogs require explicit `describeResource()`;
- resource descriptions, metadata and operation counts are bounded by policy;
- resource operation input/output crosses a JSON-style transport boundary;
- consumer authorization can deny declared operations, including mutation-sensitive policies;
- concurrent CALL scopes may reuse a resource name without cross-resolution;
- CALL resources cannot shadow AGENT resources;
- Predict does not automatically forward ResourceRefs or resource invocation authority to the model adapter;
- observability instrumentation preserves resource APIs without exposing raw live values.

Manual/adversarial findings that changed implementation:

1. Expired CALL handles and revoked AGENT handles initially collapsed into one stale-handle state; the final contract distinguishes `RESOURCE_EXPIRED` and `RESOURCE_REVOKED`.
2. Resource authorization was initially implicit in the declared operation surface; an explicit consumer authorization callback was added so the registry can deny describe/invoke authority independently of operation existence.
3. Resource-name uniqueness initially ignored lifetime scope and would make concurrent CALL resources collide; uniqueness is now keyed by lifetime/call identity while runtime-level CALL resources are still prevented from shadowing AGENT names.
4. Runtime instrumentation initially risked dropping the new resource surface; the observability wrapper now preserves resource refs/policy/describe/invoke/revoke APIs without unwrapping live values.
5. Progressive disclosure is explicit: initial refs contain no operation catalog or metadata, so registering a live resource does not become an eager prompt/tool-surface dump.
6. Operation outputs are re-validated at the JSON transport boundary, preventing a declared operation from accidentally returning a raw `Map`, class instance or other live object representation.

Verification challenges covered:

- private fields/secrets and undeclared prototype methods never appear in refs or resource descriptions;
- undeclared operations fail with `RESOURCE_OPERATION_NOT_ALLOWED`;
- CALL handles expire after success/failure paths;
- revoked AGENT handles fail deterministically;
- refs cannot cross registry/runtime boundaries even when names match;
- concurrent CALL resources with identical names remain isolated by call;
- scoped resources cannot shadow AGENT resources;
- consumer authorization can reject mutation operations;
- descriptions/metadata are bounded by resource policy;
- non-JSON resource outputs fail closed;
- Predict does not leak ResourceRef/invocation authority into model requests;
- instrumentation preserves public resource APIs without leaking live values.

Residual limits:

- `ResourceRef` is a runtime authority handle, not cryptographic proof;
- consumers can still define an unsafe operation or explicitly return sensitive data through an allowed operation;
- the authorization callback is an optional coarse operation boundary; payload-specific policy can live in operation validation/implementation and broader execution policy is handled by NOOA-06;
- ResourceRef does not provide OS/process/container isolation;
- model-driven repeated resource-call budgets and execution sessions belong to CodeAct in NOOA-06;
- live-resource snapshot/rebinding remains NOOA-09;
- nested per-resource tracing remains NOOA-07.

Stage PR: #18.

---

## NOOA-06 — CodeAct execution loop — NEXT

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