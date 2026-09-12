import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  ExHarnessErrorCode,
  LiveObjectRefKind,
  ResourceLifetime,
  RuntimeSnapshotPayloadMode,
  RuntimeSnapshotRedactionKind,
  createResumableAgentRuntime,
  defineLiveObjectSurface,
  normalizeRuntimeSnapshot
} from "../src/index.js";

const COMPATIBILITY_TAG = "runtime-snapshot-test-v1";

function simpleStrategy(result = "ok") {
  return {
    kind: "SNAPSHOT_TEST",
    async run() {
      return result;
    }
  };
}

function resumable(options = {}) {
  return createResumableAgentRuntime({
    runtimeCompatibilityTag: COMPATIBILITY_TAG,
    ...options
  });
}

function resourceDefinition({ execute = async () => "ok" } = {}) {
  return {
    name: "repo",
    lifetime: ResourceLifetime.AGENT,
    value: { live: true },
    metadata: { type: "repo" },
    operations: [{
      name: "read",
      async execute(input, runtime) {
        return execute(input, runtime);
      }
    }]
  };
}

function liveObjectDefinition({ value = null, surface = null } = {}) {
  const resolvedValue = value ?? {
    count: 0,
    increment(delta) {
      this.count += delta;
      return this.count;
    }
  };
  const resolvedSurface = surface ?? defineLiveObjectSurface({
    id: "snapshot.counter",
    type: "Counter",
    methods: [{ name: "increment", mutates: true }],
    properties: [{ name: "count", read: (counter) => counter.count }]
  });
  return {
    name: "counter",
    lifetime: ResourceLifetime.AGENT,
    value: resolvedValue,
    surface: resolvedSurface
  };
}

test("resumable runtime requires an explicit compatibility tag", () => {
  assert.throws(
    () => createResumableAgentRuntime({ strategy: simpleStrategy() }),
    /runtime compatibility tag/
  );
});

test("runtime snapshot preserves event chronology while omitting payloads by default", async () => {
  const runtime = resumable({ strategy: simpleStrategy("done") });
  assert.equal(await runtime.run({ input: { secret: "not-for-snapshot" } }), "done");

  const before = runtime.agentEvents();
  const snapshot = runtime.snapshot({ createdAt: "2026-09-11T00:00:00.000Z" });

  assert.equal(snapshot.payloadMode, RuntimeSnapshotPayloadMode.OMIT);
  assert.equal(snapshot.redactions.omittedPayloads, before.length);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.redactions, "liveObjectRefs"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.state, "agentLiveObjects"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.configuration.body, "liveObjects"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.configuration.body, "liveObjectPolicy"), false);
  assert.deepEqual(
    snapshot.state.agentEvents.map((event) => [event.id, event.type, event.callId]),
    before.map((event) => [event.id, event.type, event.callId])
  );
  assert.ok(snapshot.state.agentEvents.every(
    (event) => event.payload.kind === RuntimeSnapshotRedactionKind.PAYLOAD_OMITTED
  ));
  assert.equal(JSON.stringify(snapshot).includes("not-for-snapshot"), false);

  const restored = resumable({
    strategy: simpleStrategy("after-restore"),
    snapshot
  });
  assert.equal(restored.restoreInfo().restored, true);
  assert.deepEqual(
    restored.agentEvents().map((event) => [event.id, event.type, event.callId]),
    snapshot.state.agentEvents.map((event) => [event.id, event.type, event.callId])
  );

  await restored.run();
  assert.deepEqual(
    restored.agentEvents().slice(0, before.length).map((event) => event.id),
    before.map((event) => event.id)
  );
});

test("SANITIZE payload mode never exposes raw ResourceRef authority to the sanitizer", async () => {
  const runtime = resumable({
    strategy: {
      kind: "RESOURCE_SNAPSHOT_TEST",
      async run({ resources, recordAgentEvent }) {
        recordAgentEvent(AgentEventKind.MODEL_OUTPUT, {
          ref: resources[0],
          note: "safe-note"
        });
        return "done";
      }
    },
    resources: [resourceDefinition()]
  });

  await runtime.run();
  const liveRef = runtime.resourceRefs()[0];
  const snapshot = runtime.snapshot({
    payloadMode: RuntimeSnapshotPayloadMode.SANITIZE,
    sanitizeEventPayload(payload) {
      if (payload?.ref) {
        return {
          ...payload,
          attemptedRegistryLeak: payload.ref.registryId ?? null,
          attemptedIdLeak: payload.ref.id ?? null
        };
      }
      return payload;
    }
  });

  const modelEvent = snapshot.state.agentEvents.find((event) => event.type === AgentEventKind.MODEL_OUTPUT);
  assert.equal(modelEvent.payload.note, "safe-note");
  assert.equal(modelEvent.payload.ref.kind, RuntimeSnapshotRedactionKind.RESOURCE_REF);
  assert.equal(modelEvent.payload.ref.name, "repo");
  assert.equal(modelEvent.payload.attemptedRegistryLeak, null);
  assert.equal(modelEvent.payload.attemptedIdLeak, null);
  assert.equal(snapshot.redactions.resourceRefs, 1);

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(liveRef.registryId), false);
  assert.equal(serialized.includes(liveRef.id), false);
});

