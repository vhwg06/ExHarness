# NOOA turn + semantic-memory fidelity pipeline

This pipeline extends the completed NOOA object/runtime fidelity track without reopening its F1-F5 semantics.

The objective is narrow: close the two remaining runtime gaps that matter for ExHarness kernel use — turn-aware context lifecycle and semantic memory — while preserving AVO, authority, trust, verification and containment boundaries.

## Execution rule

```text
stage G-N
  ↓
implementation + verification
  ↓
exact-head Node 20/22/24
  ↓
merge main
  ↓
post-merge Node 20/22/24
  ↓
next stage branches from merged main
```

Do not stack a stage on an unmerged predecessor.

## Status

```text
NOOA-G1 Turn lifecycle                         DONE
NOOA-G2 Turn-aware context refresh             DONE
NOOA-G3 Safe history evolution                 DONE
NOOA-G4 Semantic memory port                   DONE
NOOA-G5 Associative recall contract            DONE
NOOA-G6 Spontaneous recall                     DONE
NOOA-G7 Integrated/adversarial evaluation      DONE
```

Current checkpoint: `G1-G7 canonical DONE; G7 exact-head and post-merge Node 20/22/24 green`.

---

## G1 — Turn lifecycle

### Objective

Introduce first-class `BEFORE_TURN` / `AFTER_TURN` runtime boundaries for every built-in model generation while keeping lifecycle events outside canonical `AgentEvent` history.

### Proven semantics

- monotonic runtime-owned turn identity per call;
- exactly one active turn at a time;
- `BEFORE_TURN` occurs before model generation;
- action/code/validation work remains inside the current turn;
- the previous turn closes before the next model turn opens;
- terminal result/error closes the final active turn exactly once;
- concurrent model turns fail closed;
- instrumentation preserves `turnEvents()`.

Artifact: `docs/architecture/turn-lifecycle.md`.

---

## G2 — Turn-aware context refresh

### Objective

Rebuild the model-facing prompt projection at every `BEFORE_TURN` rather than once per AgentRuntime invocation.

### Proven semantics

```text
previous turn closes
        ↓
BEFORE_TURN
        ↓
renderAgentContext(turn=N)
        ↓
fresh promptContext
        ↓
model generation
```

- dynamic blocks re-resolve once per turn;
- runtime-owned `turn` joins `callId` / `judgment` resolver metadata;
- context selection and hard bounds remain unchanged and are re-enforced every turn;
- call input cannot promote itself into trusted blocks;
- Predict and both CodeAct paths consume the same `prepareTurn()` projection seam;
- single-turn built-ins avoid an extra eager context resolution;
- JavaScript CodeAct `doc(self)` follows the latest turn projection;
- context render failure closes the prepared turn before model generation.

Artifact: `docs/architecture/turn-context-refresh.md`.

---

## G3 — Safe history evolution

### Objective

Make selected/reduced prompt history evolve at turn boundaries while canonical `AgentEvent` remains authoritative.

### Proven semantics

```text
current canonical AgentEvent journal
        ↓
exclude current invocation TASK
        ↓
selectHistory (subset only)
        ↓
maxHistoryEvents / serialized bounds
        ↓
reduceHistory (optional, clone only)
        ↓
next-turn prompt history
```

- the next turn sees completed MODEL_OUTPUT / ACTION_OUTPUT / ACTION_ERROR / VALIDATION_ERROR records from the previous turn;
- the current invocation TASK is excluded so call input is not duplicated into prompt history;
- prior-call canonical history remains eligible exactly as before when history is selected;
- selectors cannot fabricate/reorder canonical provenance;
- reducers stay lossy projections and cannot mutate canonical events;
- history/context bounds are re-enforced at each turn.

Artifact: `docs/architecture/turn-history-evolution.md`.

---

## G4 — Semantic memory port

### Objective

Separate associative memory from AVO persistent knowledge and AgentEvent history while giving the kernel a provider-neutral lifecycle/provenance contract.

### Proven semantics

```text
remember
  ↓
ACTIVE record revision 1
  ↓
update (CAS)
  ↓
revision N + append-only provenance
  ↓
archive (CAS)
  ↓
ARCHIVED, retained for explicit inspection
```

- semantic memory is not AVO `KnowledgeKind` state and is not candidate/lineage scoped;
- semantic memory is not canonical AgentEvent history;
- every create/update/archive operation carries explicit provenance;
- updates and archives use optimistic revision checks and stale writers fail closed;
- provider return values cross clone boundaries so persistence identity cannot leak to callers;
- archived records are hidden by default but remain explicitly inspectable.

Artifact: `docs/architecture/semantic-memory-port.md`.

---

## G5 — Associative recall

### Objective

