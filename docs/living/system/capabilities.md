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

## C6 — Bounded PM/SA project coordination

**Outcome:** a fresh/current project session can turn evidence-grounded SA architecture assessment and PM coordination proposals into bounded, durable project-graph changes without giving either role direct Blackboard authority.

**Preconditions:** project-bound session handoff; exact target lifecycle tuple; current target evidence refs; PM/SA coordination artifact store; canonical ApplicationOrchestrator.

**Application guarantees:** SA sees architecture-scoped context and can produce only architecture judgment/review need; PM sees bounded coordination context and can propose prerequisite work, target/new-work dependency edges, blockers and PM-sourced review requirements. The controller validates project/root/target/evidence freshness before delegating canonical mutation to the Orchestrator. `extendWorkGraph(...)` rechecks the exact target inside the same Blackboard transaction and atomically applies graph changes, direct proposal/assessment refs, blockers and grounded PM review requirements.

**Durable handoff:** direct Board-linked PM proposal refs + SA assessment refs + the corresponding canonical graph/blocker/review effects.

**Failure semantics:** stale project/root/target/evidence, invalid graph changes, conflicting work definitions or replay without both the direct canonical ref and its established effects fail closed. Orphan coordination artifacts are not lifecycle truth.

**Does not imply:** generic PM/SA Workers, a horizontal-role runtime/framework, SA ownership of project sequencing/timeline, PM architecture/completion/review-verdict authority, or direct role mutation of Blackboard.

Details: `agentic-application/contracts.md`, `agentic-application/workflow.md`, `agentic-application/architecture.md`.

## C7 — Bounded project work selection

**Outcome:** an opt-in selector can propose one currently eligible work item using explicit bounded policy/evidence while ordinary Orchestrator claim remains lifecycle authority.

**Preconditions:** current handoff `eligibleWork`; explicit policy; current measurements/evidence; current budget.

**Guarantees:** eligibility hard gate; mandatory obligations/starvation fencing before bounded scoring; persisted `WORK_SELECTION_DECISION`; full Board/policy/measurement/evidence/budget freshness required for reuse.

**Failure semantics:** changed or omitted scheduling input invalidates reuse even if the Board is unchanged; final claim rechecks current Board state.

**Does not imply:** default scheduler, universal weights or production benefit.

Details: `agentic-application/work-selection.md`.

## C8 — Durable research continuation

**Outcome:** research can resume exact incomplete work across fresh sessions, skip completed experiments, reassess stale evidence and submit only a reviewable proposal.

**Preconditions:** `RESEARCH_CONTINUATION v1` checkpoint + declared question/plan/experiment/evidence-ledger refs.

**Application guarantees:** Board stores lifecycle/cursor/refs, not research payloads; only declared refs are resolved; inconsistent active-experiment state fails closed; freshness is explicit/scope-aware; final proposal and PM-required research review are committed together.

**Failure semantics:** unresolved revision/freshness changes require reassessment and block submission.

**Does not imply:** generic research engine, automatic architecture-decision promotion or project acceptance.

Details: `agentic-application/research-continuation.md`.

## C9 — Bounded self-upgrade proposal loop

**Outcome:** one pinned candidate can be compared to one accepted baseline under fixed recorded scenarios and either keep the baseline or produce a proposal for independent review.

**Preconditions:** exact intent root; pinned baseline/candidate; independent evaluator/policy; fixed scenarios/budget/rollback; `adoptionAuthority: false`.

**Application guarantees:** protocol/independence/budget validation; durable pre-evaluation attempt blocker; bounded retry; only `PROPOSE_FOR_REVIEW` may submit; baseline remains selected until independent acceptance.

**Failure semantics:** failed/inconclusive evaluation keeps the baseline; crash recovery requires exact blocker/checkpoint and advances application generation.

**Does not imply:** self-modification, merge/deploy/rollout or automatic adoption.

Details: `agentic-application/self-upgrade.md`.

## C10 — Decision/outcome reconstruction for review