test("SANITIZE payload mode never exposes raw LIVE_OBJECT_REF authority to the sanitizer", async () => {
  const runtime = resumable({
    strategy: {
      kind: "LIVE_SNAPSHOT_TEST",
      async run({ liveObjects, recordAgentEvent }) {
        recordAgentEvent(AgentEventKind.MODEL_OUTPUT, {
          ref: liveObjects[0].ref,
          note: "live-safe"
        });
        return "done";
      }
    },
    liveObjects: [liveObjectDefinition()]
  });

  await runtime.run();
  const liveRef = runtime.liveObjects()[0].ref;
  assert.equal(liveRef.kind, LiveObjectRefKind);
  const snapshot = runtime.snapshot({
    payloadMode: RuntimeSnapshotPayloadMode.SANITIZE,
    sanitizeEventPayload(payload) {
      if (payload?.ref) {
        return {
          ...payload,
          attemptedRegistryLeak: payload.ref.registryId ?? null,
          attemptedIdLeak: payload.ref.id ?? null
        };
      }
      return payload;
    }
  });

  const modelEvent = snapshot.state.agentEvents.find((event) => event.type === AgentEventKind.MODEL_OUTPUT);
  assert.equal(modelEvent.payload.note, "live-safe");
  assert.equal(modelEvent.payload.ref.kind, RuntimeSnapshotRedactionKind.LIVE_OBJECT_REF);
  assert.equal(modelEvent.payload.ref.surfaceId, "snapshot.counter");
  assert.equal(modelEvent.payload.attemptedRegistryLeak, null);
  assert.equal(modelEvent.payload.attemptedIdLeak, null);
  assert.equal(snapshot.redactions.liveObjectRefs, 1);
  assert.deepEqual(snapshot.state.agentLiveObjects, [{ name: "counter", active: true }]);
  assert.equal(snapshot.configuration.body.liveObjects[0].surface.id, "snapshot.counter");

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(liveRef.registryId), false);
  assert.equal(serialized.includes(liveRef.id), false);
});

test("snapshot refuses active agent, resource and live-object operations", async () => {
  let finishRun;
  const runGate = new Promise((resolve) => { finishRun = resolve; });
  const running = resumable({
    strategy: {
      kind: "BLOCKING_RUN",
      async run() {
        await runGate;
        return "done";
      }
    }
  });

  const runPromise = running.run();
  assert.throws(
    () => running.snapshot(),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_ACTIVE_CALL
  );
  finishRun();
  assert.equal(await runPromise, "done");

  let finishResource;
  const resourceGate = new Promise((resolve) => { finishResource = resolve; });
  const withResource = resumable({
    strategy: simpleStrategy(),
    resources: [resourceDefinition({
      async execute() {
        await resourceGate;
        return "read";
      }
    })]
  });
  const ref = withResource.resourceRefs()[0];
  const operation = withResource.invokeResource(ref, "read");
  assert.throws(
    () => withResource.snapshot(),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_ACTIVE_CALL
  );
  finishResource();
  assert.equal(await operation, "read");

  let finishLive;
  const liveGate = new Promise((resolve) => { finishLive = resolve; });
  const liveValue = {
    async block() {
      await liveGate;
      return "live";
    }
  };
  const liveSurface = defineLiveObjectSurface({
    id: "snapshot.blocking-live",
    methods: [{ name: "block" }]
  });
  const withLive = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition({ value: liveValue, surface: liveSurface })]
  });
  const liveRef = withLive.liveObjects()[0].ref;
  const liveOperation = withLive.invokeLiveObject(liveRef, "block", []);
  assert.throws(
    () => withLive.snapshot(),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_ACTIVE_CALL
  );
  finishLive();
  assert.equal(await liveOperation, "live");
});

