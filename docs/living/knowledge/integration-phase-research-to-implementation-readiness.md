# Integration phase roadmap

Status: **CURRENT ROADMAP**

This file is the single current Integration roadmap. Update it in place. Git history carries previous revisions; fresh sessions do not reconstruct older roadmap states.

## Current checkpoint

Delivered system boundaries:

```text
Integration A.1
  accepted obligation
    -> materialization authorization
    -> OrganizationWorkContract
    -> READY
    -> trusted principal
    -> execution-authority policy
    -> claim / release authority
    -> exact released organizational claim

Integration B
  exact released organizational claim
    -> DomainExecutionController
    -> ExecutionPolicy
    -> immutable ExecutionStrategyRef
    -> ExecutionAttemptHead / ExecutionAttemptBinding
    -> runtime attestation / outcome
    -> domain completion decision
    -> authoritative publication
```

The delivered Integration B boundary preserves:

- organization owns WHAT / WHO / execution authority;
- domain execution control owns HOW for one already-released claim;
- policy/strategy selection cannot choose another work item or domain;
- recovery reuses the same immutable attempt binding;
- runtime success, domain acceptance and authoritative publication remain separate;
- canonical publication is fenced against the current organization claim and domain write-authority subject;
- duplicate recovery converges on one logical publication.

Integration C (BB-052) is also delivered in the canonical work graph: cross-domain obligations, selective semantic invalidation and the BA -> SA executable handoff. Its current consolidated system refs are under `docs/living/system/agentic-application/`.

Current implementation input queue:

```text
Integration D — domain activation + parallel autonomy
Integration E/F — exact deployment identity + Product QA acceptance
Integration G — product completeness + closure currentness
```

These inputs are accepted semantic handoffs, not active work and not priority order by file position. `docs/blackboard/state.md` is the current delivery router.

Remaining phase proof after D–G:

```text
H — adversarial recovery
I — causal reconstruction / observe
J — one real evidence-gated execution-strategy evolution loop
```

## Product entry model

ExHarness does not need a runtime engine that invents a new organizational workflow from arbitrary project artifacts.

The product lifecycle may be explicit and versioned before execution:

```text
ProjectSeed
  goal
  lifecycleRef
  initialArtifactRefs[]   # may be incomplete
        |
        v
explicit product lifecycle
  product / PM
  BA
  SA
  FE + BE
  DevOps
  QA
  closure
```

The lifecycle defines responsibility, expected artifact kinds, completion semantics and bounded human-interaction points. It does not grant runtime scheduling authority.

The project artifact set may begin incomplete and evolve with the end user:

```text
initial artifacts
  idea.md
  requirement notes
  Figma/design
        |
        v
bounded domain workload
  consume what exists
  identify missing/ambiguous inputs for its own responsibility
  ask the end user only when authoritative clarification is required
  publish/supersede canonical product artifacts
        |
        v
next actionable domain workloads
        |
       ...
        |
        v
complete delivery evidence + ProductOutcomeClaim
```

Hard distinctions:

```text
explicit lifecycle
!= runtime workflow-generation engine

input artifact exists
!= accepted/current product truth

HUMAN_DECISION_REQUIRED
!= agent fabricates missing Product Owner authority

Restate handler/workflow
= one durable domain-local ExecutionStrategy implementation
!= organization scheduler
!= cross-domain dispatcher
!= product/write authority
```

## Organization model

The product is modeled as a shared state vector, not one global sequential stage machine.

```text
RootIntent / ProductObjective
        |
        v
shared product state
  requirements
  architecture
  FE delivery
  BE delivery
  deployment
  quality
  obligations
  claims
  blockers
  lineage
        |
        +---- PM domain
        +---- BA domain
        +---- SA domain
        +---- FE domain
        +---- BE domain
        +---- DevOps domain
        +---- QA domain
```

No central actor selects “run BA now, then SA, then BE”. Each domain sees only actionable obligations it owns.

Parallel and re-entry behavior are required:

