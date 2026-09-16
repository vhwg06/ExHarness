# D010 — Backend/QA project completion requires an explicit trusted acceptance obligation

Status: **PROPOSED**

Proposed: 2026-09-16

Acceptance boundary: BB-018 application-architecture review plus acceptance/trust review. This proposal must not be promoted into `docs/worktree/*` or used to mark BB-018 complete before those reviews accept it.

## Context

The durable Backend -> QA workflow already produces grounded Backend and QA role-local acceptance decisions and submits one final immutable Blackboard payload containing the accepted revision, decision refs, artifact refs and evidence refs.

The Blackboard Orchestrator already supports separate Worker review requests, PM review requirements, exact review subjects, trusted evidence/decision/attestation bundles and finding reconciliation.

Two concrete gaps remain:

1. the Backend -> QA final submission currently supplies no review requirement, so it can persist as `PENDING_REVIEW` with no legal `beginReview(...)` target;
2. Blackboard stores trust-artifact refs, but current Agentic Application source has no durable reader for `DecisionArtifact` / `EvidenceArtifact` payloads comparable to its application `artifactReader`.

## Choice

For the first concrete Backend -> QA project-completion path:

1. project acceptance review is an **explicit mandatory project obligation**;
2. D003 remains authoritative: that requirement originates from PM/project-coordination authority, not from a Worker and not from configuration merely existing;
3. configuration may transport a PM-authorized requirement and project trust policy, but configuration is not itself authority and BB-019 must make that assumption explicit;
4. the final Blackboard submission remains ref-only; BB-019 supplies a bounded durable trust-artifact reader capable of resolving required Decision/Evidence artifacts by id/digest instead of copying full trust bundles into Blackboard;
5. a bounded project reviewer receives only the exact frozen review target, final Backend/QA submission lineage, declared application/trust artifact inputs and explicit project acceptance policy;
6. project-review evidence, reviewer evaluation and attestation reuse existing Core `EvidenceArtifact`, `DecisionArtifact`, `Attestation` and `TrustBoundary.ACCEPTANCE` primitives;
7. `ApplicationOrchestrator` remains lifecycle/completion authority and derives `DONE` only after every declared review obligation is trusted-ACCEPTED, findings are reconciled and no current remaining work exists;
8. missing PM authority/configuration, unavailable/mismatched durable refs or invalid trust fail closed and never become implicit acceptance;
9. a future no-review mode, if ever required, needs an explicit project-policy authority outcome. Empty review requirements are not such an outcome.

Conceptually:

```text
PM/project coordination
  -> REQUIRE BACKEND_QA_PROJECT_ACCEPTANCE

Backend ACCEPT
  -> QA ACCEPT
  -> final ref-only BackendQa submission

review preparation
  -> resolve declared trust artifacts from durable refs
  -> resolve declared application artifacts
  -> validate ids/digests

Orchestrator
  -> exact review target / attempt

independent project verification
  -> EvidenceArtifact[]

review evaluator
  -> DecisionArtifact @ ACCEPTANCE

attestor
  -> signed Attestation

Orchestrator trust validation/reconciliation
  -> DONE | REOPENED | PENDING_RECONCILIATION
```

## Trust authorities

The first implementation preserves these separate authority concepts:

```text
submission producer
PM/project-obligation authority
review evaluator
verification evidence producer
attestation issuer
ApplicationOrchestrator lifecycle authority
```

Current source guarantees the scheduled reviewer differs from the submission producer and verifies evaluator, evidence-producer and issuer authority through the trust boundary. Existing independent issuer/evidence-producer constraints are relative to the review-subject producer.

This decision does **not** claim that reviewer, verifier and attestor are automatically pairwise distinct. A concrete project policy may require distinct identities; otherwise multiple roles may map to one service only when all configured authority/independence checks still pass.

Role labels or reviewer prose alone do not establish authority.

The accepted trust bundle remains:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

No new review-specific trust artifact type is introduced.

## Durable review-input boundary

Blackboard is coordination/ref state, not the trust-artifact payload store.

BB-019 must introduce one concrete review-side adapter or equivalent source-backed capability with minimum semantics such as:

```text
readDecision({ id, digest }) -> DecisionArtifact
readEvidence({ id, digest }) -> EvidenceArtifact
```

The adapter must validate returned identity/digest before use. If project policy requires evidence referenced by a prior decision's evidence manifest, only those exact refs are resolved.

Existing application `artifactReader` remains responsible for Backend/QA application artifacts. The two source classes must not be collapsed merely to make review implementation convenient.

This is a concrete composition boundary, not evidence for a universal Oracle provider abstraction or a new global source-of-truth store.

## PM authority boundary

D003 says PM/project coordination may require review because of project obligations.

Therefore:

```text
PM-authorized requirement
-> may be transported in application/project configuration
-> may be persisted through existing requireReview(... source: PM ...)
```

