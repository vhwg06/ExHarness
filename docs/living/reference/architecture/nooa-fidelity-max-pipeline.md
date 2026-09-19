# NOOA fidelity maximization pipeline

This document is the execution authority for pushing the NOOA-inspired ExHarness runtime toward the identity-defining semantics that NOOA does especially well: agent-as-object ergonomics, live object semantics, progressive discovery, and language-native CodeAct.

The completed NOOA substrate pipeline remains valid. This pipeline is a fidelity expansion above that baseline; it must not weaken existing AVO, ResourceRef, trust, verification, or containment boundaries merely to resemble NOOA syntax.

## Semantic target

```text
ordinary agent object
        ↓
ordinary public deterministic methods are capabilities
        ↓
agentic methods are called like normal methods
        ↓
stateful helper objects remain live by reference
        ↓
initial prompt exposes a small self surface
        ↓
doc(self) / doc(obj) progressively discovers more
        ↓
CodeAct writes language-native JavaScript cells
        ↓
persistent per-call locals + live-object proxies
        ↓
return_result(value) terminates through typed validation
```

## Non-negotiable invariants

1. Generated JavaScript is never treated as contained by parser checks or Node `vm`; an injected executor/sandbox is the real containment boundary.
2. Live object does not mean serialized object.
3. Discovery does not imply authority.
4. Public-by-default is scoped to an agent surface, not arbitrary transitive reflection.
5. Agentic methods cannot self-certify correctness.
6. CodeAct budgets stay outside model control.
7. Snapshot/resume never resurrects transient object authority.
8. Existing explicit runtime APIs and action-protocol CodeAct remain backward compatible.

## Execution rule

```text
pipeline authority on main
        ↓
stage F-N objective + non-goals + verification gate
        ├─ implementation track
        └─ verification track
             ├─ manual threat/ergonomics review
             ├─ adversarial cases
             ├─ packed-consumer proof when public API changes
             └─ inspectable measurement artifact
        ↓
PASS / GAP
   ├─ GAP → repair same stage
   └─ PASS → exact-head Node 20/22/24 gate
                  ↓
               merge main
                  ↓
          post-merge integration gate
                  ↓
               next stage
```

Every implementation stage branches from merged `main` of the prior stage. Do not stack downstream implementation branches.

## Status

```text
NOOA-F1 Agent-as-object runtime surface             DONE
NOOA-F2 Live object reference graph                 DONE
NOOA-F3 Progressive doc()/surface discovery         DONE
NOOA-F4 Language-native JavaScript CodeAct session  DONE
NOOA-F5 Fidelity reference + adversarial evaluation DONE
```

Current checkpoint: `NOOA fidelity expansion complete`.

The completion claim becomes canonical only after the exact final F5 head and merged `main` both pass the full Node 20/22/24 gate.

Completed artifacts:

- F1: `docs/living/reference/architecture/object-agent.md` — PR #26.
- F2: `docs/living/reference/architecture/live-object-reference-graph.md` — PR #27.
- F3: `docs/living/reference/architecture/progressive-discovery.md` — PR #28.
- F4: `docs/living/reference/architecture/javascript-codeact-session.md` — PR #29.
- F5: `docs/living/reference/architecture/fidelity-reference-evaluation.md` + `artifacts/nooa-fidelity-eval.json` — PR #30.

---

## NOOA-F1 — Agent-as-object runtime surface — DONE

### Objective

Make normal JavaScript objects/classes the ergonomic ExHarness programming surface while reusing AgentRuntime as execution authority.

### Proven semantics

- exact object identity / `instanceof` / normal `this` dispatch;
- ordinary public methods become deterministic runtime capabilities without duplicate bodies;
- agentic marker methods remain ordinary awaited methods backed by typed Judgments;
- hidden/private/platform methods are excluded;
- attach-time implementation binding prevents monkeypatch authority laundering;
- zero/multi-argument calls have explicit bridges;
- packed consumer proves the public package path.

Detailed artifact: `docs/living/reference/architecture/object-agent.md`.

---

## NOOA-F2 — Live object reference graph — DONE

### Objective

Preserve live object identity, mutation and cycles behind explicit authority handles without serializing object graphs.

### Proven semantics

- same object + same authority/lifetime scope reuses one handle;
- different authority surface gets a different handle;
- nested/cyclic results preserve identity;
- mutation is visible on the original object;
- undeclared/reflected members remain unavailable;
- live refs cannot escape ordinary transport or become arguments without opt-in;
- call-scoped handles expire; stale refs fail deterministically;
- tracing/observability/snapshot/rebind preserve authority boundaries;
- packed consumer proves cyclic identity and mutation/reread.

Detailed artifact: `docs/living/reference/architecture/live-object-reference-graph.md`.

---

## NOOA-F3 — Progressive `doc()` / surface discovery — DONE