Provide bounded recall/search results with ranking provenance while keeping authoritative memory content in the G4 lifecycle store.

### Proven semantics

```text
retriever
  ↓
memoryId + score + reasons
  ↓
kernel re-reads authoritative record
  ↓
drop archived / tag mismatch
  ↓
maxItems + maxSerializedChars
  ↓
RELEVANCE_ONLY RecallResult
```

- retrievers cannot supply or override memory content;
- unknown or duplicate memory IDs fail closed;
- stale indexes cannot resurrect archived records;
- caller tag constraints are rechecked against authoritative memory metadata;
- provider ordering becomes explicit rank provenance;
- score/reasons explain ranking only;
- retrieval output is `RELEVANCE_ONLY` and contains no truth, trust or verdict authority;
- G5 performs no prompt injection.

Artifact: `docs/architecture/associative-recall.md`.

---

## G6 — Spontaneous recall

### Objective

Use G2 per-turn dynamic-context resolution to apply explicit semantic-memory recall cadence without creating a second prompt plane or weakening context authority.

### Proven semantics

```text
judgment explicitly selects __semantic_memory__
        ↓
BEFORE_TURN
        ↓
dynamic context resolve
        ↓
SELF_GATED | PER_TASK | EVERY_TURN
        ↓
G5 recall or cached reuse
        ↓
UNTRUSTED semantic-memory block
        ↓
existing context hard bounds
        ↓
model
```

- memory remains invisible to judgments that do not select the reserved block;
- spontaneous memory can never become a TRUSTED context block;
- `SELF_GATED` deterministically recalls again only when `deriveQuery()` changes;
- `PER_TASK` recalls once per runtime call and reuses later turns;
- `EVERY_TURN` performs recall at each selected model turn;
- no extra model call is spent deciding whether memory is needed;
- query derivation is consumer-owned and can observe live application/Oracle state through closure while resolver metadata itself stays limited to safe `callId/judgment/turn`;
- G5 remains the only ranking/materialization authority;
- existing `maxBlocks` and `maxSerializedChars` remain the final model-facing budget;
- retrieval/context failures happen before model generation;
- per-call cadence caches are isolated by call ID and bounded by deterministic LRU rather than retained without limit.

Artifact: `docs/architecture/spontaneous-recall.md`.

---

## G7 — Integrated/adversarial evaluation

### Objective

Prove G1-G6 together through the packed consumer boundary under one deterministic multi-turn JavaScript CodeAct workload with AVO still owning promotion correctness.

### Reference workload

```text
turn 1
  recalled memory includes active poison
  archived stale memory is filtered
  model tries PROMOTE before evaluation -> rejected
  ACT mutates candidate v0 -> v1

turn 2
  fresh phase = mutated
  history contains turn-1 model/action records
  SELF_GATED query changes -> recall again
  OBSERVE confirms v1

turn 3
  phase remains mutated
  history grows again
  stable query -> reuse prior recall
  EVALUATE -> PASS
  PROMOTE -> committed lineage v1
```

### Stable measured artifact

`artifacts/nooa-turn-memory-eval.json` is produced through the packed blank-consumer path and matched identically on Node 20, 22 and 24 during the G7 measurement run.

```text
modelTurns              3
javascriptCells         3
hostCalls               6
retrievalCalls          2
recallQueries           duplicate-delivery -> post-mutation-check
phaseByTurn             initial -> mutated -> mutated
historyEventsByTurn     0 -> 2 -> 4
memoryTrustViolations   0
archivedMemoryLeaks     0
poisonMemoryVisible     1
earlyPromoteRejected    1
evaluationPass          1
lineageAdvanced         1
falseSuccessCount       0
unsafeAcceptCount       0
BEFORE_TURN / AFTER     3 / 3
```

The eval keeps semantic assertions and also deep-compares the full deterministic result against the checked-in artifact. Metric drift therefore fails CI rather than silently redefining the reference target.

Artifact: `docs/architecture/turn-memory-reference-evaluation.md` + `artifacts/nooa-turn-memory-eval.json`.

G7 merge commit `6a63a6a675577ada713d326a6fd11ad42e5a5af6` passed the post-merge Node 20/22/24 matrix.

## Claim boundary after G7

G7 is merged and its post-merge matrix is green. The repository may claim **NOOA-grade turn lifecycle + semantic-memory semantics for the declared ExHarness deterministic target/reference workload**.

It does not prove:

- universal or scientific equivalence to every NOOA behavior;
- semantic retrieval quality across arbitrary providers/models/workloads;
- production sandbox containment;
- production operational maturity;
- superiority on real engineering workloads.

The next evidence-bearing step is real workload evaluation, not further NOOA capability chasing by default.
