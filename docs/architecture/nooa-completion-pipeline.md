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
NOOA-10 Reference substrate + adversarial eval NEXT
```

Current checkpoint: `NOOA-10`.

---

## Completed stage artifacts

| Stage | Architecture artifact | Stage PR |
|---|---|---:|
| NOOA-01 Typed Judgment | typed judgment contract in runtime/tests | #10 |
| NOOA-02 Predict Strategy | Predict strategy contract in runtime/tests | #11 |
| NOOA-03 AgentEvent working history | `docs/architecture/agent-events.md` | #13 |
| AVO-R1 Adaptive useful-range gate | `docs/architecture/adaptive-useful-range.md` | #16 |
| NOOA-04 Context blocks + history selection | `docs/architecture/context-history.md` | #17 |
| NOOA-05 ResourceRef / live resources | `docs/architecture/resource-ref.md` | #18 |
| NOOA-06 CodeAct | `docs/architecture/codeact.md` | #19 |
| NOOA-07 Nested tracing | `docs/architecture/nested-tracing.md` | #21 |
| NOOA-08 Model routing | `docs/architecture/model-routing.md` | #22 |
| NOOA-09 Runtime snapshot / resume | `docs/architecture/runtime-snapshot.md` | #23 |

The pipeline status above means implementation has reached each stage's branch-level exit contract. A stage becomes canonical only after its PR and post-merge `main` integration gate succeed.

---

## NOOA-10 — Reference substrate + adversarial evaluation — NEXT

### Goal

Prove the completed substrate works as a reusable consumer-facing runtime rather than as isolated APIs.

The reference workload must consume ExHarness through public package/runtime surfaces and must not require kernel source changes or special-case hooks.

### Reference scenario requirements

The scenario must exercise, together:

- typed judgments;
- Predict;
- AgentEvent working history;
- explicit context selection/history projection;
- bounded live `ResourceRef` access;
- CodeAct;
- nested tracing;
- scoped model routing and actual model-usage provenance;
- runtime snapshot/resume with safe resource rebinding;
- an AVO variation above the NOOA substrate without kernel special cases.

### Adversarial/evaluation matrix

At minimum challenge:

- Predict vs CodeAct on simple typed judgments;
- full vs selected history;
- progressive `ResourceRef` disclosure vs eager exposure;
- model-routing precedence and invalid routes;
- route resolution vs actual model usage;
- resume on/off and compatibility mismatch;
- malformed model actions;
- stale/cross-runtime resource refs;
- context poisoning/common-context pressure;
- oversized observation pressure;
- telemetry/tracing sink failures;
- false success / unsafe acceptance.

### Metrics

Capture at minimum:

- task success;
- invalid output rate;
- correction/retry count;
- model calls;
- execution/capability/resource calls;
- prompt/context size where observable;
- false-success / unsafe-accept rate for the reference workload;
- resume fidelity;
- verification/evaluation outcome provenance.

### Verification gate

N10 is PASS only when:

1. a blank consumer path imports the packaged/public ExHarness surface;
2. the reference workload demonstrates all required substrate capabilities without kernel source modification;
3. adversarial cases produce expected fail-closed behavior;
4. measured outputs are inspectable artifacts rather than prose-only claims;
5. the existing package/consumer/example/benchmark gates remain green on Node 20/22/24;
6. exact final PR head passes the full gate;
7. merged `main` passes the post-merge integration gate.

### Non-goals

- claiming universal model quality;
- adding workload-specific backend/frontend/QA semantics to the kernel;
- provider-specific SDK policy;
- inventing benchmark optima from one reference workload;
- broadening N10 into new substrate features unless evaluation exposes a contract bug.

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
