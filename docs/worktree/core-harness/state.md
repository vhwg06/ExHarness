# Core Harness state

Current ExHarness Core continuation state. Route from here only when the task is about kernel/runtime behavior rather than Agentic Application or Oracle semantics.

## CURRENT

- `createHarness()` composes validated persistence, idempotent environment actions, observability, supervision, recovery gating, search investment and `createAVOHarness()`.
- `createAVOHarness()` composes AVO variation control with `AgentRuntime`; built-in `avo.act` still calls `core.act()` directly through a normal capability.
- Persistent AVO work state tracks candidate history, observations, verifications, evaluations, knowledge, variations, search-investment decisions, trust artifacts, lineage, trajectory and supervision.
- `createResumableAgentRuntime()` snapshots runtime configuration, `AgentEvent` history and agent-scoped resource/live-object activity; restore requires compatibility checks and explicit rebinding of live authority.
- Interrupted AVO variations have explicit recovery through `recoverInterruptedVariation()`; this closes a running variation as `INTERRUPTED`, it does not reconcile external side effects.
- Effect reconciliation has explicit operation identity, intent-before-dispatch journal state and `PURE | IDEMPOTENT | OBSERVABLE | NON_RECONCILABLE` replay policies.
- Deliberation and action intent are first-class bounded cognition artifacts with source/context refs and an authorization boundary.
- Grounded cognition can activate durable `REFLECTION` / `INTENT` only through persisted source snapshots and grounding verification; reflection activation requires a fresh evaluation source.
- Intent/reflection alignment produces a grounded semantic-divergence signal without becoming an evaluation or promotion verdict.
- `createActionIntentEffectController()` composes capability-target ActionIntent with effect operations: the exact effect operation is linked as an outcome ref, ambiguous/pending effect state remains `AUTHORIZED`, and confirmation/reconciliation completes the intent.
- Semantic-memory retrieval remains `RELEVANCE_ONLY`. NOOA associative ranking and spontaneous recall are explicit opt-in composition surfaces; memory is not globally injected into every judgment.
- Promotion requires a current evaluation over the exact current observation and verification ID snapshots.

## ACTIVE CORE CONTINUATION

The remaining Core continuation is narrower than the stale pre-cognition roadmap:

1. close the built-in AVO external-effect crash window instead of treating candidate/trace state as proof of side-effect completion;
2. compose interrupted-variation recovery, runtime snapshot/restore and pending-effect reconciliation into an explicit recovery lifecycle when a concrete Core consumer proves the required shape;
3. expose a higher-level Core lifecycle surface only after that recovery composition is concrete, without absorbing Agentic Application orchestration.

No new default memory-ranking or hidden prompt-injection layer is required: explicit memory visibility is an intentional authority boundary, not an unresolved gap.

## ROUTING

- implemented Core structure -> `architecture.md`
- execution/cognition/recovery loop -> `workflow.md`
- unresolved Core seams / exit conditions -> `gaps.md`
- active Core constraints -> `decisions.md`
- system-level delivery order -> `../pipeline.md`

## BOUNDARY

```text
Agentic Application
    -> owns work semantics / orchestration / completion policy

Oracle
    -> owns source resolution / dereference / adaptation

ExHarness Core
    -> owns agent execution mechanics / runtime authority / cognition / evidence / recovery primitives
```

## AUTHORITY

Source/public exports are implementation authority. This subtree is the desired continuation projection for ExHarness Core only. Resolved gaps must be removed from this projection when source lands; Git retains their history.
