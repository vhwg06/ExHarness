# Decision/outcome summary pilot — current state

The Agentic Application now has one **opt-in Backend/QA pilot** for materializing a bounded `DECISION_OUTCOME_SUMMARY` from already-persisted Core cognition/effect artifacts.

This is a concrete application composition, not a new Core primitive or correctness authority.

## Current public surface

```text
createDecisionOutcomeBackendQaPilot(...)
createJsonDecisionOutcomeSummaryStore(...)
verifyDecisionOutcomeSummary(...)
```

The pilot requires three explicit dependencies:

```text
chainProvider.resolve(...)
  -> semantic refs for the producer's existing decision/outcome chain

artifactResolver.readArtifact({ ref })
  -> exact persisted Core/application artifacts behind those refs

summaryStore.put/read(...)
  -> immutable content-addressed DECISION_OUTCOME_SUMMARY payloads
```

The pilot does **not** generate deliberation, ActionIntent, evaluation, INTENT, REFLECTION, grounding or alignment artifacts. Their producer remains responsible for creating and persisting them under their existing Core contracts.

## Backend/QA submission composition

The pilot decorates the existing Application Orchestrator rather than changing the generic Backend/QA workflow contract.

```text
Backend/QA QA_ACCEPT
  -> decorated orchestrator.submit(QA_COMPLETED)
      -> chainProvider.resolve(itemId, submission)
      -> artifactResolver resolves exact underlying artifacts
      -> validate cross-artifact relations and authority invariants
      -> pin every resolved artifact by digest
      -> persist immutable DECISION_OUTCOME_SUMMARY
      -> inject decisionOutcomeSummaryRef into QA_COMPLETED submission
      -> include the same ref in submission.artifactRefs
      -> normal ApplicationOrchestrator.submit(...)
```

If summary materialization fails, the decorator calls the existing generation-fenced `orchestrator.block(...)` before surfacing the error. A bad/missing/stale chain therefore does not leave the Board ambiguously `CLAIMED` and does not create a reviewable submission.

## Summary authority

A summary is a bounded orientation/index artifact only.

```text
rationale != correctness evidence
summary != action authorization
summary != project acceptance
summary != Blackboard transition authority
```

The summary carries exact source pins for:

- Deliberation;
- ActionIntent;
- confirmed effect operation;
- post-action evaluation;
- active INTENT memory;
- active REFLECTION memory;
- grounding artifact;
- intent/reflection alignment;
- explicit counterevidence refs.

Each pin contains the semantic ref plus a digest of the resolved payload at materialization time. Cross-artifact relation checks use exact semantic identity: kind, id and normalized revision must all match, so a missing revision cannot act as a wildcard for a revision-qualified authoritative ref.

The current pilot requires the ActionIntent to be `EXECUTED`, authorized with `ALLOW`, linked to a `CONFIRMED` effect, and linked consistently back to its Deliberation. Reflection/grounding/alignment must all include the selected post-action evaluation, and non-success outcomes must retain that evaluation as counterevidence.

## Fresh-session review path

`createApplicationArtifactReader(fallbackReader)` recognizes only `decision-outcome://...` refs. Other application artifacts continue through the supplied fallback reader.

For a decision/outcome ref it:

```text
read immutable summary
  -> re-resolve every exact source ref
  -> verify each payload digest against the stored pin
  -> re-check Deliberation <-> ActionIntent <-> effect relations
  -> re-check evaluation/reflection/grounding/alignment relations
  -> re-derive correctness-relevant summary fields
  -> reject any copied field that conflicts with resolved evidence
  -> return the verified summary payload
```

Because the JSON summary store is durable, a fresh process can reconstruct the same bounded review input without relying on previous conversation/session memory.

Changing or removing an underlying artifact after materialization fails closed during fresh-session read. The copied summary cannot launder a newer/stale/contradictory source payload into project acceptance.

The existing Backend/QA project-acceptance controller already dereferences every `submission.artifactRefs` entry through its application artifact reader. Supplying the pilot reader therefore makes exact summary verification part of review preparation without widening reviewer or Orchestrator authority.

## Persistence

`createJsonDecisionOutcomeSummaryStore({ path })` stores immutable content-addressed JSON payloads using a `decision-outcome://<sha256>` ref.

The store validates the summary digest on write/read and accepts an already-existing digest only when canonical content is identical.

This store contains summary payloads only. It is distinct from:

- Blackboard lifecycle persistence;
- Backend Core session/effect persistence;
- trust-artifact persistence;
- underlying cognition/effect/application artifact stores.

## Current limitations

- This is one Backend/QA pilot; no generic `DecisionOutcomeGraph`, registry, lifecycle facade or Core schema is introduced.
- The producer must already persist the exact Core chain and provide refs through `chainProvider`; the pilot does not fabricate missing cognition.
- The pilot establishes deterministic fixture/integration correctness only. It does not establish production effectiveness, improved model reasoning or lower review cost.
- Summary orientation is not sufficient for acceptance. The review path must resolve the pinned underlying artifacts every time correctness-relevant fields matter.
