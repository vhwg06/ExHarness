# D010 — Backend/QA project completion requires an explicit trusted acceptance obligation

Status: **PROPOSED**

Proposed: 2026-09-16

Acceptance boundary: BB-018 application-architecture review plus acceptance/trust review. This proposal must not be promoted into `docs/worktree/*` or used to mark BB-018 complete before those reviews accept it.

## Context

The durable Backend -> QA workflow already produces grounded Backend and QA role-local acceptance decisions and submits one final immutable Blackboard payload containing the accepted revision plus decision/artifact/evidence refs.

The Blackboard Orchestrator already supports separate Worker review requests, PM review requirements, exact review subjects, trusted evidence/decision/attestation bundles and finding reconciliation.

Three concrete gaps remain:

1. the final Backend -> QA submission currently supplies no review requirement, so it can persist as `PENDING_REVIEW` with no legal `beginReview(...)` target;
2. a configured project policy is not itself PM authority even though D003 says PM/project coordination owns project-review requirements;
3. Backend/QA Decision/Evidence artifacts are created in-process while Blackboard persists only refs; current Agentic Application source has no durable trust-artifact store proving those payloads survive for a fresh review session.

## Choice

For the first concrete Backend -> QA project-completion path:

1. project acceptance review is an **explicit mandatory project obligation**;
2. D003 remains authoritative: that requirement originates from PM/project-coordination authority, not from a Worker and not from configuration merely existing;
3. configuration may transport a PM-authorized requirement and project trust policy, but BB-019 must keep the authority assumption explicit;
4. role-local Decision/Evidence artifacts required by later project review are persisted durably **before** their refs are committed into Blackboard state;
5. Blackboard remains ref-only coordination/lifecycle state; a bounded application-provided trust-artifact store owns immutable trust-artifact payload durability and lookup, not work status;
6. the project reviewer receives only the exact active review target, final Backend/QA lineage, declared application/trust artifact inputs and explicit project acceptance policy;
7. review evidence, evaluator decision and attestation reuse existing Core `EvidenceArtifact`, `DecisionArtifact`, `Attestation` and `TrustBoundary.ACCEPTANCE` primitives;
8. `ApplicationOrchestrator` remains completion authority and derives `DONE` only after all declared review obligations are trusted-ACCEPTED, findings are reconciled and no current remaining work exists;
9. missing PM authority/configuration, unavailable/mismatched refs or invalid trust fail closed and never become implicit acceptance;
10. a future no-review mode, if required, needs an explicit project-policy authority outcome. Empty review requirements are not such an outcome.

Conceptually:

```text
PM/project coordination
  -> REQUIRE BACKEND_QA_PROJECT_ACCEPTANCE

Backend / QA role completion
  -> persist required trust artifacts
  -> commit durable refs to Blackboard only after payload durability is confirmed

final BackendQa submission
  -> ref-only review lineage

review preparation
  -> resolve exact trust refs from durable trustArtifactStore
  -> resolve exact application refs from applicationArtifactReader
  -> validate ids/digests

Orchestrator
  -> exact review target / attempt

project verification
  -> EvidenceArtifact[]

review evaluator
  -> DecisionArtifact @ ACCEPTANCE

attestor
  -> signed Attestation

Orchestrator trust validation/reconciliation
  -> DONE | REOPENED | PENDING_RECONCILIATION
```

## PM authority boundary

D003 says PM/project coordination may require review because of project obligations.

Therefore:

```text
PM-authorized requirement
-> may be transported in project/application configuration
-> may be persisted through existing requireReview(... source: PM ...)
```

but:

```text
configuration object exists
!= PM authority proven
```

Current `requireReview(...)` does not cryptographically authenticate PM identity. BB-019 must expose this as an application authority assumption and must not claim stronger identity assurance than source provides.

A concrete PM Worker/runtime role remains outside this decision.

## Durable trust-artifact boundary

Blackboard is coordination/ref state, not the Decision/Evidence payload store.

BB-019 must introduce one concrete application-provided durable `trustArtifactStore` or equivalent source-backed capability with minimum semantics such as:

```text
putDecision(DecisionArtifact) -> { id, digest }
putEvidence(EvidenceArtifact) -> { id, digest }
readDecision({ id, digest }) -> DecisionArtifact
readEvidence({ id, digest }) -> EvidenceArtifact
```

Writes and reads validate artifact identity/digest.

Required ordering:

```text
persist immutable/content-addressed trust artifact
-> confirm durable ref
-> persist ref into Blackboard checkpoint/submission
```

A crash after artifact write but before Board update may leave an orphaned immutable payload. That is cleanup/retention pressure and does not corrupt canonical lifecycle state.

The reverse order is rejected because it can leave a canonical Blackboard ref pointing at a payload that never became durable.

If project acceptance policy requires evidence referenced by a prior DecisionArtifact's evidence manifest, only those exact evidence refs are resolved.

Existing application `artifactReader` remains responsible for Backend/QA application artifacts. Trust-artifact payload storage and application-artifact dereference remain distinct source boundaries.

This concrete store does not create a second lifecycle authority and does not justify a universal Oracle provider framework.

## Trust authorities

The first implementation preserves these authority concepts:

