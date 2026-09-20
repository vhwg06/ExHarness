# Outer Blackboard contracts

Status: **PROMOTED FOR REPOSITORY DEVELOPMENT COORDINATION**

## Namespace boundary

1. `docs/living/*` owns current-system truth and durable project knowledge.
2. `docs/blackboard/*` owns development state, context routing, work products and operational history.
3. Blackboard may reference Living Docs but must not duplicate current capability/architecture semantics.
4. Active work, blockers, next actions and pipeline stages must not be embedded in Living Docs.

## Fresh-session invariants

5. Every active work item has an explicit `pipeline`, `stage`, `status` and exact `current-context.ref + generation`.
6. A fresh session selects a work item, resolves its exact context, and loads only declared required refs.
7. Previous conversation/model context is never required for project-critical continuation.
8. `auditRefs` are lazy history/challenge inputs and do not widen normal execution context.
9. Missing/mismatched current-context binding fails closed; generation files are never scanned to guess currentness.
10. Multiple active items are valid. Tooling verifies every active binding by default or requires an explicit work id; it never silently chooses the first item.

## Pipeline invariants

11. Exactly two development pipeline families are defined: `RESEARCH_SA` and `IMPLEMENTATION_WORKER`.
12. Research/SA owns problem investigation, evidence, architecture synthesis and creation of implementation input.
13. Research/SA does not mutate product source as part of its normal lane.
14. The normal terminal handoff of Research/SA is an accepted `IMPLEMENTATION_INPUT` artifact under `docs/blackboard/artifacts/*`.
15. Implementation/Worker consumes an accepted implementation input plus bounded Living Docs/source/test refs.
16. Worker does not silently redefine architecture/requirements. A grounded architecture gap returns to Research/SA as new work.
17. Implementation completion that changes current system semantics reconciles `docs/living/system/*` before the durable checkpoint is review/merge complete.

## Context / authority invariants

18. `WORK_CONTEXT_SPEC` generations are immutable development-context snapshots.
19. REVIEW contexts are read-only for product source and bind an immutable review target.
20. IMPLEMENT contexts require an exact accepted parent review decision and bounded source write scope.
21. Context declares inputs/action/scope; source/tests remain implementation truth and accepted review evidence remains acceptance authority.
22. Currentness comes only from the Board pointer, never artifact existence.
23. Historical generations remain audit evidence after the Board pointer advances.

## Migration boundary

24. BB-046/BB-047 context generations are historical pre-migration artifacts; embedded old path strings remain provenance.
25. BB-048 is the first in-flight item rebound onto the new `docs/blackboard/*` context router.
26. Newly allocated implementation work after this migration requires an explicit implementation-input artifact from the Research/SA boundary.
27. Existing Living Docs knowledge through terminal BB-047 is not semantically rewritten by this migration.

## Semantic artifact invariants

28. **Artifact is semantic, not procedural.** Canonical `IMPLEMENTATION_INPUT` records WHAT must become true, WHY it matters, required behaviors, invariants, acceptance criteria and semantic scope. It does not prescribe edit order, commands, prompts or model behavior.
29. **Machine-readable canonical input.** New `IMPLEMENTATION_WORKER` contexts bind one accepted JSON `IMPLEMENTATION_INPUT` through `semanticArtifactRef`.
30. **Exact three-way binding.** The Blackboard `implementation-input.ref`, the current `WORK_CONTEXT_SPEC.semanticArtifactRef` and the resolved artifact path must be identical.
31. **Semantic acceptance is separate from implementation authority.** An accepted implementation input authorizes the meaning of the requested change; an IMPLEMENT context still requires its exact review/decision authority.
32. **Execution details live in context.** Source scope, write scope, verification checks, entrypoints and repair bounds belong to `WORK_CONTEXT_SPEC` or its materialized executor projection, never to the canonical semantic artifact.
33. **Executor capability cannot rewrite meaning.** Rich coding agents, generic interactive sessions and weak bounded harnesses may receive different context projections, but each projection carries the same semantic artifact unchanged.
34. **Repository gate.** Invalid semantic artifacts, missing implementation artifact bindings or Board/context/artifact mismatches fail `npm run verify:blackboard-context`.

## Implementation execution / judgment invariants

35. `IMPLEMENTATION_WORKER` is one development pipeline with two authority lanes: `EXECUTION` and `JUDGMENT`. They are not separate project pipelines.
36. Every current `IMPLEMENTATION_WORKER` context and Board item declares the exact current `lane`; Board lane and context lane must match.
37. `EXECUTION` requires an `IMPLEMENT` action. It may mutate only within bounded source authority and may publish an `IMPLEMENTATION_RESULT` containing candidate identity, verification runs, evidence and observed facts.
38. `IMPLEMENTATION_RESULT` is producer evidence, not correctness authority. Its schema forbids verdict/accepted/correct/done/safe-to-merge style claims.
39. `JUDGMENT` requires a read-only `REVIEW` action. Candidate judgment independently evaluates the exact semantic input, implementation result, candidate revision, evidence, acceptance criteria and invariants.
40. Candidate judgment requires exact `Board implementation-result.ref == WorkContextSpec.implementationResultRef` and exact result subject binding to work id, semantic input and candidate.
41. The producer context and candidate-judgment context must be different immutable generations. Producer reasoning is not acceptance authority.
42. `JUDGMENT/READINESS` may authorize the first bounded `EXECUTION/INITIAL` generation. `JUDGMENT/CANDIDATE` evaluates an implementation candidate; the two judgment subjects are distinct.
43. A `JUDGMENT` with `FINDINGS` may authorize only a bounded `EXECUTION/REPAIR` generation bound to that exact judgment and candidate. `ACCEPT` cannot be reused as repair authority.
44. Artifact existence is not completion. `IMPLEMENTATION_RESULT != JUDGMENT`, and a judgment artifact does not mutate canonical Board lifecycle by itself.
45. `start implement blackboard` and `continue implement blackboard` are bootstrap intents, not lane overrides. A fresh session must resolve the current Board item/context and obey its current lane.


## Semantic input queue invariants

46. **Queued implementation input is not active work.** An accepted `IMPLEMENTATION_INPUT` may exist without a Blackboard work item, active debt, owner, lane or current context.
47. **Queue does not allocate identity.** Creating an accepted semantic input does not consume the next Blackboard work id; work identity is assigned only when a grounded trigger allocates implementation work.
48. **Queue does not authorize mutation.** Accepted semantic meaning remains distinct from repository implementation authority; source mutation still requires the exact current `IMPLEMENTATION_WORKER / EXECUTION` context and its authority binding.
49. **Queue order is non-semantic.** File ordering or creation time does not establish implementation priority or dependency order.
50. **Allocation binds exactly one semantic subject.** A newly allocated Implementation/Worker item names the exact accepted implementation-input ref it consumes; it does not reconstruct meaning from research history.
51. **Stale premise fails closed at allocation.** If current-system truth materially contradicts a queued semantic input before allocation, the item returns to Research/SA for bounded reconciliation rather than being silently reinterpreted by Worker execution or judgment.
