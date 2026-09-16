# BB-026 — Stateful research continuation

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness preserve a concrete research investigation across arbitrary fresh sessions using the Blackboard and referenced artifacts already present in the Agentic Application, while making experiment completion and evidence freshness explicit enough that work is not silently repeated or promoted from stale evidence?

This research evaluates a concrete consumer. It does not assume a generic research runtime, notebook service, workflow DSL or autonomous architecture process is required.

## Current source-backed pressure

The project already has the pieces needed to carry durable research state:

- Blackboard checkpoints can persist arbitrary JSON-safe continuation cursors plus artifact/evidence refs;
- `SessionHandoffSurface` exposes the checkpoint, work lifecycle and referenced artifacts to a fresh session;
- project identity and user intent already survive session restart;
- BB-022 defines evidence classes and requires exact implementation/task/policy provenance for meaningful evaluation;
- living knowledge/decision artifacts already distinguish evidence from promoted decisions.

What is not demonstrated by those primitives alone is one concrete lifecycle:

```text
question
-> competing hypotheses
-> experiment plan
-> partial experiment
-> fresh session
-> resume only unfinished experiment
-> implementation/source revision changes
-> reassess evidence validity
-> retain stale/contradictory evidence
-> submit conclusion
-> independent review
```

The project review explicitly identified this as the BB-026 research opportunity. Existing primitives are necessary, but without a consumer convention a fresh session cannot know which experiment is complete, which experiment should resume, or whether evidence bound to an older revision remains current.

## Existing runtime boundary

The relevant public Application behavior is already sufficient for durable lifecycle transport:

```text
ApplicationOrchestrator.checkpoint(...)
  -> checkpoint JSON
  -> artifactRefs[]
  -> evidenceRefs[]
  -> REOPENED | BLOCKED

SessionHandoffSurface.read()
  -> projectId
  -> durable intent
  -> lifecycle.eligibleWork[]
  -> checkpoint
  -> referenced artifacts/evidence
```

No research semantics are built into the generic Blackboard, and this research does not recommend adding them there.

The Blackboard should not become the research notebook. It remains lifecycle state and a continuation cursor.

## Probe

Runnable probe:

```text
node docs/living/knowledge/bb026-stateful-research-probe.mjs
```

Checked expected result:

```text
artifacts/bb026-stateful-research-probe.json
```

Evidence class:

```text
DETERMINISTIC_REFERENCE
productionEvidence = false
```

The probe uses the current public `createApplicationOrchestrator`, `createJsonBlackboardStore` and `createSessionHandoffSurface` APIs plus a local durable artifact directory.

It exercises three fresh application sessions and two source revisions.

### Session A

Artifacts hold:

- Q1 research question;
- H1/H2 competing hypotheses;
- experiment E1 completed at `source-rev-a`;
- experiment E2 interrupted at `source-rev-a`;
- evidence ledger V1 with EV1 bound to its source revision/scope.

The Board checkpoint stores only the continuation manifest fields:

```text
version
kind = RESEARCH_CONTINUATION
researchId
questionRef
planRef
evidenceLedgerRef
experimentRefs[]
activeExperimentId
sourceRevision
nextAction
```

Hypothesis text, experiment procedure and observation payload are not copied into the Board.

### Session B

A new Orchestrator/SessionHandoff instance reads the same durable Board.

Observed continuation contract:

```text
E1 = COMPLETED -> do not rerun
E2 = IN_PROGRESS + activeExperimentId -> resume E2
```

The simulated implementation revision then changes from `source-rev-a` to `source-rev-b` for a source scope used by EV1.

EV1 is not deleted or rewritten into success. The next evidence-ledger version preserves EV1 as:

```text
status: STALE
invalidatedBy:
  fromRevision: source-rev-a
  toRevision: source-rev-b
  reason: source scope changed between research sessions
```

E2 completes at the new revision and produces EV2. EV2 records an explicit contradiction link to EV1 rather than erasing it.

### Session C

A third fresh session reconstructs both experiments as completed and has no active experiment to replay.

The research result is then submitted with:

```text
decisionStatus = PROPOSED
```

The Blackboard remains:

```text
PENDING_REVIEW
```

and an independent `research-workflow` review requirement is added. There is no automatic `DONE` transition and no automatic decision promotion.

## Measured fixture result

The checked artifact records:

```text
freshSessions                         = 3
completedExperimentReplayCount        = 0
resumedInterruptedExperimentCount     = 1
staleEvidenceRetainedCount            = 1
contradictionLinksRetainedCount       = 1
boardEmbeddedWorkProductCount         = 0
automaticDecisionPromotionCount       = 0
finalBoardStatus                       = PENDING_REVIEW
finalDecisionStatus                    = PROPOSED
```

