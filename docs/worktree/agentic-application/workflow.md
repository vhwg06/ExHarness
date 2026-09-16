# Agentic Application current workflow

## Backend

```text
parse objective
 -> make BackendWorkOrder
 -> resolve declared repository files once
 -> execute BackendWorker through ExHarness
 -> ground result/evidence from committed lineage + verification artifacts
 -> BackendCompletionPolicy
```

Deterministic evidence failure/missing/inconclusive paths stay in application code. `BackendAdvisor` is invoked only for the source-implemented semantic-gap condition after required objective checks pass.

When process-crash recovery is required, the concrete Backend Worker may use `createJsonBackendSessionStore(...)` so its Core session and AVO action-effect journal survive process reconstruction.

## Accepted Backend -> QA

```text
Backend ACCEPT
 -> create ref-only BackendQaHandoff
 -> create QaWorkOrder selecting required artifact paths
 -> resolve declared application artifacts once
 -> execute non-mutating QaWorker through ExHarness
 -> ground behavior/regression evidence
 -> QaCompletionPolicy
```

If Backend is not accepted, QA is not dispatched.

`runBackendThenQaObjective(...)` still provides this as a direct one-session composition. Cross-session execution uses the durable workflow below.

## Durable Backend -> QA workflow

Canonical durable composition is:

```text
createDurableBackendQaWorkflow(...)
 -> initialize(itemId, owner, backendObjective, qaObjective)
      -> validate objectives
      -> claim item and receive claimGeneration
      -> persist BACKEND_PENDING checkpoint under exact {owner, generation}
      -> release claim as REOPENED

fresh/current session
 -> advance(itemId, owner)
      -> claim exact item
      -> receive next claimGeneration
      -> execute exactly one durable stage
      -> checkpoint/submit only with exact {owner, generation}
```

State transitions:

```text
BACKEND_PENDING
  |
  | Backend ACCEPT
  v
QA_PENDING
  |
  +-- QA artifact/context failure --> BLOCKED
  |                                   |
  |                                 resume
  |                                   |
  +<----------------------------------+
  |
  | QA issues
  v
BACKEND_REMEDIATION_PENDING
  |
  | remediation objective derives from
  | last accepted revision + grounded QA issues
  v
QA_PENDING
  |
  | QA ACCEPT
  v
final Blackboard submission
  |
  v
PENDING_REVIEW
  |
  +-> PM/project coordination may require concrete review
```

The persisted checkpoint carries the validated workflow spec plus only the continuation state required by the current stage. Accepted Backend -> QA continuation carries the existing ref-only handoff and Backend acceptance-decision provenance rather than artifact payloads.

QA issues do not silently invalidate or rewrite the accepted revision. They create explicit remediation work; the remediation Backend objective uses the accepted revision as its repository base. A new accepted Backend result replaces the QA handoff with the new revision before QA runs again.

Artifact/context lookup failure does not discard progress. The item becomes `BLOCKED` with its `QA_PENDING` checkpoint intact. `resume(...)` returns it to `REOPENED`, and a later session retries the same durable stage.

`cancel(...)` supersedes unfinished work. Superseding claimed work increments its generation so an abandoned executor cannot later commit against the superseded item.

QA role acceptance is not Blackboard acceptance. Successful QA clears the partial checkpoint and creates a final submission with Backend/QA decision refs and artifact refs. It does **not** fabricate `source: WORKER` for application review. If project completion requires review, PM/project coordination must use the distinct PM review-requirement path.

## Interrupted execution recovery

A process dying after application claim leaves the item `CLAIMED` with its last durable workflow checkpoint and current claim generation.

```text
CLAIMED generation N
 -> recoverInterrupted(itemId, owner)
 -> Orchestrator.recoverClaim(...)
 -> CLAIMED generation N+1
 -> old attempt is fenced before replacement work continues
```

Generation takeover answers only **who may commit**. The current stage then decides whether execution itself is safe to continue.

### Interrupted QA

`QA_PENDING` is non-mutating at the application environment boundary:

```text
recover claim -> generation N+1
 -> reuse exact persisted accepted Backend handoff
 -> resolve declared QA artifacts
 -> rerun QA
 -> ordinary QA completion policy
 -> checkpoint/submit under generation N+1
```

A late QA result from generation N cannot commit application state.

### Interrupted Backend

`BACKEND_PENDING` and `BACKEND_REMEDIATION_PENDING` are mutating and therefore compose application fencing with durable Core effect truth.

```text
recover claim -> generation N+1
 -> resolve exact Backend WorkOrder + Context
 -> load durable Backend Core session/effect journal
 -> reconcile interrupted effect state
 -> only then continue or block
```

Current recovery cases are:

