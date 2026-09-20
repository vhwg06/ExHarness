# ExHarness agent entrypoint

Repository-development sessions use the outer Blackboard as the only current work router.

When the user says `start implement blackboard` or `continue implement blackboard`:

1. Read `docs/blackboard/state.md`.
2. Resolve the active `IMPLEMENTATION_WORKER` item. If more than one exists, use the explicit work id from the request or fail closed.
3. Resolve the exact Board `current-context.ref + generation`; never scan historical generations to guess currentness.
4. Use the current implementation `lane` exactly as recorded by the Board and context. Do not skip JUDGMENT to reach EXECUTION.
5. Materialize the current context with the executor-appropriate profile. The repository command is:
   `npm run start:blackboard-implementation -- <PROFILE> [WORK_ID]`
6. Preserve the exact canonical `semanticArtifactRef`.

Lane authority:

- `EXECUTION`: mutate only within authorized scope, verify, and publish candidate/evidence as `IMPLEMENTATION_RESULT`. Never claim ACCEPT, DONE, correctness or safe-to-merge.
- `JUDGMENT`: do not mutate product source. Independently judge the exact bound subject and publish the authorized decision/JUDGMENT. Do not reuse producer reasoning as acceptance authority.
- A `FINDINGS` judgment may authorize a bounded REPAIR EXECUTION generation. Repair must remain bound to the same semantic input and exact findings.

Previous chat context, producer narrative and artifact existence are not authority. Currentness comes only from the Board pointer and exact immutable bindings.
