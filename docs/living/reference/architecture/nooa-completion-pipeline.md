# NOOA substrate completion pipeline

This document is the execution authority for completing the NOOA-style programmable-agent substrate in ExHarness.

Detailed semantics, findings and residual boundaries live in stage architecture artifacts and PRs. This file owns stage order, checkpoint, scope and exit gates.

## Execution rule

```text
pipeline authority on main
        ↓
stage N objective + non-goals + verification gate
        ├─ implementation track
        └─ verification track
             ├─ manual vigilance
             ├─ adversarial cases
             ├─ inspectable artifacts
             └─ stable automation when valuable
        ↓
PASS / GAP
   ├─ GAP  → repair same stage
   └─ PASS → exact-head full gate
                  ↓
               merge to main
                  ↓
          post-merge integration gate
                  ↓
               stage N+1
```

Rules:

- every stage branches from current `main` after the prior stage is merged;
- one stage = one implementation PR;
- no stacked downstream implementation PRs;
- do not pull later-stage responsibilities into the current stage for convenience;
- tests/CI are verification artifacts, not the source of truth;
- material manual/adversarial findings must be recorded;
- a stage is DONE only when the exact final PR head passes its full gate and merged `main` remains healthy;
- architecture/order changes must patch this pipeline before downstream implementation continues.

## Status

```text
NOOA-01 Typed Judgment                         DONE
NOOA-02 Predict Strategy                       DONE
NOOA-03 AgentEvent working history             DONE
AVO-R1  Adaptive useful-range gate             DONE
NOOA-04 Context blocks + history selection     DONE
NOOA-05 ResourceRef / live resource semantics  DONE
NOOA-06 CodeAct execution loop                 DONE
NOOA-07 Nested tracing                         DONE
NOOA-08 Model routing / scoped overrides       DONE
NOOA-09 Runtime snapshot / resume              DONE
NOOA-10 Reference substrate + adversarial eval DONE
```

Current checkpoint: `NOOA substrate completion`.

The substrate completion claim is canonical after the exact final NOOA-10 head and merged `main` passed the full Node 20/22/24 integration gate.

## Follow-on fidelity expansion

The completed substrate intentionally stopped short of copying NOOA's identity-defining object-native ergonomics and language-native CodeAct. The follow-on execution authority is:

`docs/living/reference/architecture/nooa-fidelity-max-pipeline.md`

That pipeline pushes four areas further without weakening existing explicit authority/trust boundaries:

```text
agent-as-object ergonomics
live object reference graph
progressive doc()/surface discovery
language-native JavaScript CodeAct
```

The completion status in this file remains DONE; the fidelity pipeline is an expansion above this baseline, not a retroactive reopening of NOOA-01..10.

---

## Completed stage artifacts

| Stage | Architecture artifact | Stage PR |
|---|---|---:|
| NOOA-01 Typed Judgment | typed judgment contract in runtime/tests | #10 |
| NOOA-02 Predict Strategy | Predict strategy contract in runtime/tests | #11 |
| NOOA-03 AgentEvent working history | `docs/living/reference/architecture/agent-events.md` | #13 |
| AVO-R1 Adaptive useful-range gate | `docs/living/reference/architecture/adaptive-useful-range.md` | #16 |
| NOOA-04 Context blocks + history selection | `docs/living/reference/architecture/context-history.md` | #17 |
| NOOA-05 ResourceRef / live resources | `docs/living/reference/architecture/resource-ref.md` | #18 |
| NOOA-06 CodeAct | `docs/living/reference/architecture/codeact.md` | #19 |
| NOOA-07 Nested tracing | `docs/living/reference/architecture/nested-tracing.md` | #21 |
| NOOA-08 Model routing | `docs/living/reference/architecture/model-routing.md` | #22 |
| NOOA-09 Runtime snapshot / resume | `docs/living/reference/architecture/runtime-snapshot.md` | #23 |
| NOOA-10 Reference substrate + adversarial evaluation | `docs/living/reference/architecture/reference-substrate-evaluation.md` + `artifacts/nooa-reference-eval.json` | #24 |

---

## NOOA-10 — Reference substrate + adversarial evaluation — DONE

### Proven consumer path

The completion gate executes through the packed public package rather than source-relative imports:

```text
npm pack ./packages/core-harness
        ↓
blank temporary consumer
        ↓
install packed exharness tarball
        ↓
run reference substrate workload
        ↓
validate adversarial invariants
        ↓
deep-compare stable measured artifact
```

The reference workload composes, without kernel source special cases:

- typed judgments;
- Predict with bounded validation repair;
- AgentEvent working history;
- explicit context selection/history projection;
- bounded live `ResourceRef` access and progressive disclosure;
- CodeAct;
- nested tracing;
- scoped model routing and actual model-usage provenance;
- runtime snapshot/resume with explicit resource rebinding;
- an AVO variation above the restored NOOA runtime.

### Measured stable baseline

The checked-in reference artifact records stable measurements rather than prose-only claims. The completion candidate establishes:

```text
task success             1
model calls             13
invalid outputs          5
correction/retry         5
resource invocations     1
executor calls           1
resume fidelity          1
false success            0
unsafe accept            0
adversarial checks       8/8
```

Dynamic run identities such as snapshot digests and evaluation UUIDs remain provenance but are intentionally excluded from brittle baseline comparison.

### Material finding from evaluation

The first packed-consumer run exposed that an unknown model route failed closed but surfaced only as an unclassified plain `Error`. N10 repaired that boundary so invalid routes now fail as a stable `ModelRouteError` under `CONTRACT_VIOLATION`, with focused regression coverage. The reference gate was retained rather than weakened.

### Claim boundary

This stage proves reusable substrate contracts and fail-closed behavior for the deterministic reference workload. It does **not** claim universal model quality, optimal context dosage, provider-specific reliability, or workload-domain correctness.

---

## Completion condition

The NOOA substrate is complete when a blank consumer can import ExHarness and, without kernel source changes:

```text
define typed judgments
        +
choose Predict / CodeAct behavior
        +
control context + working history
        +
expose bounded live resources/capabilities
        +
route models by scope
        +
inspect nested traces
        +
snapshot/resume runtime working state
        ↓
run under the existing AVO long-horizon control plane
        ↓
produce inspectable reference/adversarial evaluation artifacts
```

Final layering:

```text
AVO
  long-horizon search / lineage / supervision / commit
        ↓
ExHarness NOOA-style substrate
  typed judgment / strategy / context / events / resources / execution
        ↓
Injected infrastructure
  models / tools / sandbox / store / tracing / trust authorities
```
