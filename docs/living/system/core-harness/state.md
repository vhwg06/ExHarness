# Core Harness current state

Source-synchronized ExHarness Core checkpoint. Open Core gaps/problems live only in `../docs/blackboard/state.md`.

## Current implemented capabilities

- `createHarness()` composes persistence, environment actions, observability, supervision, recovery gating, search investment and AVO.
- public `createHarness()` / `createAVOHarness()` route built-in `avo.act` through a durable action-effect boundary before Core candidate/session persistence;
- built-in AVO effect operations persist `INTENDED -> DISPATCHED -> CONFIRMED | UNKNOWN` in a sidecar journal keyed by deterministic action identity;
- a durably confirmed action result can be reused after Core-state persistence failure without dispatching the external action again;
- ambiguous built-in action effects default to `NON_RECONCILABLE`; replay requires explicit adapter `PURE | IDEMPOTENT | OBSERVABLE` semantics;
- effect operations remain separate from candidate lineage, evaluation, semantic memory and application completion;
- persistent AVO work state tracks candidates, observations, verifications, evaluations, knowledge, variations, search-investment decisions, trust artifacts, lineage, trajectory and supervision;
- `createResumableAgentRuntime()` snapshots runtime configuration, event history and agent-scoped resource/live-object activity with compatibility checks and explicit authority rebinding;
- `recoverInterruptedVariation()` closes an interrupted running variation as `INTERRUPTED`; it is separate from external-effect reconciliation;
- effect reconciliation has explicit operation identity, intent-before-dispatch journal state and `PURE | IDEMPOTENT | OBSERVABLE | NON_RECONCILABLE` replay policies;
- structured deliberation and ActionIntent are explicit bounded cognition/action artifacts;
- grounded durable `REFLECTION` / `INTENT` require persisted source snapshots and grounding verification; active reflection requires a fresh evaluation source;
- intent/reflection alignment is a grounded semantic-divergence signal, not evaluation or promotion authority;
- `createActionIntentEffectController()` links capability-target ActionIntent to exact effect operations and keeps ambiguous pending effects authorized until confirmation/reconciliation;
- semantic-memory retrieval is `RELEVANCE_ONLY`; associative ranking/spontaneous recall are opt-in;
- promotion requires a current evaluation over exact current observation/verification snapshots.

- `createAgentRuntime()` accepts `contextRequirementBlocks` and an injected `contextResolver`; selected requirements resolve once before prompt/model work, then project to fixed context blocks. Core does not select providers or interpret Oracle schema. The delivered Oracle facade plugs into this port; resolver failure stops before model dispatch with no automatic retry.

## Detached operation scheduling

Core can schedule long-running effect capabilities independently of the active model turn without changing synchronous behavior:

