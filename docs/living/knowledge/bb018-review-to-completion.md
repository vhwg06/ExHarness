# BB-018 — Concrete Backend/QA review-to-completion research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

How should the delivered durable Backend -> QA workflow move from role-local acceptance to independently grounded project acceptance without inventing a generic Reviewer framework, laundering PM authority through configuration, or assuming trust artifacts remain available across sessions when current source persists only their refs?

## Current source-backed boundaries

### Role completion is not project completion

Backend completion grounds implementation claims such as:

```text
backend.mutation
backend.typecheck
backend.tests
```

QA completion separately grounds verification claims such as:

```text
qa.behavior
qa.regression
```

Both produce `DecisionArtifact`s at `TrustBoundary.ACCEPTANCE`, but those decisions belong to their concrete role-completion policies.

```text
role-local ACCEPT != project acceptance
Worker submission != DONE authority
```

### Durable final submission is ref-only

When QA accepts, `createDurableBackendQaWorkflow(...)` submits:

```text
kind = BACKEND_QA_WORKFLOW
stage = QA_COMPLETED
acceptedRevision
backendAcceptanceDecision { id, digest }
qaAcceptanceDecision { id, digest }
artifactRefs[]
evidenceRefs[]
```

The Blackboard therefore retains review lineage refs without carrying application/trust artifact payloads.

### Existing Orchestrator review lifecycle

`ApplicationOrchestrator` already separates:

```text
Worker REQUEST
PM REQUIRE
Orchestrator DISPATCH
Reviewer/evaluator ASSESS
Core trust validation
Orchestrator RECONCILE
```

`recordAssessment(...)` consumes a Core bundle:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

Current source requires the scheduled reviewer to differ from the submission producer, verifies evaluator/evidence/issuer authority, requires reviewer/verifier/attestor roles, validates signatures, and enforces issuer/evidence-producer independence relative to the subject producer.

That is not the same as automatic pairwise independence among reviewer, verifier and attestor. A project policy may require distinct identities, but BB-018 must not claim the Core primitive enforces that by default.

BB-016/017 separately owns review-attempt generation fencing and interruption recovery. BB-019 composes that behavior when available.

## Gap 1 — no declared final project review obligation

`submit(...)` moves work to `PENDING_REVIEW` even when `reviewRequests` is empty.

`beginReview(...)` requires a persisted matching requirement.

The current durable Backend -> QA workflow can therefore end as:

```text
PENDING_REVIEW
reviewRequirements = []
```

This must not become auto-acceptance. The concrete composition is missing a mandatory project acceptance obligation.

## Gap 2 — PM authority cannot be invented by configuration

D003 says:

```text
PM/project coordination may REQUIRE review because of project obligations
```

A project configuration object may transport a PM-authored requirement, but:

```text
configuration exists
!= PM authority proven
```

The current `requireReview(... source: PM ...)` API also does not cryptographically authenticate PM identity. BB-019 must expose that as an application authority assumption instead of pretending the config object itself is the authority.

A Worker must not fabricate the final project review as a Worker request merely to make the item dispatchable.

## Gap 3 — trust-artifact refs are not durable payload storage

Backend/QA completion creates Decision/Evidence artifacts in process memory. The durable workflow then persists ids/digests into Blackboard state.

Current Agentic Application source has an `artifactReader` for application artifacts but no durable trust-artifact payload store that guarantees a fresh session can resolve:

```text
DecisionArtifact by { id, digest }
EvidenceArtifact by { id, digest }
```

Therefore:

```text
Blackboard has ref
!= payload was durably stored
!= fresh session can dereference it
```

A reader alone is insufficient if the artifact was never written durably.

## Required trust-artifact storage invariant

BB-019 needs one bounded application-provided durable `trustArtifactStore` or source-backed equivalent.

Minimum semantics:

```text
putDecision(DecisionArtifact) -> { id, digest }
putEvidence(EvidenceArtifact) -> { id, digest }
readDecision({ id, digest }) -> DecisionArtifact
readEvidence({ id, digest }) -> EvidenceArtifact
```

The store must validate artifact identity/digest on write and read.

The durability order is:

```text
persist immutable/content-addressed trust artifact
-> confirm durable { id, digest }
-> only then persist that ref into Blackboard checkpoint/submission
```

A crash after artifact write but before the Blackboard ref may leave an orphaned immutable payload. That is acceptable cleanup pressure.

The reverse order is not acceptable:

```text
Blackboard ref committed
-> payload never became durable
```

because a later session would hold an authoritative lifecycle ref to unavailable trust evidence.

The store owns payload durability/lookup only. Blackboard remains lifecycle authority; the store must not become a second work-status source of truth.

