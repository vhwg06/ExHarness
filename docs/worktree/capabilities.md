# Agentic System capabilities

This is the capability-first, source-synchronized semantic map of the Agentic System **as implemented now**.

It answers what the system can do, which boundary owns each guarantee, what durable state crosses boundaries, how failures propagate, and what the capability explicitly does **not** imply. Capability facts come from current source/public contracts and executable behavior, never from Blackboard DONE/history.

## C1 — Project-bound fresh-session continuation

**Outcome:** a fresh session can reopen the same durable project and recover lifecycle/review/checkpoint state without prior conversation state.

**Preconditions:** JSON-backed Blackboard; exactly one durable user-intent root; matching explicit `projectId` for project-bound handoff; work provenance traceable to that root.

**Application guarantees:** project identity, lifecycle buckets, claim/review generations, active review, checkpoints and artifact/evidence refs are durable and projected to the fresh session. Identity/provenance ambiguity fails closed.

**Core/Oracle boundary:** reading the handoff does not require Oracle or Core. Later concrete work resolves only its declared source refs; mutating Backend recovery separately consults persisted Core effect truth.

**Durable handoff:** `USER_INTENT_ROOT` + Board graph + generations + checkpoints + refs.

**Does not imply:** project registry, distributed coordination or automatic next-work selection.

Details: `agentic-application/contracts.md`, `agentic-application/state.md`.

## C2 — Durable Backend -> QA continuation

**Outcome:** accepted Backend work can continue into non-mutating QA across fresh sessions, including source-block resume and bounded remediation.

**Preconditions:** durable Board workflow; validated Backend/QA specs; accepted Backend revision/result; resolvable artifact refs.

**Application guarantees:** exact stage checkpoints; accepted ref-only `BackendQaHandoff`; Backend acceptance before `QA_PENDING`; QA acceptance submits to review rather than project `DONE`.

**Oracle guarantees:** resolve only declared application artifacts and preserve producer/revision/acceptance provenance.

**Core guarantees:** execute concrete Workers and provide evidence/effect recovery primitives. Interrupted mutating Backend execution must recover from persisted effect truth before redispatch.

**Durable handoff:** stage checkpoint + accepted revision + artifact refs + Backend/QA decision refs.

**Failure semantics:** source failure blocks the exact stage; non-reconcilable Backend effect ambiguity blocks instead of guessing.

**Does not imply:** exactly-once effects or project completion.

Details: `agentic-application/workflow.md`, `oracle/capabilities.md`, `core-harness/capabilities.md`.

## C3 — Manifest-protected Backend -> QA continuation

**Outcome:** protected QA reads can be bound to the exact producer-side artifact manifest made durable before protected `QA_PENDING`.

**Preconditions:** C2 + explicit manifest publisher + revision-bound producer bytes + manifest store/reader.

**Application guarantees:** exact manifest ref is durable before the protected checkpoint; publication failure after Backend effects returns through Backend/Core recovery; a durable receipt is reused only when recovered acceptance is semantically equivalent.

**Oracle guarantees:** validate ref/path, producer, revision, acceptance provenance, stored revision, availability and content digest; fresh QA is scoped to the exact persisted manifest ref.

**Core guarantee:** effect truth remains recovery authority when publication is interrupted after potential mutation.

**Failure semantics:** missing/conflicting manifest, provenance drift, unavailable payload or content mismatch fails closed; protected reads never silently downgrade.

**Does not imply:** semantic correctness, independent authenticity, infinite retention or acceptance correctness.

Details: `oracle/artifact-manifest.md`, `agentic-application/contracts.md`.

## C4 — Trusted Backend/QA project acceptance and same-item remediation

**Outcome:** a final Backend/QA submission can undergo fresh-session, evidence-grounded project review; rejection/inconclusive review reopens the same item for bounded remediation, while acceptance can complete only after all obligations are satisfied.

**Preconditions:** exact Backend/QA decision refs; application artifact refs; explicit PM-sourced acceptance requirement; durable trust artifacts; configured verifier/evaluator/attestation/trust policy.

**Application guarantees:** review preparation resolves exact inputs before dispatch; review is bound to an exact generation/subject; trust policy is checked before lifecycle mutation; rejection reopens the same item; accepted findings still require reconciliation.

**Oracle boundary:** application-artifact dereference is distinct from trust-artifact dereference and missing source input fails before dispatch.

**Core contribution:** EvidenceArtifact / DecisionArtifact / Attestation primitives.

**Failure semantics:** missing/corrupt/mismatched inputs fail closed; interrupted review increments generation, invalidating abandoned-attempt evidence.

**Does not imply:** reviewer prose as evidence, cryptographic proof of PM identity, or role-local acceptance as project completion.

Details: `agentic-application/project-acceptance.md`, `agentic-application/contracts.md`.

## C5 — Generation-fenced execution/review recovery

