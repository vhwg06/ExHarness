import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  LiveObjectMemberKind,
  LiveObjectRefKind,
  ResourceLifetime,
  TraceSpanKind,
  createAgentRuntime,
  createLiveObjectRegistry,
  createTraceRecorder,
  defineLiveObjectPolicy,
  defineLiveObjectSurface
} from "../src/index.js";

function counterSurface(id = "counter.full") {
  return defineLiveObjectSurface({
    id,
    type: "Counter",
    description: "Mutable counter surface.",
    methods: [
      { name: "increment", mutates: true, description: "Increment by a delta." }
    ],
    properties: [
      { name: "count", description: "Current count.", read: (counter) => counter.count }
    ]
  });
}

test("same live object and authority surface reuse one stable handle", () => {
  const registry = createLiveObjectRegistry({ registryId: "shared", idFactory: (() => {
    let id = 0;
    return () => `live-${++id}`;
  })() });
  const value = { count: 0, increment(delta) { this.count += delta; return this.count; } };
  const surface = counterSurface();

  const first = registry.expose(value, surface);
  const second = registry.expose(value, surface);

  assert.equal(first.kind, LiveObjectRefKind);
  assert.equal(first.id, second.id);
  assert.equal(first.registryId, "shared");
  assert.equal(first.surfaceId, "counter.full");
});

test("same object under a different authority surface receives a different handle", () => {
  const registry = createLiveObjectRegistry({ registryId: "authority" });
  const value = { count: 1, increment(delta) { this.count += delta; return this.count; } };
  const full = counterSurface("counter.full");
  const readOnly = defineLiveObjectSurface({
    id: "counter.read-only",
    type: "Counter",
    properties: [{ name: "count", read: (counter) => counter.count }]
  });

  const fullRef = registry.expose(value, full);
  const readOnlyRef = registry.expose(value, readOnly);

  assert.notEqual(fullRef.id, readOnlyRef.id);
});

test("live mutation is visible through later reads without serialization", async () => {
  const registry = createLiveObjectRegistry();
  const value = { count: 0, increment(delta) { this.count += delta; return this.count; } };
  const ref = registry.expose(value, counterSurface());

  assert.equal(await registry.read(ref, "count"), 0);
  assert.equal(await registry.invoke(ref, "increment", [2]), 2);
  assert.equal(await registry.read(ref, "count"), 2);
  assert.equal(value.count, 2);
});

test("nested live results preserve cycles and object identity", async () => {
  class Node {
    constructor(name) {
      this.name = name;
      this.parentNode = null;
      this.childNode = null;
    }
    child() { return this.childNode; }
    parent() { return this.parentNode; }
  }

  let nodeSurface;
  nodeSurface = defineLiveObjectSurface({
    id: "graph.node",
    type: "Node",
    methods: [
      { name: "child", resultSurface: () => nodeSurface },
      { name: "parent", resultSurface: () => nodeSurface }
    ],
    properties: [{ name: "name", read: (node) => node.name }]
  });

  const root = new Node("root");
  const child = new Node("child");
  root.childNode = child;
  child.parentNode = root;

  const registry = createLiveObjectRegistry();
  const rootRef = registry.expose(root, nodeSurface);
  const childRef = await registry.invoke(rootRef, "child", []);
  const parentRef = await registry.invoke(childRef, "parent", []);

  assert.equal(await registry.read(childRef, "name"), "child");
  assert.equal(parentRef.id, rootRef.id);
  assert.equal(registry.refs().length, 2);
});

test("undeclared members are never reflected into authority", async () => {
  const value = {
    count: 0,
    increment(delta) { this.count += delta; return this.count; },
    deleteEverything() { throw new Error("must not run"); }
  };
  const registry = createLiveObjectRegistry();
  const ref = registry.expose(value, counterSurface());

  await assert.rejects(
    () => registry.invoke(ref, "deleteEverything", []),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED
  );
  await assert.rejects(
    () => registry.read(ref, "deleteEverything"),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED
  );
});

