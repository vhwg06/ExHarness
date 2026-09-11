# Persistent K and Grounded Feedback

## Objective

ExHarness needs long-horizon memory without turning conversation history, raw trajectory, feedback, and curated knowledge into one undifferentiated context blob.

The AVO/NOOA composition therefore separates four things:

```text
trajectory
  = what happened

persistent domain state
  = implementations / observations / verifications / evaluations / variations

feedback
  = grounded typed projection over persisted execution/evaluation state

K (knowledge)
  = agent-curated reusable reasoning records with explicit scope, provenance, and relations
```

NVIDIA AVO motivates the persistent-memory side: useful prior implementations, evaluation results, tool outputs, and accumulated reasoning must survive beyond a single model context. NVIDIA NOOA motivates the model-callable memory side: the agent should deliberately write/query/correct memory and typed relations should preserve how records support, contradict, or derive from one another.

## Feedback is a projection, not a second log

Feedback is derived from records ExHarness already persists. This slice projects:

- action results
- observations
- verification artifacts
- objective evaluations
- completed variation results

Each feedback item has a stable derived ID, source identity, candidate binding, timestamp, kind, and value.

There is intentionally no `recordFeedback()` API. Agent text cannot manufacture grounded feedback. New feedback must originate from a persisted execution/evaluation source.

Feedback queries are selective and may filter to the current candidate, kinds, a cursor, and a limit.

## K is curated, scoped memory

Knowledge remains append-only history. The active view is derived rather than overwriting the past.

Knowledge scopes:

- `CANDIDATE` — default; active only for the exact current candidate. This is the safe default for local findings.
- `LINEAGE` — reusable across committed versions in the current sequential lineage.
- `SESSION` — reusable across the whole work session and must be chosen explicitly.

Legacy records without a scope are read as `CANDIDATE` so old sessions do not silently lose memory after upgrade.

Knowledge records can carry:

- `feedbackRefs` — stable provenance links to grounded feedback
- legacy/free-form `evidence` — retained for compatibility
- tags
- typed relations

Typed relations:

- `SUPPORTS`
- `CONTRADICTS`
- `DERIVED_FROM`
- `SUPERSEDES`

`SUPERSEDES` changes the active view but does not delete history. `CONTRADICTS` never chooses a winner; active conflicts remain visible to the agent/evaluator/supervisor.

## Correction semantics

A new record may supersede an older record only at the same semantic scope.

- candidate-scoped corrections must target the same candidate;
- session-scoped corrections remain session-scoped;
- lineage-scoped corrections may supersede earlier lineage records after later commits in the current sequential lineage.

The last rule is required because AVO search is expected to revise its accumulated understanding as committed candidates advance.

Parallel lineage semantics are intentionally not inferred yet. ExHarness still permits only one running variation per session, so a single committed lineage exists. Branch-aware memory ancestry belongs with future concurrency/CAS work.

## Model-facing memory APIs

A variation agent receives capability names rather than the complete persistent memory store:

```text
avo.queryFeedback
avo.queryKnowledge
avo.recordKnowledge
```

The strategy can pull the memory slice it needs. This keeps persistent memory separate from model context and leaves context dosage/projection policy explicit.

## Development verification for this slice

Manual vigilance must challenge at least:

1. candidate-local knowledge leaking into a newer candidate;
2. session/lineage knowledge disappearing after candidate or lineage advancement;
3. a superseded record vanishing from history rather than only the active view;
4. contradictory active records being silently resolved;
5. knowledge citing nonexistent feedback;
6. agent-returned text or knowledge being misclassified as grounded feedback;
7. stale candidate feedback entering a current-candidate-only query;
8. old pre-scope knowledge becoming invisible after upgrade;
9. broad memory being dumped automatically into every variation context.

Automated tests guard stable invariants. They are not the sole verification claim.

## Residual gaps

- no automatic reflection, deduplication, summarization, importance scoring, or pruning yet;
- no semantic proof that a `SESSION` or `LINEAGE` claim is actually general enough for that scope; the scope is an explicit authoring decision;
- no provenance dependency graph beyond feedback refs and typed knowledge-to-knowledge relations;
- no branch-aware lineage memory because parallel variations are not supported yet;
- feedback ordering uses persisted timestamps plus stable IDs, not a dedicated global sequence number;
- query defaults (`limit: 50`) are practical bounds, not benchmark-derived optimal context doses.
