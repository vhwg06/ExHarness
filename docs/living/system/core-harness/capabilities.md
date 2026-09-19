# ExHarness Core capabilities

Core owns execution/runtime mechanics, bounded cognition, evidence/trust and effect/recovery primitives. It does not own Agentic Application project workflow or Oracle source selection.

## H1 — Persisted AVO execution state
Outcome: execute variations with persisted candidate/observation/verification/evaluation/knowledge/lineage/trajectory/trust state.
Guarantee: promotion requires current evaluation bound to exact current observation/verification snapshots.
Failure: unrecovered running variation gates new variation.
Limit: Core candidate/evaluation state is not application project completion.
Details: `state.md`, `workflow.md`.

## H2 — Durable action-effect truth
Outcome: journal built-in mutating actions so a confirmed external result can be reused after later Core persistence failure without external redispatch.
Durable state: deterministic action identity + `INTENDED -> DISPATCHED -> CONFIRMED | UNKNOWN`.
Guarantees: confirmed result reuse for the same current base; effect journal remains separate from candidate/evaluation/application completion.
Failure: ambiguity defaults to `NON_RECONCILABLE`; candidate divergence escalates.
Limit: action identity does not prove idempotency or exactly-once behavior.
Details: `workflow.md`.

## H3 — Explicit effect reconciliation
Outcome: reconcile ambiguous effects through declared `PURE | IDEMPOTENT | OBSERVABLE | NON_RECONCILABLE` semantics.
Guarantee: PURE/IDEMPOTENT retry; OBSERVABLE observe then continue/retry; NON_RECONCILABLE escalate.
Limit: effect confirmation is not evaluation success or application acceptance.
Details: `workflow.md`.

## H4 — Runtime snapshot/resume
Outcome: restore compatible AgentRuntime state with explicit live-authority rebinding.
Guarantee: compatibility checks; restore last safe runtime state rather than pretending to resume an in-flight call stack.
Limit: runtime resume is separate from project lifecycle and effect reconciliation.
Details: `state.md`, `workflow.md`.

## H5 — Interrupted variation recovery
Outcome: explicitly close persisted running variation as `INTERRUPTED` after effect truth is handled.
Guarantee: variation recovery stays distinct from effect reconciliation and application claim recovery.
Limit: closing variation does not certify effect outcome or project completion.
Details: `workflow.md`.

## H6 — Structured cognition + ActionIntent/effect linkage
Outcome: persist bounded deliberation/ActionIntent, authorize exact intended capability/input, link to exact effect operations and later ground semantic continuation.
Guarantees: raw chain-of-thought is not the artifact contract; ActionIntent and SemanticMemory.INTENT stay distinct; ambiguous pending effects remain linked until reconciliation.
Limit: cognition artifacts are not correctness/promotion/project-acceptance authority.
Details: `workflow.md`.

## H7 — Grounded REFLECTION / INTENT and alignment
Outcome: activate semantic reflection/continuation only from persisted source snapshots with grounding verification; reflection requires fresh evaluation source.
Guarantee: alignment can expose semantic divergence as a search signal.
Limit: alignment is not evaluation or promotion verdict.
Details: `state.md`, `workflow.md`.

## H8 — Evidence/trust primitives for application acceptance
Outcome: provide structured EvidenceArtifact / DecisionArtifact / Attestation primitives consumed by application trust policy.
Guarantee: explicit trust payloads/refs instead of reviewer prose.
Limit: Core does not decide project review requirement, scheduling, lifecycle transition or final `DONE`.
Details: `../agentic-application/project-acceptance.md`.

## Integration rule

```text
Application generation fence
  = which application attempt may mutate Board?

Core effect truth
  = what is known about interrupted external effects?

Application completion policy
  = does recovered work satisfy role/project obligations?
```

Those truths must not substitute for one another.
