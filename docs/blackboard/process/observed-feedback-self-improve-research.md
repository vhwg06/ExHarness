# BB-084 / BB-085 / BB-086 — Observed Implementation, Feedback Lifecycle, Self-Improve

Status: RESEARCH_SA brief. Research runs ahead on planned contracts; every Worker remains blocked until its direct dependencies are DONE.
Checked: 2026-09-28. Upstream research input: BB-083 READY plan and `docs/blackboard/evidence/BB-083/**`.

## Why BB-083 splits into three capability layers

BB-083 research is complete, but it mixes three capability layers with different owners, dependencies and failure semantics:

```text
OBSERVED IMPLEMENTATION  (BB-084)
  execution / attempt / tool / provider evidence
    -> grounded observation -> causal facts (BB-058) -> Oracle context (BB-064)
    -> GroundedFindingInput
        |
        v
FEEDBACK LIFECYCLE       (BB-085)
  GroundedFindingInput -> Finding + Impact -> Disposition -> Response
    -> Fresh Outcome -> FeedbackResolution
        |
        v
SELF-IMPROVE             (BB-086)
  resolved episodes -> cross-episode pattern -> HOW_IMPROVEMENT_PROPOSAL_V1
    -> pinned GEPA search -> benchmark / sealed holdout -> BB-059 independent promotion
```

Dependency runs one way: Observed -> Feedback -> Self-Improve. No layer imports a downstream layer. Cross-episode pattern and reinforcement belong to Self-Improve because aggregating many episodes to change HOW starts self-improvement; the Feedback lifecycle ends at FeedbackResolution.

BB-083 canonical objective, plan, readiness and graph record are not modified here. Narrowing or retiring BB-083 requires the trusted objective-supersession control owned by BB-082; that reconciliation is a later control-plane action and does not block this research.

## Research vs Worker dependency rule

```text
RESEARCH dependency = desired contract / prior research result needed to design
WORKER dependency   = delivered DONE truth needed to code against
```

Research may consume READY plans and prior research as design inputs. A Worker may not. At Worker start each task resolves exact DONE implementation-result, judgment, Living refs and public exports of its direct dependencies; a mismatch with the planned contract is PLAN_INPUT_CONTRADICTION and returns the task to research.

## Source classification

Every plan labels its inputs with exactly one class.

| Class | Meaning | Sources used by this split |
|---|---|---|
| DELIVERED_TRUTH | Present in current source/Living Docs at the research baseline | `createJsonImmutableArtifactStore` and `createOrganizationArtifactRegistry` (organization-artifact-store.js, package-root exports); `createJsonCasHeadStore(...).compareAndSwap(key, expectedRevision, nextValue)` (organization-authority-store.js, package-internal); `resolveExecutionJudgmentBundle`, ExecutionAttemptBinding and RuntimeExecutionAttestation (domain-execution-control.js); `validateApplicationEvidenceArtifact` (evidence.js); `parseApplicationArtifactRef` (artifact-ref.js) |
| PLANNED_CONTRACT | READY plan of an undelivered task; design input only | BB-058 OrganizationObserver, CausalObservationSubject, CausalLifecycleEvidence, MISSING_PROVENANCE; BB-061 ContextRequirement/ContextResolution COMPLETE/PARTIAL/UNSATISFIED and resolutionId; BB-063 ContextResolutionReceipt and evaluateReceiptCurrentness CURRENT/STALE; BB-064 createOracleContextResolver facade; BB-059 HOW_EVOLUTION_FINDING, HOW_EVOLUTION_EVALUATION_PROTOCOL/v1 and independent promotion; BB-065 @exharness/benchmark root exports |
| RESEARCH_DESIRED_STATE | Converged research output not yet implemented | BB-083 feedbackContract, patternContract, optimizerContract, bridgeContract, evaluationHandoffContract and its source/probe evidence; BB-084 GroundedFindingInput; BB-085 FeedbackResolution |

A planned contract is never described as a delivered API. No planned name is imported by research; the Worker preflight binds it or stops.

## BB-084 — Observed Implementation desired state

BB-058 already owns causal reconstruction, owner attribution, execution identity, timing and MISSING_PROVENANCE. BB-084 does not reimplement them. It productizes their read-only output into a grounded observation that downstream feedback can consume.

Grounded observation contract (GROUNDED_OBSERVATION_V1):

