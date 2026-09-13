# Engineering state

Bounded engineering projection. Route to child context instead of loading the repository or architecture history wholesale.

## CURRENT

- AVO control: candidate variation, lineage, supervision, search investment.
- Agent runtime: judgments, Predict/CodeAct, turns/events, context, resources/live objects, model routing, tracing.
- Cognition: semantic memory with NOOA-style retrieval behind ExHarness canonical-record/budget boundaries.
- Evidence: observations, verifications, evaluations, freshness and promotion gates.
- Durability: persistent work state, snapshot/resume primitives.
- Effects: explicit operation journal/replay semantics exist as a standalone primitive.

## COMPOSED

- AVO -> `AgentRuntime`
- runtime -> bounded context + canonical working history
- semantic retrieval -> canonical memory authority boundary
- current observation/verification snapshots -> evaluation freshness -> promotion

## GAPS

- effect reconciliation is not wired into built-in `avo.act`;
- no integrated restore -> reconcile effects -> resume workflow lifecycle;
- no consumer-facing workflow/pipeline composition API.

## CONTEXT

- Workflow/recovery seam -> `workflow.md`

## SOURCE MAP

`state.js`, `avo-harness.js`, `agent-runtime.js`, `semantic-memory-retrieval.js`, `evaluation-freshness.js`, `effect-reconciliation.js` under `packages/core-harness/src/`.
