import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ArtifactManifestErrorCode,
  BackendCompletionAction,
  captureAcceptedBackendArtifactManifest,
  createJsonArtifactManifestStore
} from "../src/index.js";

function acceptedRun() {
  return {
    order: { id: "bb045-atomic:backend" },
    result: {
      revision: "rev-2",
      artifacts: [
        { ref: "artifact://bb045-atomic/server", path: "src/server.js" }
      ]
    },
    completion: {
      action: BackendCompletionAction.ACCEPT,
      decision: {
        id: "decision:bb045-atomic",
        digest: "sha256:bb045-atomic"
      }
    }
  };
}

function manifest(content) {
  return captureAcceptedBackendArtifactManifest({
    backendRun: acceptedRun(),
    producedArtifacts: [
      {
        ref: "artifact://bb045-atomic/server",
        path: "src/server.js",
        storedRevision: "rev-2",
        content
      }
    ],
    retention: {
      policyRevision: "bb045-atomic-retention@1",
      pinnedBy: ["BB-045:QA_PENDING"]
    }
  });
}

function twoWriterBarrierFs() {
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  return {
    mkdir: (...args) => nodeFs.mkdir(...args),
    open: (...args) => nodeFs.open(...args),
    readFile: (...args) => nodeFs.readFile(...args),
    readdir: (...args) => nodeFs.readdir(...args),
    unlink: (...args) => nodeFs.unlink(...args),
    async link(...args) {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      return nodeFs.link(...args);
    }
  };
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb045-atomic-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-045 concurrent identical publication is idempotent with one atomic publication slot", async () => {
  await withDirectory(async (directory) => {
    const store = createJsonArtifactManifestStore({
      path: directory,
      fs: twoWriterBarrierFs()
    });
    const candidate = manifest("export const healthy = true;\n");

    const [left, right] = await Promise.all([
      store.putManifest(candidate),
      store.putManifest(candidate)
    ]);

    assert.equal(left, candidate.ref);
    assert.equal(right, candidate.ref);

    const publication = await store.findPublication({
      producerWorkOrderId: candidate.producerWorkOrderId,
      producerRevision: candidate.producerRevision,
      artifacts: candidate.entries
    });
    assert.equal(publication.ref, candidate.ref);

    const names = await nodeFs.readdir(directory);
    assert.equal(names.filter((name) => /^publication-.*\.json$/.test(name)).length, 1);
  });
});

test("BB-045 concurrent conflicting publication has exactly one winner and one fail-closed conflict", async () => {
  await withDirectory(async (directory) => {
    const store = createJsonArtifactManifestStore({
      path: directory,
      fs: twoWriterBarrierFs()
    });
    const healthy = manifest("export const healthy = true;\n");
    const changed = manifest("export const healthy = false;\n");
    assert.notEqual(healthy.ref, changed.ref);

    const outcomes = await Promise.allSettled([
      store.putManifest(healthy),
      store.putManifest(changed)
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, ArtifactManifestErrorCode.MANIFEST_CONFLICT);

    const winnerRef = fulfilled[0].value;
    assert.ok([healthy.ref, changed.ref].includes(winnerRef));

    const publication = await store.findPublication({
      producerWorkOrderId: healthy.producerWorkOrderId,
      producerRevision: healthy.producerRevision,
      artifacts: healthy.entries
    });
    assert.equal(publication.ref, winnerRef);

    const names = await nodeFs.readdir(directory);
    assert.equal(names.filter((name) => /^publication-.*\.json$/.test(name)).length, 1);
    assert.equal(names.some((name) => /^manifest-.*\.json$/.test(name)), false);
  });
});

test("BB-045 legacy content-addressed manifest files remain readable and retain publication identity", async () => {
  await withDirectory(async (directory) => {
    const candidate = manifest("export const healthy = true;\n");
    await mkdir(directory, { recursive: true });
    const legacyName = `manifest-${candidate.digest.slice("sha256:".length)}.json`;
    await writeFile(
      join(directory, legacyName),
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8"
    );

    const store = createJsonArtifactManifestStore({ path: directory });
    const loaded = await store.readManifest(candidate.ref);
    assert.deepEqual(loaded, candidate);

    const publication = await store.findPublication({
      producerWorkOrderId: candidate.producerWorkOrderId,
      producerRevision: candidate.producerRevision,
      artifacts: candidate.entries
    });
    assert.equal(publication.ref, candidate.ref);

    assert.equal(await store.putManifest(candidate), candidate.ref);
    const names = await nodeFs.readdir(directory);
    assert.equal(names.filter((name) => /^publication-.*\.json$/.test(name)).length, 0);
  });
});