All five bounded continuation assertions are true:

```text
Board stores lifecycle + refs only
completed experiments are not repeated
interrupted experiment is resumed
stale evidence remains inspectable
research cannot self-accept
```

These values are fixture evidence about the continuation contract. They do not establish research quality, production storage reliability or production effectiveness.

## Result

The probe does **not** justify a dedicated research runtime.

Existing Application primitives are sufficient transport/lifecycle mechanisms for this concrete consumer:

```text
Blackboard = lifecycle + cursor + refs
artifacts  = hypotheses + experiment states/results + evidence ledger + research result
```

The missing boundary is narrower: a **versioned research-continuation manifest and evidence-freshness convention** for the concrete research consumer.

The manifest needs to make the following explicit:

```text
research id
question/plan refs
experiment refs
active experiment id or null
current source/policy revision
evidence-ledger ref
next action
manifest version
```

An experiment artifact needs at least:

```text
id
status = PLANNED | IN_PROGRESS | COMPLETED | INVALIDATED
input/source/policy revision
resume provenance when applicable
result/evidence refs when completed
```

An evidence ledger entry needs at least:

```text
id
status = OBSERVED | CONFIRMED | CONTRADICTED | STALE | SUPERSEDED
source/policy revision and relevant scope
observation ref/summary
supports[]
contradicts[]
invalidatedBy when stale/superseded
```

The exact vocabulary may be narrowed during implementation, but freshness and state must not be inferred from file existence or prose ordering.

## Freshness rule

Evidence validity is not simply:

```text
artifact exists -> valid
```

The consumer must compare the evidence's declared source/policy identity with the research continuation's current identity.

When a relevant source/policy scope changes:

```text
prior evidence remains inspectable
+ freshness is explicitly reassessed
+ affected evidence becomes STALE/CONTRADICTED/SUPERSEDED as appropriate
+ it cannot silently satisfy the current conclusion
```

Unchanged scopes need not be invalidated merely because an unrelated repository revision changed. BB-027 should therefore use explicit provenance/scope rather than treating every commit change as universal invalidation.

## Completion and acceptance boundary

Research work has at least three distinct states that must remain separate:

```text
experiment completed
research submission completed
architecture decision accepted
```

The first does not imply the second; the second does not imply the third.

A research producer may produce a `PROPOSED` conclusion and submit it. Acceptance remains owned by independent review/decision promotion according to the ordinary Agentic Application authority boundary.

This is important for BB-034/035: a grounded reflection or self-upgrade experiment can use this continuation convention, but the experiment cannot rewrite its evaluator, acceptance threshold, user objective, review requirement or rollout authority.

## BB-027 implementation handoff

Implement the smallest concrete research consumer before introducing any shared framework.

Recommended scope:

1. define and validate one `RESEARCH_CONTINUATION v1` manifest shape;
2. define experiment-state and evidence-ledger parsing/validation for the BB-026 consumer;
3. provide a bounded resume operation that resolves refs and returns:
   - completed experiments to skip;
   - exactly one active/incomplete experiment to resume, when present;
   - evidence that requires freshness reassessment;
4. require explicit source/policy revision comparison before evidence is current;
5. persist updated artifact refs through the existing Blackboard checkpoint API;
6. leave the generic Blackboard schema and Core lifecycle unchanged;
7. exercise restart, interrupted experiment, source-revision change, contradictory evidence and final `PENDING_REVIEW` submission.

A no-runtime-extension implementation is acceptable if the concrete application helper/schema enforces these semantics. Do not create a generic research engine, registry or workflow DSL from this one consumer.

## Compatibility and adoption

The proposed convention is additive:

- existing Blackboard checkpoint callers remain unchanged;
- non-research work does not need the manifest;
- research artifacts remain external refs;
- the first consumer can be opt-in;
- rollback removes the research helper/convention without changing Core or generic Board authority.

BB-041 separately owns JSON-safe checkpoint persistence. BB-039 separately studies artifact content identity/retention. BB-026 assumes the checkpoint/artifact bytes supplied by those lower boundaries can be durably retrieved; it owns research continuation semantics, not storage implementation.

## Limitations

- deterministic local artifact store and JSON Blackboard only;
- no concurrent research writers;
- no production artifact-retention evidence;
- no production research-effectiveness claim;
- source-revision invalidation is exercised on one declared affected scope;
- no architectural decision is accepted by this research artifact itself.

## Conclusion

For the concrete stateful-research consumer, ExHarness does not need a new research runtime before continuing.

It needs a small, explicit continuation contract over existing primitives:

```text
checkpoint cursor
+ immutable/versioned work-product refs
+ experiment state
+ revision-scoped evidence freshness
+ independent acceptance
```

That is the bounded implementation target for BB-027.