**Outcome:** an immutable summary can index already-persisted Core decision/outcome artifacts and a fresh review can re-resolve and verify the exact underlying chain.

**Preconditions:** exact semantic refs; source artifact resolver; immutable summary store.

**Application guarantees:** cross-artifact relation checks; source digest pinning; summary ref in normal submission; fresh read re-resolves exact sources and re-derives correctness-relevant fields.

**Core boundary:** Core remains producer/authority for deliberation, ActionIntent, effect, evaluation, grounded INTENT/REFLECTION and alignment artifacts. The application does not fabricate missing cognition.

**Failure semantics:** missing/changed/stale underlying artifacts fail closed; copied summary fields cannot override contradictory source evidence.

**Does not imply:** correctness evidence by itself, action authorization or project acceptance.

Details: `agentic-application/decision-outcome.md`, `core-harness/capabilities.md`.

## C11 — Authorized organizational work → released executable claim

**Outcome:** one accepted obligation can become one durable organization-managed work item that is discoverable by owning domain, claimable only by a trusted authorized principal, and releasable as an exact executable capability that survives restart and authority races.

**Preconditions:** one project/root intent; accepted decision + explicit bounded `MATERIALIZATION_AUTHORIZATION_GRANT`; durable Blackboard + immutable artifact registry + CAS current heads; trusted execution-principal provider; current `EXECUTION_AUTHORITY_POLICY` for the owning domain.

**Application guarantees:**
- materialization writes one immutable `ORGANIZATION_WORK_CONTRACT` containing the governed WHAT/provenance: project/root, accepted decision, exact grant observation, pinned authority-policy revision, implementation artifact, slice/obligation, logical/materialization identities, Board item id, domain/workload, dependencies, required artifacts, expected outputs and acceptance refs;
- `obligationSubjectKey` is the logical-work identity; at most one live Board item may exist for it. Exact `materializationKey` retries/concurrent identical attempts converge on the same Board item and immutable materialization receipt;
- organization work discovery is read-only: it validates exact immutable contracts, dependencies and owning domain; it cannot authenticate, claim, schedule or mutate lifecycle;
- claim authority derives the exact materialization grant from Board provenance plus a controller-configured current `EXECUTION_AUTHORITY_POLICY`; caller input cannot substitute another grant/policy or self-assert the execution principal;
- Board `CLAIMED` is provisional. Executable capability exists only after an immutable project/root-bound `CLAIM_RELEASE_RECEIPT` is current behind the project-scoped `ClaimReleaseHead`;
- claim/release/reconciliation/execution-entry revalidate exact authority observations and the exact canonical Board claim tuple. ACTIVE→ACTIVE head drift, policy-revision drift and stale claim generations fail closed;
- a fresh process can reconcile the same current claim generation from durable Board/artifacts/heads: complete a missing release, reconstruct the current receipt, or converge typed invalidation without minting a new semantic claim;
- work/materialization-authority loss converges `WORK_AUTHORIZATION_INVALIDATED -> BLOCKED`; execution principal/policy loss converges `EXECUTION_AUTHORITY_INVALIDATED -> REOPENED`. Canonical Board invalidation commits before release fencing;
- missing/corrupt immutable authority artifacts still produce exact raw-head invalidation provenance, so broken authority cannot leave a stale released capability silently executable.

**Durable state:** immutable work contract, materialization receipt, authority grant/policy artifacts, claim-release receipt, claim-authority invalidation artifacts; Board item + `claimGeneration`; pointer-only materialization/execution-authority heads; project-scoped claim-release head.

**Failure semantics:** stale/mismatched provenance, duplicate live logical work, unauthorized principal/domain, changed authority observation, corrupt authority artifact, stale Board claim tuple or release mismatch fail closed. Old release subjects are fenced without overwriting a newer canonical Board lifecycle.

**Does not imply:** execution HOW, `DOMAIN_EXECUTION_CONTROL`, Integration-B `ExecutionPolicy` / `ExecutionStrategy`, `ExecutionAttemptHead` / `ExecutionAttemptBinding`, actual BA/FE/BE/QA/DevOps workload execution, authoritative domain publication, cross-domain dispatch or ProductStateProjection.