This concrete store does not justify a universal Oracle provider framework or copying trust payloads into Blackboard.

## Project acceptance obligations after QA

The first project-level review must establish only obligations not already owned by Backend/QA role completion:

1. **submission lineage** — one exact accepted revision and intact Backend/QA decision refs;
2. **durable trust-artifact availability** — required prior decisions/evidence resolve from the declared store and match ids/digests;
3. **declared application-artifact availability** — required application refs resolve through the existing application artifact boundary;
4. **fresh project evidence** — project-acceptance claims are produced by authorized verifier(s) and bound to the exact active review subject;
5. **policy satisfaction** — configured acceptance claims/trust constraints pass;
6. **no unresolved current obligation** — accepted review has no blocking unresolved claim and no current-work finding remains unreconciled.

Prior Backend/QA decisions are lineage/evidence inputs only where the project acceptance policy requires them. The project reviewer does not repeat the entire Backend/QA lifecycle by default.

## Concrete review requirement

Use one PM/project obligation, for example:

```text
key: BACKEND_QA_PROJECT_ACCEPTANCE
source: PM
reason: Final Backend/QA submission requires independent project acceptance.
```

BB-019 may receive a PM-authorized requirement through project/application setup and persist it via the existing PM requirement path. That transport is not proof of PM identity; the assumption must remain explicit until a concrete PM authority implementation exists.

## Bounded review preparation

A concrete preparation function receives only:

```text
ReviewTarget
  - exact active review subject
  - requirement key/reason
  - submission producer

BackendQaFinalSubmission
  - acceptedRevision
  - Backend/QA decision refs
  - declared application/trust refs

ProjectAcceptancePolicy
  - required claims
  - accepted trust policy
  - evaluator/verifier/issuer authority rules
  - accepted environments/freshness where configured

Declared sources
  - applicationArtifactReader
  - trustArtifactStore
```

Preparation resolves only exact declared refs and validates identity/digests. If project policy requires evidence from a prior decision's evidence manifest, only those exact evidence refs are read.

No implicit repository browsing or source-scope expansion is authorized by review.

## Review output

The concrete review produces:

```text
EvidenceArtifact[]
  subject = exact active review target
  authorized verifier producer/environment

DecisionArtifact
  subject = exact active review target
  boundary = ACCEPTANCE
  evaluator = scheduled reviewer
  verdict = ACCEPTED | REJECTED | INCONCLUSIVE
  claims = project acceptance claims
  unresolved = grounded blockers for non-accepted verdicts
  metadata.findings = independently scoped findings when present

Attestation
  authorized attestor issuer
  signed trust payload
```

`ApplicationOrchestrator` remains the only component that mutates canonical Blackboard review/completion state.

## Authority split

```text
submission producer
  -> final Backend/QA submission
  -> cannot review own submission

PM/project coordination
  -> declares project review obligation
  -> config may carry the decision but does not create authority

reviewer/evaluator
  -> evaluates exact review target

verifier/evidence producer
  -> produces grounded review evidence

attestor/issuer
  -> signs decision bundle

trustArtifactStore
  -> durable immutable trust-artifact payload storage/lookup only

ApplicationOrchestrator
  -> lifecycle/trust application/reconciliation authority
```

Pairwise reviewer/verifier/attestor identity separation is policy-specific; current Core guarantees must not be overstated.

## Failure and transition semantics

### Deferred review

Requirement exists but reviewer not dispatched:

```text
PENDING_REVIEW
```

This is valid durable state and survives restart.

### Missing input before dispatch

Preparation should resolve mandatory inputs before `beginReview(...)` when possible.

If a required artifact is unavailable or has a digest mismatch:

```text
do not dispatch
do not fabricate verdict
leave item PENDING_REVIEW
return explicit preparation diagnostic
```

Continuation-critical refs already remain durable on Blackboard. Current source has no canonical `PENDING_REVIEW` checkpoint/blocker mutation; BB-019 must not pretend otherwise. A durable diagnostic field requires separate concrete pressure.

### Failure after dispatch

Once a review attempt is active, interruption/abandonment belongs to BB-016/017 recovery/fencing when available.

Infrastructure/source unavailability is not a trusted `REJECTED` product decision.

### Invalid trust bundle

Stale/wrong subject, forged signature, unauthorized evaluator/evidence/issuer, wrong policy/boundary or violated configured independence constraints reject canonical assessment mutation.

### Trusted non-acceptance

`REJECTED` / `INCONCLUSIVE` require grounded unresolved blocking reasons and reopen the same current work after reconciliation as applicable.

```text
current acceptance failed
!= create replacement work automatically
```

