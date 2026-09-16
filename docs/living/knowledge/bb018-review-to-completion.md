# BB-018 — Concrete Backend/QA review-to-completion research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

How should the delivered durable Backend -> QA workflow move from role-local acceptance to independently grounded project acceptance without inventing a generic Reviewer framework, laundering PM authority through configuration, or assuming durable evidence/decision artifacts can be dereferenced when current source does not provide that reader yet?

## Current source-backed boundaries

### Backend and QA completion are role-local

Backend completion establishes grounded implementation claims such as:

```text
backend.mutation
backend.typecheck
backend.tests
```

QA completion separately establishes grounded verification claims such as:

```text
qa.behavior
qa.regression
```

Both produce `DecisionArtifact`s at `TrustBoundary.ACCEPTANCE`, but those decisions belong to their concrete role-completion policies. They do not authorize the enclosing Blackboard item to become project `DONE`.

```text
role-local ACCEPT != project acceptance
Worker submission != DONE authority
```

### Durable Backend -> QA final submission

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

The workflow then reports `AWAITING_REVIEW`.

This is a suitable project-review target because the Blackboard fixes the accepted revision and ref lineage without copying application-artifact payloads into coordination state.

### The Orchestrator already owns trusted review lifecycle

`ApplicationOrchestrator` already separates:

```text
Worker REQUEST
PM REQUIRE
Orchestrator DISPATCH (`beginReview`)
Reviewer/evaluator ASSESS
Trust boundary validates evidence/decision/attestation
Orchestrator RECONCILE findings
```

`beginReview(...)` freezes an exact review subject over the item, requirement key and submission. The interrupted-review lane BB-016/017 additionally introduces review-generation fencing; BB-019 must compose that behavior when it is available rather than create another recovery mechanism.

`recordAssessment(...)` accepts a Core trust bundle rather than a naked verdict:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

Current source requires the scheduled reviewer to differ from the submission producer, verifies reviewer/evaluator authority, verifies evidence-producer authority, requires verifier/reviewer/attestor roles, requires signature validation and enforces independent issuer/evidence-producer authority relative to the submission producer.

Important precision:

```text
current independence guarantee
!= automatic pairwise separation of reviewer, verifier and attestor
```

A concrete project policy may require distinct identities, but that is policy-specific. BB-018 must not claim the Core primitive enforces a stronger separation than source implements.

## Gap 1 — final submission can be stranded with no review requirement

`submit(...)` transitions to `PENDING_REVIEW` even when `reviewRequests` is empty.

`beginReview(...)` requires a matching persisted review requirement.

The durable Backend -> QA workflow currently calls `submit(...)` without a Worker review request. Therefore the final QA submission can legally persist as:

```text
PENDING_REVIEW
reviewRequirements = []
```

No `beginReview(...)` call is legal until a PM-sourced requirement exists.

This does **not** mean QA should auto-authorize project completion. It means the concrete composition is missing an explicit project acceptance obligation.

## Gap 2 — Blackboard refs are not yet a durable trust-artifact resolver

The final submission persists Backend/QA decision ids/digests and other refs. The current application has an `artifactReader` for application artifacts, but no source-backed durable reader for project-review trust artifacts such as:

```text
DecisionArtifact by { id, digest }
EvidenceArtifact by { id, digest }
```

A `DecisionArtifact` itself contains an evidence manifest of refs, not the durable evidence payload store.

Therefore a fresh review session cannot infer:

```text
I have an id/digest
=> I can dereference the original decision/evidence artifact
```

without an explicit adapter/store provided by the application.

This is a concrete BB-019 implementation boundary. Blackboard remains ref-only coordination state; BB-019 must not solve this by copying full trust bundles into Blackboard.

## Acceptance obligations after QA completion

The first project-level review should answer only the obligations not already owned by Backend/QA role completion.

For the concrete Backend -> QA workflow, project acceptance must establish:

1. **submission lineage** — one exact accepted revision plus intact Backend/QA decision refs;
2. **trust-artifact resolvability** — required prior decision/evidence refs can be resolved from declared durable sources and their digests validated;
3. **declared application-artifact availability** — application refs required for project acceptance can be resolved through their declared adapter;
4. **independent project evidence** — acceptance claims are produced by an authorized verifier and are bound to the exact active review subject;
5. **acceptance-policy satisfaction** — all claims required by the concrete project acceptance policy are satisfied under configured trust rules;
6. **no unresolved current-work blocker** — a trusted ACCEPTED decision contains no unresolved blockers and no unreconciled current-work finding remains.

The reviewer does not repeat Backend or QA merely because their artifacts exist. Prior role decisions are lineage/evidence inputs only where the project policy explicitly requires them.

## Concrete review contract

### Project review requirement

Use one concrete project obligation, for example:

```text
key: BACKEND_QA_PROJECT_ACCEPTANCE
source: PM
reason: Final Backend/QA submission requires independent project acceptance.
```

D003 is authoritative here:

```text
PM/project coordination may REQUIRE review because of project obligations
```

