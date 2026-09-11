# NOOA fidelity maximization pipeline

This document is the execution authority for pushing the NOOA-inspired ExHarness runtime toward the identity-defining semantics that NOOA does especially well: agent-as-object ergonomics, live object semantics, progressive discovery, and language-native CodeAct.

The completed NOOA substrate pipeline remains valid. This pipeline is a fidelity expansion above that baseline; it must not weaken the existing AVO, ResourceRef, trust, verification, or containment boundaries merely to resemble NOOA syntax.

## Semantic target

The target is not Python syntax parity. The target is this user/programming model:

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

NOOA is the semantic reference for this pipeline. ExHarness remains explicit where JavaScript lacks Python runtime type metadata and where explicit authority improves security.

## Non-negotiable invariants

1. **Containment remains external to generated code.** Generated JavaScript is never treated as safely contained by parser checks or Node `vm`; an injected executor/sandbox is the real containment boundary.
2. **Live object does not mean serialized object.** Object identity and mutations must be preserved without dumping raw objects into model context or persistence.
3. **Discovery does not imply authority.** Seeing a method/property description does not grant invocation authority beyond runtime policy.
4. **Public-by-default is scoped to an agent object surface, not arbitrary transitive reflection.** Private/internal/framework members remain hidden and nested objects require deliberate discovery.
5. **Agentic methods cannot self-certify correctness.** Existing typed output, objective, verification, and AVO promotion authority remain unchanged.
6. **CodeAct budgets stay outside model control.** Turns/cells, action/host calls, wall clock, output/context bounds, and sandbox policy remain runtime-owned.
7. **Snapshot/resume never resurrects transient object authority.** Any new live-object handles must obey the existing fresh-rebind model.
8. **Backward compatibility is preserved unless a breaking change is explicitly justified and versioned.** Existing `defineJudgment`, `defineCapability`, `ResourceRef`, and action-protocol CodeAct remain supported.

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

Every implementation stage branches from the merged `main` of the prior stage. Do not stack downstream implementation branches.

## Status

```text
NOOA-F1 Agent-as-object runtime surface             DONE
NOOA-F2 Live object reference graph                 NEXT
NOOA-F3 Progressive doc()/surface discovery         PENDING
NOOA-F4 Language-native JavaScript CodeAct session  PENDING
NOOA-F5 Fidelity reference + adversarial evaluation PENDING
```

Current checkpoint: `NOOA-F2 Live object reference graph`.

Branch-level `DONE` becomes canonical only after the exact final stage head and merged `main` both pass the full Node 20/22/24 gate.