test("future schema, tampered digest, and incompatible configuration fail closed", async () => {
  const runtime = resumable({ strategy: simpleStrategy() });
  await runtime.run();
  const snapshot = runtime.snapshot();

  assert.throws(
    () => normalizeRuntimeSnapshot({ ...structuredClone(snapshot), schemaVersion: 99 }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_SCHEMA_UNSUPPORTED
  );
  assert.throws(
    () => normalizeRuntimeSnapshot({ ...structuredClone(snapshot), createdAt: "tampered" }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_INVALID
  );
  assert.throws(
    () => createResumableAgentRuntime({
      strategy: simpleStrategy(),
      runtimeCompatibilityTag: "runtime-snapshot-test-v2",
      snapshot
    }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE
  );
});

test("active resources require explicit rebinding and restore with fresh authority refs", async () => {
  const original = resumable({
    strategy: simpleStrategy(),
    resources: [resourceDefinition()]
  });
  const oldRef = original.resourceRefs()[0];
  const snapshot = original.snapshot();

  assert.throws(
    () => resumable({
      strategy: simpleStrategy(),
      resources: [resourceDefinition()],
      snapshot
    }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_RESOURCE_REBIND_REQUIRED
  );

  const rebound = [];
  const restored = resumable({
    strategy: simpleStrategy(),
    resources: [resourceDefinition()],
    snapshot,
    resourceRebind({ name, ref }) {
      rebound.push({ name, ref });
      return true;
    }
  });
  const freshRef = restored.resourceRefs()[0];
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].name, "repo");
  assert.notEqual(freshRef.registryId, oldRef.registryId);
  assert.notEqual(freshRef.id, oldRef.id);
  await assert.rejects(
    restored.describeResource(oldRef),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_REF_INVALID
  );
  assert.deepEqual((await restored.describeResource(freshRef)).ref, freshRef);
});

test("active live objects require explicit rebinding and restore with fresh authority refs", async () => {
  const originalValue = {
    count: 1,
    increment(delta) { this.count += delta; return this.count; }
  };
  const original = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition({ value: originalValue })]
  });
  const oldRef = original.liveObjects()[0].ref;
  const snapshot = original.snapshot();

  assert.throws(
    () => resumable({
      strategy: simpleStrategy(),
      liveObjects: [liveObjectDefinition()],
      snapshot
    }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_LIVE_OBJECT_REBIND_REQUIRED
  );

  const rebound = [];
  const replacementValue = {
    count: 10,
    increment(delta) { this.count += delta; return this.count; }
  };
  const restored = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition({ value: replacementValue })],
    snapshot,
    liveObjectRebind({ name, ref }) {
      rebound.push({ name, ref });
      return true;
    }
  });
  const freshRef = restored.liveObjects()[0].ref;
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].name, "counter");
  assert.notEqual(freshRef.registryId, oldRef.registryId);
  assert.notEqual(freshRef.id, oldRef.id);
  await assert.rejects(
    () => restored.describeLiveObject(oldRef),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID
  );
  assert.equal(await restored.readLiveObject(freshRef, "count"), 10);
  assert.equal(await restored.invokeLiveObject(freshRef, "increment", [2]), 12);
  assert.equal(replacementValue.count, 12);
});

test("live object authority surface changes invalidate snapshot compatibility", () => {
  const original = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition()]
  });
  const snapshot = original.snapshot();
  const changedSurface = defineLiveObjectSurface({
    id: "snapshot.counter-v2",
    type: "Counter",
    properties: [{ name: "count", read: (counter) => counter.count }]
  });

  assert.throws(
    () => resumable({
      strategy: simpleStrategy(),
      liveObjects: [liveObjectDefinition({ surface: changedSurface })],
      snapshot,
      liveObjectRebind: () => true
    }),
    (error) => error.code === ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE
  );
});

test("revoked resources stay revoked after restore and do not require rebinding", () => {
  const original = resumable({
    strategy: simpleStrategy(),
    resources: [resourceDefinition()]
  });
  original.revokeResource(original.resourceRefs()[0]);
  const snapshot = original.snapshot();
  assert.deepEqual(snapshot.state.agentResources, [{ name: "repo", active: false }]);

  const restored = resumable({
    strategy: simpleStrategy(),
    resources: [resourceDefinition()],
    snapshot
  });
  assert.deepEqual(restored.resourceRefs(), []);
});

test("revoked live objects stay revoked after restore and do not require rebinding", () => {
  const original = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition()]
  });
  original.revokeLiveObject(original.liveObjects()[0].ref);
  const snapshot = original.snapshot();
  assert.deepEqual(snapshot.state.agentLiveObjects, [{ name: "counter", active: false }]);

  const restored = resumable({
    strategy: simpleStrategy(),
    liveObjects: [liveObjectDefinition()],
    snapshot
  });
  assert.deepEqual(restored.liveObjects(), []);
});