A Worker must not fabricate this as a Worker request merely to escape `PENDING_REVIEW`.

A project-acceptance configuration object is also **not** authority by itself. BB-019 may receive configuration as data, but the requirement must enter through an explicitly PM/project-coordination-authorized application boundary.

Because a concrete PM Worker is not implemented, BB-019 should make the authority assumption visible instead of pretending to verify more than current source can verify. For example, the concrete composition may receive a PM-authorized requirement from its caller/project setup and then persist it through the existing `requireReview(... source: PM ...)` path. That transport does not prove PM identity cryptographically.

### Bounded review preparation

A concrete review-preparation function receives:

```text
ReviewTarget
  - exact frozen Blackboard review subject
  - review requirement key/reason
  - submission producer identity

BackendQaFinalSubmission
  - acceptedRevision
  - backendAcceptanceDecision ref + digest
  - qaAcceptanceDecision ref + digest
  - artifactRefs[]
  - evidenceRefs[]

ProjectAcceptancePolicy
  - required project acceptance claims
  - accepted trust-policy digest/config
  - verifier/reviewer/attestor authority rules
  - accepted verification environments
  - freshness limits where configured

Declared readers
  - applicationArtifactReader
  - trustArtifactReader
```

The first concrete `trustArtifactReader` need not become a generic Oracle provider. Its minimum useful shape is bounded to project review, for example:

```text
readDecision({ id, digest }) -> DecisionArtifact
readEvidence({ id, digest }) -> EvidenceArtifact
```

It must validate returned artifact identity/digest before the artifacts can become review evidence or lineage input.

If a decision's evidence manifest is required by project policy, the reader resolves those exact evidence refs. It must not silently broaden source scope.

### Reviewer output

The executable review produces:

```text
EvidenceArtifact[]
  subject = exact active review target
  producer has authorized verifier role
  environment is accepted by policy

DecisionArtifact
  subject = exact active review target
  boundary = ACCEPTANCE
  evaluator = scheduled reviewer
  evaluator has authorized reviewer role
  verdict = ACCEPTED | REJECTED | INCONCLUSIVE
  claims = project-acceptance claims
  unresolved = blocking obligations for non-accepted verdicts
  metadata.findings = independently scoped observations when present

Attestation
  issuer has authorized attestor role
  signed over the decision/trust payload
```

The Orchestrator remains the only component that applies the trusted assessment to canonical Blackboard lifecycle state.

## Authority split

```text
submission producer
  -> produces final Backend/QA submission
  -> cannot review its own submission

PM/project coordination authority
  -> declares project review obligation
  -> configuration transports that decision but is not authority itself

reviewer/evaluator
  -> evaluates exact frozen review target
  -> cannot replace evidence with prose

verifier/evidence producer
  -> produces grounded review evidence
  -> must satisfy configured evidence authority and independence policy

attestor/issuer
  -> signs the decision bundle
  -> must satisfy configured issuer authority and independence policy

ApplicationOrchestrator
  -> validates trust
  -> commits review/finding transitions
  -> derives DONE only after all current obligations are satisfied
```

Roles may map to the same deployment process only if the declared project trust policy allows it and every enforced authority/independence rule still passes. BB-018 does not assume pairwise reviewer/verifier/attestor independence unless configured.

## Failure and transition semantics

### Deferred review

If the requirement exists but no reviewer is dispatched yet:

```text
PENDING_REVIEW
```

is valid durable state and survives restart.

### Missing review input before dispatch

Resolve mandatory review inputs before `beginReview(...)` when possible.

If a required application/trust artifact is unavailable or fails digest validation:

```text
do not dispatch review
do not fabricate verdict
leave canonical item PENDING_REVIEW
return an explicit preparation diagnostic
```

All continuation-critical refs remain on Blackboard, so a fresh session can retry preparation without hidden session state.

Current source does not expose a `PENDING_REVIEW` checkpoint/blocker mutation. BB-019 must not invent a claim that such a durable diagnostic already exists. If implementation pressure proves the diagnostic itself must survive as canonical state, that is a separate concrete lifecycle extension and must be justified explicitly.

### Failure after review dispatch

Once `beginReview(...)` has created an active attempt, interruption/abandonment belongs to the BB-016/017 recovery contract. When generation-fenced recovery is available, reschedule through that path so stale assessment evidence cannot commit.

Do not convert infrastructure/source unavailability into a trusted REJECTED product decision.

### Invalid, stale or unauthorized trust bundle

`recordAssessment(...)` rejects canonical mutation for cases such as:

- wrong/stale review subject or generation;
- forged signature;
- unauthorized evaluator/reviewer;
- unauthorized evidence producer/environment;
- wrong policy/boundary;
- violated configured independence constraint.

### Trusted REJECTED / INCONCLUSIVE

A non-accepted decision requires at least one grounded unresolved blocking reason. Those blockers remain obligations of the same Blackboard item.

```text
review failure of current obligation
!= automatic NEW_WORK
```

### Trusted ACCEPTED

`DONE` is derived only when:

```text
all declared review requirements are ACCEPTED
AND no pending findings remain
AND no current remainingWork remains
```

Trusted findings enter existing reconciliation:

```text
CURRENT_WORK
EXISTING_WORK
NEW_WORK
NON_ACTIONABLE
```

## No declared review obligation

Absence of a review requirement must not mean project acceptance.

For BB-019, a PM-authorized project acceptance requirement is mandatory input. If final Backend/QA submission is reached without that obligation, the concrete composition must fail closed rather than:

```text
auto-DONE
or
silently leave an undispatchable PENDING_REVIEW state
```

If a future project genuinely permits no independent project review, that needs an explicit project-policy authority outcome. An empty array is not that outcome, and BB-018 does not require implementing that mode.

## Proposed concrete pipeline

```text
PM/project setup
  -> authorizes BACKEND_QA_PROJECT_ACCEPTANCE requirement

Backend role-local ACCEPT
  -> durable QA handoff

QA role-local ACCEPT
  -> final BackendQa submission
  -> persist PM-authorized review requirement

review preparation while PENDING_REVIEW
  -> resolve exact decision refs through trustArtifactReader
  -> resolve required prior evidence refs through trustArtifactReader
  -> resolve declared application refs through applicationArtifactReader
  -> validate identity/digests
  -> preparation failure: remain PENDING_REVIEW, no verdict

Orchestrator.beginReview(...)
  -> freezes exact active review subject/attempt

independent verifier(s)
  -> fresh EvidenceArtifact[] bound to review target

review evaluator
  -> DecisionArtifact @ ACCEPTANCE

attestor
  -> signed Attestation

Orchestrator.recordAssessment(...)
  -> trust invalid: no canonical assessment mutation
  -> REJECTED/INCONCLUSIVE: current work REOPENED after reconciliation as applicable
  -> ACCEPTED + findings: PENDING_RECONCILIATION
  -> ACCEPTED + all obligations satisfied: DONE
```

## BB-019 implementation handoff

Implement one concrete Backend/QA project-review composition, not a framework.

Minimum delivery surface:

1. a PM-authorized project-acceptance requirement input and policy contract; configuration must not be described as self-authorizing PM authority;
2. a bounded `trustArtifactReader` (or source-backed equivalent) that can resolve and integrity-check required Decision/Evidence artifacts from durable refs;
3. reuse the existing application `artifactReader` boundary for declared Backend/QA application artifacts rather than merging source classes;
4. a bounded review-preparation function that resolves only exact declared refs before dispatch;
5. one concrete verifier/reviewer/attestor composition producing `EvidenceArtifact[] + DecisionArtifact + Attestation`;
6. orchestration through existing `requireReview -> beginReview -> recordAssessment -> reconcileFinding` semantics, composed with review-generation recovery when available;
7. explicit fail-closed behavior for missing authority/config, unavailable refs, digest mismatch and invalid trust;
8. end-to-end acceptance plus rejection/remediation/resubmission tests.

Do not add:

```text
generic Reviewer<C,R>
reviewer registry
generic review workflow DSL
new trust artifact types
universal Oracle provider abstraction
full trust-artifact payloads inside Blackboard
```

unless later concrete pressure demonstrates repeated semantics.

## Required BB-019 scenarios

1. QA ACCEPT receives a PM-authorized project acceptance requirement and is dispatchable;
2. missing authority/config fails closed rather than auto-accepting or silently deadlocking;
3. deferred review survives restart in `PENDING_REVIEW`;
4. a fresh session resolves Backend/QA decision refs through the declared durable trust-artifact reader and validates their digests;
5. missing or mismatched decision/evidence artifact leaves review undispatched and cannot fabricate acceptance;
6. exact application refs are resolved only through the declared application reader;
7. fresh independent verification produces EvidenceArtifact(s) bound to the exact active review target;
8. trusted ACCEPTED with no remaining obligations derives `DONE`;
9. forged/stale/unauthorized evidence, evaluator or attestation cannot mutate canonical state;
10. trusted REJECTED/INCONCLUSIVE reopens the same work with grounded blockers;
11. remediation resubmission creates a new exact review target, and stale prior assessment cannot authorize it;
12. trusted findings preserve CURRENT_WORK versus independent follow-up reconciliation.

## Relationship to BB-016/017

BB-016/017 own interruption recovery and review-attempt fencing. BB-018 requires only this invariant:

```text
assessment authority is bound to the current exact review attempt/subject
```

BB-019 composes that implementation when available; it does not duplicate recovery state.

## Judgment

The missing capability is not a generic Reviewer abstraction. It is the concrete chain:

```text
role-local accepted Backend/QA result
+ PM-authorized project review obligation
+ durable trust-artifact dereference
+ bounded declared application context
+ fresh grounded review evidence
+ trusted evaluator/attestor bundle
+ Orchestrator-owned reconciliation
= project acceptance path
```

Current Core trust and Blackboard lifecycle primitives provide most of the authority machinery. The missing application work is the explicit project obligation, durable trust-artifact resolution and concrete review composition that connect those primitives end to end.