### Trusted acceptance

`DONE` is derived only when:

```text
all review requirements ACCEPTED
AND no pending findings
AND no remaining current work
```

Findings continue through:

```text
CURRENT_WORK
EXISTING_WORK
NEW_WORK
NON_ACTIONABLE
```

## No declared review obligation

For BB-019, the PM-authorized project acceptance requirement is mandatory.

If the workflow reaches final submission without it, fail closed rather than auto-accepting or silently leaving an undispatchable state.

A future no-review mode requires an explicit project-policy authority outcome. Empty review requirements are not that outcome.

## Proposed concrete pipeline

```text
PM/project setup
  -> authorize BACKEND_QA_PROJECT_ACCEPTANCE

Backend role-local completion
  -> persist required Decision/Evidence artifacts to trustArtifactStore
  -> then checkpoint their refs

QA role-local completion
  -> persist required Decision/Evidence artifacts to trustArtifactStore
  -> then submit final BackendQa refs
  -> ensure PM-authorized review requirement is persisted

PENDING_REVIEW preparation
  -> read exact trust refs from trustArtifactStore
  -> read exact application refs from applicationArtifactReader
  -> validate ids/digests
  -> preparation failure stays PENDING_REVIEW

Orchestrator.beginReview(...)
  -> exact active subject/attempt

project verifier(s)
  -> fresh EvidenceArtifact[]
  -> persist review evidence as required by the concrete store policy

review evaluator
  -> DecisionArtifact @ ACCEPTANCE

attestor
  -> signed Attestation

Orchestrator.recordAssessment(...)
  -> invalid trust: no canonical mutation
  -> REJECTED/INCONCLUSIVE: reopen same current work
  -> ACCEPTED + findings: PENDING_RECONCILIATION
  -> ACCEPTED + all obligations satisfied: DONE
```

## BB-019 implementation handoff

Implement one concrete Backend/QA project-review composition, not a framework.

Minimum delivery surface:

1. PM-authorized project acceptance requirement input; configuration is transport, not self-authorizing PM authority;
2. bounded durable `trustArtifactStore` (or equivalent) with write-before-ref and read/identity-validation semantics for required Decision/Evidence artifacts;
3. integration of role-local trust artifact persistence before durable Blackboard refs are committed;
4. reuse existing application `artifactReader` for declared Backend/QA application artifacts;
5. bounded review preparation resolving only exact declared refs before dispatch;
6. one concrete verifier/reviewer/attestor composition producing the existing Core trust bundle;
7. orchestration through `requireReview -> beginReview -> recordAssessment -> reconcileFinding`, composing review-generation recovery when available;
8. explicit fail-closed behavior for missing authority/config, unavailable refs, digest mismatch and invalid trust;
9. end-to-end acceptance plus rejection/remediation/resubmission/restart tests.

Do not add:

```text
generic Reviewer<C,R>
reviewer registry
generic review workflow DSL
new trust artifact types
universal Oracle provider abstraction
full trust-artifact payloads inside Blackboard
second lifecycle authority in the trust artifact store
```

## Required BB-019 scenarios

1. QA ACCEPT receives a PM-authorized project acceptance requirement and is dispatchable;
2. missing PM authority/config fails closed;
3. role-local trust artifacts are durably written before their refs become canonical Blackboard refs;
4. crash after trust-artifact write but before Board ref does not create a dangling canonical ref;
5. deferred review survives restart in `PENDING_REVIEW`;
6. fresh session resolves Backend/QA decision refs from the durable trust store and validates digests;
7. missing/mismatched trust artifact leaves review undispatched and cannot fabricate acceptance;
8. exact application refs resolve only through declared application source;
9. fresh project evidence binds to exact active review target;
10. trusted ACCEPTED derives `DONE` only with no remaining obligations;
11. forged/stale/unauthorized bundle cannot mutate canonical state;
12. trusted REJECTED/INCONCLUSIVE reopens the same work;
13. remediation resubmission creates a new exact review target and stale prior assessment cannot authorize it;
14. trusted findings preserve CURRENT_WORK versus independent follow-up semantics.

## Judgment

The missing capability is not a generic Reviewer abstraction. It is the concrete chain:

```text
role-local Backend/QA acceptance
+ durable write-before-ref trust artifacts
+ PM-authorized project review obligation
+ bounded declared review context
+ fresh grounded project evidence
+ trusted evaluator/attestor bundle
+ Orchestrator-owned reconciliation
= project acceptance path
```

Current Core trust and Blackboard lifecycle primitives already provide most authority machinery. BB-019 must close the application-specific durable trust-artifact and project-review composition gaps without generalizing beyond the evidence.
