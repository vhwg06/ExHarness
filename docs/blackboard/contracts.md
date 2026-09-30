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
31a. Research cannot redefine its objective. Ordinary Research/Worker candidates may not change `objectiveRef`, `planRef` or trusted objective bytes. The only way to replace an unfinished task objective is a typed `OBJECTIVE_SUPERSESSION` receipt at `docs/blackboard/artifacts/objective/<WORK_ID>.supersession.json`. It binds `targetWorkId`, `trustedBaseSha` (the exact PR base), old and replacement objective `{ref,hash}` at the same stable path, `planRef`, `reason`, `evidenceRefs` and the complete `directDependents` manifest.
31b. Supersession applies only to an unfinished `RESEARCH_SA` target. A valid publication moves it to non-active `PLANNED RESEARCH_SA/RESEARCH`: claim and current context are removed, and the contract keeps only `objectiveRef`, `planRef` and `researchBaselineSha`. Readiness, evaluation, candidate, evidence and delivery fields are removed. The plan at the same ref becomes `DRAFT` without `readinessRef` and is bound to the replacement hash. Id, feature, title, components, dependency edges and artifacts are preserved.
31c. Every trusted direct dependent is declared exactly once and handled conservatively. DONE work is `TERMINAL_UNCHANGED` (byte-identical). Unfinished WORKER/READY work is `RESET_RESEARCH`: it returns to non-active research, its plan content stays the same with DRAFT status, and stale authority is stripped. RESEARCH_SA work is `RETAIN_RESEARCH`: it stays non-active research with its refs and plan unchanged. All other tasks, features and topics are unchanged.
31d. The trusted PR-base verifier (`verify-supersession`, sibling job `objective-supersession-verify`) checks the receipt against trusted bytes. It fails closed on a stale base/old hash (compare-and-swap), wrong refs, self-redefinition and hidden or mutated dependents. It also rejects unrelated paths, version siblings, rewritten historical artifacts and any bundled `scripts/`, `packages/`, `test/` or `.github/` change. It reads candidate files as data, executes no candidate code, uses no secrets and makes no provider call. Merge of the verified PR is the publication authorization.

## Implementation lanes and artifacts

32. Outer lane is exactly `RESEARCH_SA | WORKER`. Research, execution, judgment, repair and merge-pending are phases, not extra lanes.
33. Execution uses the plan's authorized source scope. Research and judgment contexts have no product write scope.
34. `JEV_EVALUATION` binds task, objective, plan, evaluation spec/model and materialized evidence; worker evaluation also binds candidate SHA/tree and result.
35. Worker evidence records exact verification commands, exit codes, candidate SHA, hashed logs and criterion evidence. Producer observations are not acceptance.
35a. A plan may bind its `negativeVerificationCases` through `negativeCaseBindings: [{id, negativeCaseIndex, criterionId, verificationId, testRef, testTitle, subjectSymbol}]`. Every case index is covered exactly once, with a distinct test title per index. The criterion must list the verification. `testRef` must be an expected test, and `subjectSymbol` must be a plain identifier. The binding is mandatory for work ids at or above `jev-policy.json` `negativeCaseBindingsFromWorkId`. Earlier plans are grandfathered and never retrofitted.
35b. Evidence collection deterministically requires each bound title to pass exactly once in its verification log (spec or TAP; a missing, failed, skipped, duplicate or substring-only title fails). The single extracted `test(...)`/`it(...)` body at the candidate SHA must invoke the subject and contain a non-vacuous assertion. Otherwise collection fails with `negative case unbound: <id>: <reason>`. Passing bindings are recorded in their criterion claim as `negativeCases [{id, logRef, testRef, bodyHash}]`.
36. Jev owns semantic judgment. All typed choices must be SATISFIED; confidence is telemetry only. Each negative-case binding is its own atomic Worker question carrying the extracted test body, alongside the aggregate criterion questions. Schema, evidence, binding and merge checks remain deterministic.
37. Defects and insufficient evidence authorize bounded repair. Input contradiction returns upstream. Unchanged input reuses its judgment; no rerolling for pass.
38. DELIVERED_FEATURE requires all claims satisfied, including the plan's Living Docs claim, exact candidate ancestor of main, merge tree equality, consolidated Living Doc refs and evaluated source still present in main. Helper-context identity is never an authority subject.

## Retention and consolidation

39. `current-only` means one canonical artifact per semantic subject, not active-work-only.
40. Work completion removes active routing/context but does not delete canonical delivery artifacts.
41. Artifact deletion requires explicit semantic retirement/supersession. A supersession overwrites the canonical unfinished objective/plan in place and retains its receipt. Retained receipts must bind the current objective hash. Prior bodies live only in Git history, with no `gNNNN`/version siblings. Migration of any specific task's objective (for example BB-065) is a separate publication after the mechanism is delivered.
42. Task outputs aggregate through Feature/Bug and Topic consolidation into Living Docs.
43. Once a dependency is DONE and consolidated, future context prefers Living/current truth over historical task transcript.
44. Git retains revision history; fresh workers do not reconstruct context from Git history.
45. Migration converts unfinished work only. Existing terminal canonical evidence stays unchanged and valid; no version/history reconstruction.
46. Multi-task features declare an acceptance task depending on all implementation tasks. Its plan covers the whole feature; only its delivered receipt closes the feature. A single-task feature uses that task as its acceptance task.

API, publication, failure handling and commands are specified in [Jev integration](jev.md).
