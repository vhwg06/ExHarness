import assert from "node:assert/strict";
import { promises as nodeFs } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonBlackboardStore } from "../src/index.js";

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-blackboard-store-"));
  const path = join(directory, "board.json");
  try {
    await run({ directory, path });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function addItem(snapshot, id) {
  snapshot.items.push({ id, work: `work ${id}` });
}

test("paused stale writer cannot overwrite a newer committed successor", async () => {
  await withStore(async ({ path }) => {
    const staleWriter = createJsonBlackboardStore({ path, lockStaleMs: 1 });
    const recoveryWriter = createJsonBlackboardStore({ path, lockStaleMs: 1 });

    let releaseStale;
    const staleMayFinish = new Promise((resolve) => {
      releaseStale = resolve;
    });
    let staleStarted;
    const staleDidStart = new Promise((resolve) => {
      staleStarted = resolve;
    });

    const staleTransaction = staleWriter.transact(async (snapshot) => {
      addItem(snapshot, "A");
      staleStarted();
      await staleMayFinish;
    });

    await staleDidStart;
    await recoveryWriter.transact((snapshot) => {
      addItem(snapshot, "B");
    });

    releaseStale();
    await assert.rejects(
      staleTransaction,
      /transaction conflict: revision root already has a committed successor/
    );

    const head = await recoveryWriter.load();
    assert.deepEqual(head.items.map((item) => item.id), ["B"]);
  });
});

test("competing recovery attempts from one base produce one winner and one explicit conflict", async () => {
  await withStore(async ({ path }) => {
    const left = createJsonBlackboardStore({ path });
    const right = createJsonBlackboardStore({ path });

    let leftReady;
    let rightReady;
    const leftDidPrepare = new Promise((resolve) => { leftReady = resolve; });
    const rightDidPrepare = new Promise((resolve) => { rightReady = resolve; });
    let releaseBoth;
    const mayCommit = new Promise((resolve) => { releaseBoth = resolve; });

    const leftCommit = left.transact(async (snapshot) => {
      addItem(snapshot, "left");
      leftReady();
      await mayCommit;
    });
    const rightCommit = right.transact(async (snapshot) => {
      addItem(snapshot, "right");
      rightReady();
      await mayCommit;
    });

    await Promise.all([leftDidPrepare, rightDidPrepare]);
    releaseBoth();
    const results = await Promise.allSettled([leftCommit, rightCommit]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      results.find((result) => result.status === "rejected").reason.message,
      /transaction conflict/
    );

    const head = await left.load();
    assert.equal(head.items.length, 1);
    assert.ok(["left", "right"].includes(head.items[0].id));
  });
});

test("legacy abandoned or replacement lock files are neither trusted nor deleted", async () => {
  await withStore(async ({ path }) => {
    const lockPath = `${path}.lock`;
    const lockPayload = `${JSON.stringify({ token: "newer-owner", createdAt: 1 })}\n`;
    await writeFile(lockPath, lockPayload, "utf8");

    const store = createJsonBlackboardStore({ path, lockStaleMs: 1 });
    await store.transact((snapshot) => {
      addItem(snapshot, "safe");
    });

    assert.equal(await readFile(lockPath, "utf8"), lockPayload);
    assert.deepEqual((await store.load()).items.map((item) => item.id), ["safe"]);
  });
});

test("failed commit publication cleans its temp file and leaves prior state unchanged", async () => {
  await withStore(async ({ directory, path }) => {
    const failingFs = {
      readFile: nodeFs.readFile,
      writeFile: nodeFs.writeFile,
      mkdir: nodeFs.mkdir,
      rename: nodeFs.rename,
      unlink: nodeFs.unlink,
      async link() {
        const error = new Error("injected link failure");
        error.code = "EIO";
        throw error;
      }
    };
    const failingStore = createJsonBlackboardStore({ path, fs: failingFs });

    await assert.rejects(
      failingStore.transact((snapshot) => {
        addItem(snapshot, "not-committed");
      }),
      /injected link failure/
    );

    const files = await readdir(directory);
    assert.equal(files.some((name) => name.endsWith(".tmp")), false);
    assert.deepEqual((await createJsonBlackboardStore({ path }).load()).items, []);
  });
});

test("compatibility JSON projection exposes the latest committed snapshot without becoming authority", async () => {
  await withStore(async ({ path }) => {
    const store = createJsonBlackboardStore({ path });
    await store.transact((snapshot) => addItem(snapshot, "visible"));

    const projected = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(projected.items.map((item) => item.id), ["visible"]);

    projected.items = [];
    await writeFile(path, `${JSON.stringify(projected, null, 2)}\n`, "utf8");
    assert.deepEqual((await store.load()).items.map((item) => item.id), ["visible"]);
  });
});

test("committed successor survives compatibility projection failure", async () => {
  await withStore(async ({ path }) => {
    const projectionFailingFs = {
      readFile: nodeFs.readFile,
      writeFile: nodeFs.writeFile,
      mkdir: nodeFs.mkdir,
      link: nodeFs.link,
      unlink: nodeFs.unlink,
      async rename() {
        const error = new Error("injected projection failure");
        error.code = "EIO";
        throw error;
      }
    };
    const store = createJsonBlackboardStore({ path, fs: projectionFailingFs });
    const committed = await store.transact((snapshot) => addItem(snapshot, "durable"));
    assert.deepEqual(committed.snapshot.items.map((item) => item.id), ["durable"]);

    const recovered = await createJsonBlackboardStore({ path }).load();
    assert.deepEqual(recovered.items.map((item) => item.id), ["durable"]);
  });
});

test("revision identity remains valid when a later snapshot repeats an earlier value", async () => {
  await withStore(async ({ path }) => {
    const store = createJsonBlackboardStore({ path });

    await store.transact((snapshot) => addItem(snapshot, "A"));
    await store.transact((snapshot) => {
      snapshot.items = [];
    });
    await store.transact((snapshot) => addItem(snapshot, "B"));

    const head = await store.load();
    assert.deepEqual(head.items.map((item) => item.id), ["B"]);
  });
});
