# Current Core Harness invariants

These constraints describe current Core authority boundaries; they are not a future-work list.

## Layering

- AVO owns long-horizon search/control semantics; AgentRuntime owns how an agent acts inside a variation.
- Agentic Application owns domain/work orchestration above Core; Oracle owns source-resolution infrastructure.
- Core remains backend/frontend/QA/product agnostic.
- deterministic lifecycle rules outrank model self-report.

## Authority

- `Observation != SemanticMemory != Evaluation`.
- `AgentEvent != TurnEvent != TraceSpan != EffectJournal`.
- `SemanticMemory.INTENT != ActionIntent`.
- `IntentReflectionAlignment != Evaluation`.
- candidate state and trace history do not prove an external side effect completed.
- retrieval/ranking selects context; it is not correctness authority.
- search investment and supervision control continuation, not promotion correctness.

## Grounded cognition

- durable `REFLECTION` and semantic `INTENT` require persisted source snapshots plus grounding verification;
- active reflection retains a fresh evaluation source reference;
- grounded cognition may inform later work but cannot self-certify evaluation correctness or external-effect completion.

## Recovery/effects

- effect identity/recovery state remain separate from semantic memory and evaluation state;
- replay/observation is machine-first where semantics are known;
- non-reconcilable ambiguity is not reconstructed from model prose or traces.

Open integration problems implied by these current boundaries are tracked in `../../living/blackboard.md`.
