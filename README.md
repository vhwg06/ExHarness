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

WAVE C — ACTIVE / NEXT
  S7 Second real role + extract only proven abstractions
  S8 Artifact handoff / dereference / context chaining

WAVE D — harden and generalize
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

No generic `Worker<C,R>`, generic WorkOrder, generic Advisor, role registry, workflow graph or generic Orchestrator has been introduced. Wave C S7 is the first permitted extraction point because a second real role is required to prove common semantics.

See `docs/worktree/pipeline.md` for the canonical sequence and `docs/worktree/state.md` for the current checkpoint.

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

Oracle may resolve two distinct source classes:

```text
External sources
  Git / Figma / docs / OpenAPI / APIs / ...

Application-produced sources
  prior WorkResult refs / artifact store / application state
```

Both cross the Oracle boundary, but their adapters and source semantics remain distinct. Wave C S8 is where internal artifact dereference becomes a real cross-work path.

## Completion and evidence

A Worker saying `done` is never sufficient application completion state.

```text
Worker execution
   -> structured WorkResult
   -> grounded role-specific evidence / artifacts / gaps / blockers
   -> application completion policy
   -> ACCEPT | CONTINUE | BLOCK | FAIL
```

For the current Backend slice, grounded claims are concrete: mutation, typecheck and tests. These are Backend semantics, not a universal evidence schema. Frontend, QA or Design may require different evidence; common structure is extracted only after real slices demonstrate it.

ExHarness trust primitives provide integrity/provenance artifacts; the Agentic Application still owns which evidence is sufficient for domain completion.

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

### Agentic Application + Oracle — Waves A + B delivered, Wave C next

`packages/agentic-system/` currently delivers:

- concrete Backend objective/order/context/result contracts;
- resolve-once Backend context loading through a repository-reader Oracle boundary;
- `BackendWorker` execution through ExHarness Core;
- grounded mutation + verification evidence assembly;
- Backend-specific completion policy and acceptance decision artifact;
- bounded BackendAdvisor only for unresolved semantic gaps;
- tests wired into the repository verification gate.

The larger Agentic Application and Oracle architecture remains intentionally incomplete. A second real role, cross-work artifact dereference, durable application workflow state and production generalization remain later-wave work.

## Documentation routing

Start at `docs/README.md`.

```text
docs/
├── README.md                         # documentation router
├── worktree/
│   ├── state.md                      # Agentic System current desired/delivered checkpoint
│   ├── pipeline.md                   # canonical 10-stage / 4-wave delivery sequence
│   ├── agentic-application/          # application semantics and boundaries
│   ├── oracle/                       # context-resolution infrastructure
│   └── core-harness/                 # ExHarness Core continuation state
├── architecture/                     # deeper implemented/Core design records
└── development/                      # implementation/verification process
```

Source/public exports are authority for implemented behavior now. `docs/worktree/` is authority for accepted target semantics/current delivery projection. `docs/architecture/` does not silently override current worktree decisions.

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

The repository verification gate covers ExHarness Core plus delivered Wave-A and Wave-B Agentic System behavior. Desired-state documentation does not imply implementation completeness for Wave C/D.
