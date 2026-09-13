# ExHarness Kernel Completion

## Identity

ExHarness is a reusable harness kernel composed from two NVIDIA-inspired layers plus an explicit cognition/evidence boundary:

```text
AVO control plane
  candidate / lineage
  autonomous variation
  objective feedback
  persistent K
  supervision
  commit / recovery
        |
        v
NOOA-style agent substrate
  object-native agent surface
  explicit context + turn lifecycle
  typed capabilities
  JavaScript CodeAct
  live object authority
  runtime events
        |
        v
cognition + evidence planes
  first-class observations
  semantic memory
  typed memory graph
  bounded relevance fusion
  memory evolution / reflection
  causal tracing
        |
        v
injected infrastructure
  model adapter
  executor / sandbox
  tools
  persistent stores / retrieval providers
  event / trace sinks
```

AVO owns what the system does over long horizons. The NOOA-style substrate owns how an autonomous agent can programmatically inspect and act inside one variation. The cognition layer separates what the system currently observes, what the agent durably remembers, and what may certify correctness. Consumer projects still own domain semantics and infrastructure adapters.

The core authority rule is:

```text
Observation != Memory != Evaluation
```

- **Observation** is a current, provenance-carrying sensory artifact.
- **Memory** is selected durable cognition and remains relevance-only unless independently grounded elsewhere.
- **Evaluation** is the correctness authority that may permit promotion.

No plane may silently inherit authority from another.

## Public composition boundary

Normal consumers start at one facade:

```js
import { createHarness } from "exharness";

const harness = createHarness({
  strategy,
  environment,
  objective,
  capabilities,
  verifiers,
  sessionStore,
  supervisor,
  policies
});
```

`createAVOHarness()` and `createCoreHarness()` remain exported for low-level composition and kernel development. They are not the recommended production entrypoint.

The cognition APIs are composable rather than vendor-bound. Consumers may inject retrieval providers, storage, tracing, and execution infrastructure while retaining kernel-owned admission, provenance, revision, authority, and lifecycle semantics.

## Persistent state and consistency

Persistent work state has an explicit `schemaVersion` and monotonic `revision`.

Production `createHarness()` requires a revision-aware store. A store must reject a stale write instead of silently applying last-writer-wins. The bundled in-memory store is the reference semantics, not the production persistence recommendation.

The testing SDK exports `verifySessionStoreContract()` so a project-specific Postgres, SQLite, Redis, object-store, or remote implementation can prove the same behavior. A revision-aware store must return the revision it actually persisted; merely advertising revision support is insufficient.

Future schema versions must be rejected before they enter kernel state. Older compatible state is normalized at the persistence boundary; future-state guessing is forbidden.

Schema evolution is explicit and sequential:

```text
v1 -- migration 1->2 --> v2 -- migration 2->3 --> v3
```

`defineStateMigration()` and `createStateMigrator()` require every intermediate transition. Missing migration steps fail rather than silently coercing persistent engineering memory.

## External mutation consistency

No generic kernel can atomically commit arbitrary external side effects and its own state store. A process can crash after an external mutation succeeds but before the new candidate is persisted.

ExHarness therefore does not claim distributed rollback. The production facade gives every `environment.act()` call a deterministic `actionKey` derived from:

```text
session + current candidate + semantic action
```

A retry of the same semantic action from the same candidate receives the same key. Environment/executor adapters use that key to deduplicate or reconcile an uncertain prior attempt.

```text
external mutation succeeds
        |
process crashes before state save
        |
explicit recovery / retry
        |
identical actionKey
        |
consumer adapter deduplicates or reconciles
```

This is an idempotency/reconciliation protocol, not a fake transaction guarantee. Consumers whose external systems cannot provide idempotent or reconcilable mutation semantics must surface that limitation in their workload harness.

Memory evolution follows the same honesty rule. Multi-memory evolution prevalidates source revisions before mutation and uses CAS-guarded writes, but when independent stores do not share a transaction boundary ExHarness does **not** claim atomic multi-store commit. A mid-commit infrastructure/concurrency failure is surfaced as explicit partial evolution with the exact applied steps so recovery remains observable.

## Interrupted work and recovery

A `RUNNING` variation is durable state. Resume never silently erases it and never automatically assumes the worker is dead.

```text
RUNNING variation found
        |
        +--> resume/vary => RECOVERY_REQUIRED
        |
        +--> recover(force=false)
        |      only if stale by policy
        |
        +--> recover(force=true)
               explicit operator decision
```