```text
submission producer
PM/project-obligation authority
review evaluator
verification evidence producer
attestation issuer
trustArtifactStore payload authority
ApplicationOrchestrator lifecycle authority
```

Current source guarantees the scheduled reviewer differs from the submission producer and verifies evaluator/evidence/issuer authority through the trust boundary. Existing independent issuer/evidence-producer checks are relative to the review-subject producer.

This decision does **not** claim reviewer, verifier and attestor are automatically pairwise distinct. A concrete project policy may require distinct identities. Otherwise multiple roles may map to one service only when every configured authority/independence check still passes.

Role labels or reviewer prose alone do not establish authority.

The review trust bundle remains:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

No new review-specific trust artifact type is introduced.

## Failure semantics

- review requirement exists but no reviewer dispatched -> durable `PENDING_REVIEW`;
- required trust/application artifact unavailable before dispatch -> keep item `PENDING_REVIEW`, return preparation diagnostic, do not fabricate a verdict;
- trust artifact resolves with wrong id/digest -> fail closed before dispatch;
- trust-artifact persistence fails -> do not commit its ref into Blackboard;
- interruption after review dispatch -> compose BB-016/017 review recovery/fencing when available;
- stale/forged/unauthorized trust bundle -> reject canonical assessment mutation;
- trusted `REJECTED` / `INCONCLUSIVE` -> reopen the same current work with grounded blockers;
- trusted `ACCEPTED` with findings -> `PENDING_RECONCILIATION` until findings are classified;
- trusted `ACCEPTED` with every obligation satisfied and no remaining current work -> `DONE`;
- missing PM-authorized project-acceptance obligation/configuration -> fail closed rather than auto-accepting or silently leaving an undispatchable state.

Current source has no canonical `PENDING_REVIEW` checkpoint field for preparation diagnostics. Continuation-critical refs are already durable; BB-019 may retry preparation from them. A new canonical diagnostic field requires separate concrete pressure.

## Rejected alternatives

### Treat QA ACCEPT as project DONE

Rejected. QA owns a concrete verification role and its evidence policy; it is not project completion authority.

### Add a Worker review request from QA merely to make the item dispatchable

Rejected. Mandatory final project acceptance belongs to project coordination. Conflating the two erases the D003 authority split.

### Treat configured policy as PM authority

Rejected. Configuration can carry an authorized decision; it does not create authority by itself.

### Empty review requirements mean no review required

Rejected. Absence is ambiguous and currently creates an undispatchable `PENDING_REVIEW` state.

### Assume decision/evidence refs are self-dereferencing

Rejected. Ref identity is not durable payload availability.

### Add only a reader

Rejected. A fresh-session reader cannot resolve an artifact that role completion never stored durably. Write-before-ref persistence is required.

### Copy full trust artifacts into Blackboard

Rejected. Blackboard remains lifecycle/ref state; trust-artifact payload storage is a separate source boundary.

### Introduce a generic Reviewer or universal Oracle provider framework now

Rejected. One concrete Backend/QA project review does not establish repeated semantics for those abstractions.

### Let reviewer prose authorize completion

Rejected. Narrative is not grounded evidence, an integrity-checked decision or an attestation.

## Consequences

- BB-019 can implement one bounded Backend/QA project-acceptance composition using existing Orchestrator/Core trust machinery plus an explicit durable trust-artifact store;
- role-local trust evidence can survive session boundaries before Blackboard references it;
- the workflow gains a legal path from QA completion to independently grounded project `DONE`;
- PM authority assumptions become explicit instead of being hidden inside configuration;
- final submission remains ref-only and review inputs are resolved through declared sources;
- rejection/remediation remains on the same Blackboard item;
- findings retain current-work versus follow-up reconciliation;
- PM/SA concrete runtime roles remain deferred to their own evidence pressure;
- interrupted-review recovery remains owned by BB-016/017 and is composed rather than duplicated.

## Evidence

- `docs/living/knowledge/bb018-review-to-completion.md`;
- `docs/living/decisions/D003-orchestrator-blackboard-review-authority.md`;
- `packages/agentic-system/src/durable-backend-qa.js` final QA submission behavior;
- `packages/agentic-system/src/blackboard-orchestrator.js` requirement, dispatch, trust and reconciliation semantics;
- current application `artifactReader` boundary;
- `packages/agentic-system/test/wave-d.test.js` executable trusted-review contracts;
- Backend/QA completion contracts and trust refs;
- `packages/core-harness/src/trust.js` and `trust-boundary.js` authority/evidence/decision/attestation semantics;
- `docs/worktree/agentic-application/contracts.md` current source-backed authority split.

## Promotion targets

Only after BB-019 implements and verifies this concrete composition should applicable current-system facts be promoted into:

- `docs/worktree/agentic-application/contracts.md`;
- `docs/worktree/agentic-application/state.md`;
- the durable Backend -> QA workflow projection.

The accepted design constraint may remain in living decisions before implementation; it must not make unimplemented behavior appear current in `docs/worktree/*`.

## What would reopen this decision

Reopen if a second concrete project-review slice demonstrates materially different context/authority semantics, a real project requires explicitly authorized no-review mode, production trust infrastructure requires stronger identity guarantees than current application assumptions, or a different durable trust-artifact storage boundary proves necessary.