Completed F1 artifact: `docs/architecture/object-agent.md` (stage PR #26).

---

## NOOA-F1 — Agent-as-object runtime surface — DONE

### Objective

Make normal JavaScript objects/classes the ergonomic programming surface while reusing the existing AgentRuntime underneath.

Proven consumer shape:

```js
class InventoryAgent extends Agent {
  stock(sku) {
    return this.inventory.get(sku) ?? 0;
  }

  answer = agenticMethod({
    strategy,
    parseInput,
    parseOutput,
    model
  });
}

const agent = createObjectAgent(new InventoryAgent(...));

agent.stock("X");
await agent.answer("Do we have X?");
```

The returned agent is the exact original object identity. Deterministic public methods are backed by runtime capabilities without duplicate implementation bodies; agentic marker fields become ordinary awaited methods backed by typed Judgments.

### Required semantics

- object identity is stable for the lifetime of the runtime;
- ordinary public prototype methods can become deterministic capabilities without duplicate implementation registration;
- agentic methods delegate through typed Judgment/runtime semantics but remain ordinary awaited methods to callers;
- private/internal names are hidden by convention and explicit metadata;
- per-instance fields/helper objects remain per-instance, never class-shared by framework magic;
- model routing/context/events/tracing still correlate to the same underlying invocation;
- existing explicit runtime APIs remain available.

### Non-goals

- language-native code execution;
- transitive live object proxying;
- full `doc(obj)` rendering;
- decorators requiring syntax/runtime support unavailable in the supported Node matrix.

### Verification gate

Proven before stage-status flip:

- deterministic public method can be invoked by the runtime without a duplicate function body;
- agentic method called as an ordinary object method receives typed validation/model routing/context/tracing;
- hidden/private method is never auto-exposed;
- two instances do not share mutable tool state;
- method override/subclass dispatch uses the actual attach-time instance implementation;
- getters/accessors are not executed during reflection;
- inherited platform/library methods are not reflected from arbitrary wrapped classes;
- runtime capability implementation cannot be replaced by later application monkeypatching;
- zero/multi-argument method calls have an explicit unambiguous bridge;
- public `then()` is rejected unless hidden;
- public API is proven through the packed blank consumer.

Detailed findings and residual boundary: `docs/architecture/object-agent.md`.

---

## NOOA-F2 — Live object reference graph

### Objective

Extend `ResourceRef` from named registered resources into a safe graph of live object identities that can be returned, stored in a per-call execution session, and re-used without JSON serialization.

### Required semantics

- stable handle identity: the same live object maps to the same handle within its authority/lifetime scope;
- nested returned objects may become handles instead of forced JSON values;
- mutations through permitted methods are visible through later reads of the same object;
- method/property authority is policy-scoped and does not expose arbitrary reflection;
- graph handles are registry/runtime scoped and fail cross-runtime;
- revoked/expired handles fail deterministically;
- cycles in live object graphs do not require serialization;
- snapshot persists requirements/metadata only, never transient IDs or raw live values;
- rebind after restore creates fresh handles.

### Non-goals

- unrestricted object reflection;
- proxying secrets/private fields merely because they are present on a JavaScript object;
- process-boundary transport pretending to preserve JavaScript identity without an explicit host bridge.

### Verification gate

Adversarial tests must cover identity, mutation visibility, cycles, nested returns, stale/cross-runtime refs, revoked refs, hidden members, confused-deputy calls, oversized discovery metadata, and snapshot/rebind freshness.

---

## NOOA-F3 — Progressive `doc()` / surface discovery

### Objective

Give the model NOOA-style progressive discovery: a small initial `self` contract and an on-demand `doc(obj)` capability for live handles and agent/tool objects.

### Required semantics

- initial model context contains a bounded concise description of the current agent surface rather than all nested tool schemas;
- `doc(self)` exposes public deterministic/agentic methods and explicitly visible fields;
- `doc(handle)` resolves the current live object surface on demand;
- concise/full modes are supported;
- method descriptions carry name, description, mutation/side-effect signal where known, and argument/result contract metadata where available;
- dynamic current values may be shown only through bounded safe renderers;
- private/framework fields stay hidden;
- discovering a nested object does not eagerly dump its transitive graph;
- discovery output has explicit size/depth/member budgets and deterministic overflow behavior.

### Verification gate

Compare eager disclosure vs progressive disclosure on a reference object graph. Measure initial prompt surface, total discovered surface, successful task completion, and accidental authority exposure. Progressive mode must materially reduce initial disclosure while preserving task completion.

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
- deterministic public methods can be called naturally from generated code through the host bridge;
- `doc()` works inside the execution session;
- `return_result(value)` terminates even when invoked inside generated code;
- stdout/stderr/execution errors become bounded model-visible observations;
- typed final validation can feed correction back into the loop;
- executor/session lifecycle is explicit open/execute/close;
- host calls are counted/budgeted separately from generated-code cells;
- wall-clock/cell/output/host-call limits remain runtime-owned;
- sandbox/process cancellation semantics are explicit and never overstated.

### Backward compatibility

The current finite action-protocol CodeAct remains supported. Language-native CodeAct is an additional mode/strategy until evidence justifies making it the preferred default.

### Verification gate

Reference tasks must require real glue code: loop/branch/local variable reuse, two or more live object calls, nested object discovery, mutation then reread, and in-cell `return_result`. Adversarial cases include infinite loop containment, forbidden host method, stale handle, huge stdout, code syntax/runtime errors, sandbox crash, host-call budget exhaustion, and terminal-action smuggling.

---

## NOOA-F5 — Fidelity reference + adversarial evaluation

### Objective

Prove the four identity features through the packed public package and compare them with the existing explicit runtime/action-protocol baseline.

### Required reference scenarios

1. **Object ergonomics** — caller uses ordinary object methods; no separate judgment/capability invocation in application code.
2. **Live identity** — helper object mutation is observed later without serialize/reload.
3. **Progressive discovery** — nested API is unavailable initially and discovered only when needed.
4. **Code-native action** — model-generated JavaScript performs nontrivial glue logic with persistent locals and live proxies.
5. **AVO composition** — the resulting object agent still runs under existing long-horizon candidate/evaluation/promotion control.

### Measurements

At minimum record:

- task success;
- false-success / unsafe-accept count;
- model turns;
- generated code cells;
- host/live-object calls;
- correction count;
- initial prompt/context chars;
- discovered API chars/members;
- live-handle count and stale-handle rejections;
- executor/sandbox failures;
- trace correlation completeness;
- snapshot/rebind fidelity;
- packed-consumer success.

### Completion target

The pipeline may claim high NOOA semantic fidelity only when all four identity dimensions are proven through packed-consumer artifacts:

```text
Agent-as-object ergonomics   >= 90% semantic target
Live object semantics       >= 90% semantic target
Progressive discovery       >= 90% semantic target
CodeAct fidelity            >= 90% semantic target
```

These percentages are rubric labels, not scientific benchmark scores. F5 must replace subjective confidence with explicit capability checks and measurements. A dimension cannot receive `>= 90%` merely because an API exists.

## Final identity if complete

```text
ExHarness
  = AVO long-horizon control plane
  + NOOA-like object-native agent runtime
  + explicit authority / trust / verification boundaries
  + injected sandbox and infrastructure
```
