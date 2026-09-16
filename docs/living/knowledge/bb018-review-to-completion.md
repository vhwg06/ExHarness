# BB-018 — Concrete Backend/QA review-to-completion research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

How should the delivered durable Backend -> QA workflow move from a role-locally accepted final QA submission to independently grounded project acceptance, without treating reviewer prose as evidence, inventing a generic Reviewer framework, or allowing the absence of a declared review obligation to mean acceptance by accident?

## Current source-backed boundaries

### Backend and QA completion are role-local

Backend completion establishes grounded implementation evidence such as:

```text
backend.mutation
backend.typecheck
backend.tests
```

QA completion separately establishes grounded verification evidence such as:

```text
qa.behavior
qa.regression
```

Both produce `DecisionArtifact`s at `TrustBoundary.ACCEPTANCE`, but these decisions belong to the concrete role-completion policies. They do not authorize the enclosing Blackboard item to become project `DONE`.

The existing Blackboard invariant remains correct:

```text
role-local ACCEPT != project acceptance
Worker submission != DONE authority
```

### Durable Backend -> QA final submission

When QA accepts, `createDurableBackendQaWorkflow(...)` submits a concrete payload containing:

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

This is a good project-review target because it fixes the revision and the role-local decision/ref lineage without copying artifact payloads into Blackboard state.

### The Orchestrator already owns trusted review state

`ApplicationOrchestrator` already separates:

```text
Worker REQUEST
PM REQUIRE
Orchestrator DISPATCH (`beginReview`)
Reviewer/Verifier ASSESS
Trust boundary ACCEPT/REJECT
Orchestrator RECONCILE findings
```

`beginReview(...)` freezes an exact subject over:

```text
item id
+ review requirement key
+ exact submitted payload
+ submission producer identity
```

`recordAssessment(...)` accepts a Core trust bundle rather than a naked verdict:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

It requires evidence bound to the exact active target, a scheduled reviewer independent from the submission producer, `TrustBoundary.ACCEPTANCE`, signature verification, evaluator authority, evidence authority, an attestor role, a reviewer role, a verifier role and independent evidence/issuer authority.

These primitives are sufficient for the first concrete project-acceptance review. BB-018 does not justify a generic reviewer registry, reviewer DSL, workflow engine or new trust subsystem.

## Observed liveness gap: empty review requirements

`submit(...)` always transitions a submission to `PENDING_REVIEW`, even when `reviewRequests` is empty.

`beginReview(...)` requires a matching persisted review requirement.

The durable Backend -> QA workflow currently calls `submit(...)` without a Worker review request. Therefore the concrete final QA submission can be left in:

```text
PENDING_REVIEW
reviewRequirements = []
```

No legal `beginReview(...)` call exists until a PM-sourced requirement is added.

This is not evidence that the workflow should auto-complete. It shows that project acceptance obligation declaration is currently missing from the concrete composition.

## Acceptance obligations after QA completion

The first project-level review should answer only the obligations that are not already owned by Backend or QA role completion.

For the concrete Backend -> QA workflow, the project acceptance review must establish:

1. **submission lineage** — the reviewed payload names one exact accepted revision and intact Backend/QA acceptance-decision refs;
2. **declared artifact/evidence availability** — refs required by the project acceptance policy can be dereferenced and verified for the exact submitted revision/subject;
3. **independent acceptance evidence** — the final project acceptance claims are produced by an authorized verifier, not copied from Worker/reviewer prose;
4. **acceptance-policy satisfaction** — all claims required by the concrete project acceptance policy are satisfied under the configured trust policy;
5. **no unresolved current-work blocker** — a trusted ACCEPTED decision carries no unresolved blocker; unresolved obligations reopen the same work rather than being hidden in a follow-up.

The reviewer is not asked to repeat all Backend implementation work or all QA behavior/regression work. It may consume those accepted decisions as lineage inputs, but the project review must independently establish the claims its own policy requires.

## Concrete review contract

### Review requirement

Use one concrete PM/project-obligation requirement for the first implementation, for example:

```text
key: BACKEND_QA_PROJECT_ACCEPTANCE
source: PM
reason: Final Backend/QA submission requires independent project acceptance.
```

The requirement is project policy/input. The Backend or QA Worker must not fabricate it as a Worker request merely to escape `PENDING_REVIEW`.

Because a concrete PM runtime role is not implemented yet, BB-019 should accept this obligation through a narrow application-level project-acceptance configuration/policy input and persist it through the existing `requireReview(... source: PM ...)` authority path. That is not evidence for a generic PM Worker or reviewer registry.

