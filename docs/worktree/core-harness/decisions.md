# Active Core Harness decisions

Current constraints that must shape ExHarness Core continuation. This is not an ADR archive and it does not define Agentic Application/Oracle semantics.

## LAYERING

- AVO owns long-horizon search/control semantics; NOOA-style runtime owns how an agent acts inside a variation.
- Agentic Application owns domain/work orchestration above Core; Oracle owns source-resolution infrastructure around that application boundary.
- Core remains backend/frontend/QA/product agnostic.
- Deterministic Core lifecycle rules outrank model self-reported state.
- Strategy owns reasoning policy; Core owns inspectable lifecycle/authority boundaries around the resulting steps.

## AUTHORITY

- Source/public exports are implementation authority; this subtree is the desired delivery projection for active Core continuation.
- `Observation != SemanticMemory != Evaluation`.
- `AgentEvent != TurnEvent != TraceSpan != EffectJournal`.
- `SemanticMemory.INTENT != ActionIntent`.
- `IntentReflectionAlignment != Evaluation`.
- candidate state and trace history do not prove an external side effect completed.
- retrieval/ranking selects context; it is not correctness authority.
- search investment and supervision control continuation, not promotion correctness.

## DELIBERATION

- Deliberation must be represented as a bounded structured artifact/step, never raw chain-of-thought.
- A deliberation must identify the context/evidence snapshot it consumed and the action intent it selected.
- Actions should be causally attributable to their selecting deliberation and resulting observation.
- Independent pre-action policy/verification may inspect structured intent without requiring access to hidden model reasoning.

## GROUNDED COGNITION

- `REFLECTION` and durable `INTENT` must be derived from persisted source snapshots, not accepted as truth because model prose supplied them.
- Source linkage/provenance alone is insufficient; semantic derivation requires a grounding boundary that can reject unsupported or stale output.
- Every active `REFLECTION` must retain an exact source ref to a persisted evaluation whose input snapshot remains fresh at activation time.
- Grounded reflection/intent may inform later context and deliberation, but cannot self-certify evaluation correctness or external-effect completion.
- Durable semantic intent expresses continuing goal state; per-step action/effect intent expresses one concrete intended operation.

## SEMANTIC CALIBRATION

- Intent/reflection comparison is a prediction-error signal: it measures mismatch between a grounded pre-action expectation and a grounded post-evaluation semantic outcome.
- Alignment must bind exact intent/reflection memory IDs and revisions plus grounding/evaluation evidence; model self-report is not a valid alignment source by itself.
- Divergence may become grounded search knowledge and influence adaptive search investment, but it is never a correctness verdict or promotion gate.
- Search investment must only consume persisted alignment signals through a freshness-bound input path; later signals must invalidate older decisions.

## CONTEXT

- Core context is a bounded projection of canonical runtime state/history, not an Oracle replacement and not a repository dump.
- Context selection cannot fabricate canonical runtime events; summaries/reductions retain source-event identity.
- Live resources and live objects carry explicit authority; snapshot/resume requires explicit rebinding rather than resurrecting transient authority.

## RECOVERY

- Recovery is machine-first where semantics are known: replay pure/idempotent work, observe externally reconcilable effects, escalate non-reconcilable ambiguity.
- Model/operator judgment is fallback for residual ambiguity, not the default mechanism for reconstructing state from logs/traces.
- Effect identity and recovery state must remain separate from semantic memory and evaluation state.

Remove or replace a decision here when the desired/implemented Core authority changes it.
