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
NOOA-F4 Language-native JavaScript CodeAct session  NEXT
NOOA-F5 Fidelity reference + adversarial evaluation PENDING
```

Current checkpoint: `NOOA-F4 Language-native JavaScript CodeAct session`.

Branch-level `DONE` becomes canonical only after the exact final stage head and merged `main` both pass the full Node 20/22/24 gate.

Completed artifacts:

- F1: `docs/architecture/object-agent.md` — PR #26.
- F2: `docs/architecture/live-object-reference-graph.md` — PR #27.
- F3: `docs/architecture/progressive-discovery.md` — PR #28.

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

Detailed artifact: `docs/architecture/object-agent.md`.

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

Detailed artifact: `docs/architecture/live-object-reference-graph.md`.

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

Detailed artifact: `docs/architecture/progressive-discovery.md`.

---

## NOOA-F4 — Language-native JavaScript CodeAct session

### Objective

Add a CodeAct mode where the model writes JavaScript cells against a persistent per-call execution session, analogous to NOOA's Python REPL, while authority remains mediated by an injected sandbox/executor.

### Target model loop

```text
model
  ↓
execute_javascript(code)
  ↓
injected sandbox session
  ├─ persistent locals across cells
  ├─ self = live remote agent proxy
  ├─ doc(obj)
  ├─ stdout/stderr/result observation
  └─ return_result(value)
  ↓
next model turn or typed terminal result
```

### Required semantics

- generated source code is a first-class model action;
- per-call locals persist across cells;
- prior cell outputs are addressable in-session;
- `self` and discovered objects are live proxies/handles, not serialized clones;
- deterministic public methods can be called naturally through the host bridge;
- `doc()` works inside the execution session;
- `return_result(value)` terminates from generated code;
- stdout/stderr/execution errors become bounded observations;
- typed final validation can feed correction back into the loop;
- executor/session lifecycle is explicit open/execute/close;
- host calls are budgeted separately from cells;
- wall-clock/cell/output/host-call limits remain runtime-owned;
- sandbox/process cancellation semantics are explicit and never overstated.

### Backward compatibility

The finite action-protocol CodeAct remains supported. Language-native CodeAct is an additional strategy/mode.

### Verification gate

Reference tasks must require real glue code: loop/branch/local reuse, two or more live-object calls, nested discovery, mutation+reread, and in-cell `return_result`. Adversarial cases: infinite-loop containment, forbidden host method, stale handle, huge stdout, syntax/runtime errors, sandbox crash, host-call budget exhaustion, and terminal-action smuggling.

---

## NOOA-F5 — Fidelity reference + adversarial evaluation

### Objective

Prove F1-F4 through the packed public package and compare with the existing explicit runtime/action-protocol baseline.

### Required scenarios

1. ordinary object ergonomics;
2. live identity + mutation;
3. progressive discovery;
4. generated JavaScript with persistent locals/live proxies;
5. AVO composition above the resulting runtime.

### Measurements

At minimum record task success, false-success/unsafe-accept, model turns, code cells, host/live calls, corrections, initial/discovered context size, handle/stale rejection counts, sandbox failures, trace correlation, snapshot/rebind fidelity, and packed-consumer success.

### Completion target

```text
Agent-as-object ergonomics   >= 90% semantic target
Live object semantics       >= 90% semantic target
Progressive discovery       >= 90% semantic target
CodeAct fidelity            >= 90% semantic target
```

These percentages are explicit capability-rubric labels, not scientific benchmark scores.

## Final identity if complete

```text
ExHarness
  = AVO long-horizon control plane
  + NOOA-like object-native agent runtime
  + explicit authority / trust / verification boundaries
  + injected sandbox and infrastructure
```
