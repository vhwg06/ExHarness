# Repository state

Living delivery projection for ExHarness. Read this first; load child trees only when the task needs them.

## PROJECT

ExHarness is the publishable `exharness` kernel: AVO long-horizon control above a NOOA-style programmable agent runtime, with explicit evidence, trust, persistence, recovery and cognition boundaries.

The repository also carries desired-state work for outer agentic layers that consume the kernel. Those concerns remain separate from kernel implementation authority.

## DELIVERED

- AVO variation, lineage, verification/evaluation, supervision and adaptive search investment.
- NOOA-style typed judgments, Predict/CodeAct, object agents, live objects, progressive discovery, model routing and tracing.
- Revision-aware persistent work state plus explicit interrupted-variation recovery.
- Runtime snapshot/resume with compatibility checks and explicit resource/live-object rebinding.
- Semantic memory, graph/evolution/intelligence ports, spontaneous recall, and a separate NOOA-style retrieval adapter.
- Trust evidence/decision/attestation primitives and promotion freshness gates.
- Effect intent/replay/reconciliation primitives exposed separately from the normal AVO action path.

## ACTIVE ENGINEERING

- `engineering/state.md`

Current kernel desired delivery target: add an inspectable `deliberate -> act -> observe` step lifecycle and grounded `REFLECTION` / durable `INTENT` derivation from persisted evidence, then compose those boundaries with effect/recovery workflow semantics.

## ACTIVE AGENTIC APPLICATION

- `agentic-application/state.md`

Current Agentic Application desired delivery target: provide typed application semantics around deterministic Orchestrator control, bounded Advisor judgment, specialist Worker contracts, explicit WorkOrders/WorkResults, application-owned context requirements, Oracle context resolution and ExHarness-backed execution.

The Agentic Application Layer owns task/role/workflow semantics; it does not recreate ExHarness runtime mechanics or infrastructure source resolution.

## ACTIVE ORACLE

- `oracle/state.md`

Current Oracle desired delivery target: provide a thin, single-pass infrastructure bridge that resolves application-owned context requirements once before Worker execution by pulling/adapting concrete external sources and validating the resulting application-shaped context.

Oracle is tracked as a sibling worktree because its semantics belong to infrastructure around the Agentic Application Layer, not to ExHarness Core.

## RECONCILE

Source/public exports are authority for what is implemented now. Worktree is authority for the active desired delivery state. Implementation is complete when source converges to the desired semantics and the projections can be reconciled back to current delivered truth. Git/history keeps the past.
