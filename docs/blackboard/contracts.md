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
18. `READY_IMPLEMENT_PLAN` fixes source seams and authorized scope before worker execution. Component metadata cannot expand that scope.

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

27. `RESEARCH_SA` consumes `OBJECTIVE` and converges only to a Jev-satisfied `READY_IMPLEMENT_PLAN`.
28. The plan contains scope, constraints, invariants, architecture decisions, source seams, slices, acceptance criteria and verification. A draft is not executable.
29. Plan content binds the exact objective ref/hash. Readiness evaluates source at the exact recorded research baseline; worker source changes do not rewrite that baseline.
30. `WORKER` consumes the exact ready plan ref/content hash and dependency truth. Its plan must declare the current Living Doc refs that describe the implementation. It converges only to `DELIVERED_FEATURE` after those refs are changed in the candidate and accepted by Jev.
31. Worker cannot redefine its plan. Plan/input contradictions return to Research/SA and revoke readiness. Research cannot claim delivery.

## Implementation lanes and artifacts

32. Outer lane is exactly `RESEARCH_SA | WORKER`. Research, execution, judgment, repair and merge-pending are phases, not extra lanes.
33. Execution uses the plan's authorized source scope. Research and judgment contexts have no product write scope.
34. `JEV_EVALUATION` binds task, objective, plan, evaluation spec/model and materialized evidence; worker evaluation also binds candidate SHA/tree and result.
35. Worker evidence records exact verification commands, exit codes, candidate SHA, hashed logs and criterion evidence. Producer observations are not acceptance.
36. Jev owns semantic judgment. All typed choices must be SATISFIED; confidence is telemetry only. Schema, evidence, binding and merge checks remain deterministic.
37. Defects and insufficient evidence authorize bounded repair. Input contradiction returns upstream. Unchanged input reuses its judgment; no rerolling for pass.
38. DELIVERED_FEATURE requires all claims satisfied, including the plan's Living Docs claim, exact candidate ancestor of main, merge tree equality, consolidated Living Doc refs and evaluated source still present in main. Helper-context identity is never an authority subject.

## Retention and consolidation

39. `current-only` means one canonical artifact per semantic subject, not active-work-only.
40. Work completion removes active routing/context but does not delete canonical delivery artifacts.
41. Artifact deletion requires explicit semantic retirement/supersession.
42. Task outputs aggregate through Feature/Bug and Topic consolidation into Living Docs.
43. Once a dependency is DONE and consolidated, future context prefers Living/current truth over historical task transcript.
44. Git retains revision history; fresh workers do not reconstruct context from Git history.
45. Migration converts unfinished work only. Existing terminal canonical evidence stays unchanged and valid; no version/history reconstruction.
46. Multi-task features declare an acceptance task depending on all implementation tasks. Its plan covers the whole feature; only its delivered receipt closes the feature. A single-task feature uses that task as its acceptance task.

API, publication, failure handling and commands are specified in [Jev integration](jev.md).
