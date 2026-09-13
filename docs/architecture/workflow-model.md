# ExHarness living workflow model

This document is the canonical architecture authority for autonomous workflows built **with** ExHarness.

The completion-pipeline documents describe how ExHarness itself was built and verified. This document describes how its runtime, control, cognition, evidence and recovery primitives compose into a long-running workflow.

When implementation changes a lifecycle transition, authority boundary, recovery path, or composition rule described here, this document must change in the same PR. Domain harnesses may specialize semantics but must not silently invent a conflicting kernel lifecycle.

## Canonical loop

```text
WORK
  |
  v
RESTORE / RESUME
  |
  v
RECONCILE PENDING EFFECTS
  |---------------- unresolved ----------------> STOP / ESCALATE
  v
OBSERVE
  |
  +--> Observation artifacts
  |
  +--> semantic-memory retrieval
  |
  v
CONTEXT PROJECTION
  |
  v
TURN
  |
  +--> strategy / model judgment
  |
  v
CAPABILITY / CODEACT
  |
  v
DURABLE EFFECT INTENT
  |
  v
ACT
  |
  v
RE-OBSERVE / RECONCILE
  |
  v
EVALUATE
  |\
  | +---- GAP / REPAIR ----> next bounded variation / turn
  |
  +------ PASS ------------> COMMIT / PROMOTE
                                 |
                                 v
                       lineage + reusable knowledge
                                 |
                                 v
                       search-investment decision
                         |        |        |
                      continue   stop   escalate
```

This is a lifecycle graph, not a requirement that every workload execute every box once or in one fixed sequence. Read-only capabilities may not create external effects. Some evaluations happen several times inside one variation. A workload may use Predict, CodeAct, deterministic code, or a mixture. What remains invariant is the ownership of state transitions and authority.

## Two nested loops

ExHarness composes two different timescales.

### Runtime loop

```text
observe -> project context -> turn -> act -> observe -> evaluate/decide
```

This is where an agent performs bounded work. NOOA-style runtime primitives live here: typed judgments, context, working history, live resources, CodeAct, model routing and tracing.

### Long-horizon control loop

```text
committed candidate
      |
      v
begin variation
      |
      v
runtime loop(s)
      |
      v
objective evaluation
      |
   PASS / GAP
    |      |
 promote  repair/new variation
    |      |
    +------+
      |
 adaptive search-investment decision
```

AVO-style lineage, freshness, supervision, recovery, promotion and adaptive search investment live here. A runtime turn is not a variation, and a successful model/tool call is not promotion evidence.

## Authority model

ExHarness intentionally has typed authorities rather than one universal source of truth.

| Artifact / plane | Authority | Must not become |
|---|---|---|
| Effect journal | lifecycle of effectful operations | model history or correctness proof |
| Observation | evidence about the currently observed world | semantic memory or evaluation verdict |
| Session / candidate state | current local working state | proof that external effects occurred |
| AgentEvent history | canonical model-working history | distributed effect journal |
| Semantic memory | reusable cognition across turns/work | operational truth |
| Evaluation evidence | basis for correctness and promotion decisions | external-world state by assertion |
| TraceSpan | causal/diagnostic execution evidence | recovery authority |
| Tests / CI | verification artifacts | sole source of truth |

Canonical invariants:

```text
Observation != Memory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
Trace != RecoveryAuthority
Memory != OperationalTruth
Evaluation != ExternalState
```

## Recovery ordering

Recovery is machine-resolved before model judgment whenever semantics permit it.

```text
restore durable state
       |
       v
inspect pending effect operations
       |
       +--> replayable ----------> replay
       |
       +--> idempotent ----------> retry same operation identity
       |
       +--> observable ----------> probe actual state -> reconcile
       |
       +--> unresolved ----------> bounded semantic/operator escalation
       v
project current authoritative state
       |
       v
resume normal runtime loop
```

Raw trace or raw historical logs are not injected into the model and called reconciliation. The model is a fallback for residual semantic ambiguity, not the default recovery authority.

## Context construction

Context is a projection, not storage.

```text
AgentEvent working history
+ selected context blocks/resources
+ ACTIVE semantic-memory retrieval
+ relevant fresh observations/evidence
        |
        v
bounded model-facing context
```

The canonical records remain in their owning stores. Summaries, retrieval rankings and context projections are lossy views. NOOA-style retrieval may rank cognition relevance; ExHarness authority boundaries still re-read canonical records and enforce lifecycle, scope and budget constraints.

Recovery-specific context is lazy. If replay or observed-state reconciliation resolves a failure, no special model context is needed. Only unresolved semantic ambiguity may produce a bounded ephemeral recovery projection.

## Effect boundary

Effectful capabilities cross a different trust boundary from pure reasoning or local deterministic computation.

```text
operation identity
      |
intent persisted
      |
dispatch
      |
external world
      |
confirmation may be lost
```

A crash after the external effect but before local confirmation creates an ambiguous outcome. Therefore a persisted `started` trace/event alone cannot prove whether the effect happened. Capability effect semantics determine whether the kernel can replay, retry idempotently, observe/reconcile, or must fail closed and escalate.

## Evaluation and promotion

Evaluation is a pipeline of evidence and judgment, not a synonym for tests and not a property of memory retrieval.

```text
candidate/current state
+ fresh observations
+ objective checks
+ domain evaluators
+ independent verification where required
        |
        v
current evaluation
        |
        +--> GAP   -> repair / another variation
        +--> PASS  -> eligible for promotion
```

Promotion requires current evidence for the candidate being promoted. Historical PASS, model confidence, retrieved memory, a successful capability call, or a green but stale test artifact cannot independently authorize promotion.

## Composition rule

A BE, FE, QA, design, research or other workload harness should provide domain semantics through injected capabilities, observers, evaluators, policies, stores and context sources. It should not fork the kernel lifecycle.

```text
Domain harness
  goal / workflow policy
  capabilities
  observers
  evaluators
  context sources
  effect semantics
        |
        v
ExHarness workflow lifecycle
  restore/reconcile
  runtime turns
  observation/context
  effect lifecycle
  evaluation
  lineage/promotion/search
        |
        v
Injected infrastructure
  models / APIs / repo / browser / sandbox / stores / CI / telemetry
```

Different domain pipelines may skip irrelevant primitives or repeat stages, but their transitions must preserve the authority boundaries above.

## Living-document rule

This document is intentionally coupled to runtime architecture rather than to a particular product workflow.

A change requires updating this document when it changes any of:

- the canonical workflow lifecycle;
- ownership of an authoritative artifact;
- resume/reconciliation semantics;
- context construction authority;
- evaluation/promotion authority;
- the boundary between kernel lifecycle and domain composition.

Component-specific documents remain authoritative for their detailed contracts. This document owns their composition.

## Current implementation boundary

The repository already contains the major primitives described here: AVO variation/lineage control, NOOA-style runtime/context/CodeAct/tracing, observations, semantic memory and retrieval, evaluation/promotion gates, runtime snapshot/resume, and effect reconciliation semantics.

What remains a separate implementation concern is a higher-level consumer-facing pipeline/orchestration API that makes this entire graph convenient to declare and run. This document does not pretend that such an API already exists. It defines the lifecycle and authority model that API must preserve.
