# Project review: persistence, lifecycle and research continuation

Status: OBSERVED / RESEARCH INPUT; not an accepted architecture decision.

Reviewed source: `ad61a2b037b99384e16fdd5245ee04f43dc36083`.
Method: source inspection and isolated Node probes importing current public modules. Probes used injected in-memory filesystem/store adapters; no production project data was modified. Results below establish current behavior, not production incident frequency.

## R1: expired store lock permits a live writer to overwrite a committed update

Source: `packages/agentic-system/src/blackboard-orchestrator.js`, `lockIsStale`, `openMutationLock`, `withMutationLock`, `transact`.

Reproduction schedule:

1. Create the JSON store with an injected filesystem and `lockStaleMs: 100`.
2. Start transaction A against an empty snapshot, append item A, and pause its asynchronous mutator before save.
3. Advance the lock's recorded creation age beyond the threshold, representing a paused but still live writer.
4. Run transaction B, append item B, and let it commit.
5. Release transaction A and read the final snapshot.

Observed output:

```text
after second writer commits: [ 'B' ]
after first writer resumes: [ 'A' ]
```

Age is the only takeover check. The old owner neither verifies ownership before save nor checks lock identity before unlinking it. The lost committed update was reproduced; the related stale-owner unlink race is source-supported but was not separately exercised. Atomic rename does not prevent a stale snapshot from replacing a newer snapshot.

Disposition: BB-023. Separate from BB-016/017 work-item ownership: this is the lower-level store transaction exclusion boundary.

## R2: late finding reconciliation changes canceled work to DONE

Source: `blackboard-orchestrator.js`, `supersede`, `reconcileFinding`, `derivePostReviewStatus`.

Reproduction: load a normalized `PENDING_RECONCILIATION` item with a submission, an accepted required review and one undisposed finding; call `supersede` with a cancellation reason; then reconcile that finding as `NON_ACTIONABLE`.

```text
after cancel: SUPERSEDED
after late finding reconciliation: DONE
```

The probe used a synthetic, structurally valid post-review snapshot and the actual Orchestrator mutation APIs. It did not generate a new signed review bundle. `reconcileFinding` has no status guard and unconditionally derives a replacement status. A delayed reconciliation therefore overrides explicit cancellation.

Disposition: BB-024. Preserve terminal cancellation and prevent delayed reconciliation from creating child work after cancellation.

## R3: dependency graph validity is not checked at snapshot admission

Source: `blackboard-orchestrator.js`, `defineBlackboardSnapshot`; `session-handoff.js`, `dependenciesDone`.

Calls to `defineBlackboardSnapshot({ version: 1, items })` accepted both inputs:

```js
[{ id: 'A', work: 'a', status: 'READY', dependsOn: ['MISSING'] }]

[{ id: 'A', work: 'a', status: 'READY', dependsOn: ['B'] },
 { id: 'B', work: 'b', status: 'READY', dependsOn: ['A'] }]
```

Observed: `dangling: accepted`, `cycle: accepted`. Eligibility requires dependencies to be DONE; claim checks cannot repair these graphs. The validator checks duplicate item IDs but not dangling dependency edges or cycles. The admission behavior is reproduced; production occurrence is unknown.

Disposition: BB-025. Define graph validation and explicit recovery of already stored invalid snapshots without fabricating completed dependencies.

## R4: active review identity disappears from the handoff projection

Source: `session-handoff.js`, `workSummary`; `blackboard-orchestrator.js`, `beginReview`.

A snapshot with an intent root and a REVIEWING item carrying `activeReview: { key, reviewer, subject: { type, digest } }` was passed to `sessionHandoffFromBlackboard`. The result preserved its REVIEWING bucket but `lifecycle.reviewing[0].activeReview` was `undefined`.

The full Board still retains the review identity and target; this is a projection omission, not storage loss. A session relying on the handoff view must reread raw Board state to recover the scheduled reviewer and exact target.

Disposition: extend BB-016/017 rather than create a second review-resume workstream.

## Research opportunity: durable research continuation

Existing building blocks are generic checkpoint payloads, artifact refs, the evidence/judgment/audit/decision document model, project-bound handoff and the BB-022 evaluation protocol. These do not by themselves demonstrate a concrete research lifecycle with resumable experiments and evidence invalidation.

Proposed scenario: perform BB-016's failure-boundary investigation across two fresh sessions. Preserve the research question, competing hypotheses, experiment specification, implementation/policy revision, observed outcomes, rejected alternatives and next unresolved experiment as referenced artifacts. Change the implementation revision between sessions and require explicit reassessment of affected evidence.

The question is whether existing checkpoints plus artifact conventions suffice or whether this concrete consumer demonstrates a narrower missing contract. No dedicated research runtime or generic research framework is assumed necessary.

Disposition: BB-026 research, BB-027 conditional implementation. Research completion and architectural promotion remain separate acceptance boundaries.