### Reviewer input/context

A bounded concrete reviewer receives only what is needed for this acceptance obligation:

```text
ReviewTarget
  - exact frozen Blackboard review subject
  - review requirement key/reason
  - submission producer identity

BackendQaFinalSubmission
  - acceptedRevision
  - backendAcceptanceDecision ref + digest
  - qaAcceptanceDecision ref + digest
  - declared artifactRefs
  - declared evidenceRefs

ProjectAcceptancePolicy
  - required acceptance claims
  - accepted policy digest
  - trusted verifier/reviewer/attestor identities or authority rules
  - accepted verification environments
  - freshness limits where configured
```

Artifact/evidence payloads are dereferenced by declared adapters before verification. The reviewer does not receive unrestricted repository access by default and does not expand source scope implicitly.

If an acceptance claim requires additional source material, that requirement must be declared explicitly rather than letting the reviewer browse arbitrary project context and later present prose as authority.

### Reviewer output

The executable review produces a Core trust bundle:

```text
EvidenceArtifact[]
  subject = exact active review target
  producer role includes verifier
  environment is accepted by policy

DecisionArtifact
  subject = exact active review target
  boundary = ACCEPTANCE
  evaluator = scheduled reviewer
  evaluator role includes reviewer
  verdict = ACCEPTED | REJECTED | INCONCLUSIVE
  claims = project-acceptance claims
  unresolved = blocking obligations for non-accepted verdicts
  metadata.findings = independently scoped observations, if any

Attestation
  issuer role includes attestor
  signed over the decision/trust payload
```

The existing Orchestrator remains the only component that applies the trusted verdict to Blackboard lifecycle state.

### Authority split

The minimum authority split is:

```text
submission producer
  -> produces final Backend/QA submission
  -> cannot review/accept its own submission

project obligation authority (PM/configured application policy)
  -> declares that project acceptance review is required
  -> does not perform the assessment by implication

reviewer / evaluator
  -> evaluates the exact frozen review target
  -> cannot substitute prose for evidence

verifier / evidence producer
  -> produces fresh grounded EvidenceArtifact(s)
  -> is independently authorized from the submission producer

attestor / issuer
  -> signs the accepted/rejected decision bundle
  -> is independently trusted

ApplicationOrchestrator
  -> validates trust
  -> commits review/finding lifecycle transitions
  -> derives DONE only after all obligations are satisfied
```

A deployment may map multiple roles to one service only when the configured trust policy still satisfies the required independence constraints. Role labels alone are not authority proof.

## Failure and transition semantics

### Deferred review

If the review obligation exists but no reviewer is dispatched yet:

```text
PENDING_REVIEW
```

is valid durable state and survives session restart.

### Missing/unavailable artifact or evidence during review preparation

Unavailable source material is not a `REJECTED` project decision and not evidence of failed product behavior.

Before a review is dispatched, keep/defer the item in `PENDING_REVIEW` with a durable diagnostic/checkpoint owned by the concrete review composition.

If the outage is discovered after dispatch, the review attempt must not fabricate a trusted assessment. The implementation should return to a recoverable pending/deferred review state or use the interrupted-review recovery semantics when available. Do not create an `ACCEPTED`, `REJECTED` or `INCONCLUSIVE` bundle without the required grounded evidence.

### Invalid, stale or unauthorized trust bundle

`recordAssessment(...)` rejects the mutation. The invalid bundle does not become canonical review state.

Examples include:

- stale/wrong review subject;
- forged signature;
- unauthorized reviewer/evaluator;
- unauthorized evidence producer/environment;
- wrong policy or trust boundary;
- producer/evidence/issuer independence failure.

### Trusted REJECTED / INCONCLUSIVE

A non-accepted decision must carry at least one unresolved blocking reason.

Those blockers become current `remainingWork`; the same Blackboard item becomes `REOPENED` after finding reconciliation when appropriate.

Do not spawn replacement work merely because current acceptance failed.

### Trusted ACCEPTED

`DONE` is derived only when:

```text
all declared review requirements are ACCEPTED
AND no pending findings remain
AND no current remainingWork remains
```

If trusted findings exist, the item enters `PENDING_RECONCILIATION` until each finding is classified as:

```text
CURRENT_WORK
EXISTING_WORK
NEW_WORK
NON_ACTIONABLE
```

