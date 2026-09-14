# Core Harness convergence state

Current ExHarness Core checkpoint plus candidate continuation work. Route from here only when the task is about kernel/runtime behavior rather than Agentic Application or Oracle semantics.

Implemented claims must be checked against source/public exports. Continuation ideas remain candidates until evidence/decision/promotion.

## OBSERVED / DELIVERED CURRENT

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

Source/public exports are final authority for whether each item is still current.

## CANDIDATE CORE CONTINUATION

The remaining continuation currently being explored is narrower than the stale pre-cognition roadmap:

1. close the built-in AVO external-effect crash window instead of treating candidate/trace state as proof of side-effect completion;
2. explore composition of interrupted-variation recovery, runtime snapshot/restore and pending-effect reconciliation when a concrete Core consumer proves the required shape;
3. consider a higher-level Core lifecycle surface only after that recovery composition becomes concrete, without absorbing Agentic Application orchestration.

These are convergence targets, not automatically promoted desired state. Concrete component/API shape must be earned by implementation and evidence.

No new default memory-ranking or hidden prompt-injection layer is currently required: explicit memory visibility remains an accepted authority boundary unless later evidence reopens it.

## ROUTING

- implemented Core structure -> `architecture.md` plus source/public exports
- execution/cognition/recovery loop -> `workflow.md`
- unresolved Core seams / candidate exit conditions -> `gaps.md`
- prior/current Core constraints -> `decisions.md`
- system-level delivery order -> `../pipeline.md`
- promotion/authority rules -> `../../living/README.md`

## ACCEPTED BOUNDARY

```text
Agentic Application
    -> owns work semantics / orchestration / completion policy

Oracle
    -> owns source resolution / dereference / adaptation

ExHarness Core
    -> owns agent execution mechanics / runtime authority / cognition / evidence / recovery primitives
```

This subtree is convergence material. It cannot override source/public exports or promoted living decisions by file location alone.
