# Outer Blackboard pipelines

Status: **CURRENT TWO-LANE DELIVERY CONTRACT**

Topic -> Feature/Bug -> Task remains the planning topology. Task is the only schedulable and claimable unit. Component metadata routes context and cannot grant authority.

## RESEARCH_SA

OBJECTIVE -> research and plan draft -> Jev readiness -> READY_IMPLEMENT_PLAN.

Jev evaluates atomic objective-coverage and implementability claims. Every claim must be SATISFIED before the plan becomes READY. Gaps return to research; unknown or failed API results never promote readiness. Research does not mutate product source or claim feature delivery.

## WORKER

Exact READY_IMPLEMENT_PLAN -> execution -> verification/evidence -> Jev candidate judgment.

- SATISFIED for every acceptance claim -> MERGE_PENDING.
- Implementation defect or insufficient evidence -> REPAIR within the same plan.
- Plan/input contradiction -> RESEARCH_SA; revoke readiness before any further execution.
- Exact candidate merged to main, with verified tree and current source -> DELIVERED_FEATURE.

Jev is the semantic judge. Confidence/probability is recorded for stability analysis, not used as another acceptance threshold. Deterministic checks enforce source scope, full criterion coverage, evidence integrity and current binding. Worker observations cannot self-accept.

Execution, judgment, repair and merge-pending are phases within these two lanes. There is no independently routable reviewer lane.

## Context and currentness

Task -> graph/catalog -> current objective/plan -> components -> direct dependency consolidated refs -> deterministic context. Non-DONE dependencies block execution context. Bounded search is available only for unresolved context.

The current graph owns lane, phase, claims and artifact refs. The context file is a rebuildable projection. It is updated in place and removed from active routing on completion; canonical delivery evidence remains addressable. Exact baseline commit reads verify source identity; they do not reconstruct historical work or context generations.

A plan edit at the same canonical ref changes its content hash and invalidates readiness. Worker cannot reinterpret or silently rebind that input.

## Feature completion

A feature identifies its acceptance task. For one task, it is that task. For multiple tasks, an aggregation task depends on all implementation tasks and its plan/evaluation covers every feature acceptance criterion. Intermediate task completion alone cannot close the feature.

## Commands and integration

See [Jev integration](jev.md) for evidence collection, API/CI evaluation, current publication and merge verification. The compatibility bootstrap command supports both outer lanes:

    npm run start:blackboard-implementation -- GENERIC_INTERACTIVE <WORK_ID>

The Agentic Application's internal runtime Blackboard is outside this development pipeline.
