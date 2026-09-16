# Agentic System current delivered pipeline

This document describes execution/verification pipelines that exist in source today. It is not the roadmap. Open stages and future work live only in `../living/blackboard.md`.

## Backend path

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
    -> repositoryReader.readFile(...)
    -> validated BackendContext + sourceRef
 -> BackendWorker
 -> ExHarness Core
 -> grounded BackendWorkResult
 -> mutation + typecheck + tests evidence
 -> BackendCompletionPolicy
 -> ACCEPT | CONTINUE | BLOCK | FAIL
```

`APPLIED` requires actual ExHarness lineage promotion. Worker-returned evidence is not completion authority.

When required objective evidence passes but semantic gaps are explicitly reported, the bounded `BackendAdvisor` may propose only retry implementation, request context or escalation. It cannot accept work or mutate workflow state directly.

## Backend -> QA path

```text
accepted Backend completion
 -> BackendQaHandoff
    -> producer work-order id
    -> accepted revision
    -> acceptance decision ref
    -> ApplicationArtifactRef[]
 -> QaWorkOrder
 -> resolveQaContext(...)
    -> artifactReader.readArtifact(...)
    -> validated QaContext
    -> sourceRef + APPLICATION_ARTIFACT provenance
 -> QaWorker
    -> ExHarness verification with mutation forbidden
 -> qa.behavior + qa.regression evidence
 -> QaCompletionPolicy
```

QA is dispatched only after Backend `ACCEPT`. QA issues produce deterministic remediation/continuation behavior rather than borrowing Backend mutation semantics.

## Durable Blackboard path

```text
READY / REOPENED
 -> ApplicationOrchestrator.claim(...)
 -> CLAIMED
 -> bounded Worker submission
    -> optional WORKER-sourced review requests
    -> optional explicit resolvedWork claims for previously reopened obligations
 -> ApplicationOrchestrator.submit(...)
 -> PENDING_REVIEW

PM project obligation
 -> ApplicationOrchestrator.requireReview(...)
    source must be PM

PENDING_REVIEW
 -> beginReview(key, reviewer)
 -> REVIEWING
 -> recordAssessment(...)
      +-> REJECTED / INCONCLUSIVE -> REOPENED + remaining work
      +-> ACCEPTED + other review remains -> PENDING_REVIEW
      +-> ACCEPTED + no review remains + remaining work exists -> REOPENED
      +-> ACCEPTED + no review remains + no remaining work -> DONE
```

Worker review request and PM review requirement are separate source paths. Reviewer assessment is explicit. A Worker submission cannot take a Board item directly to `DONE`.

A reopened item can be claimed again and a later submission can identify exact outstanding `resolvedWork`; that assertion still cannot close the work without its required reviews accepting the new submission.

## Grounded follow-up reconciliation

```text
finding(summary + sourceRef)
 -> CURRENT_WORK   -> remaining work + evidence provenance + REOPENED
 -> EXISTING_WORK  -> link existing Board item + evidence provenance
 -> NEW_WORK       -> create child with parent/finding/source provenance
 -> NON_ACTIONABLE -> no new Board work
```

This prevents review failure from being hidden behind a replacement ticket when the original acceptance obligation is still unmet.

## Persistence

`createJsonBlackboardStore(...)` validates the Board snapshot and persists via temporary-file write + rename. Submitted refs, review requirements and `PENDING_REVIEW` state survive reconstruction through a new Orchestrator instance.

The durable `createDurableBackendQaWorkflow(...)` composition binds the concrete Backend -> QA stages to Blackboard dispatch and recovery. It persists the workflow specification and stage checkpoint, resumes QA from a ref-only accepted Backend handoff, routes QA issues to Backend remediation, preserves blocked source-lookup checkpoints for explicit resume, and submits accepted QA as `PENDING_REVIEW`. The direct `runBackendThenQaObjective(...)` composition remains available for one-session execution.

## Application evaluation gate

Root `npm run verify` now includes the concrete Agentic Application reference evaluation:

```text
npm run eval:agentic
 -> scripts/agentic-backend-qa-eval.mjs
 -> durable Backend -> QA workflow
 -> happy / restart / remediation / blocked-recovery / cancel scenarios
 -> measured deterministic result
 -> deep compare with artifacts/agentic-backend-qa-reference-eval.json
```

The gate verifies regression-level application behavior including ref-only handoff integrity, false-completion avoidance, repository/application-artifact source reads, remediation/recovery and review-gate behavior. Its checked artifact declares `evidenceClass: DETERMINISTIC_REFERENCE` and `productionEvidence: false`; it is not a production workload benchmark and does not establish Advisor value-add or justify generic abstractions.

## Current extraction result

Repeated source-backed shapes:

- `ApplicationArtifactRef`;
- evidence-artifact integrity / required-claim state plumbing;
- durable Blackboard work/review/follow-up state.

Not implemented as generic abstractions:

- generic Worker / WorkOrder / WorkResult;
- generic Advisor;
- role registry;
- workflow graph/DSL;
- Teacher/Reviewer registry;
- generic workflow Orchestrator.

The concrete `ApplicationOrchestrator` owns application Blackboard transitions; it is not a generic orchestration framework or second agent runtime.