test("method binding does not execute accessors and late monkeypatch cannot replace authority", async () => {
  let getterCalls = 0;
  const bad = {};
  Object.defineProperty(bad, "run", {
    get() {
      getterCalls += 1;
      return () => "unsafe";
    }
  });
  const badSurface = defineLiveObjectSurface({ id: "bad", methods: [{ name: "run" }] });
  const registry = createLiveObjectRegistry();
  assert.throws(
    () => registry.expose(bad, badSurface),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED
  );
  assert.equal(getterCalls, 0);

  const value = { run() { return "original"; } };
  const surface = defineLiveObjectSurface({ id: "bound", methods: [{ name: "run" }] });
  const ref = registry.expose(value, surface);
  value.run = () => "patched";

  assert.equal(value.run(), "patched");
  assert.equal(await registry.invoke(ref, "run", []), "original");
});

test("live refs cannot become method arguments without explicit member opt-in", async () => {
  const secret = { value: "secret" };
  const sink = {
    inspect(other) { return other.value; },
    inspectAllowed(other) { return other.value; }
  };
  const secretSurface = defineLiveObjectSurface({
    id: "secret.read",
    properties: [{ name: "value", read: (value) => value.value }]
  });
  const sinkSurface = defineLiveObjectSurface({
    id: "sink",
    methods: [
      { name: "inspect" },
      { name: "inspectAllowed", allowLiveArgs: true }
    ]
  });
  const registry = createLiveObjectRegistry();
  const secretRef = registry.expose(secret, secretSurface);
  const sinkRef = registry.expose(sink, sinkSurface);

  await assert.rejects(
    () => registry.invoke(sinkRef, "inspect", [secretRef]),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_ACCESS_DENIED
  );
  assert.equal(await registry.invoke(sinkRef, "inspectAllowed", [secretRef]), "secret");
});

test("cross-registry, revoked and expired live refs fail deterministically", async () => {
  const surface = counterSurface();
  const value = { count: 0, increment(delta) { this.count += delta; return this.count; } };
  const first = createLiveObjectRegistry({ registryId: "first" });
  const second = createLiveObjectRegistry({ registryId: "second" });
  const ref = first.expose(value, surface);

  await assert.rejects(
    () => second.read(ref, "count"),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID
  );

  first.revoke(ref);
  await assert.rejects(
    () => first.read(ref, "count"),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_REVOKED
  );

  const callRef = first.expose(value, surface, { lifetime: ResourceLifetime.CALL, callId: "call-1" });
  assert.equal(await first.read(callRef, "count", { callId: "call-1" }), 0);
  first.closeCall("call-1");
  await assert.rejects(
    () => first.read(callRef, "count", { callId: "call-1" }),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_EXPIRED
  );
  const nextCallRef = first.expose(value, surface, { lifetime: ResourceLifetime.CALL, callId: "call-2" });
  assert.notEqual(nextCallRef.id, callRef.id);
});

test("surface identifiers cannot silently alias different authority definitions", () => {
  const registry = createLiveObjectRegistry();
  const firstSurface = defineLiveObjectSurface({ id: "same", methods: [{ name: "run" }] });
  const secondSurface = defineLiveObjectSurface({ id: "same", properties: [{ name: "value", read: (item) => item.value }] });
  registry.expose({ run() { return true; } }, firstSurface);

  assert.throws(
    () => registry.expose({ value: true }, secondSurface),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_SURFACE_CONFLICT
  );
});

test("live object discovery metadata is bounded by policy before handle creation", () => {
  const registry = createLiveObjectRegistry({
    policy: defineLiveObjectPolicy({ maxDescriptionChars: 3 })
  });
  const surface = defineLiveObjectSurface({ id: "bounded", description: "too long" });

  assert.throws(
    () => registry.expose({}, surface),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED
  );
  assert.deepEqual(registry.refs(), []);
});

