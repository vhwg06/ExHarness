# Backend / QA project acceptance

This file describes the concrete project-acceptance composition implemented by the Agentic Application today. It is a current-source projection, not a desired-state design.

## Scope

`createBackendQaProjectAcceptanceController(...)` composes one concrete Backend -> QA project-acceptance path over existing boundaries:

```text
PM-authorized project review obligation
+ durable Backend/QA trust artifacts
+ exact application artifact refs
+ concrete verifier / evaluator / attestor
+ ApplicationOrchestrator review lifecycle
```

It does not introduce a generic Reviewer API, role registry, workflow DSL, universal Oracle provider, second lifecycle engine or concrete PM runtime Worker.

## PM requirement authority

The controller requires an explicit project-acceptance requirement whose source is `ReviewRequirementSource.PM` and whose configuration carries an `authorizedBy` authority identity.

Configuration transports an already-authorized project obligation; configuration does not create or cryptographically prove PM authority. The current Blackboard review requirement persists the PM source, key and reason. The configured PM authority is carried into the resulting project-review decision metadata for audit, while lifecycle mutation remains owned by `ApplicationOrchestrator`.

When the controller is attached to `createDurableBackendQaWorkflow(...)`, final QA acceptance ensures the declared PM project-acceptance requirement exists before the final submission is committed. The workflow never fabricates a Worker review request for this obligation.

## Durable trust-artifact boundary

`createJsonTrustArtifactStore(...)` is the concrete local payload store for Core trust artifacts required across sessions.

It stores immutable/content-addressed:

```text
EvidenceArtifact
DecisionArtifact
Attestation
```

Writes validate artifact identity and digest. Reads require the exact `{ id, digest }` and validate the stored payload again before returning it. Rewriting a digest with different content is rejected.

The store is payload authority only. Blackboard remains lifecycle/ref state and does not copy trust-artifact payloads into work items.

Accepted Backend and QA role-completion lineage follows write-before-ref ordering:

```text
persist role evidence
 -> persist role DecisionArtifact
 -> only then checkpoint/submit the corresponding decision ref in Blackboard
```

Non-accepted role completion is not promoted into the later project-acceptance trust lineage. Its ordinary Backend/QA checkpoint/block/retry behavior remains unchanged.

A trust-artifact persistence failure occurs before the Board mutation that would publish the corresponding decision ref. The existing claim/checkpoint remains canonical; an already-written immutable evidence payload may remain orphaned and is not completion authority.

## Final Backend / QA submission

With project acceptance configured, successful QA submits a ref-only payload containing:

- accepted revision;
- validated Backend/QA workflow spec and attempt needed for later same-item remediation;
- accepted Backend handoff refs;
- Backend acceptance-decision `{ id, digest }`;
- QA acceptance-decision `{ id, digest }`;
- application artifact refs;
- decision evidence refs used by Board continuation.

The partial execution checkpoint is cleared by final submission as before. The extra ref/spec lineage exists so a later review session can resolve exact trust inputs and so a trusted rejection can resume the same work item without relying on prior conversation state.

## Review preparation

Project review preparation runs before `beginReview(...)` for a normal `PENDING_REVIEW` item.

It resolves only the exact declared inputs:

```text
Backend decision ref
 -> exact decision
 -> exact evidence-manifest refs
 -> exact evidence payloads

QA decision ref
 -> exact decision
 -> exact evidence-manifest refs
 -> exact evidence payloads

application artifact refs
 -> applicationArtifactReader
```

Missing, corrupted or mismatched trust payloads fail closed. An unavailable declared application artifact also fails before review dispatch, so the Board remains `PENDING_REVIEW` with no fabricated verdict or active review.

Trust-artifact dereference and application-artifact dereference remain separate source boundaries.

## Trusted project review

A review attempt is still scheduled and fenced by the existing Orchestrator:

```text
PENDING_REVIEW
 -> beginReview(...)
 -> REVIEWING generation N
```

The configured project verifier must produce one or more grounded `EvidenceArtifact`s bound to the exact active review subject. The configured evaluator produces the decision claims, unresolved reasons, findings and verdict. The controller materializes a Core `DecisionArtifact` at `TrustBoundary.ACCEPTANCE`, then the configured Core attestation issuer signs that exact decision.

The resulting trust bundle is persisted to the trust-artifact store and passed to `ApplicationOrchestrator.recordAssessment(...)`.

The Orchestrator remains trust/completion authority. It validates exact review target, reviewer/evaluator identity, evidence authority, issuer/signature, policy and independence rules before applying the trusted verdict to Board state.

Reviewer prose is not accepted as evidence or completion authority.

## Interrupted review

If a process dies after review dispatch, the Board remains `REVIEWING` with its active review generation.

A fresh controller can call `recoverReview(...)`. The Orchestrator increments `reviewGeneration` and freezes a replacement exact review subject before replacement verification runs. Evidence from the abandoned generation cannot commit against the replacement attempt.

The durable trust/application inputs are resolved again from refs; prior conversation state is not required.

## Rejection and same-item remediation

A trusted `REJECTED` or `INCONCLUSIVE` project review follows the existing Orchestrator rule: the current item becomes `REOPENED` with grounded unresolved reasons in `remainingWork`.

Because final submission has already cleared the execution checkpoint, the durable workflow reconstructs a bounded `BACKEND_REMEDIATION_PENDING` checkpoint from:

```text
final submitted workflow spec
+ last accepted Backend handoff
+ last Backend acceptance-decision ref
+ exact current remainingWork produced by trusted review
```

The checkpoint records the exact outstanding remediation obligations separately from the issue text used to construct the Backend remediation objective. This preserves both existing QA-issue remediation and review-rejection remediation without claiming work resolved unless that exact obligation is currently outstanding.

A new accepted Backend result resolves those obligations, creates a new accepted handoff/revision and returns the same item to QA. QA acceptance resubmits the same item for the existing PM project-acceptance requirement. A later trusted acceptance can then reach `DONE`.

No replacement Blackboard item is manufactured for a failed current acceptance obligation.

## Findings

Trusted accepted review findings continue to use the existing Orchestrator reconciliation contract:

```text
CURRENT_WORK
EXISTING_WORK
NEW_WORK
NON_ACTIONABLE
```

The project-acceptance controller does not create a parallel finding model or bypass `ApplicationOrchestrator.reconcileFinding(...)`.

## Compatibility boundary

`createDurableBackendQaWorkflow(...)` still accepts no project-acceptance controller for existing role-local/low-level compositions. That compatibility path still stops at `PENDING_REVIEW` and does not claim project completion.

The concrete BB-019 project-completion path is the composition with an explicit `createBackendQaProjectAcceptanceController(...)` attached. In that path, PM requirement transport, durable trust-artifact persistence and trusted project review are mandatory parts of reaching Blackboard `DONE`.

## Verified scenarios

The current contract suite covers:

- Backend -> QA -> fresh-session trusted project acceptance -> `DONE`;
- exact Backend/QA decision reload from the durable trust store;
- missing application review input failing before review dispatch;
- trusted rejection reopening the same item, fresh-session Backend remediation, QA resubmission and later acceptance;
- interrupted `REVIEWING` recovery with a new fenced review generation;
- trust decision persistence failure leaving Blackboard without the unpublished decision ref;
- existing QA-remediation and durable workflow behavior through the full repository test matrix.