This preserves the existing current-work versus independent-follow-up semantics.

### No declared review obligation

Absence of a requirement must **not** mean project acceptance.

For the concrete Backend -> QA project workflow in BB-019, the project acceptance obligation is mandatory configuration. If the workflow reaches final submission without that obligation, fail closed as a configuration/project-obligation error rather than:

```text
auto-DONE
or
permanent PENDING_REVIEW with no legal dispatch
```

If a future project genuinely allows no independent review, `NO_REVIEW_REQUIRED` must be an explicit project acceptance-policy decision/authority outcome, not inferred from an empty array. BB-018 does not require implementing that future mode.

## Proposed concrete pipeline

```text
Backend role-local ACCEPT
  -> durable QA handoff

QA role-local ACCEPT
  -> final BackendQa submission

project acceptance policy
  -> REQUIRE BACKEND_QA_PROJECT_ACCEPTANCE

Orchestrator
  -> PENDING_REVIEW
  -> beginReview(exact subject, scheduled reviewer)
  -> REVIEWING

review preparation
  -> resolve declared decision/artifact/evidence refs only
  -> run configured independent verifier(s)
  -> create EvidenceArtifact[] bound to exact review subject

review evaluator
  -> DecisionArtifact at ACCEPTANCE

attestor
  -> signed Attestation

Orchestrator.recordAssessment(trust bundle)
  -> trust fails: no canonical assessment mutation
  -> REJECTED/INCONCLUSIVE: REOPENED current work
  -> ACCEPTED + findings: PENDING_RECONCILIATION
  -> ACCEPTED + all obligations satisfied: DONE
```

## BB-019 implementation handoff

Implement the first review path as a concrete Backend/QA composition, not a framework.

Minimum delivery surface:

1. a project-acceptance policy/config contract naming the mandatory review requirement and trust/claim policy;
2. a bounded resolver/preparation function for the exact BackendQa final submission refs;
3. one concrete Backend/QA project reviewer/verifier composition producing `EvidenceArtifact[] + DecisionArtifact + Attestation`;
4. orchestration that persists the PM/project requirement, dispatches through existing `beginReview(...)`, records through existing `recordAssessment(...)`, and reconciles findings through existing semantics;
5. explicit failure behavior for unavailable refs/configuration and deferred review;
6. integration tests from durable QA completion through trusted project acceptance and through rejection/remediation/resubmission.

Do not add:

```text
generic Reviewer<C,R>
reviewer registry
generic review workflow DSL
new trust artifact types
review-specific source-of-truth store
```

unless a second concrete review slice later demonstrates repeated semantics.

## Required BB-019 scenarios

The implementation should make at least these scenarios executable:

1. QA ACCEPT final submission receives the configured project acceptance obligation and becomes dispatchable, not stranded with an empty requirement set;
2. deferred review survives a fresh session in `PENDING_REVIEW`;
3. exact declared refs are resolved and independent verification produces evidence bound to the frozen review target;
4. trusted ACCEPTED assessment with no remaining obligations derives `DONE`;
5. forged/stale/unauthorized evidence, evaluator or attestation cannot mutate canonical review state;
6. missing/unavailable review inputs remain recoverable/deferred and do not fabricate a verdict;
7. trusted REJECTED/INCONCLUSIVE assessment reopens the same work with grounded blockers;
8. remediation resubmission creates a new exact review target and old assessment evidence cannot authorize the new submission;
9. trusted findings preserve `CURRENT_WORK` versus independent follow-up reconciliation semantics;
10. missing project acceptance configuration fails closed instead of auto-accepting or silently deadlocking.

## Relationship to interrupted-review recovery

BB-016/017 own interrupted execution/review recovery and attempt fencing. BB-018 does not redefine that boundary.

The review-to-completion contract requires only this invariant from that lane:

```text
an assessment is valid only for the currently active exact review attempt/subject
```

BB-019 should compose the merged recovery semantics available at implementation time rather than duplicate a second review-recovery mechanism.

## Judgment

The missing piece is not a generic Reviewer abstraction. The concrete gap is:

```text
role-local accepted Backend/QA result
+ explicit project acceptance obligation
+ bounded declared review context
+ independently produced evidence
+ trusted evaluator/attestor bundle
+ Orchestrator-owned reconciliation
= project acceptance path
```

The current Core trust primitives and Blackboard review lifecycle already provide the authority machinery. BB-019 should supply the concrete application composition and mandatory project-acceptance obligation that are absent today.
