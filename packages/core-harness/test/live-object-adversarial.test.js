import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  createLiveObjectRegistry,
  defineLiveObjectSurface
} from "../src/index.js";

test("opaque live refs cannot escape through ordinary transport results", async () => {
  const registry = createLiveObjectRegistry({ registryId: "authority-escape" });
  const secretSurface = defineLiveObjectSurface({
    id: "secret.surface",
    properties: [{ name: "value", read: (value) => value.value }]
  });
  const secretRef = registry.expose({ value: "secret" }, secretSurface);

  const directCarrier = {
    leak() {
      return secretRef;
    }
  };
  const nestedCarrier = {
    leak() {
      return { nested: { ref: secretRef } };
    }
  };
  const carrierSurface = defineLiveObjectSurface({
    id: "carrier.surface",
    methods: [{ name: "leak" }]
  });

  for (const carrier of [directCarrier, nestedCarrier]) {
    const carrierRef = registry.expose(carrier, carrierSurface);
    await assert.rejects(
      () => registry.invoke(carrierRef, "leak", []),
      /cannot contain live object refs without an explicit resultSurface/
    );
  }

  assert.equal(await registry.read(secretRef, "value"), "secret");
});

test("revoked authority becomes a stale tombstone while the same object can receive fresh authority", async () => {
  const registry = createLiveObjectRegistry({
    registryId: "tombstone",
    idFactory: (() => {
      let id = 0;
      return () => `live-${++id}`;
    })()
  });
  const value = {
    count: 1,
    increment(delta) {
      this.count += delta;
      return this.count;
    }
  };
  const surface = defineLiveObjectSurface({
    id: "counter.tombstone",
    methods: [{ name: "increment", mutates: true }],
    properties: [{ name: "count", read: (counter) => counter.count }]
  });

  const staleRef = registry.expose(value, surface);
  registry.revoke(staleRef);

  await assert.rejects(
    () => registry.read(staleRef, "count"),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_REVOKED
  );

  const freshRef = registry.expose(value, surface);
  assert.notEqual(freshRef.id, staleRef.id);
  assert.equal(await registry.invoke(freshRef, "increment", [2]), 3);
  assert.equal(await registry.read(freshRef, "count"), 3);

  await assert.rejects(
    () => registry.read(staleRef, "count"),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_REVOKED
  );
});
