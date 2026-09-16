import assert from "node:assert/strict";
import { promises as nodeFs } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createEvidenceArtifact,
  environmentRefFromValue,
  subjectFromValue
} from "../../core-harness/src/index.js";
import { createJsonTrustArtifactStore } from "../src/index.js";

function evidence() {
  return createEvidenceArtifact({
    subject: subjectFromValue(
      { revision: "rev-2", task: "bb019" },
      { type: "trust-store-test", producer: { identity: "producer", roles: ["producer"] } }
    ),
    kind: "TRUST_STORE_TEST",
    producer: { identity: "verifier", roles: ["verifier"] },
    environment: environmentRefFromValue(
      { image: "verify@sha256:bb019" },
      { name: "bb019-test" }
    ),
    content: { passed: true },
    generatedAt: "2026-09-16T15:30:00.000Z"
  });
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-trust-store-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("trust artifact publication interruption cannot leave a poisoned final digest path", async () => {
  await withDirectory(async (directory) => {
    let failPublish = true;
    const interruptedFs = {
      mkdir: (...args) => nodeFs.mkdir(...args),
      open: (...args) => nodeFs.open(...args),
      readFile: (...args) => nodeFs.readFile(...args),
      unlink: (...args) => nodeFs.unlink(...args),
      async link(...args) {
        if (failPublish) {
          failPublish = false;
          const error = new Error("simulated publish interruption");
          error.code = "EIO";
          throw error;
        }
        return nodeFs.link(...args);
      }
    };
    const artifact = evidence();
    const interrupted = createJsonTrustArtifactStore({ path: directory, fs: interruptedFs });

    await assert.rejects(
      () => interrupted.putEvidence(artifact),
      /simulated publish interruption/
    );
    assert.deepEqual(await readdir(directory), [], "failed pre-publication write must clean its temporary file and publish no final artifact");

    const recovered = createJsonTrustArtifactStore({ path: directory });
    const ref = await recovered.putEvidence(artifact);
    assert.deepEqual(ref, { id: artifact.id, digest: artifact.digest });
    assert.equal((await recovered.readEvidence(ref)).id, artifact.id);
  });
});

test("trust artifact store makes competing identical publications deterministic and idempotent", async () => {
  await withDirectory(async (directory) => {
    const artifact = evidence();
    const writers = Array.from({ length: 8 }, () => createJsonTrustArtifactStore({ path: directory }));
    const refs = await Promise.all(writers.map((store) => store.putEvidence(artifact)));

    assert.ok(refs.every((ref) => ref.id === artifact.id && ref.digest === artifact.digest));
    const files = await readdir(directory);
    assert.equal(files.length, 1, "all successful identical writers must converge on one immutable final artifact");
    assert.ok(files[0].startsWith("evidence-"));
    assert.equal((await writers[0].readEvidence(refs[0])).digest, artifact.digest);
  });
});
