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
NOOA-G4 Semantic memory port                   DONE on PR candidate
NOOA-G5 Associative recall contract            NEXT after G4 merge
NOOA-G6 Spontaneous recall                     PENDING
NOOA-G7 Integrated/adversarial evaluation      PENDING
```

Current checkpoint: `G4 exact-head verification pending`.

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
- context render failure closes the prepared turn before model generation;
- G2 deliberately keeps history sourced from the pre-invocation canonical snapshot.

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
- `selectHistory` remains subset-only and canonical-order preserving;
- `reduceHistory` stays a lossy projection and cannot mutate canonical events;
- reduced history retains exact `sourceEventIds` provenance;
- fabricated provenance fails closed before the next model generation;
- history/context bounds are re-enforced at each turn;
- G1 lifecycle and G2 dynamic-context refresh semantics are unchanged.

The measured packed-consumer reference artifact changes only where G3 intentionally changes prompt projection size. All correctness, false-success, unsafe-accept, authority and adversarial metrics remain unchanged.

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
- provenance preserves optional call/turn identity without asserting truth;
- updates and archives use optimistic revision checks and stale writers fail closed;
- provider return values cross clone boundaries so persistence identity cannot leak to callers;
- archived records are hidden by default but remain explicitly inspectable;
- provider implementation owns bytes/storage and may later own indexes;
- G4 intentionally exposes no semantic `recall()` / `search()` / ranking surface.

Artifact: `docs/architecture/semantic-memory-port.md`.

---

## G5 — Associative recall

Provide bounded recall/search results with ranking provenance and replaceable provider implementation.

Retrieval result is relevant context, not truth or correctness evidence.

---

## G6 — Spontaneous recall

Use the G1/G2 turn boundary for `SELF_GATED`, `PER_TASK` and `EVERY_TURN` recall policies. Inject recalled memory through the existing context plane as bounded data, never implicit trusted instruction.

---

## G7 — Integrated evaluation

Exercise a long multi-turn CodeAct workload where:

- dynamic context changes during execution;
- history must evolve without losing canonical provenance;
- a later turn depends on semantic recall;
- stale/poisoned memory is adversarially present;
- AVO remains above the runtime;
- false success / unsafe accept remain zero under the declared reference workload.

Only after G7 may the repository claim NOOA-grade turn lifecycle + semantic-memory semantics for the declared ExHarness target.
