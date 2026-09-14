# ExHarness — Agentic System

ExHarness is an **agentic system** for building bounded, evidence-aware software engineering agents from three explicit layers:

- **Agentic Application** — owns objectives, work decomposition, deterministic orchestration, bounded Advisor judgment, specialist Worker semantics, context requirements and application completion policy.
- **Oracle** — infrastructure that resolves application-owned context requirements by pulling/dereferencing concrete sources and adapting them into application-shaped context before Worker execution.
- **ExHarness Core** — the reusable execution kernel providing long-horizon control, agent runtime, cognition, evidence/trust, persistence, recovery and authority boundaries.

The repository is organized around the composed **Agentic System**. The published `exharness` package is the reusable Core layer inside that system.

## System architecture

```text
Objective
   |
   v
Agentic Application
  Orchestrator ----------------> Advisor
      |                           bounded judgment only
      |
      v
  concrete WorkOrder / context need
      |
      +------> Oracle
      |          |
      |          +------> external sources
      |          +------> application-produced artifacts/state
      |          |
      |       resolved context
      v          v
  specialist Worker
      |
      v
  ExHarness Core
      |
      v
  structured WorkResult + grounded evidence/artifact refs
      |
      +------> application completion / next-step decision
```

Ownership is intentionally split:

```text
Application owns WHAT / WHY / semantic contracts / completion policy.
Oracle owns WHERE / pull / dereference / adaptation.
ExHarness Core owns agent execution mechanics and runtime/trust primitives.
Infrastructure owns concrete IO, sandboxing, storage and source access.
```

## Delivery model

The system is developed **concrete-first**. Generic application abstractions are not introduced before multiple real slices prove a common shape.

Current delivery status:

```text
WAVE A — DONE
  S1 Concrete Backend semantics                         DONE
  S2 Concrete Backend context resolution               DONE
  S3 BackendWorker × ExHarness execution               DONE
  S4 Concrete deterministic Backend orchestration      DONE

WAVE B — DONE
  S5 Backend-specific completion/evidence semantics    DONE
  S6 Advisor judgment boundary                         DONE

WAVE C — DONE
  S7 Second real role + extract only proven abstractions   DONE
  S8 Artifact handoff / dereference / context chaining     DONE

WAVE D — ACTIVE / NEXT
  S9 Persistence / resilience / recovery composition
  S10 Production evaluation + evidence-based generalization
```

### Delivered Backend path

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext
  -> BackendWorker
  -> ExHarness Core
  -> BackendWorkResult
  -> grounded mutation/typecheck/tests evidence
  -> BackendCompletionPolicy
  -> ACCEPT | CONTINUE | BLOCK | FAIL
```

Wave A proved execution without framework magic. Wave B makes the result trustworthy at the application boundary.

An `APPLIED` result must correspond to actual ExHarness lineage promotion, but promotion alone is not acceptance. `BackendWorker` discards evidence merely claimed in its returned payload and rebuilds completion evidence from actual ExHarness lineage/verification artifacts. Default Backend acceptance requires grounded mutation, typecheck and tests evidence plus artifact presence. Completion is materialized as an ExHarness `DecisionArtifact` at the `ACCEPTANCE` boundary.

The first real Advisor boundary is narrower than completion: when required objective evidence passes but unresolved semantic gaps remain. Missing, inconclusive or failed evidence stays deterministic application logic. `BackendAdvisor` may propose only retry implementation, request context or escalation; it cannot ACCEPT work, dispatch Workers or directly mutate workflow state.

### Delivered Backend -> QA path

```text
accepted Backend completion
  -> BackendQaHandoff
     artifact refs + accepted revision + decision provenance
  -> QaWorkOrder selects required artifact paths
  -> resolveQaContext
     -> artifactReader.readArtifact(...)
  -> QaWorker
     non-mutating ExHarness execution
  -> qa.behavior + qa.regression evidence
  -> QaCompletionPolicy
```

Wave C adds QA as the second real role and makes cross-work context flow explicit. QA inspects a fixed accepted Backend revision: environment mutation is forbidden and lineage must not advance. Worker-returned evidence/inspected-artifact claims are replaced by grounded ExHarness/context state.

The S7 comparison produced a deliberate **negative generalization result**: Backend mutates/promotes lineage while QA verifies without mutation, so no generic Worker/WorkOrder/Orchestrator was extracted. The common shapes actually proven are narrow: `ApplicationArtifactRef` and evidence-integrity/claim-state plumbing. This conclusion is recorded as a `SUPPORTED` living-knowledge judgment, not silently promoted architecture.

See `docs/worktree/pipeline.md` for the current delivery sequence and `docs/worktree/state.md` for the convergence checkpoint. Read `docs/living/README.md` for authority and promotion semantics before treating future worktree shapes as committed architecture.

## Context feeding

Context semantics belong to the Agentic Application. Oracle only satisfies those semantics.

```text
Application declares required semantic context
        |
        v
Oracle pulls / dereferences / adapts sources
        |
        v
validated application-shaped context
        |
        v
Serializer renders context for execution
        |
        v
Worker / ExHarness Core
```

The serializer performs **no IO**. Dereferencing belongs to Oracle.

Oracle now has two concrete source classes in delivered code:

```text
External repository source
  Backend required file
  -> repositoryReader.readFile(...)

