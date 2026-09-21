# ExHarness — Agentic System

ExHarness is an **agentic system** composed from three explicit boundaries:

- **Agentic Application** — owns concrete objective/work/result semantics, deterministic orchestration, bounded Advisor judgment, durable Blackboard workflow state and application completion/review policy.
- **Oracle** — resolves application-declared context through concrete external/internal source adapters before Worker execution.
- **ExHarness Core** — reusable execution kernel for agent/runtime mechanics, cognition, evidence/trust, persistence, recovery and authority boundaries.

The published `exharness` package is the reusable Core. `packages/agentic-system/` contains the current concrete Backend + QA application composition, durable Blackboard orchestration and the durable Backend -> QA workflow.

## Current delivered system

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext
     -> repositoryReader.readFile(...)
  -> BackendWorker
  -> ExHarness Core
  -> grounded BackendWorkResult
  -> mutation + typecheck + tests evidence
  -> BackendCompletionPolicy
  -> ACCEPT | CONTINUE | BLOCK | FAIL

Backend ACCEPT
  -> BackendQaHandoff
     artifact refs + accepted revision + acceptance decision provenance
  -> QaWorkOrder
  -> resolveQaContext
     -> artifactReader.readArtifact(...)
  -> QaWorker
     non-mutating ExHarness execution
  -> qa.behavior + qa.regression evidence
  -> QaCompletionPolicy
```

The durable application coordination layer is implemented through `ApplicationOrchestrator` and its JSON-backed Blackboard store:

```text
ApplicationOrchestrator
  -> JSON-backed Blackboard
  -> claim READY/REOPENED work
  -> persist Worker submission
  -> Worker REQUEST review / PM REQUIRE review
  -> PENDING_REVIEW / REVIEWING
  -> explicit assessment
      -> all required accepted + no remaining work -> DONE
      -> rejected/inconclusive or unresolved current work -> REOPENED
  -> reconcile grounded findings
      -> CURRENT_WORK / EXISTING_WORK / NEW_WORK / NON_ACTIONABLE
```

The concrete `createDurableBackendQaWorkflow(...)` binds the accepted Backend -> QA path to this durable lifecycle. It persists the validated workflow specification, resumes QA from a ref-only Backend handoff, records remediation and blocked checkpoints, and submits accepted QA for the separate review/acceptance path. The older `runBackendThenQaObjective(...)` composition remains available for one-session execution.

Current implementation facts:

- Backend mutation/promotion and QA non-mutating verification are materially different lifecycles.
- Worker-returned evidence is not completion authority; completion is grounded from ExHarness/runtime state.
- QA cannot mutate or advance lineage and is dispatched only after Backend acceptance.
- Backend -> QA handoff carries references and acceptance-decision provenance, not copied artifact payloads.
- durable Backend -> QA execution survives a new Orchestrator/process session through persisted checkpoints, including QA remediation, blocked artifact lookup and explicit resume.
- Oracle keeps external repository reads and internal application-artifact reads as distinct source boundaries.
- Worker submission cannot self-authorize Blackboard `DONE`; required review state survives Orchestrator reconstruction through the JSON store.
- Worker review request and PM review requirement are separate authority paths.
- review failure that proves the current obligation remains unresolved reopens the same Board item instead of generating replacement work.
- follow-up findings require provenance before the Orchestrator can reconcile them into current/existing/new work.
- `ApplicationArtifactRef`, evidence-integrity/claim-state plumbing and durable Blackboard state are the narrow common shapes currently proven.
- no generic Worker/WorkOrder/Advisor, role registry, workflow graph, Teacher registry or Reviewer registry exists in current source.

`ApplicationOrchestrator` is concrete application workflow/Blackboard control, not a generic workflow graph/DSL or a second runtime.

## Repository development Blackboard

The repository also has an **outer Blackboard** for development work. It is separate from the Agentic Application Blackboard described above. The outer Blackboard routes implementation work through exactly two lanes:

```text
OBJECTIVE
  -> RESEARCH_SA
  -> READY_IMPLEMENT_PLAN
  -> WORKER
  -> DELIVERED_FEATURE
```

`RESEARCH_SA` consumes an `OBJECTIVE` and may change only the current draft plan. It converges only when the plan has explicit scope, constraints, invariants, architecture decisions, source seams, acceptance criteria and verification. `WORKER` consumes the exact `READY_IMPLEMENT_PLAN`; it cannot reinterpret the plan or claim delivery before the candidate, evidence, Jev judgment and merge identity are verified. Execution, judgment, repair and merge-pending are phases within these two lanes, not additional lanes.

The canonical task artifact tree has only these two directories:

```text
docs/blackboard/artifacts/objective/
docs/blackboard/artifacts/ready-implement-plan/
```

The unsuffixed `BB-<id>.json` in each directory is the current lane input. Retained source, Jev evaluation, implementation-result and judgment evidence is co-located beside the plan with explicit suffixes; legacy `implementation-input/`, `implementation-spec/`, `implementation-result/` and `judgment/` directories are not valid current routing paths. Run `npm run migrate:blackboard-delivery` when importing an older checkout.

Jev is the semantic judge for both lane contracts. The local evaluator batches atomic questions, validates the typed response, caches by semantic state/spec/model hash and records usage. Configure the key in a local `.env` file or the process environment; `.env` is ignored by Git:

```powershell
# One-time setup, then edit .env and fill the value after the equals sign.
Copy-Item .env.example .env
# TYPESAFE_API_KEY=<your TypeSafe key>

