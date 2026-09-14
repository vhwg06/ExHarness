# Active engineering decisions

Current constraints that must shape continuation. This is not an ADR archive.

## LAYERING

- AVO owns long-horizon search/control semantics; NOOA-style runtime owns how an agent acts inside a variation.
- Consumers inject domain semantics, infrastructure and correctness authorities; the kernel stays backend/frontend/QA/product agnostic.
- Deterministic kernel lifecycle rules outrank model self-reported state.
- Strategy owns reasoning policy; kernel owns inspectable lifecycle/authority boundaries around the resulting steps.

## AUTHORITY

- Source/public exports are implementation authority; worktree is the desired delivery projection for active engineering.
- `Observation != SemanticMemory != Evaluation`.
- `AgentEvent != TurnEvent != TraceSpan != EffectJournal`.
- `SemanticMemory.INTENT != ActionIntent`.
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
- Grounded reflection/intent may inform later context and deliberation, but cannot self-certify evaluation correctness or external-effect completion.
- Durable semantic intent expresses continuing goal state; per-step action/effect intent expresses one concrete intended operation.

## CONTEXT

- Context is a bounded projection of canonical state/history, not a dump of repository/runtime history.
- Context selection cannot fabricate canonical runtime events; summaries/reductions retain source-event identity.
- Live resources and live objects carry explicit authority; snapshot/resume requires explicit rebinding rather than resurrecting transient authority.

## RECOVERY

- Recovery is machine-first where semantics are known: replay pure/idempotent work, observe externally reconcilable effects, escalate non-reconcilable ambiguity.
- Model/operator judgment is fallback for residual ambiguity, not the default mechanism for reconstructing state from logs/traces.
- Effect identity and recovery state must remain separate from semantic memory and evaluation state.

Remove or replace a decision here when the desired/implemented authority changes it.
