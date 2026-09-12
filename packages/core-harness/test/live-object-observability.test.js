import assert from "node:assert/strict";
import test from "node:test";

import {
  ResourceLifetime,
  createAgentRuntime,
  createEventBus,
  defineLiveObjectSurface,
  instrumentAgentRuntime
} from "../src/index.js";

test("observability instrumentation preserves live object roots and authority APIs", async () => {
  const counter = {
    count: 1,
    increment(delta) {
      this.count += delta;
      return this.count;
    }
  };
  const surface = defineLiveObjectSurface({
    id: "instrumented.counter",
    type: "Counter",
    methods: [{ name: "increment", mutates: true }],
    properties: [{ name: "count", read: (value) => value.count }]
  });
  const runtime = createAgentRuntime({
    strategy: { async run() { return "ok"; } },
    liveObjects: [{
      name: "counter",
      value: counter,
      surface,
      lifetime: ResourceLifetime.AGENT
    }]
  });
  const bus = createEventBus();
  const instrumented = instrumentAgentRuntime(runtime, bus);

  const ref = instrumented.liveObjects()[0].ref;
  assert.equal((await instrumented.describeLiveObject(ref)).surface.id, "instrumented.counter");
  assert.equal(await instrumented.readLiveObject(ref, "count"), 1);
  assert.equal(await instrumented.invokeLiveObject(ref, "increment", [2]), 3);
  assert.equal(counter.count, 3);
  assert.equal(typeof instrumented.liveObjectPolicy, "function");

  await instrumented.run({
    liveObjects: [{
      name: "temporary",
      value: { value: 1 },
      surface: defineLiveObjectSurface({
        id: "instrumented.temporary",
        properties: [{ name: "value", read: (value) => value.value }]
      }),
      lifetime: ResourceLifetime.CALL
    }]
  });
  const started = bus.events().find((event) => event.type === "AGENT_RUN_STARTED");
  assert.equal(started.payload.scopedLiveObjectCount, 1);
});