# Or set it for the current PowerShell process.
$env:TYPESAFE_API_KEY = "<your TypeSafe key>"
npm run materialize:blackboard-evaluation -- BB-056
npm run eval:blackboard-jev -- BB-056
```

`materialize` prepares the payload and does not call the provider. A live evaluation reports `cacheHit: false` and `attempts: 1`; `cacheHit: true` means the unchanged semantic input reused a cached result. `RESEARCH_REQUIRED` means Jev found missing plan evidence and keeps the task in `RESEARCH_SA`; it is not an API-key failure. Publish a trusted result with:

```powershell
npm run publish:blackboard-evaluation -- BB-056 artifacts/blackboard-jev/BB-056.json
```

Live provider calls are separate from the normal test matrix. Local `eval` and the Jev workflow require the key; CI reads the repository secret named `TYPESAFE_API_KEY` from `.github/workflows/blackboard-jev.yml`. Blackboard-specific checks are available through:

```bash
npm run verify:blackboard-context
npm run verify:current-docs
```

## Role topology

Current authority topology separates horizontal governance from vertical context-bound execution:

```text
PM
  = project coordination / sequencing / dependency / timeline / progress

SA
  = architecture constraints / judgment / review only

remaining specialist execution/review
  = vertical + context-bound
```

Concrete PM context/role execution, SA context/role execution and vertical Reviewer implementations are not yet source-delivered and therefore are not claimed as current runtime behavior.

## Context feeding

```text
application contract declares required context
  -> Oracle reads only declared source refs
  -> adapts + preserves source/provenance
  -> validates application-owned schema
  -> Worker executes through ExHarness Core
```

Current Oracle source classes:

```text
External repository
  -> repositoryReader.readFile(...)

Internal application artifact
  -> artifactReader.readArtifact(...)
  -> APPLICATION_ARTIFACT provenance
```

There is no generic resolver registry, hidden provider lifecycle, MCP-first framework, retrieval framework or cache lifecycle in current source.

## Completion and evidence

```text
Backend evidence
  backend.mutation
  backend.typecheck
  backend.tests

QA evidence
  qa.behavior
  qa.regression
```

Application policy owns sufficiency. ExHarness trust/evidence primitives provide integrity/provenance; model/Worker prose cannot self-certify completion.

`BackendAdvisor` is intentionally narrow: it is consulted only after required objective evidence passes while explicit semantic gaps remain, and may propose retry implementation, request context or escalation. It cannot accept work or mutate workflow state directly.

Blackboard problem completion is a separate boundary from role-local completion:

```text
role completion != Blackboard problem completion
Worker submission != acceptance
REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT
```

## Core maturity

`packages/core-harness` currently includes:

- AVO variation/lineage/evaluation/supervision/search-investment control;
- typed judgments, Predict/CodeAct, object agents, live objects and progressive discovery;
- bounded context/history, routing, tracing and runtime snapshot/resume;
- semantic memory plus opt-in associative retrieval/ranking;
- evidence/decision/attestation trust primitives;
- interrupted-variation recovery and separate effect reconciliation;
- structured deliberation, ActionIntent and grounded reflection/intent;
- intent/reflection semantic calibration.

Important authority distinctions include:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
SemanticMemory.INTENT != ActionIntent
IntentReflectionAlignment != Evaluation
candidate/trace state != proof of external effect completion
retrieval/ranking != correctness authority
search investment/supervision != promotion correctness
```

## Documentation model

The repository has a strict partition:

```text
docs/living/system/*
    = source-synchronized living system docs
    = current state only

docs/blackboard/state.md
    = all unresolved gaps / problems / questions / blockers / next work
```

The Blackboard is shared operational state, not an actor. Orchestration owns lifecycle transitions; a Worker may submit/request review but cannot close its own work.

Do **not** use `docs/living/system/` as a hidden backlog. If a current-system document discovers an unresolved problem, keep the current fact in the document and move the problem to the Blackboard.

Documentation routing:

```text
docs/README.md
  -> docs/blackboard/state.md             where development is now
  -> docs/living/system/state.md          what exists now
     -> living/system/pipeline.md          current delivered pipeline
     -> agentic-application/             current application docs
     -> oracle/                          current Oracle docs
     -> core-harness/                    current Core docs
  -> docs/living/knowledge/integration-phase-research-to-implementation-readiness.md  current integration roadmap
```

Source/public exports and executable tests/runtime are implementation authority. `docs/living/system/*` must be reconciled to them.

## Core package

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

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The repository verification gate covers ExHarness Core plus delivered Agentic System behavior, including the durable Blackboard orchestration contract tests.
