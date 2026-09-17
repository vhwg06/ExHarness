# Research continuation

The Agentic Application has one opt-in, application-local research-continuation consumer. It composes existing Blackboard lifecycle state with external research artifacts; it does not add research semantics to the generic Blackboard or Core.

## Boundary

```text
Blackboard work item
  -> checkpoint = RESEARCH_CONTINUATION v1 cursor
  -> artifact/evidence refs
  -> external question / plan / experiment / evidence-ledger artifacts
```

The Board stores lifecycle state, the versioned continuation cursor and references. Hypotheses, experiment procedures, observations and research-result payloads remain external work products.

`createResearchContinuationController(...)` reconstructs the project through `sessionHandoffFromBlackboard(...)` and resolves only the refs declared by the research manifest through the injected `artifactReader`.

## Continuation manifest

The concrete v1 manifest carries:

```text
version = 1
kind = RESEARCH_CONTINUATION
researchId
questionRef
planRef
evidenceLedgerRef
experimentRefs[]
activeExperimentId | null
sourceRevision
policyRevision | null
nextAction
```

`persistContinuation(...)` validates the manifest before calling the ordinary Application Orchestrator checkpoint boundary. The supplied Blackboard `artifactRefs` must include every manifest work-product ref, and `evidenceRefs` must include the declared evidence ledger.

No new Blackboard schema or lifecycle transition is introduced.

## Experiment state

The concrete consumer recognizes:

```text
PLANNED
IN_PROGRESS
COMPLETED
INVALIDATED
```

A completed experiment must carry a result or evidence ref. Resume reconstruction separates completed experiments from the single active/incomplete experiment.

When `activeExperimentId` exists, exactly one `PLANNED` or `IN_PROGRESS` experiment must exist and its id must match the cursor. When no active id exists, no incomplete experiment may remain. Inconsistent continuation state fails closed rather than guessing what to execute.

Completed experiment ids are returned as skip state; the controller does not redispatch them.

## Evidence ledger and freshness

The bounded evidence ledger recognizes:

```text
OBSERVED
CONFIRMED
CONTRADICTED
STALE
SUPERSEDED
```

Contradiction targets must identify another entry in the same ledger. `STALE` and `SUPERSEDED` evidence carries explicit invalidation provenance instead of being deleted.

Evidence freshness is scope-aware. A source or policy revision mismatch requires reassessment only when the caller declares that one of the evidence entry's bound scopes changed:

```text
revision differs + bound scope changed
  -> REASSESS_REQUIRED

revision differs + only unrelated scope changed
  -> CURRENT

STALE / CONTRADICTED / SUPERSEDED
  -> NON_CURRENT
```

Artifact existence alone is never treated as evidence freshness.

## Fresh-session resume

```text
fresh ApplicationOrchestrator
  -> project-bound session handoff
  -> read research checkpoint
  -> resolve question / plan / experiment / ledger refs
  -> validate continuation state
  -> completedExperimentIds[]
  -> resumeExperiment | null
  -> evidence freshness decisions
  -> reassessmentEvidenceIds[]
```

The controller has no hidden role memory or previous-conversation dependency.

## Submission and acceptance

`submitProposal(...)` refuses submission while:

- an experiment remains active; or
- current source/policy changes leave evidence in `REASSESS_REQUIRED` state.

A valid final research submission is explicitly:

```text
decisionStatus = PROPOSED
Blackboard status = PENDING_REVIEW
```

The controller delegates to the Application Orchestrator's `submitWithRequiredReviews(...)` boundary so the proposal and its PM-sourced independent `research-workflow` review obligation are committed in one Blackboard transaction. There is no accepted intermediate state where the proposal is `PENDING_REVIEW` without that required review. The controller cannot mark the work `DONE`, manufacture a review assessment or promote an architecture decision.

Therefore these remain distinct:

```text
experiment completed
!= research submission completed
!= independent acceptance / promoted decision
```

## Non-goals

This slice is not:

- a generic research engine;
- a role or workflow registry;
- a notebook service;
- a second lifecycle authority;
- a generic artifact-retention or identity layer;
- a replacement for Blackboard persistence validation;
- an autonomous architecture-decision promotion path.

Storage/payload integrity, artifact-retention semantics and project acceptance remain owned by their existing boundaries.
