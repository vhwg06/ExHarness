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

Do not stack G2 on an unmerged G1 branch or G3 on an unmerged G2 branch.

## Status

```text
NOOA-G1 Turn lifecycle                         DONE
NOOA-G2 Turn-aware context refresh             DONE on PR candidate
NOOA-G3 Safe history evolution                 NEXT after G2 merge
NOOA-G4 Semantic memory port                   PENDING
NOOA-G5 Associative recall contract            PENDING
NOOA-G6 Spontaneous recall                     PENDING
NOOA-G7 Integrated/adversarial evaluation      PENDING
```

Current checkpoint: `G2 exact-head verification pending after final docs commit`.

---

## G1 — Turn lifecycle

### Objective

Introduce first-class `BEFORE_TURN` / `AFTER_TURN` runtime boundaries for every built-in model generation while keeping lifecycle events outside canonical `AgentEvent` history.

### Required semantics

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

### Required semantics

- `AFTER_TURN` observes a completed turn, including action/validation effects;
- next `BEFORE_TURN` projects from the then-current canonical journal;
- `selectHistory` remains subset-only and canonical-order preserving;
- `reduceHistory` stays lossy projection, never authoritative replacement;
- source event provenance remains explicit;
- bounded history/context failure remains fail-closed;
- no reducer may rewrite canonical events.

G3 should reuse the existing selector/reducer machinery rather than invent a second summary store unless real workload evidence requires one.

---

## G4 — Semantic memory port

Separate associative memory from AVO persistent knowledge and AgentEvent history.

Kernel owns contracts, provenance and lifecycle; providers own embeddings, lexical search, vector indexes, graph spread and physical persistence.

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