**Outcome:** interrupted application attempts can be replaced without allowing abandoned attempts to commit late state.

**Application guarantees:** monotonic `claimGeneration` and `reviewGeneration`; exact generation required for checkpoint/submit/block/assessment; explicit `recoverClaim` / `recoverReview` fences old attempts.

**Core boundary:** generation fencing answers who may mutate Board state; it does not answer what happened to an external mutating effect. Backend recovery therefore consults Core effect truth separately.

**Durable state:** generations + active review/checkpoint + persisted Backend Core session/effect journal where required.

**Failure semantics:** elapsed time, heartbeat loss, owner equality or empty volatile state is never proof that redispatch is safe.

**Does not imply:** lease correctness or exactly-once effects.

Details: `agentic-application/contracts.md`, `core-harness/workflow.md`.

## C6 — Bounded project work selection

**Outcome:** an opt-in selector can propose one currently eligible work item using explicit bounded policy/evidence while ordinary Orchestrator claim remains lifecycle authority.

**Preconditions:** current handoff `eligibleWork`; explicit policy; current measurements/evidence; current budget.

**Guarantees:** eligibility hard gate; mandatory obligations/starvation fencing before bounded scoring; persisted `WORK_SELECTION_DECISION`; full Board/policy/measurement/evidence/budget freshness required for reuse.

**Failure semantics:** changed or omitted scheduling input invalidates reuse even if the Board is unchanged; final claim rechecks current Board state.

**Does not imply:** default scheduler, universal weights or production benefit.

Details: `agentic-application/work-selection.md`.

## C7 — Durable research continuation

**Outcome:** research can resume exact incomplete work across fresh sessions, skip completed experiments, reassess stale evidence and submit only a reviewable proposal.

**Preconditions:** `RESEARCH_CONTINUATION v1` checkpoint + declared question/plan/experiment/evidence-ledger refs.

**Application guarantees:** Board stores lifecycle/cursor/refs, not research payloads; only declared refs are resolved; inconsistent active-experiment state fails closed; freshness is explicit/scope-aware; final proposal and PM-required research review are committed together.

**Failure semantics:** unresolved revision/freshness changes require reassessment and block submission.

**Does not imply:** generic research engine, automatic architecture-decision promotion or project acceptance.

Details: `agentic-application/research-continuation.md`.

## C8 — Bounded self-upgrade proposal loop

**Outcome:** one pinned candidate can be compared to one accepted baseline under fixed recorded scenarios and either keep the baseline or produce a proposal for independent review.

**Preconditions:** exact intent root; pinned baseline/candidate; independent evaluator/policy; fixed scenarios/budget/rollback; `adoptionAuthority: false`.

**Application guarantees:** protocol/independence/budget validation; durable pre-evaluation attempt blocker; bounded retry; only `PROPOSE_FOR_REVIEW` may submit; baseline remains selected until independent acceptance.

**Failure semantics:** failed/inconclusive evaluation keeps the baseline; crash recovery requires exact blocker/checkpoint and advances application generation.

**Does not imply:** self-modification, merge/deploy/rollout or automatic adoption.

Details: `agentic-application/self-upgrade.md`.

## C9 — Decision/outcome reconstruction for review

**Outcome:** an immutable summary can index already-persisted Core decision/outcome artifacts and a fresh review can re-resolve and verify the exact underlying chain.

**Preconditions:** exact semantic refs; source artifact resolver; immutable summary store.

**Application guarantees:** cross-artifact relation checks; source digest pinning; summary ref in normal submission; fresh read re-resolves exact sources and re-derives correctness-relevant fields.

**Core boundary:** Core remains producer/authority for deliberation, ActionIntent, effect, evaluation, grounded INTENT/REFLECTION and alignment artifacts. The application does not fabricate missing cognition.

**Failure semantics:** missing/changed/stale underlying artifacts fail closed; copied summary fields cannot override contradictory source evidence.

**Does not imply:** correctness evidence by itself, action authorization or project acceptance.

Details: `agentic-application/decision-outcome.md`, `core-harness/capabilities.md`.

## Integration semantics

```text
Agentic Application
  owns capability/workflow meaning, durable project lifecycle,
  stage/review/acceptance ordering
        |
        | exact declared context/artifact requirements + refs
        v
Oracle
  owns declared-source resolution, dereference, adaptation,
  provenance/integrity checks
        |
        | application-shaped resolved context
        v
ExHarness Core
  owns execution/runtime mechanics, evidence/trust/cognition,
  effect truth and recovery primitives
```

State remains deliberately separate:

```text
Blackboard lifecycle state
!= Oracle source/cache state
!= Core session/effect state
!= trust/evidence payload stores
!= application artifact payload stores
```

Integration must preserve those authorities. Source failure blocks at the source boundary; lifecycle interruption is generation-fenced by Application; ambiguous mutating effects are reconciled from Core effect truth; acceptance failure returns through Application review/remediation semantics.