Details: `agentic-application/capabilities.md`, `agentic-application/contracts.md`, `agentic-application/boundaries.md`, `../living/history/bb047-a1-closure-2026-09-19.md`.

## C12 — Released claim → bounded domain execution and reconstructable judgment

**Outcome:** one exact current released organizational claim can execute one owning-domain workload through a durable semantic attempt whose HOW/runtime binding is immutable and reconstructable across restart.

**Preconditions:** C11 released capability; current domain ExecutionPolicy head; immutable compatible ExecutionStrategyDescriptor; trusted runtime adapter; explicit domain completion evaluator and publication gate; durable immutable artifact and CAS-head stores.

**Application guarantees:** ExecutionAttemptHead is resolved before policy selection; first-attempt binding rechecks policy currentness before CAS; ACTIVE/RECOVERY_REQUIRED reuse the same ExecutionAttemptBinding; claim/release authority is revalidated before dispatch; exact runtime deployment identity is attested outside strategy self-report; runtime outcome, completion decision and authoritative publication are separate artifacts; fresh review can re-resolve the exact ExecutionJudgmentBundle chain.

**Failure semantics:** stale released claim fails before policy/runtime entry; crash after attempt creation preserves the same attempt and invocation identity for recovery; later policy promotion cannot rewrite an in-flight binding; strategy SUCCEEDED cannot self-authorize ACCEPT or publication.

**Does not imply:** organization-wide scheduling, cross-domain dispatch, automatic remediation/new attempts, ProductStateProjection, deployment/Product QA, or Integration C-J.

## Integration semantics

```text
Agentic Application
  owns capability/workflow meaning, WorkOrder/context requirements,
  durable project lifecycle and completion/review/acceptance semantics
        |
        +--> Oracle
        |      owns declared-source resolution, dereference, adaptation,
        |      provenance/integrity checks
        |      |
        |      +--> returns application-shaped BackendContext / QaContext
        |           to Agentic Application
        |
        +--> concrete Worker + resolved Application context
               |
               v
          ExHarness Core
            owns execution/runtime mechanics, evidence/trust/cognition,
            effect truth and recovery primitives
               |
               +--> returns runtime/evidence/effect state
                    to Agentic Application
```

Oracle and Core are dependencies composed by Agentic Application. Oracle does not dispatch Core work or own a direct authority edge into Core; Application binds resolved context to the concrete Worker before Core execution and applies completion/lifecycle semantics to the returned execution state.

State remains deliberately separate:

```text
Blackboard lifecycle state
!= Oracle source/cache state
!= Core session/effect state
!= trust/evidence payload stores
!= application artifact payload stores
```

Integration must preserve those authorities. Source failure blocks at the source boundary; lifecycle interruption is generation-fenced by Application; ambiguous mutating effects are reconciled from Core effect truth; acceptance failure returns through Application review/remediation semantics.

## C13 — Publication-fenced domain execution repair

**Outcome:** Integration B authoritative publication is mutation-current: one accepted domain outcome can become a canonical product only while the exact organization claim lifecycle and exact current domain writer authority remain fenced through the publication commit.

**Guarantees:** the public Blackboard store serializes every mutation and guarded publication through one non-takeover mutation fence while the immutable successor chain remains commit authority; publication uses a stable semantic-attempt publication key; concurrent recovery/retry converges on one canonical publication; the publication receipt records the exact lifecycle and writer-authority observations used by the mutation gate; recovery-relevant attempt transitions bind the exact observed durable head revision; fresh judgment re-derives transition/CAS revision continuity.

**Failure semantics:** claim lifecycle drift or writer-authority revocation cannot interleave through a canonical publication commit; a concurrent recovery loser may replay the terminal winner but cannot create a second canonical publication; forged or missing transition-head revision evidence fails fresh reconstruction.

**Does not imply:** cross-domain scheduling, Integration C+ lineage propagation, automatic domain remediation, deployment, or Product QA.