```text
no persisted Core session + store supports durable recovery
 -> normal fresh Backend execution

no persisted Core session + volatile/unknown recovery authority
 -> BLOCK
 -> absence is not proof that an external effect did not happen

confirmed effect + Core candidate still at effect base
 -> close interrupted variation
 -> replay same strategy on same session
 -> same semantic action key
 -> effect journal returns confirmed result
 -> no external redispatch
 -> ordinary lineage/evidence/completion policy

ambiguous IDEMPOTENT effect
 -> Core reconciliation prepares RETRY
 -> same action key is reused
 -> ordinary Backend completion continues after confirmed retry

UNKNOWN / NON_RECONCILABLE effect
 -> BLOCK
 -> no blind redispatch

multiple persisted mutation effects
or candidate diverged from effect base
or candidate already advanced but Worker semantic result was not durably committed
 -> BLOCK / require reassessment
 -> do not fabricate BackendWorkResult
```

Recovery success is not Backend acceptance. Any reconstructed normal Backend result still passes the same mutation/typecheck/tests/artifact evidence and completion policy.

## Durable Blackboard lifecycle

```text
READY / REOPENED
 -> Orchestrator.claim(...)
 -> CLAIMED with claimGeneration N
 -> either checkpoint partial work using N
      -> REOPENED | BLOCKED
    or submit final work using N
      -> PENDING_REVIEW

interrupted CLAIMED
 -> Orchestrator.recoverClaim(...)
 -> CLAIMED with claimGeneration N+1
 -> stale N writes rejected

PENDING_REVIEW
 -> project/PM may add required review
 -> Orchestrator.beginReview(...)
      -> increment reviewGeneration
      -> freeze exact review target subject including generation
 -> REVIEWING

interrupted REVIEWING
 -> Orchestrator.recoverReview(...)
 -> increment reviewGeneration
 -> freeze replacement exact target
 -> abandoned review bundle becomes stale

REVIEWING
 -> reviewer produces grounded Core trust bundle
      EvidenceArtifact[] + DecisionArtifact + Attestation
 -> Orchestrator verifies bundle outside Board transaction
 -> transaction re-checks same active review target/generation
 -> apply trusted decision verdict
      |
      +-> all required ACCEPTED + no remaining work -> DONE
      +-> REJECTED / INCONCLUSIVE -> REOPENED
      +-> ACCEPTED but remaining current work -> REOPENED
      +-> other required review remains -> PENDING_REVIEW
```

The Orchestrator does not accept a naked caller-provided review verdict. Review decision/evidence/signature/authority must pass the application-provided trust policy over the exact active review target.

Review requirements may be Worker-requested when a real Worker raises that need or PM-required separately. `createDurableBackendQaWorkflow(...)` does not impersonate either source after QA completion. Current source implements a bounded application-local PM/SA coordination slice for proposal/assessment/context/review-requirement handling, but still has no generic horizontal-role runtime or concrete vertical reviewer Worker implementation.

Elapsed time or a future lease/heartbeat signal may indicate suspected liveness failure, but current recovery requires an explicit transition. Time alone does not transfer correctness authority or prove effect outcome.

## Bounded PM / SA coordination workflow

Horizontal coordination is opt-in and project-bound:

```text
fresh/current session
 -> reconstruct ApplicationOrchestrator + session handoff
 -> createPmSaCoordinationController(...)

SA path
 -> prepareSaContext(target, architectureFacts, evidenceRefs)
      -> reject evidence not currently linked to target
 -> produce evidence-bound SA architecture assessment
 -> persist assessment artifact
 -> assessment is proposal/judgment state only

PM path
 -> preparePmContext(target, coordinationFacts, relevant work, optional SA ref)
      -> reject SA assessment for different work
 -> produce PM proposal bound to exact target lifecycle tuple
 -> validate project/root/target/evidence semantics
 -> persist content-addressed proposal artifact
 -> if proposalRef already linked on target: return completed replay
 -> otherwise Orchestrator.extendWorkGraph(...)
      -> re-check exact expected target inside transaction
      -> atomically apply work/dependencies/refs/evidence/blockers/PM review requirements
      -> validate complete dependency graph
```

The PM proposal may add fresh prerequisite work and dependency edges only for the current target or work created by that proposal. Fresh work must start without prior claim/review/checkpoint/submission/follow-up history. A blocker may link existing unresolved work instead of inventing replacement work. PM review requirements are part of the same canonical transaction as the proposal's graph and blocker effects, so a process cannot publish the graph while losing the review obligation.

PM cannot rewrite user intent or issue architecture/completion/review verdicts. SA cannot own dependency, priority, timeline or lifecycle mutation. Neither role writes Board state directly.

SA assessments must reference evidence currently linked to the exact target. PM proposals bind `{itemId, status, claimGeneration, reviewGeneration}`. Controller-side validation narrows the proposal, but correctness fencing happens again inside the Orchestrator transaction: if the target changes between validation and mutation, the proposal fails before canonical state is published. A no-op proposal is also freshness-checked and does not publish a proposal artifact.

For mutating proposals, the content-addressed proposal artifact can exist before canonical application. It becomes continuation-relevant only when its exact ref is linked to the target in the same atomic Blackboard transaction as all proposal effects. If that transaction fails, the artifact is orphaned and is not lifecycle truth. If an exact later retry observes the proposal ref already linked, it returns `replayed: true` rather than reapplying the original target tuple after status changed.

