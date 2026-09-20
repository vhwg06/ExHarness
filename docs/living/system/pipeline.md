# Agentic System current delivered pipeline

This document describes execution/verification pipelines that exist in source today. It is not the roadmap. Open stages and future work live only in `docs/blackboard/state.md`.

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
 -> NON_ACTIONABLE -> no Board work
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

## Workflow policy replay evaluation

Root `npm run verify` also runs a bounded deterministic policy-replay evaluation:

```text
npm run eval:workflow-replay
 -> scripts/workflow-policy-replay-eval.mjs
 -> fixed artifact-outage / cancellation / retry / review-delay schedules
 -> same recorded observable events under baseline and candidate policy identities
 -> reproduce the late-reconciliation cancellation divergence
 -> assert unrelated schedules remain behaviorally unchanged
 -> assert historical mutating-effect observations cause zero external dispatches
 -> deep compare with artifacts/bb038-workflow-replay-eval.json
```

This replay surface is evaluation/regression tooling only. It consumes recorded fixture events and adapter outcomes; it does not replay model/provider calls, reconstruct live runtime authority, reproduce real concurrent timing, or dispatch historical external mutations. Its checked artifact declares `evidenceClass: DETERMINISTIC_POLICY_REPLAY_FIXTURE` and `productionEvidence: false`. A replay divergence identifies a policy/decision difference under fixed fixture inputs; it does not establish causal certainty when live model, environment, timing or authority inputs differ.

## Semantic-memory reuse evaluation

Root `npm run verify` also runs the deterministic experience-reuse evaluation:

```text
npm run eval:memory-reuse
 -> scripts/semantic-memory-reuse-eval.mjs
 -> existing Core SemanticMemory retrieval + intelligence ports
 -> no-memory / lexical / associative / application-bounded modes
 -> held-out recurring-failure tasks under one fixed repair-attempt budget
 -> exercise cross-project, revision-specific, policy-mismatch, stale, archived and contradictory experience
 -> assert retrieval remains RELEVANCE_ONLY and memory never becomes acceptance authority
 -> deep compare with artifacts/bb037-grounded-experience-reuse-eval.json
```

The bounded mode is evaluation tooling for an application-side remediation-context proposal, not a delivered runtime adapter or a Core ranking change. The checked artifact declares deterministic fixture evidence only (`productionEvidence: false`). A reduction in fixture repair attempts does not establish production transfer quality or authorize semantic memory as correctness evidence.

## Self-upgrade research verification

Root `npm run verify` also executes the bounded self-upgrade evaluation:

```text
npm run eval:self-upgrade-research
 -> fresh persisted failure evaluation
 -> grounded REFLECTION
 -> stale-evaluation negative control
 -> bounded DeliberationArtifact + experiment-only ActionIntent
 -> recorded baseline/candidate replay artifact
 -> fixed target/control/budget checks
 -> synthetic collateral-regression negative control
 -> independent EvidenceArtifact + DecisionArtifact + Attestation trust check
 -> deep compare with artifacts/bb034-self-upgrade-loop-probe.json
```

This remains a deterministic research fixture rather than evidence of autonomous self-modification. The ActionIntent authorizes only the isolated experiment, and a trusted experiment result produces only a reviewable proposal. It does not select, deploy or merge the candidate, alter user intent, change acceptance thresholds, or grant runtime authority. Failed or inconclusive experiment criteria retain the baseline. The checked artifact declares `evidenceClass: DETERMINISTIC_SELF_UPGRADE_RESEARCH_FIXTURE` and `productionEvidence: false`. The bounded application pilot is delivered separately; its runtime boundary still exposes proposal-for-review rather than adoption authority.

## Artifact-manifest fresh-session research verification

Root `npm run verify` also executes the artifact-manifest evaluation:

```text
npm run eval:artifact-manifest-research
 -> producer session persists QA_PENDING-like accepted Backend handoff
 -> JSON Blackboard stores ref-only artifact + acceptance provenance
 -> filesystem fixture stores artifact bytes + producer-side manifest
 -> fresh ApplicationOrchestrator + SessionHandoffSurface reconstruct the handoff
 -> makeQaWorkOrder(...) + resolveQaContext(...)
 -> baseline vs manifest reader under nine deterministic scenarios
 -> changed-content / producer-revision / work-order / decision-id / decision-digest negatives
 -> explicit missing-content / partial-set / manifest-unavailable outcomes
```

This verification surface remains deterministic evidence for the optional manifest boundary. The runtime manifest-validating artifactReader is delivered as an application-owned wrapper; the default direct artifactReader path remains unchanged. Every research scenario reconstructs the project from durable Blackboard state plus filesystem-backed stores. The manifest establishes content/provenance identity only, never correctness or acceptance authority. The probe declares `evidenceClass: DETERMINISTIC_FRESH_SESSION_FIXTURE` and `productionEvidence: false`; real artifact-store latency, retention cost, availability and production value remain unmeasured.

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
- generic workflow Orchestrator;
- generic self-improvement/self-modifying runtime.

The concrete `ApplicationOrchestrator` owns application Blackboard transitions; it is not a generic orchestration framework or second agent runtime.