- subject: exact CausalObservationSubject pin (historical or current, never mixed) as ref+digest;
- execution identity: semantic executionAttemptId, runtimeInvocationId and ExecutionAttemptBinding/RuntimeExecutionAttestation refs+digests;
- provider/tool events: provider event ids such as tool_call_id or action_id are attributes bound to the ExHarness attempt; provider ids alone are never identity;
- facts: each fact carries evidenceRefs+digests; a required boundary without provenance is MISSING_PROVENANCE, never estimated;
- measurements: key, value, unit, evidenceRef; unmeasured is null plus reason, never zero;
- narrative: provider/model prose is UNTRUSTED_NARRATIVE and cannot become a grounded fact.

Observation ContextBinding (OBSERVATION_CONTEXT_BINDING_V1): exact ContextResolution resolutionId, requirementId and status; optional receipt ref+digest; currentness evaluated at binding time and rechecked at consumption time. Grounding classification is fail-closed:

```text
GROUNDED   = required facts provenanced
             + resolution COMPLETE, or PARTIAL with only OPTIONAL unresolved
             + currentness CURRENT at binding and at consumption
UNRESOLVED = any of MISSING_PROVENANCE | MISSING_CONTEXT | STALE_CONTEXT |
             AMBIGUOUS_CONTEXT | CURRENTNESS_UNVERIFIABLE | SUBJECT_MISMATCH
```

GroundedFindingInput (GROUNDED_FINDING_INPUT_V1) is the only surface Feedback consumes: observation refs+digests, context binding ref+digest, grounding status, typed unresolved reasons and uncertainty. It contains no finding, disposition, acceptance or remediation. Observations, bindings and inputs are immutable content-addressed evidence in the delivered immutable artifact store; they are never product or lifecycle authority.

## BB-085 — Feedback Lifecycle desired state

The per-episode lifecycle is application-owned and ends at FeedbackResolution. It requires no optimizer, benchmark or HOW promotion.

- FeedbackEpisode: immutable; binds GroundedFindingInput refs+digests, finding (kind, statement, evidenceRefs, producer identity), impact MEASURED or HYPOTHESIZED, explicit scopeKey and contraryEvidenceRefs. MEASURED impact and ACTED disposition require GROUNDED input.
- FeedbackResponse: verified application principal, expected current revision, ACTED/REJECTED/DEFERRED/SUPERSEDED, rationaleRef, action/successor refs, typed revisit condition, and for ACTED a frozen outcome policy.
- Episode head: CAS head keyed by episode id; transitions use expected revision; exact replay converges without a second mutation; stale revision fails without rebase.
- FeedbackOutcome: fresh GroundedFindingInput strictly newer than the response under an explicit freshness identity; classified IMPROVED/NO_CHANGE/REGRESSED/UNKNOWN by the frozen outcome policy.
- FeedbackResolution: terminal record for RESOLVED outcomes, acknowledged REJECTED and SUPERSEDED. UNKNOWN never resolves as success.

Outcome evidence is fresh grounded observation, so Feedback Lifecycle does not depend on BB-059 or BB-065. A HOW promotion produced by Self-Improve is measured later by a new episode observation.

## BB-086 — Self-Improve desired state

Self-Improve consumes FeedbackResolution one-directionally and reuses the closed BB-083 research: deterministic cohort pattern projection, reinforcement as support metadata only, mechanism-gated SYSTEMIC, HOW_IMPROVEMENT_PROPOSAL_V1, pinned standalone GEPA 0.1.4 offline bridge, Node-owned AttemptLedger reservation, sealed final holdout, frozen metric policy/minEffect and independent BB-059 evaluation/promotion.

Executed BB-083 evidence carried forward: the GEPA seam probe shows aggregate acceptance can hide a per-case regression and max_metric_calls is not a hard dispatch budget; the Node/Python bridge probe recovers crash-after-commit without duplicate dispatch, preserves the cancellation reservation and denies over-budget work before dispatch.

## Physical ownership

| Task | New product files | Living Doc |
|---|---|---|
| BB-084 | packages/agentic-system/src/grounded-observation.js, observation-context-binding.js | docs/living/system/agentic-application/observed-implementation.md |
| BB-085 | packages/agentic-system/src/feedback-lifecycle-contracts.js, feedback-lifecycle-controller.js, feedback-outcome.js | docs/living/system/agentic-application/feedback-lifecycle.md |
| BB-086 | packages/agentic-system/src/improvement-pattern.js, improvement-proposal.js; scripts/self-improve/** | docs/living/system/agentic-application/self-improvement.md |

File names differ from BB-083's planned feedback-*.js so the split never collides with the not-yet-superseded BB-083 record.

## Per-task research records

Each record is derived from the canonical objective, READY plan and readiness judgment and adds no new claims:

- [BB-084](feedback-research/BB-084.md)
- [BB-085](feedback-research/BB-085.md)
- [BB-086](feedback-research/BB-086.md)
