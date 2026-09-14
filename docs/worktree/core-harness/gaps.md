# Core Harness gaps

Only unresolved, source-backed seams that matter to ExHarness Core continuation. Application/Oracle gaps belong in their own worktree subtrees.

## EFFECT / RECOVERY INTEGRATION

Delivered boundary:

- effect-aware capabilities journal operation intent before dispatch and reconcile `PURE | IDEMPOTENT | OBSERVABLE | NON_RECONCILABLE` outcomes;
- deliberation/action-intent lifecycle is explicit and inspectable;
- `createActionIntentEffectController()` binds a capability-target ActionIntent to the exact effect operation;
- a journaled `INTENDED`, `DISPATCHED` or `UNKNOWN` effect does not falsely transition the ActionIntent to `FAILED`;
- reconciliation can complete an observed/confirmed effect, prepare a safe retry, or escalate non-reconcilable ambiguity while preserving intent state.

Remaining:

- built-in `avo.act` is still a normal capability calling `core.act()`; it does not use the effect-aware action-intent path;
- `core.act()` still has an external-effect/persistence crash window because `environment.act()` completes before the resulting candidate/event persistence;
- AVO interrupted-variation recovery, AgentRuntime snapshot/restore and effect reconciliation remain separate APIs; there is no integrated restore -> reconcile pending effects -> resume lifecycle;
- the bundled effect journal is reference in-memory state. Production durability/fencing remains injected infrastructure rather than a bundled persistence implementation.

Exit conditions:

- externally visible built-in actions cannot be inferred complete from candidate, trace or variation state alone;
- recovery orders deterministic state restoration and pending-effect reconciliation before autonomous continuation;
- safe replay/observation is machine-first, while non-reconcilable ambiguity fails closed or escalates;
- effect state remains separate from evaluation, semantic memory and application completion authority.

## CORE WORKFLOW SURFACE

The Core now has the constituent lifecycle boundaries — deliberation/action intent, effects, observations/verifications/evaluation, grounded cognition, calibration, promotion, recovery and search investment — but no single executable lifecycle surface composes all of them.

Do not close this gap with a generic application workflow engine. A Core-level surface is justified only after a concrete Core consumer demonstrates the required sequencing and recovery semantics.

Desired shape remains roughly:

```text
bounded context / evidence
  -> deliberate
  -> authorize action intent
  -> effect/action
  -> observe / verify / evaluate
  -> grounded reflection / intent + calibration
  -> promote or continue search

recovery:
restore deterministic state
  -> reconcile pending effects
  -> restore exact evidence state
  -> continue at an explicit cognition boundary
```

Exit conditions:

- ordering and authority boundaries are kernel-owned and inspectable;
- application work decomposition, role semantics and completion policy remain outside Core;
- no lifecycle step treats model self-report, retrieval ranking or trace presence as correctness/effect authority.

Resolved cognition and memory-composition entries were removed: those capabilities already exist in source, and explicit opt-in memory visibility is an intentional trust/context boundary rather than a missing default.