test("non-transport object results require an explicit nested live surface", async () => {
  class Child {}
  const value = { child() { return new Child(); } };
  const surface = defineLiveObjectSurface({ id: "transport-only", methods: [{ name: "child" }] });
  const registry = createLiveObjectRegistry();
  const ref = registry.expose(value, surface);

  await assert.rejects(
    () => registry.invoke(ref, "child", []),
    /plain objects and arrays/
  );
});

test("runtime exposes named roots and nested live host calls inside one causal trace", async () => {
  class Node {
    constructor(name) {
      this.name = name;
      this.childNode = null;
    }
    child() { return this.childNode; }
    rename(name) { this.name = name; return this.name; }
  }
  let nodeSurface;
  nodeSurface = defineLiveObjectSurface({
    id: "runtime.node",
    type: "Node",
    methods: [
      { name: "child", resultSurface: () => nodeSurface },
      { name: "rename", mutates: true }
    ],
    properties: [{ name: "name", read: (node) => node.name }]
  });
  const root = new Node("root");
  root.childNode = new Node("child");
  const tracer = createTraceRecorder();

  const runtime = createAgentRuntime({
    tracer,
    liveObjects: [{ name: "root", value: root, surface: nodeSurface }],
    strategy: {
      kind: "LIVE_GRAPH",
      async run({ liveObjects, describeLiveObject, invokeLiveObject, readLiveObject }) {
        const rootRef = liveObjects.find((entry) => entry.name === "root").ref;
        const described = await describeLiveObject(rootRef);
        assert.equal(described.surface.methods[0].kind, undefined);
        const childRef = await invokeLiveObject(rootRef, "child", []);
        await invokeLiveObject(childRef, "rename", ["renamed"]);
        return readLiveObject(childRef, "name");
      }
    }
  });

  assert.equal(await runtime.run(), "renamed");
  assert.equal(root.childNode.name, "renamed");
  assert.equal(runtime.liveObjects().length, 1);
  assert.equal(runtime.liveObjects()[0].ref.kind, LiveObjectRefKind);
  const spans = runtime.traces();
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.LIVE_OBJECT_DESCRIBE));
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.LIVE_OBJECT));
});

test("call-scoped runtime roots and nested handles expire when the invocation closes", async () => {
  let surface;
  surface = defineLiveObjectSurface({
    id: "call.node",
    methods: [{ name: "self", resultSurface: () => surface }]
  });
  const value = { self() { return this; } };
  let escapedRef = null;
  const runtime = createAgentRuntime({
    strategy: {
      async run({ liveObjects, invokeLiveObject }) {
        const ref = liveObjects[0].ref;
        escapedRef = await invokeLiveObject(ref, "self", []);
        assert.equal(escapedRef.id, ref.id);
        return true;
      }
    }
  });

  assert.equal(await runtime.run({
    liveObjects: [{ name: "temporary", value, surface, lifetime: ResourceLifetime.CALL }]
  }), true);
  await assert.rejects(
    () => runtime.describeLiveObject(escapedRef),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_EXPIRED
  );
});

test("authorization callback can deny describe/read/invoke independently", async () => {
  const seen = [];
  const registry = createLiveObjectRegistry({
    authorize(request) {
      seen.push([request.action, request.member?.kind ?? null, request.member?.name ?? null]);
      return request.action !== "INVOKE_LIVE";
    }
  });
  const value = { count: 1, increment(delta) { this.count += delta; return this.count; } };
  const ref = registry.expose(value, counterSurface());

  await registry.describe(ref);
  assert.equal(await registry.read(ref, "count"), 1);
  await assert.rejects(
    () => registry.invoke(ref, "increment", [1]),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_ACCESS_DENIED
  );
  assert.deepEqual(seen, [
    ["DESCRIBE_LIVE", null, null],
    ["READ_LIVE", LiveObjectMemberKind.PROPERTY, "count"],
    ["INVOKE_LIVE", LiveObjectMemberKind.METHOD, "increment"]
  ]);
});