Fresh-session coordination recovery reads the project handoff, collects only PM/SA artifact refs already linked from Blackboard and dereferences those refs through the concrete coordination artifact store. Conversation history is not required.

## Fresh-session handoff

Canonical handoff-safe bootstrap is:

```text
user-defined idea / objective / bullets / constraints
 -> defineUserIntent(...)
 -> createSessionHandoffSurface(...).initialize(...)
 -> durable intent root + initial Blackboard work
```

A later session does not need prior conversation state:

```text
fresh session
 -> reconstruct ApplicationOrchestrator from the durable Board store
 -> createSessionHandoffSurface(...).read()
 -> recover user intent
 -> recover work graph, generations, active review and current checkpoints
 -> recover lifecycle buckets and artifact/evidence refs
 -> resolve only the refs needed for the next work context
 -> continue
```

The handoff projection exposes:

```text
intent
workGraph[*].claimGeneration
workGraph[*].reviewGeneration
workGraph[*].activeReview
workGraph[*].checkpoint
workGraph[*].checkpointedBy
lifecycle.eligibleWork
lifecycle.claimedWork
lifecycle.pendingReview
lifecycle.reviewing
lifecycle.pendingReconciliation
lifecycle.blocked
lifecycle.done
lifecycle.superseded
references.artifacts
references.evidence
```

The intent root is excluded from ordinary work buckets. A Board with no durable intent root, multiple intent roots or untraceable work fails closed as not handoff-safe.

Legacy `orchestrator.seed(...)` remains available for existing tests/low-level Board construction; it does not by itself establish session-handoff safety.

## Follow-up reconciliation

```text
grounded finding(summary + sourceRef)
 -> CURRENT_WORK   -> reopen/narrow current item
 -> EXISTING_WORK  -> link existing Board item
 -> NEW_WORK       -> create child with parent/finding/source provenance
 -> NON_ACTIONABLE -> no Board work
```

Review failure that proves the current obligation is still unresolved does not create a replacement item.

## Persistence and concurrency

`createJsonBlackboardStore(...)` exposes read + transaction over an immutable single-successor revision chain.

```text
resolve committed revision rN
 -> run mutator against exact snapshot rN
 -> write complete successor record to unique temp file
 -> atomically hard-link successor for rN
      |
      +-> link succeeds: commit rN+1
      +-> successor already exists: explicit transaction conflict
```

A new `ApplicationOrchestrator` instance resolves the same committed chain and restores checkpoints, submissions, generations, active reviews and requirements. Concurrent local writers from one base revision cannot both publish; one successor wins and stale writers fail before replacing committed state.

Opaque revision tokens identify chain positions. Snapshot digests validate the exact base content but do not define revision identity, so later state may legitimately repeat an earlier snapshot value.

Legacy `.lock` age is not correctness authority. The public store does not trust or delete legacy lock files, and `lockStaleMs` does not authorize takeover. A successor record that was atomically published remains authoritative across process interruption even if the publishing call did not return.

Async review trust verification still happens outside the Board mutation transaction; if another mutation wins before assessment commit, the later store publication fails on its stale base revision. The Orchestrator also re-checks the active review target/generation inside its mutator before publication.

`createJsonBackendSessionStore(...)` is separate concrete Backend execution/effect persistence. It is revision-aware and declares `supportsDurableRecovery: true`; that explicit authority is required before absence of a persisted Core session can authorize fresh Backend execution during recovery.

Neither local JSON store is a distributed consensus/lease mechanism. The Backend store does not provide exactly-once effects; replay safety still comes from Core effect operation state and declared replay policy.

Application checkpoint persistence is not external-effect reconciliation. A crash between an external effect and durable Core proof is handled through the concrete Backend composition over existing Core effect reconciliation primitives; application stage, claim generation or elapsed time alone must not be used to infer effect completion.

## Context rules

- repository and application-artifact context are resolved explicitly before execution/recovery;
- source payload is not hidden in a provider/session lifecycle;
- Oracle does not widen semantic scope;
- source refs/provenance survive into validated context;
- serializer/dereference responsibilities remain separate;
- conversation history is not project lifecycle state;
- Blackboard tracks lifecycle and refs, while actual work products remain external artifacts.

## Completion rules

Worker prose is not completion authority. Role completion is derived from structured results plus grounded role-specific evidence and application policy.

Backend acceptance authorizes creation of the QA handoff; QA acceptance authorizes a final application submission. Neither role-local decision directly authorizes Blackboard `DONE` or a fabricated review requirement.

Interrupted recovery only restores bounded execution authority. It cannot promote a candidate, manufacture Worker semantic results, bypass role evidence or authorize Blackboard completion.

Blackboard problem completion remains a separate boundary: required review/acceptance obligations and unresolved current-work findings must be reconciled first.
