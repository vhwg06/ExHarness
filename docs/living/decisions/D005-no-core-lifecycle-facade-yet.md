# D005 — Do not extract a Core lifecycle facade yet

Status: **PROMOTED**

Accepted: 2026-09-16

## Question

After BB-007 proved deterministic recovery composition, is there enough source pressure to introduce a higher-level executable Core lifecycle/recovery facade?

## Evidence

Current source has distinct public mechanisms for:

- AgentRuntime snapshot/restore and authority rebinding;
- AVO interrupted-variation recovery;
- built-in AVO effect journaling/reconciliation;
- persisted observation/verification/evaluation state;
- explicit harness resume/continuation.

BB-007 adds one concrete recovery-reference consumer proving the required ordering across those mechanisms. Repository search does not show a second production/application consumer repeating that full sequence. Existing `actionEffects()` / `reconcileActionEffect()` usage is still confined to Core effect/recovery contracts rather than repeated application orchestration.

## Decision

Do **not** introduce a generic executable Core lifecycle facade now.

Keep the proven sequencing as a concrete contract and keep the existing authority boundaries separate:

```text
runtime restore
  != effect reconciliation
  != variation recovery
  != evidence restoration
  != application completion
```

A new facade would currently encode one consumer's sequence as a generalized API before repeated semantics exist.

## Reopen pressure

Reassess only when at least one additional concrete consumer demonstrates repeated orchestration pressure, for example:

- a second real recovery consumer repeats the same ordering;
- production evaluation exposes recurring caller mistakes or coordination boilerplate;
- multiple callers need one stable executable boundary while preserving the same authority separation.

If that pressure appears, extraction must preserve BB-007 ordering and must not absorb Agentic Application WorkOrder/Worker/PM/SA/completion semantics.

## Consequences

- no `LifecycleEngine`, generic `RecoveryCoordinator`, registry or workflow DSL is added by BB-008;
- current Core primitives remain independently usable and testable;
- BB-007 remains the concrete executable contract evidence;
- absence of a facade is a deliberate current architecture constraint, not an unresolved implementation gap.
