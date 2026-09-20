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