```text
FE + BE may execute independently
QA planning may start before all implementation is complete
DevOps may prepare runtime skeleton after architecture
SA may re-enter when a contract issue appears
BA may clarify one requirement while unrelated delivery remains current
```

## Execution hierarchy

```text
Role Domain
  -> Workload Type
      -> ExecutionPolicy
          -> immutable ExecutionStrategyRef
              -> ExecutionAttemptBinding
                  -> runtime
```

A strategy may be implemented by:

```text
Restate durable handler/workflow
Application/Core loop
Human-assisted strategy
```

Changing HOW must not silently change WHAT:

```text
strategy revision
!= WorkContract revision
!= acceptance revision
!= RootIntent revision
```

An in-flight/recovered semantic attempt remains pinned to its existing binding. New attempts may resolve the current accepted policy/strategy.

## Integration C — cross-domain obligations and selective semantic invalidation

Goal: allow accepted domain publications to create only authorized typed obligations for another domain, with exact semantic lineage and bounded non-current propagation.

Required properties:

- domain write authority is separate from organization claim authority and execution policy;
- CrossDomainObligation states required outcome, not target worker/runtime/priority;
- authoritative derivation edges enter product truth only through accepted publication;
- target materialization validates exact obligation, issuance authority and ordinary materialization authority;
- upstream semantic change invalidates only the reverse-transitive dependent subjects;
- unrelated work remains current;
- publication revalidates consumed input currentness across the commit window;
- already-materialized affected work loses executable capability through canonical lifecycle invalidation/fencing.

Hard invariants:

```text
Obligation != Dispatch
Dependency edge != Work ordering
Invalidation != organization reset
```

First executable proof: BA requirement publication -> authorized SA solution-design obligation -> SA-owned work, without BA selecting SA execution mechanics.

## Integration D — autonomous domain activation

Goal: persisted actionable work can be discovered and activated by its exact owning domain without a manual next-role dispatcher.

```text
event / poll / restart scan
  -> ActivationKey(workId, owningDomain)
  -> read canonical current state
  -> claim/recover
  -> DomainExecutionController
```

Activation is not scheduling.

Required properties:

- hints/queues are disposable wake-up aids, never authority;
- restart scan repairs missed signals;
- activation does not choose domain, priority, policy or strategy;
- FE and BE can progress independently;
- a local requirement change does not create an implicit whole-development barrier.

Architecture tripwire: if progress repeatedly requires a central actor to choose the next domain, the model has regressed into a hidden global scheduler.

## Integration E/F — exact deployment identity and Product QA

Goal: QA accepts one exact deployed product subject, not a branch/tag/self-report.

```text
accepted FE/BE delivery
        |
        v
BuildProvenance
        |
        v
exact deployable digests
        |
        v
DeploymentRelease
        |
        v
AcceptanceSnapshot
        |
        v
independent RuntimeObservationEvidence
        |
        v
QualityAcceptance
```

Required distinctions:

```text
source revision != deployable identity
DeploymentRelease != RuntimeObservation
RuntimeObservation != QualityAcceptance
strategy success != QualityAcceptance
```

QA must bind one deterministic AcceptanceSnapshot and independently observe runtime identity. Mixed/unknown/mismatched runtime identity blocks current acceptance unless explicit product policy says otherwise.

Deployment or acceptance subject changes during the verification window require re-evaluation of the exact current subject; historical releases/snapshots/acceptances remain immutable evidence but do not define current readiness.

## Integration G — product completeness and closure

Goal: callers cannot manufacture product readiness by omitting blocking claims or obligations.

Canonical completeness boundary:

```text
closure-relevant product transitions
        |
        v
ProductHistoryHead
  productId
  generation
  commitRef
  historyDigest
        |
        v
ProductProjectionSubject
        |
        v
ProductStateProjection
        |
        v
ELIGIBLE_FOR_CLOSURE
        |
        v
revalidate exact history/policy subject
        |
        v
ProductOutcomeClaim
```

Required properties:

