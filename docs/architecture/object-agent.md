# Object-native agent surface

NOOA-F1 makes an ordinary JavaScript object/class the ergonomic ExHarness programming surface while preserving the existing AgentRuntime as the execution authority underneath.

## Semantic target

The goal is NOOA-style object ergonomics rather than Python syntax emulation:

```text
ordinary JavaScript object
        ↓
public deterministic methods
        = runtime capabilities
        ↓
agentic methods
        = ordinary awaited methods backed by typed Judgments
```

The returned value from `createObjectAgent(instance)` is the exact same object identity. There is no proxy wrapper replacing application semantics.

## Public model

```js
class InventoryAgent extends Agent {
  constructor() {
    super();
    this.inventory = new Map([["gpu", 3]]);
  }

  stock(sku) {
    return this.inventory.get(sku) ?? 0;
  }

  answer = agenticMethod({
    strategy,
    parseInput,
    parseOutput
  });
}

const agent = createObjectAgent(new InventoryAgent());

agent.stock("gpu");
await agent.answer("gpu");
```

The explicit low-level runtime remains available through `getObjectAgentRuntime(agent)` for composition/debugging/advanced policy without forcing ordinary application callers to invoke judgment names.

## Deterministic method authority

Public deterministic methods are discovered from the concrete object/prototype surface and become AgentRuntime capabilities without copying their implementation into a second registry.

A key authority rule is:

```text
attach-time resolved implementation
        ↓
model/runtime capability authority
```

A later application-side monkeypatch may change direct JavaScript caller behavior, but it does not silently replace the implementation that the runtime/model was authorized to invoke under the existing capability name and metadata.

This preserves subclass dispatch at attach time while preventing capability-body laundering after attachment.

### Argument bridge

AgentRuntime capability invocation has one payload slot, while JavaScript methods have positional arguments. `objectMethodCall(...args)` explicitly bridges this mismatch:

```js
await invoke("add", objectMethodCall(2, 3));
await invoke("zeroArg", objectMethodCall());
```

A normal array payload remains one array argument rather than being ambiguously spread.

## Agentic method authority

JavaScript/Node 20 does not have a portable equivalent of NOOA's Python ellipsis-method metaclass syntax. F1 therefore uses an instance field marker:

```js
answer = agenticMethod({
  strategy,
  model,
  context,
  parseInput,
  parseOutput
});
```

At attachment, the marker is replaced in place by an ordinary callable async method. The method delegates to the existing typed Judgment runtime, so it retains:

- typed input/output validation;
- context/history selection;
- model routing and `modelUsage` provenance;
- AgentEvent working history;
- nested tracing;
- existing runtime budgets/policies.

Convenience surfaces on the callable method are intentionally non-enumerable:

```text
method.report(...args)
method.withOptions(options, ...args)
```

They do not become deterministic model capabilities or separate object-surface members.

## Visibility and reflection boundary

Visibility follows an explicit object-agent surface rather than unrestricted JavaScript reflection:

- names beginning with `_` are hidden by convention;
- methods explicitly marked `hidden` are excluded from automatic capabilities;
- getters/accessors are inspected only as property descriptors and are never executed during discovery;
- arbitrary wrapped classes expose only their immediate prototype by default;
- classes extending `Agent` may expose their subclass chain up to `Agent.prototype`;
- inherited platform/library methods (for example `Map#get`, `Map#set`) are not pulled in accidentally;
- non-function shadowing members prevent a same-named base method from leaking through;
- a public `then()` is rejected unless hidden to avoid turning arbitrary agents into accidental Promise-like objects.

Hidden application methods remain callable by application code. Hidden agentic methods remain callable by the application but are absent from the default model-facing surface.

## State and identity

The framework creates no class-shared tool state. Per-instance fields remain ordinary JavaScript fields, so two agent instances retain isolated mutable state.

Because the object is not wrapped, these language semantics remain true:

```text
agent === originalInstance
agent instanceof ConcreteAgent
subclass method override dispatch
this.method() calls between deterministic/agentic siblings
per-instance helper object identity
```

F2 will extend this same identity model into nested live-object handles visible to generated/model-controlled execution.

## Verification findings

The F1 verification track materially changed or hardened the implementation:

1. **Packed-consumer generator failure.** The first full gate exposed a nested-template-literal syntax error in the blank-consumer generator. Core tests were green, but the packed package path failed. The consumer gate was fixed rather than removed.
2. **Capability-body laundering.** An initial implementation resolved `instance[method]` on every model capability call. That allowed a later application monkeypatch to replace a model-authorized method body under unchanged capability identity/policy. The runtime now binds the resolved implementation at attach time.
3. **Getter/accessor side effects.** Reflection must use property descriptors and never evaluate getters merely to discover a surface. Adversarial coverage locks this behavior.
4. **Zero-argument fidelity.** A one-payload capability API cannot infer zero-vs-one argument semantics. `objectMethodCall()` explicitly preserves a true zero-argument call.
5. **Promise-like `then` trap.** Public `then()` can cause implicit Promise resolution to execute application code. It must be explicitly hidden before attachment.
6. **Partial attachment.** Non-configurable agentic marker fields are rejected before runtime attachment, preventing a failure from leaving a partially instrumented object.

## Claim boundary

F1 proves object-native caller ergonomics and deterministic/agentic method composition. It does not yet claim:

- transitive live-object graph handles;
- nested live object mutation through model-controlled execution;
- `doc(self)` / `doc(obj)` progressive discovery;
- language-native JavaScript REPL CodeAct.

Those are owned by F2, F3 and F4 respectively.
