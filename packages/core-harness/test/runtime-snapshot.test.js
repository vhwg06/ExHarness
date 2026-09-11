import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  ExHarnessErrorCode,
  ResourceLifetime,
  RuntimeSnapshotPayloadMode,
  RuntimeSnapshotRedactionKind,
  createResumableAgentRuntime,
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

test("snapshot refuses both active agent calls and active direct resource operations", async () => {
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