- `createSessionDetachedOperationStore({ sessionStore, scopeId })` persists one operation scope in a dedicated manager state document over the existing revision-aware `sessionStore.load/save(expectedRevision)` contract; `createInMemoryDetachedOperationStore({ scopeId })` is the deterministic test adapter. Production durability comes from the caller's own SessionStore implementation.
- `createDetachedOperationManager({ store, effectBindings })` pairs each detachable effect capability with the exact journal used by `defineEffectCapability`. Only capabilities wrapped through `manager.capability(name)` detach; unwrapped capabilities keep the existing synchronous `AgentRuntime` behavior, and both may coexist in one runtime.
- The wrapper computes the existing `effect.operationKey()`, durably records a `RUNNING` handle (generation 1) before any background launch, returns the handle immediately, and passes a cooperative `AbortSignal` plus scheduler binding into the underlying effect runtime. The existing `invoke()` still awaits `capability.execute`; there is no second AgentRuntime loop.
- Scheduling status is transport truth only: `RUNNING`, `CANCEL_REQUESTED`, `SUCCEEDED`, `FAILED`, `CANCELLED` or `UNKNOWN`. Every transition is compare-and-set by persisted revision plus generation with monotonic sequence and deterministic transition ids; terminal transitions are immutable and delivery to observers is at-least-once (deduplicate by transition id). `EffectOperation` (`INTENDED`, `DISPATCHED`, `CONFIRMED`, `UNKNOWN`) remains the only side-effect authority: scheduler `SUCCEEDED` is derived from journal `CONFIRMED` truth and can never synthesize it, and `FAILED` is reserved for deterministic pre-dispatch failures with no recorded dispatch.
- Recovery (`manager.recover()`) CAS-increments the generation fencing token before any work, rebinds the exact stored `effectOperationId`, and follows a fixed mapping: `CONFIRMED` converges to `SUCCEEDED`; absent/`INTENDED` may execute the exact capability; `DISPATCHED`/`UNKNOWN` go through the existing `reconcileEffectOperation()` (`CONTINUE` -> `SUCCEEDED`, `RETRY` only for the same operation under the replay policy with no cancel fence, `ESCALATE` -> scheduler `UNKNOWN`). No recovery path creates a new semantic operation key, concurrent takeovers yield one current generation, and stale generations record diagnostics without publishing authoritative terminal transitions.
- Cancellation (`manager.cancel(operationId, { reason })`) persists `CANCEL_REQUESTED` before acting and fences later dispatch/retry. Before external dispatch every policy may become `CANCELLED`. After dispatch: `PURE` becomes `CANCELLED` once the local attempt settles; `IDEMPOTENT` stays `UNKNOWN` unless completion is confirmed; `OBSERVABLE` becomes `SUCCEEDED` when observation confirms the effect or `CANCELLED` only after the attempt settles and observation proves the effect absent (observer failure -> `UNKNOWN`); `NON_RECONCILABLE` escalates `UNKNOWN`. A `CONFIRMED` effect always wins a racing cancel as `SUCCEEDED`.
- Every operation record binds operation id, scope, capability, input digest/snapshot, effect operation id, replay policy, call/turn/trace identity and action-intent/deliberation refs when present. Reusing an operation id with a different binding, or recovering with a changed capability/input/call/turn/action/effect binding, fails closed. Unresolved ambiguity stays `UNKNOWN` for explicit handling elsewhere.
- This is functional scheduling capability only: no cost, token, latency or cache conclusion follows from it. Matched-efficiency evidence with fixed model, task semantics, tool surface and resource budget is a separate future comparison.

## Synchronous harness-economics comparison tooling

`benchmarks/harness-efficiency/` is built to answer what quality, cost, latency and failure behavior is attributable to the harness orchestration path under an otherwise fixed benchmark contract. It compares two arms over the same JavaScript CodeAct strategy, executor, model route, task cohort, prompt, tool surface, evaluator and budgets:

- `DIRECT_CODEACT` — the strategy through a benchmark-owned minimal orchestration shim;
- `CORE_SYNC` — the same strategy through the synchronous `createAgentRuntime` Core path.

Both arms really execute the shared strategy against a benchmark-owned offline scripted model client and session executor; turn counts, capability-call counts, MODEL/CALL intervals and prompt-prefix hashes are derived from each run. The experiment consumes the shared benchmark kernel (`@exharness/benchmark`, package root only) and the sealed calibrated substrate manifest. It owns only the two arm adapters, the fixed-factor protocol, the development/held-out cohort with three alternating paired repeats, economics observations, the comparison reducer/report and the held-out handoff. Experiment registration, AttemptLedger, evidence manifests, accounting normalization, audit and Harbor substrate behavior stay upstream; the run fails closed when the kernel contract or substrate manifest is missing or incompatible.

The committed report (`manifests/report.example.json`, `manifests/comparison.json`) is an offline scripted fixture proving the pipeline — kernel registration, shared-ledger settling of 36 paired attempts plus one retry, 37/37 PASS on reopened evidence — and NOT a measurement: no quality, cost or latency claim follows from it, provider cost/token/cache stay null/UNKNOWN, and the six-task cohort supports no significance claim. The live synchronous baseline on the frozen route has not been executed yet; it is pending an authorized paid run (`run.mjs --live` refuses without credentials and substrate). The four-task held-out set is reserved and never executes here; async scheduling, cache-stable context and steering/recovery capabilities are out of scope, as is any promotion decision. A versioned comparison manifest, held-out manifest and preregistered quality/safety/economics/context/interaction/latency gate are frozen for the future held-out decision before any async result exists.

## Current authority boundary

```text
Agentic Application -> work semantics / orchestration / completion policy
Oracle              -> source resolution / dereference / adaptation
ExHarness Core       -> execution / runtime authority / cognition / evidence / recovery primitives
```

Source/public exports are authority for the exact behavior. Any unresolved Core issue belongs on the Blackboard, not in this subtree.

## Routing

- **current Core capability semantics -> `capabilities.md`**
- current Core structure -> `architecture.md`
- current execution/cognition/recovery behavior -> `workflow.md`
- current Core invariants -> `decisions.md`
- all open Core work -> `../docs/blackboard/state.md`