Internal application-produced source
  Backend artifact ref
  -> artifactReader.readArtifact(...)
  -> APPLICATION_ARTIFACT provenance
```

Backend -> QA handoff carries references and Backend acceptance-decision provenance rather than copying artifact payloads through application state. External repository access and internal artifact lookup remain distinct adapters/source semantics rather than being collapsed into a generic retrieval framework.

## Completion and evidence

A Worker saying `done` is never sufficient application completion state.

```text
Worker execution
   -> structured WorkResult
   -> grounded role-specific evidence / artifacts / gaps / blockers
   -> application completion policy
   -> ACCEPT | CONTINUE | BLOCK | FAIL
```

Role-specific evidence remains intentionally different:

```text
Backend
  backend.mutation
  backend.typecheck
  backend.tests

QA
  qa.behavior
  qa.regression
```

ExHarness trust primitives provide integrity/provenance artifacts; the Agentic Application still owns which evidence is sufficient for domain completion. Shared evidence plumbing does not imply shared role correctness semantics.

## Current maturity

### ExHarness Core — delivered

`packages/core-harness` publishes `exharness` and currently provides:

- AVO variation, lineage, verification/evaluation, supervision and adaptive search investment;
- typed judgments, Predict/CodeAct, object agents, live objects and progressive discovery;
- bounded context/history, model routing, tracing and runtime snapshot/resume;
- semantic memory and separate NOOA-style retrieval/ranking;
- evidence/decision/attestation trust primitives;
- interrupted-variation recovery and separate effect reconciliation primitives.

Important Core invariants include:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
retrieval/ranking != correctness authority
candidate state != proof of external side effect
search investment != promotion correctness
supervision != correctness verdict
```

### Agentic Application + Oracle — Waves A + B + C delivered, Wave D next

`packages/agentic-system/` currently delivers:

- concrete Backend objective/order/context/result contracts;
- resolve-once Backend context loading through a repository-reader Oracle boundary;
- `BackendWorker` execution through ExHarness Core;
- grounded Backend mutation + verification evidence assembly;
- Backend-specific completion policy and bounded BackendAdvisor;
- concrete QA objective/order/context/result/completion contracts;
- non-mutating `QaWorker` with grounded behavior/regression verification;
- shared application artifact-reference shape where the two roles actually repeat semantics;
- ref-only Backend -> QA handoff with acceptance-decision provenance;
- internal application-artifact dereference through `artifactReader`;
- direct `runBackendThenQaObjective(...)` composition gated on Backend acceptance;
- Wave A-C tests wired into the repository verification gate.

The larger Agentic Application remains intentionally incomplete. Durable multi-work application state, retry/resume/recovery composition and production evaluation/generalization are Wave D work.

`docs/worktree/` contains convergence/candidate material and delivered checkpoints; it no longer gains desired-state authority merely from its path. Promoted durable authority is routed through `docs/living/`, while source/public exports remain authority for what is actually delivered.

## Living knowledge and documentation routing

Start at `docs/README.md`, then `docs/living/README.md` for the authority model.

```text
docs/
├── README.md                         # documentation router
├── living/
│   ├── README.md                     # typed authority + promotion router
│   ├── architecture.md               # promoted accepted knowledge architecture
│   ├── pipelines.md                  # promotion/reconciliation lifecycle
│   ├── contracts.md                  # authority + mutation invariants
│   ├── knowledge/
│   │   ├── state.md                  # durable knowledge snapshot
│   │   ├── evidence.md               # observations + provenance
│   │   ├── judgment.md               # conclusions + uncertainty
│   │   └── audit.md                  # independent challenge
│   └── decisions/                    # accepted/promoted choices
├── worktree/
│   ├── README.md                     # convergence semantics; not Blackboard
│   ├── state.md                      # Agentic System convergence router
│   ├── pipeline.md                   # current accepted delivery order
│   ├── agentic-application/          # application convergence material
│   ├── oracle/                       # context-resolution convergence material
│   └── core-harness/                 # Core continuation material
├── architecture/                     # deeper implemented/reference/history records
└── development/                      # implementation/verification process
```

ExHarness intentionally separates three planes:

```text
Blackboard / coordination plane
    = high-frequency operational work state

Living knowledge plane
    = evidence -> judgment -> audit -> decision -> promoted views

Artifact plane
    = source / tests / configs / runtime observations / produced artifacts
```

There is **no single global source of truth**. Authority is typed by the question being answered. A newly drafted component remains a candidate until evidence and an explicit acceptance boundary promote it; session count alone never makes it desired state.

The runtime Blackboard is an architectural coordination boundary, not `docs/worktree/`, and its concrete storage/claim/lease/event semantics are deliberately not selected yet.

## Core package

The published Core remains independently reusable:

```js
import { createHarness } from "exharness";
```

Low-level `createAVOHarness()`, `createCoreHarness()` and `createAgentRuntime()` remain available for custom Core composition.

Current package subpaths include:

```text
exharness
exharness/testing
exharness/effects
exharness/memory-retrieval
```

The workspace root remains private so Agentic Application, Oracle and repository-level composition can evolve without prematurely expanding the Core package surface.

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The repository verification gate covers ExHarness Core plus delivered Wave-A, Wave-B and Wave-C Agentic System behavior. Candidate/convergence documentation does not imply promoted architecture for Wave D.
