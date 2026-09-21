# Outer Blackboard contracts

Status: **CURRENT TYPED WORK / CONTEXT CONTRACT**

## Authority boundaries

1. `docs/living/*` owns current delivered system truth.
2. `docs/blackboard/work-graph.json` owns outer planning, task dependency, lifecycle and task-claim state.
3. `docs/blackboard/component-registry.json` owns component context-routing metadata.
4. `docs/blackboard/state.md` is a derived human projection and is never semantic authority.
5. `context/<TASK_ID>/current.json` is a rebuildable task-context projection and is never planning or acceptance authority.

## Work graph

6. The hierarchy is `Topic -> Feature|Bug -> Task`.
7. Task is the scheduling, claim and execution unit.
8. A Task declares only direct Task dependencies; transitive closure is derived.
9. Executable subtasks must be Task nodes. Embedded subtasks may only be non-schedulable checklists.
10. A non-ACTIVE Task has no worker claim and no `currentContextRef`.
11. An ACTIVE Task has exactly one current worker claim and one canonical `currentContextRef`.
12. One Task may reference many Components without creating multiple workers.
13. Work ids are globally reserved identities and may not be reused for a different work subject.

## Components and context routing

14. Component is a context-routing unit, not execution ownership or authorization.
15. Every referenced Component resolves through one canonical Context Profile.
16. Context Profiles may declare current-system refs, source roots, test roots, contracts and progressive-search roots.
17. Component metadata must not grant source mutation, acceptance or runtime authority.
18. Task-specific `IMPLEMENTATION_SPEC` may narrow/extend worker-ready source seams without changing the semantic `IMPLEMENTATION_INPUT`.

## Context derivation

19. A fresh worker starts from the exact Task node, never from repository-wide search.
20. Context resolution order is Task -> Topic/Feature -> Components -> explicit task artifacts -> direct dependencies -> deterministic WorkerContext.
21. DONE direct dependencies contribute their canonical `consolidatedRefs`; terminal implementation transcript is not default context.
22. Non-DONE direct dependencies block executable task context.
23. Broad grep/search is progressive discovery only after deterministic context is insufficient.
24. Progressive search is bounded by component-declared search roots.
25. Deleting `current.json` must not destroy semantic continuation state; the resolver must reconstruct the base context from canonical graph/catalog/artifacts.
26. Helpful context has no generation, parent chain, stale marker or audit-history refs.

## Research / implementation boundary

27. `RESEARCH_SA` turns an explicit problem/question into an accepted `IMPLEMENTATION_INPUT`.
28. `IMPLEMENTATION_INPUT` owns WHAT/WHY/required behavior/invariants/acceptance.
29. `IMPLEMENTATION_SPEC` owns worker-ready HOW/source seams/slices/negative tests; it is not routing, acceptance or allocation authority.
30. `IMPLEMENTATION_WORKER` consumes the exact Task, its semantic input/spec, graph-derived component context and exact dependency truth.
31. Worker may not silently redefine semantic input; architecture gaps return to Research/SA.

## Implementation lanes and artifacts

32. `IMPLEMENTATION_WORKER` has `JUDGMENT/READINESS -> EXECUTION -> JUDGMENT/CANDIDATE -> REPAIR?`.
33. Readiness context carries a graph-derived execution source scope; accepted execution reuses that scope instead of inventing one later.
34. `READINESS_DECISION` binds `taskId + semanticArtifactRef`.
35. `IMPLEMENTATION_RESULT` binds `taskId + semanticArtifactRef + sourceBaseline + candidateRef + executionAuthorityRef` and records facts only.
36. `JUDGMENT` independently binds semantic input/result/candidate and owns correctness assessment.
37. `ACCEPT` cannot authorize repair; `FINDINGS` may authorize only bounded repair.
38. Helper-context identity is never an authority subject.

## Retention and consolidation

39. `current-only` means one canonical artifact per semantic subject, not active-work-only.
40. Work completion removes active routing/context but does not delete canonical delivery artifacts.
41. Artifact deletion requires explicit semantic retirement/supersession.
42. Task outputs aggregate through Feature/Bug and Topic consolidation into Living Docs.
43. Once a dependency is DONE and consolidated, future context prefers Living/current truth over historical task transcript.
44. Git retains revision history; fresh workers do not reconstruct context from Git history.