- ProductHistoryHead commits to the complete closure-relevant history prefix;
- trusted projection builder derives the complete current subject;
- caller-selected claim/obligation subsets are never completeness proof;
- ProductStateProjection is deterministic, disposable and rebuildable;
- closure revalidates exact history/policy currentness immediately before commit;
- ProductOutcomeClaim is immutable historical evidence, not a permanent current DONE bit;
- later closure-relevant transitions require current readiness to be rebuilt;
- strategy-only changes do not invalidate accepted product outputs when product lineage is unchanged.

## Integration H — adversarial recovery

H intentionally breaks the end-to-end organization.

Failure classes include:

```text
process dies after domain output
publication committed but local continuation dies
old worker resumes after claim-generation takeover
input obligation changes during execution
deployment changes during QA
closure completes before an upstream supersession
duplicate recovery workers
repair accidentally attempts to mint a new semantic attempt
partial recovery diverges product/currentness heads
```

Expected behavior:

```text
failure
  -> identify exact affected authority/currentness boundary
  -> fence abandoned execution capability where required
  -> reconstruct from durable canonical refs
  -> local bounded remediation
  -> revalidate only affected downstream product state
```

Forbidden fallback:

```text
reset whole organization
rerun all roles
rebuild all artifacts
central actor manually chooses recovery order
```

Architecture reassessment is required when repeated evidence shows deadlock, central next-domain selection, unrelated invalidation, global barriers, invented routing authority or non-deterministic product reconstruction.

## Integration I — causal reconstruction / observe

Goal: reconstruct why a product is or is not complete from durable provenance already produced by earlier slices.

For one objective, a fresh observer must answer:

```text
why is it not done?
who owns remaining work?
which semantic obligation failed?
which execution policy/strategy/config was used?
which exact attempt/runtime invocation produced the evidence?
how long was waiting vs executing?
what evidence supports each accepted claim?
```

I must consume real durable provenance. Missing execution-attempt/strategy/config identity is a failure of earlier slices; I must not backfill it by model inference.

Observation is not acceptance authority.

## Integration J — one real evolutionary loop

J uses one real failure observed in B–I execution history.

```text
Evidence
  -> Observation
  -> relevant context resolution
  -> Finding + explicit impact
  -> authorized disposition / response
  -> exact target layer
       ExecutionStrategy
       ExecutionPolicy
       ContextPolicy
       tool/model/harness config
  -> Candidate
  -> fixed-work-semantics replay/evaluation
  -> independent proposal
  -> PROMOTE | KEEP_BASELINE
```

Acceptance must prove:

```text
promote strategy v3 -> v4
existing accepted product output from v3 remains current
  when its semantic/product lineage remains current

new attempt
  -> resolves v4

in-flight/recovered old attempt
  -> stays pinned to old binding

candidate tries to alter acceptance/root authority
  -> rejected before promotion
```

The organization may improve HOW without moving the goalposts.

## Feedback architecture direction — research amendment

Updated 2026-09-28 from the user-approved feedback direction; repository baseline `c5356b4d6ae81df64bcfcdb8cd8fd196f1f4e7f5`.

This section defines future architecture and research acceptance, not delivered behavior or an amendment to an already evaluated implementation plan. Existing BB-058/059/075 plans require an explicit scope comparison and, where changed, trusted objective/plan supersession plus fresh Jev readiness before a worker implements this extension. The canonical work graph remains the execution router. Do not treat old readiness judgments as covering these additions.

