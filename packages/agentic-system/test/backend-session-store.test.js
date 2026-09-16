import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StoreConflictError } from "../../core-harness/src/index.js";
import { createJsonBackendSessionStore } from "../src/index.js";

function session(id, revision, marker) {
  return {
    schemaVersion: 2,
    revision,
    id,
    work: { kind: "BACKEND_STORE_TEST", marker }
  };
}

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), "exharness-backend-store-"));
  try {
    await run(createJsonBackendSessionStore({ directory: root }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Backend durable recovery store publishes only one successor for concurrent writers from the same revision", async () => {
  await withStore(async (store) => {
    const left = session("backend:concurrent", 0, "left");
    const right = session("backend:concurrent", 0, "right");

    const settled = await Promise.allSettled([
      store.save(left, { expectedRevision: 0 }),
      store.save(right, { expectedRevision: 0 })
    ]);

    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.ok(rejected?.reason instanceof StoreConflictError);

    const persisted = await store.load("backend:concurrent");
    assert.equal(persisted.revision, 1);
    assert.ok(["left", "right"].includes(persisted.work.marker));
  });
});

test("Backend durable recovery store rejects a stale writer after a newer revision is committed", async () => {
  await withStore(async (store) => {
    const first = session("backend:stale", 0, "first");
    await store.save(first, { expectedRevision: 0 });

    const second = session("backend:stale", 1, "second");
    await store.save(second, { expectedRevision: 1 });

    const stale = session("backend:stale", 0, "stale");
    await assert.rejects(
      () => store.save(stale, { expectedRevision: 0 }),
      (error) => error instanceof StoreConflictError && error.code === "STORE_CONFLICT"
    );

    const persisted = await store.load("backend:stale");
    assert.equal(persisted.revision, 2);
    assert.equal(persisted.work.marker, "second");
  });
});