### Objective

Give the model NOOA-style progressive discovery: a small initial `self` contract and on-demand docs for object-agent and live-object surfaces.

### Proven semantics

- every object-agent agentic judgment gets a bounded `CONCISE` self document through the existing trusted N4 context plane;
- `docObjectAgent()` supports concise/full modes without hidden members;
- `docLiveObject()` resolves F2 handles through DESCRIBE authority before rendering;
- discovery never grants invoke/read authority;
- member count, serialized chars and descriptions are bounded with explicit truncation metadata;
- no transitive graph dump occurs;
- packed consumer measured `236` concise chars vs `725` full chars (32.6% initial/full) while task completion remained PASS.

Detailed artifact: `docs/living/reference/architecture/progressive-discovery.md`.

---

## NOOA-F4 — Language-native JavaScript CodeAct session — DONE

### Objective

Add a CodeAct mode where the model writes JavaScript cells against a persistent per-call execution session, analogous to NOOA's Python REPL, while authority remains mediated by an injected sandbox/executor.

### Proven semantics

- generated JavaScript source is a first-class model action;
- one persistent per-call execution session preserves locals across cells;
- `self`, nested live objects and `doc()` stay behind kernel-owned host authority;
- typed `return_result(value)` terminates through an explicit `CELL_ABORT` executor handshake;
- generated-code failures become bounded observations while executor/infrastructure failures propagate;
- model turns, code cells, host calls, wall-clock and output bounds remain runtime-owned;
- finite action-protocol CodeAct remains supported;
- packed child-process reference execution proves real JavaScript looping, persistent locals, nested discovery, mutation/reread, terminal abort and infinite-loop containment.

Detailed artifact: `docs/living/reference/architecture/javascript-codeact-session.md`.

### Measured packed reference path

```text
JavaScript cells          2
host calls                8
execution errors          0
worker opens/closes       1 / 1
result.total              12
nested discovered members 3
live mutation             before → after
infinite loop contained   true
forced process kills      1
```

### Material findings repaired during verification

- executor/process abort was initially laundered into recoverable JavaScript feedback;
- `return_result()` initially did not stop pure JavaScript statements later in the same cell;
- the process reference bridge initially revived a nested live ref twice and lost proxy identity.

The stage retained the packed real-language gate that exposed those failures.

---

## NOOA-F5 — Fidelity reference + adversarial evaluation — DONE

### Objective

Prove F1-F4 through the packed public package and compare with the existing explicit runtime/action-protocol baseline.

### Proven packed scenarios

1. ordinary object ergonomics;
2. live identity, cycles and mutation;
3. progressive discovery;
4. generated JavaScript with persistent locals and live proxies;
5. AVO composition above JavaScript CodeAct;
6. trace correlation and snapshot/rebind authority freshness;
7. adversarial authority, terminal and containment failures.

Detailed artifact: `docs/living/reference/architecture/fidelity-reference-evaluation.md`.
Stable measurement artifact: `artifacts/nooa-fidelity-eval.json`.

### Measured same-task comparison

```text
explicit action-protocol baseline
  model turns       6
  capability calls  5
  final result      { total: 12, name: "after" }

JavaScript fidelity path
  model turns       2
  JavaScript cells  2
  host calls         8
  final result      { total: 12, name: "after" }

reference-task model-turn reduction  66.67%
```

The reduction is specific to the deterministic reference task; it is not a universal latency/token/cost claim.

### Fidelity measurements

```text
initial/full discovery chars  242 / 688
initial/full ratio             35.17%
typed corrections              1
handle rejections              3
sandbox failures observed      2
trace correlation              PASS (13 correlated spans)
snapshot/rebind fidelity       PASS
AVO composition                PASS
packed consumer                PASS
false success                  0
unsafe accept                  0
adversarial checks             8 / 8
```

### Capability rubric

```text
Agent-as-object ergonomics   100 (10/10)
Live object semantics        100 (10/10)
Progressive discovery        100 (10/10)
CodeAct fidelity             100 (10/10)
```

These are explicit capability-coverage labels for the declared semantic target, not scientific benchmark scores.

### Material finding repaired during verification

The first packed F5 candidate declared `rename/getName` on a live surface while its root fixture implemented only `child()`. The runtime failed closed at authority binding. F5 repaired the fixture to match its declared surface; it did not weaken the runtime, rubric or verification gate.

---

## Final identity and claim boundary

Within the deterministic reference-workload boundary, the fidelity pipeline establishes:

```text
ExHarness
  = AVO long-horizon control plane
  + NOOA-like object-native agent runtime
  + explicit authority / trust / verification boundaries
  + injected sandbox and infrastructure
```

Completion does not claim universal model quality, scientific equivalence with every NOOA detail, provider reliability, production security of the reference child-process/`vm` worker, or universal token/latency/cost improvement.
