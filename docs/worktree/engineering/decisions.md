# Active engineering decisions

Current constraints that must shape continuation. This is not an ADR archive.

## LAYERING

- AVO owns long-horizon search/control semantics; NOOA-style runtime owns how an agent acts inside a variation.
- Consumers inject domain semantics, infrastructure and correctness authorities; the kernel stays backend/frontend/QA/product agnostic.
- Deterministic kernel lifecycle rules outrank model self-reported state.

## AUTHORITY

- Source/public exports are implementation authority; worktree is a reconciled delivery projection.
- `Observation != SemanticMemory != Evaluation`.
- `AgentEvent != TurnEvent != TraceSpan != EffectJournal`.
- candidate state and trace history do not prove an external side effect completed.
- retrieval/ranking selects context; it is not correctness authority.
- search investment and supervision control continuation, not promotion correctness.

## CONTEXT

- Context is a bounded projection of canonical state/history, not a dump of repository/runtime history.
- Context selection cannot fabricate canonical runtime events; summaries/reductions retain source-event identity.
- Live resources and live objects carry explicit authority; snapshot/resume requires explicit rebinding rather than resurrecting transient authority.

## RECOVERY

- Recovery is machine-first where semantics are known: replay pure/idempotent work, observe externally reconcilable effects, escalate non-reconcilable ambiguity.
- Model/operator judgment is fallback for residual ambiguity, not the default mechanism for reconstructing state from logs/traces.
- Effect identity and recovery state must remain separate from semantic memory and evaluation state.

Remove or replace a decision here when the implementation authority changes it.