Recovery completes the old variation with `termination=INTERRUPTED`. Any candidate/evidence changes already persisted remain visible; recovery does not roll them back or pretend the run never happened.

## Supervision semantics

Supervisor remains a search-control role, never a correctness oracle.

Deterministic trajectory signals may surface:

- no-change streak;
- repeated budget exhaustion;
- failed/interrupted variation frequency;
- exact repeated failed-direction records;
- unresolved active knowledge conflicts.

Signals request attention; they do not declare failure or success.

After a completed variation, a configured supervisor can be asked to redirect when the trajectory crosses a signal threshold. The same supervisor contract still forbids verdicts and candidate mutation. A valid redirect is persisted in `supervision.interventions`, enters trajectory, and is available to the next variation context.

## Execution boundary

Core capabilities do not need to execute processes directly. `Executor` is the infrastructure boundary:

```text
semantic capability
       |
       v
execution envelope
  capability
  request
  timeout
  AbortSignal
  constraints
       |
       v
consumer executor
  local / sandbox / container / remote / Codex / MCP / future
```

The kernel bounds the caller with timeout/abort behavior and transports explicit constraints. It does **not** claim that an in-process Promise timeout kills an OS process. Filesystem, network, credential, process, and resource containment must be enforced by the injected executor/sandbox adapter.

This is intentional: security authority belongs at the actual runtime boundary, not in prompts.

## Observation, memory, and cognition lifecycle

The completed cognition core follows this control loop:

```text
Environment / Candidate
        |
        v
OBSERVE
        |
        v
Observation
  identity / provenance / candidate revision / freshness / trust
        |
        +--> current context / evidence projection
        |
        +--> explicit memory encoding policy
                        |
                        v
                 Semantic Memory
                  typed kind
                  source refs
                  confidence
                  temporal validity
                  revision lifecycle
                        |
                        +--> retrieval / graph expansion
                        +--> reflection / evolution proposal
                                   |
                                   v
                         validated CAS mutation
                                   |
                                   v
Turn -> CodeAct -> ACT -> re-OBSERVE
        |
        v
objective EVALUATE
        |
        v
PROMOTE only after current evaluation PASS
```

Observations are high-volume sensory artifacts; memory is selected durable cognition. The kernel never automatically treats every observation as memory.

Semantic memory records support typed cognition roles including episodic, semantic, procedural, reflection, and intent memories. Rich fields such as confidence, temporal validity, typed source references, lifecycle state, revision, and provenance are kernel-owned semantics. Legacy records normalize conservatively rather than inventing confidence or lineage.

The relationship graph is stored outside memory record revisions. Directed typed relations such as `DERIVED_FROM` and `SUPERSEDES` preserve causal/semantic lineage without rewriting source memories.

Retrieval intelligence remains bounded and relevance-only. Provider candidates are re-read from authoritative memory storage, admission filters are re-applied, archived memory cannot be resurrected through graph topology, and graph-expanded candidates obey the same tag/kind/temporal rules. Ranking signals do not become truth, correctness evidence, or promotion authority.

Reflection/evolution is proposal-driven. Reflection code may propose merge/reconcile/supersede/abstract/reinforce/forget operations, but it cannot silently rewrite memory. Kernel validation checks source revisions and operation invariants before commit; resulting replacement/derivation lineage remains explicit.

## Observability and causal tracing

Kernel observability has three distinct forms:

- persistent engineering trajectory inside work state;
- canonical agent/observation/memory artifacts with stable identity and provenance;
- process/runtime trace spans for turns, context rendering, model/code execution, capability calls, recall, memory writes, and evolution.

Observability is not correctness. By default a failing telemetry sink is recorded without changing the engineering outcome. Consumers can opt into strict observability when losing telemetry itself should fail a run.

Correlation is explicit rather than heuristic. Runtime artifacts can answer questions such as:

```text
which turn produced this action?
which observation resulted from it?
which capability trace produced that observation?
which observation was encoded into this memory?
which memories were recalled for this turn?
which source revisions produced this reflection?
which evaluation authorized promotion?
```

Control-plane correlation metadata does not automatically enter model-facing history. Trace metadata references IDs and bounded query metadata; it does not dump semantic-memory content merely for observability.

## Testing and compatibility

The kernel ships deterministic utilities for clocks, IDs, fake environments/executors, and adapter contracts.

