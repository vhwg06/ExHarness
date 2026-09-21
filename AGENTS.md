# ExHarness agent entrypoint

Use the outer Blackboard as the current work router for repository development.

1. Read `docs/blackboard/state.md`, then resolve the exact Task in canonical `docs/blackboard/work-graph.json`.
2. If multiple tasks are active, require an explicit work id. Do not select by directory/history scans.
3. Outer `lane` is exactly `RESEARCH_SA` or `WORKER`; obey its current `phase`.
4. `currentContextRef` points to rebuildable `context/<TASK_ID>/current.json`. There are no generations or history chains.
5. Materialize with `npm run start:blackboard-implementation -- <PROFILE> [WORK_ID]`. The compatibility command supports both lanes.
6. Preserve exact upstream canonical ref and content hash. Recheck bindings before publication.

## Authority

- `RESEARCH_SA`: OBJECTIVE -> READY_IMPLEMENT_PLAN. Research may revise its current plan, never mutate product source or claim feature delivery. Only a current SATISFIED Jev readiness judgment makes the plan READY.
- `WORKER` execution/repair: implement the exact READY plan within its write scope and publish facts/evidence. Never redefine the plan or self-accept.
- `JUDGMENT` is a read-only phase, not a third lane. Jev owns semantic judgment. Deterministic validators check schema, binding, evidence and merge identity.
- Defect/evidence gaps return to worker repair. Plan/input contradictions return to research and revoke readiness.
- All acceptance claims must be SATISFIED. Confidence is telemetry, not an extra acceptance threshold.
- DELIVERED_FEATURE requires the evaluated candidate commit in main with the exact evaluated merge tree. Execution success and artifact existence are not delivery.

Current-only means one canonical artifact per semantic subject, including retained DONE delivery evidence. Correct current unfinished artifacts in place; never retrofit terminal work or resurrect old revisions.

For the initial BB-056 tooling migration, the user's explicit implementation instruction authorizes building this evaluator before it can judge itself. This does not authorize a fabricated Jev verdict, READY status, or delivery receipt. BB-056 must pass the real gates before convergence.