but:

```text
configuration object exists
!= PM authority proven
```

Current `requireReview(...)` does not cryptographically authenticate PM identity. BB-019 must expose this as an explicit application authority assumption and must not claim stronger identity assurance than source provides.

A concrete PM Worker/runtime role remains outside this decision.

## Failure semantics

- review requirement exists but no reviewer dispatched -> durable `PENDING_REVIEW`;
- required trust/application artifact unavailable before dispatch -> keep item `PENDING_REVIEW`, return explicit preparation diagnostic, do not fabricate a verdict;
- trust artifact resolves with wrong id/digest -> fail closed before dispatch;
- interruption after review dispatch -> use BB-016/017 review recovery/fencing when available rather than inventing another recovery mechanism;
- stale/forged/unauthorized trust bundle -> reject canonical assessment mutation;
- trusted `REJECTED` / `INCONCLUSIVE` -> reopen the same current work with grounded blockers;
- trusted `ACCEPTED` with findings -> `PENDING_RECONCILIATION` until findings are classified;
- trusted `ACCEPTED` with every obligation satisfied and no remaining current work -> `DONE`;
- missing PM-authorized project-acceptance obligation/configuration -> fail closed rather than auto-accepting or silently leaving an undispatchable state.

Current source has no canonical `PENDING_REVIEW` checkpoint field for preparation diagnostics. This decision does not pretend otherwise. Continuation-critical refs are already durable; BB-019 may retry preparation from them. A new canonical diagnostic field requires separate concrete pressure.

## Rejected alternatives

### Treat QA ACCEPT as project DONE

Rejected. QA owns a concrete verification role and its evidence policy; it is not the enclosing project completion authority.

### Add a Worker review request from QA merely to make the item dispatchable

Rejected. A Worker may request specialist verification, but the mandatory final project acceptance obligation belongs to project coordination. Conflating the two erases the D003 authority split.

### Treat configured policy as PM authority

Rejected. Configuration can carry an authorized decision; it does not create that authority by itself.

### Empty review requirements mean no review required

Rejected. Absence is ambiguous and currently creates an undispatchable `PENDING_REVIEW` state. Acceptance must be explicit.

### Assume decision/evidence refs are self-dereferencing

Rejected. Current source provides no durable project-review trust-artifact reader. Ref identity is not payload availability.

### Copy full trust artifacts into Blackboard

Rejected. Blackboard remains lifecycle/ref state; payload storage/resolution is a separate source boundary.

### Introduce a generic Reviewer or universal Oracle provider framework now

Rejected. One concrete Backend/QA project review does not establish repeated semantics for those abstractions.

### Let reviewer prose authorize completion

Rejected. Reviewer narrative is not grounded evidence, an integrity-checked decision or an attestation.

## Consequences

- BB-019 can implement one bounded Backend/QA acceptance-review composition using existing Orchestrator/Core trust machinery plus one explicit durable trust-artifact reader boundary;
- the workflow gains a legal path from QA completion to independently grounded project `DONE`;
- PM authority assumptions become explicit instead of being hidden inside configuration;
- final submission remains ref-only and fresh sessions can resolve review inputs through declared sources;
- rejection/remediation remains on the same Blackboard item;
- independent findings retain current-work versus follow-up reconciliation;
- PM/SA concrete runtime roles remain deferred to their own evidence pressure;
- interrupted-review recovery remains owned by BB-016/017 and is composed rather than duplicated.

## Evidence

- `docs/living/knowledge/bb018-review-to-completion.md`;
- `docs/living/decisions/D003-orchestrator-blackboard-review-authority.md`;
- `packages/agentic-system/src/durable-backend-qa.js` final QA submission behavior;
- `packages/agentic-system/src/blackboard-orchestrator.js` requirement, dispatch, trust and reconciliation semantics;
- `packages/agentic-system/src/oracle.js` / application `artifactReader` source boundary;
- `packages/agentic-system/test/wave-d.test.js` executable trusted-review contracts;
- Backend/QA completion contracts and decision refs;
- `packages/core-harness/src/trust.js` and `trust-boundary.js` authority/evidence/decision/attestation semantics;
- `docs/worktree/agentic-application/contracts.md` current source-backed authority split.

## Promotion targets

Only after BB-019 implements and verifies this concrete composition should applicable current-system facts be promoted into:

- `docs/worktree/agentic-application/contracts.md`;
- `docs/worktree/agentic-application/state.md`;
- the durable Backend -> QA workflow projection.

The accepted design constraint itself may remain in living decisions before implementation; it must not make unimplemented behavior appear current in `docs/worktree/*`.

## What would reopen this decision

Reopen if a second concrete project-review slice demonstrates materially different context/authority semantics, if a real project requires an explicitly authorized no-review mode, if production trust infrastructure requires stronger identity guarantees than current application assumptions, or if a different durable trust-artifact source boundary proves necessary.