Repository verification now has five independent surfaces:

```text
kernel invariant + adversarial tests
        +
reference harness
        +
blank-consumer packed-package smoke
        +
deterministic control-plane / NOOA fidelity evaluations
        +
integrated cognition evaluation
```

The blank-consumer smoke installs the actual packed tarball and imports both `exharness` and `exharness/testing`; it is deliberately separate from source-relative tests.

`artifacts/cognition-eval.json` is the measured deterministic H8 artifact for the declared `observe-memory-act-v1` reference workload. The workload executes through the packed public package and proves composition across observation, episodic memory, explicit intelligent recall, mutation, re-observation, reflection/graph lineage, objective evaluation, and promotion.

Measured H8 reference metrics are:

```text
modelTurns: 3
javascriptCells: 3
hostCalls: 12
observations: 2
episodicMemories: 2
reflectionMemories: 1
retrievalCalls: 2
graphRelations: 2
finalRecallGraphHit: 1
evolutionCommits: 1
contextResolutions: 3
recallTraceSpans: 2
observationTraceLinks: 2
observationMemoryLinks: 2
earlyPromoteRejected: 1
evaluationPass: 1
lineageAdvanced: 1
falseSuccessCount: 0
unsafeAcceptCount: 0
```

These metrics are a deterministic reference workload, not a universal model-quality benchmark.

The CI compatibility gate runs the complete verification command on Node 20, 22, and 24.

## Completion gate

The runtime core is considered complete for the declared deterministic ExHarness reference scope when all of the following hold:

1. another project can import `createHarness` from the packed `exharness` package;
2. the project can inject its own environment, objective, strategy/model runtime, capabilities, verifier, store, executor, supervisor, retrieval providers, tracing, and policies without editing kernel code;
3. candidate lineage, verification freshness, persistent K, bounded variation, promotion, and feedback remain enforced by deterministic core semantics;
4. interrupted work is detectable and explicitly recoverable;
5. stale persistence writes conflict instead of silently overwriting progress;
6. schema evolution has an explicit sequential migration contract;
7. external mutation retries have a stable idempotency/reconciliation key;
8. supervisor redirects can survive context/process boundaries without gaining correctness or mutation authority;
9. execution is routed through an explicit adapter boundary with timeout/abort/constraints;
10. turn lifecycle and per-turn context/history refresh are explicit and bounded;
11. JavaScript CodeAct preserves persistent program state, typed terminal correction, live-object authority, and containment boundaries;
12. observations have stable identity, candidate/turn/capability provenance, freshness, and causal links without becoming evaluation authority;
13. semantic memory has typed records, revision-safe provenance, temporal/source semantics, archive lifecycle, and conservative compatibility normalization;
14. typed memory relationships preserve derivation/supersession lineage outside record mutation;
15. retrieval intelligence revalidates authoritative records, applies bounded relevance fusion and graph expansion, and remains relevance-only;
16. reflection/evolution uses explicit proposals, validation, CAS semantics, provenance, and visible partial-commit failure rather than silent rewrites;
17. context, action, observation, recall, memory evolution, evaluation, and promotion can be correlated through one causal trace domain;
18. the packed-package H8 workload proves `observe -> remember/recall -> act -> re-observe -> evolve -> evaluate -> promote` with early promotion rejected and no false/unsafe accept;
19. custom store/executor adapters have reusable contract verification;
20. tests, reference example, package smoke, benchmark/evals, npm pack, and supported-runtime matrix are green.

H1-H8 therefore close the **runtime semantic/cognition core** for the declared deterministic reference target. They do not close real-world workload validation or operational product maturity.

## Explicit non-goals / non-claims

The completed runtime core does not contain or claim:

- backend/frontend/QA/research workflows;
- repository/Figma/SRS/Task Provider semantics;
- a concrete model provider;
- a production shell/container/browser sandbox;
- automatic semantic truth resolution for conflicting memory;
- universal semantic-retrieval quality or optimal ranking weights;
- universal/scientific equivalence to NVIDIA NOOA;
- superiority over NOOA or plain coding agents on real engineering workloads;
- production operational maturity, distributed transactions, or automatic rollback over consumer side effects;
- benchmark-derived optimal context/supervision doses;
- parallel AVO branches.

Those are adapters, workload harnesses, or future evidence-driven extensions. The next meaningful evidence step is real backend/frontend/QA workload evaluation and comparison, not additional core capability expansion by default.
