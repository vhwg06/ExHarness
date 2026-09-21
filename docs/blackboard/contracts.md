# Outer Blackboard contracts

Status: **CURRENT DEVELOPMENT COORDINATION CONTRACT**

## Namespace

1. `docs/living/*` owns current system truth/current durable knowledge.
2. `docs/blackboard/state.md` owns current development state/routing.
3. Blackboard context is helpful loading/routing only and does not duplicate Living Docs semantics.

## Current context

4. Every active work item has one exact `current-context.ref`.
5. The canonical active context path is `docs/blackboard/context/<WORK_ID>/current.json`.
6. Helpful context is updated in place. It has no generation, parent chain, stale marker or audit-history refs.
7. A fresh session loads only the refs declared by the current context.
8. Missing/mismatched current-context ref fails closed.
9. Multiple active work items are valid; selection is explicit when more than one exists.

## Research / implementation boundary

10. `RESEARCH_SA` turns an explicit problem/question into a current accepted `IMPLEMENTATION_INPUT`.
11. Research/SA does not mutate product source in its normal lane.
12. `IMPLEMENTATION_WORKER` consumes one exact implementation input, its canonical `IMPLEMENTATION_SPEC` when one exists, plus explicit current-system/source/test refs.
13. Worker does not silently redefine semantic input; architecture gaps return to Research/SA.

## Artifact semantics

14. `IMPLEMENTATION_INPUT` records WHAT/WHY/required behavior/invariants/acceptance, not executor procedure.
15. `IMPLEMENTATION_SPEC` records worker-ready HOW/source seams/slices/negative tests and is keyed by semantic subject. It is not routing, acceptance or allocation authority.
16. `IMPLEMENTATION_SPEC.provenance.originWorkId` is retained identity evidence only and must never be reused as a different work subject.
17. `READINESS_DECISION` binds directly to `itemId + semanticArtifactRef`.
18. `IMPLEMENTATION_RESULT` binds directly to `itemId + semanticArtifactRef + sourceBaseline + candidateRef + executionAuthorityRef`.
19. `JUDGMENT` binds directly to `itemId + semanticArtifactRef + implementationResultRef + candidateRef + sourceBaseline`.
20. Helper-context identity is never an authority subject.
21. Current artifact files use canonical filenames and are updated in place when the current pipeline subject changes; Git carries revision history. Artifact existence alone is never completion; current work/queue membership comes from `state.md`.

## Implementation lanes

22. `IMPLEMENTATION_WORKER` has `EXECUTION` and `JUDGMENT` lanes.
23. `EXECUTION` may mutate only bounded source scope and may publish observations/results, never correctness verdicts.
24. `JUDGMENT` is read-only for product source and owns correctness assessment.
25. `JUDGMENT/READINESS` may publish `READINESS_DECISION`.
26. `JUDGMENT/CANDIDATE` evaluates the exact semantic input/result/candidate and publishes `ACCEPT | FINDINGS`.
27. `FINDINGS` may authorize bounded repair through the exact current judgment artifact.
28. `ACCEPT` cannot authorize repair.
29. No `CONTEXT_STALE` finding exists. Context is explicitly rewritten when current delivery information changes.

## Currentness

30. `state.md` is the only current outer-Blackboard state SoT.
31. Currentness is never inferred from timestamps, filename suffixes, generations, history files, newest commits or artifact directory scans.
32. There is no Blackboard history directory requirement. Previous Board/context revisions are available through Git only.
33. Queue order is non-semantic. `state.md` names the currently accepted unallocated semantic inputs and paired implementation specs when present.
34. If an implementation input or implementation spec changes before allocation, update the canonical file and `state.md` explicitly; do not create `v2/v3` siblings.

## Living Docs reconciliation

35. Delivery that changes current system semantics updates the canonical `docs/living/*` files in place.
36. Living Docs keep no stale/version-sibling files for current knowledge. Git history is the revision history.