The conceptual source is [Healthy Feedback](https://martinfowler.com/articles/healthy-peer-feedback.html), by Anuja Karnik and Sumeet Gayathri Moghe (2026-09-24). It motivates observation before interpretation, context, reinforcement and closing the response loop. The typed lifecycle and authority design below are ExHarness design choices, not an architecture claimed by that article.

### One feedback episode

Evidence -> Observation -> Context resolution -> Finding + Impact -> Disposition -> Response -> fresh Outcome observation -> FeedbackResolution.

These are semantic boundaries, not mandatory model calls or a new global scheduler. Reuse existing runtime evidence, reconciliation and self-upgrade seams; context already present and current need not be retrieved again.

| Concept | Required research contract |
|---|---|
| Observation | Exact subject/attempt/candidate, evidence refs, producer and observed time; facts remain distinct from interpretation. |
| Context resolution | Relevant requirement, policy, environment and baseline refs with provenance/currentness; explicit missing or contradictory context. Reuse Oracle contracts for IO. |
| Finding + Impact | Grounded interpretation, supporting/counterevidence, scope and uncertainty; distinguish measured impact from a hypothesis. A tool-call count alone does not prove inefficiency. |
| Disposition | Authorized reconciliation to CURRENT_WORK, EXISTING_WORK, NEW_WORK or NON_ACTIONABLE. Routing is independent of instance/pattern/system classification. |
| Response | ACTED, REJECTED, DEFERRED or SUPERSEDED, with owner, rationale and linked work/experiment where relevant. |
| Outcome observation | Fresh evidence bound to the response and comparison protocol; IMPROVED, NO_CHANGE, REGRESSED or UNKNOWN. Unknown is never silently success. |
| FeedbackResolution | Links the observation/finding, disposition, response/rationale and outcome evidence; records what happened to the feedback, not merely that work was created. |

Research must settle identity, idempotency, replay, stale-context handling, supersession and authorized writes. Separate response acknowledgement from outcome completion: DEFERRED needs an owner and revisit condition; REJECTED can close the response without claiming improvement; SUPERSEDED links its successor. Unmeasured outcomes remain UNKNOWN. Work completion is not evidence that feedback was useful.

Missing context may support a bounded evidence-gathering response; it cannot authorize an unsupported causal diagnosis. Existing independently grounded correctness failures may still route to repair.

### Instance, pattern and system scope

BB-058 should provide read-only episode reconstruction and aggregation proposals. INSTANCE is one exact execution. PATTERN requires a declared cohort/window, denominator, deduplicated independent episodes, comparable context and counterexamples. SYSTEM requires evidence of a shared mechanism or contract defect; repetition alone is insufficient. These levels are not an automatic escalation ladder.

Aggregation must retain source episode refs, uncertainty and disconfirming evidence. Retries of the same event cannot manufacture recurrence. Contradictory or stale evidence must be visible rather than discarded.

Feedback also records REINFORCE_PATTERN / KEEP proposals: preserve a strategy shown useful under comparable quality and resource conditions. Reinforcement cannot bypass evaluation or create promotion authority.

### Ownership and authority

- Observer produces observations, reconstructs episodes and proposes patterns; it cannot repair, mutate canonical work lifecycle, accept or promote.
- Oracle resolves context and provenance; it does not judge correctness or authorize a response.
- Evaluators/Jev produce judgments at their defined boundaries; they do not mutate Blackboard.
- Application authority reconciles findings and commits authorized lifecycle/disposition changes.
- Existing independent evaluation and promotion authority govern HOW changes. Feedback itself never becomes accepted truth.
- Inner product/runtime episodes and outer development feedback remain distinct scopes with explicit provenance links. Outer Jev is one evaluation boundary, not the entire feedback system.

### Research sequence and reuse study

| Slice | Existing owner / dependency | Required output |
|---|---|---|
| F1: episode and context semantics | BB-058 scope review; Oracle BB-061/063 contract coordination | Typed facts/context/finding/impact boundaries, missing-context behavior and read-only reconstruction fixtures. |
| F2: response and resolution | BB-059 scope review; consumes F1 | Application-owned routing/write authority, durable response/outcome lifecycle, recovery and no-action closure. |
| F3: cross-episode learning | BB-058/059 coordinated scope; consumes F1/F2 | Aggregation criteria, counterevidence, recurrence/system distinction and reinforcement. |
| F4: independent improvement proof | BB-075; consumes BB-059 and BB-074 | Episode -> candidate -> held-out experiment -> independent decision -> observed outcome/resolution. |
| F5: reproduction | BB-076; existing BB-074/075 dependencies | Reproduce exact candidate, baseline, decisions and feedback outcome on the supported release. |

F1–F5 are roadmap slices, not allocated task IDs. Research may proceed using planned dependency contracts; worker execution requires canonical delivered dependencies. Decide exact direct edges during plan alignment; do not add transitive dependencies or block BB-065 on this feedback extension. BB-065 remains neutral benchmark substrate; BB-077/081 supply isolation/ablation evidence, not feedback authority.

Study the user-provided shortlist as candidates: OpenHands (events/observations), Reflexion (trial/reflection), LangGraph (durable workflow), LangMem (consolidation), DSPy/GEPA (candidate evaluation/selection). This amendment does not verify their complete capabilities, current stars, or the absence of an end-to-end implementation. Before treating any repository as evidence, verify >=1,000 stars, pin source/release, inspect relevant code/tests, and record license, limitations and integration cost. If none qualifies for a mechanism, say so. Compare reuse with extending existing ExHarness seams; no framework adoption is implied.

### Acceptance and measurement

Before READY, publish exact schemas/exports, owning packages, source/write scopes, migration strategy, direct dependencies and executable evidence commands. Validate:

1. Same observation with different relevant context can yield different grounded findings; missing context remains explicit.
2. Duplicate events/retries cannot create false patterns; correlated observations cannot alone establish system causality.
3. All response dispositions survive restart with rationale; deferred work remains discoverable and superseded feedback links its successor.
4. Fresh outcome evidence distinguishes improvement, no change, regression and unknown; positive reinforcement preserves correctness constraints.
5. Stale subject/context bindings, forged authority and self-promotion fail closed; candidate code cannot change its evaluator, objective or acceptance gate.
6. Matched baseline/candidate experiments freeze task/model/environment/budgets, use held-out work and preserve in-flight attempt bindings.

Report feedback usefulness separately from routing throughput: evidence completeness, unresolved/deferred age, false pattern rate on labeled fixtures, response-to-outcome coverage, quality/cost/latency deltas and regression rate. Predeclare budgets and thresholds before trials. A resolution count or generated-work count is not an improvement metric.

## End-to-end phase acceptance

Run the same explicit lifecycle from different starting completeness levels.

```text
Fixture A — minimal seed
  goal/idea only

Fixture B — partial project
  requirement markdown + Figma/design

Fixture C — advanced project
  requirements + architecture + design + existing code/deployment refs
```

All fixtures must converge through the same canonical authority/product semantics. Different starting completeness changes how much work is needed, not the trust model.

Canonical phase proof:

```text
ProjectSeed
  goal
  lifecycleRef
  initialArtifactRefs[]
        |
        v
explicit lifecycle + bounded end-user clarification
        |
        v
canonical product artifacts / obligations
        |
        v
autonomous domain activation
        |
        +-> BA / SA
        +-> FE + BE
        +-> DevOps
        +-> QA
        |
        v
adversarial kill/resume
        |
        v
ProductStateProjection
        |
        v
ELIGIBLE_FOR_CLOSURE
        |
        v
ProductOutcomeClaim
        |
        v
causal reconstruction
        |
        v
one evidence-gated HOW evolution
```

The phase is complete only when this proves a durable software organization rather than a multi-agent demo.

## Current routing

Current implementation work is not selected from this roadmap directly.

```text
roadmap
  = current architectural direction and phase acceptance

docs/blackboard/state.md
  = current delivery router / active work / accepted input queue

docs/blackboard/artifacts/objective/*
  = exact accepted semantic slices

docs/living/system/*
  = currently delivered system truth
```

Do not reconstruct prior research/review history to decide what is current.

## Delivery product continuation

Integration is the organization contract foundation for the [delivery product roadmap](../../blackboard/process/delivery-product-roadmap.md). The continuation covers real agent and repository execution, independent live QA, supported installation, matched pilot value and release acceptance. Oracle reconciliation retains its own phase contract. These are planned capabilities, not delivered system truth. The canonical outer Blackboard owns scheduling and exact task dependencies.
