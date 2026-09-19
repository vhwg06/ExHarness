# Current Core Harness invariants

These constraints describe current Core authority boundaries; they are not a future-work list.

## Layering

- AVO owns long-horizon search/control semantics; AgentRuntime owns how an agent acts inside a variation.
- Agentic Application owns domain/work orchestration above Core; Oracle owns source-resolution infrastructure.
- Core remains backend/frontend/QA/product agnostic.
- deterministic lifecycle rules outrank model self-report.
- no higher-level executable Core lifecycle facade is currently justified; one concrete recovery-composition consumer is evidence for ordering, not enough repeated pressure for a generalized API.

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

- effect identity/recovery state remain separate from candidate lineage, semantic memory, evaluation state and application completion;
- public built-in `avo.act` persists an effect operation before dispatch and records confirmed results independently from the enclosing Core session state;
- deterministic `actionKey` is operation identity, not evidence that an effect completed;
- a durably `CONFIRMED` effect result may be reused to finish Core state after a persistence crash without dispatching the external effect again;
- ambiguous `DISPATCHED`/`UNKNOWN` state fails closed by default with `NON_RECONCILABLE` replay semantics;
- replay/observation is machine-first only when the environment adapter explicitly declares `PURE`, `IDEMPOTENT` or `OBSERVABLE` semantics;
- non-reconcilable ambiguity is not reconstructed from model prose, candidate state or traces;
- BB-007 recovery ordering remains a concrete contract: restore runtime authority -> reconcile effect truth -> close interrupted variation -> preserve evidence -> explicit resume;
- do not collapse runtime restore, effect reconciliation, variation recovery, evidence restoration or application completion into one authority merely for API convenience.

Open integration problems implied by these current boundaries are tracked in `../../living/blackboard.md`.
