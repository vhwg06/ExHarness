import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ArtifactAvailability,
  ArtifactManifestErrorCode,
  BackendCompletionAction,
  captureAcceptedBackendArtifactManifest,
  createJsonArtifactManifestStore,
  createManifestArtifactReader,
  defineApplicationArtifactManifest,
  makeQaWorkOrder,
  resolveQaContext
} from "../src/index.js";

function acceptedBackendRun() {
  return {
    order: { id: "backend:bb043" },
    result: {
      revision: "rev-2",
      artifacts: [
        { ref: "artifact://stable/server", path: "src/server.js" },
        { ref: "artifact://stable/tests", path: "test/server.test.js" }
      ]
    },
    completion: {
      action: BackendCompletionAction.ACCEPT,
      decision: {
        id: "decision:backend-accepted",
        digest: "sha256:backend-accepted"
      }
    }
  };
}

function qaObjective() {
  return {
    id: "qa:bb043",
    task: "Verify accepted Backend artifacts.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: ["Inspect exactly the accepted Backend bytes."]
  };
}

function producedArtifacts() {
  return [
    {
      ref: "artifact://stable/server",
      path: "src/server.js",
      content: "export const healthy = true;\n"
    },
    {
      ref: "artifact://stable/tests",
      path: "test/server.test.js",
      content: "assert.equal(healthy, true);\n"
    }
  ];
}

function retention() {
  return {
    policyRevision: "artifact-retention@1",
    pinnedBy: ["BB-043:QA_PENDING"]
  };
}

function manifest() {
  return captureAcceptedBackendArtifactManifest({
    backendRun: acceptedBackendRun(),
    producedArtifacts: producedArtifacts(),
    retention: retention()
  });
}

function handoff(overrides = {}) {
  const run = acceptedBackendRun();
  return {
    producerWorkOrderId: overrides.producerWorkOrderId ?? run.order.id,
    revision: overrides.revision ?? run.result.revision,
    acceptanceDecision: overrides.acceptanceDecision ?? structuredClone(run.completion.decision),
    artifacts: structuredClone(run.result.artifacts)
  };
}

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb043-"));
  const manifestPath = join(directory, "manifests");
  const recordsPath = join(directory, "records.json");
  const records = Object.fromEntries(
    producedArtifacts().map((artifact) => [
      artifact.ref,
      {
        path: artifact.path,
        content: artifact.content
      }
    ])
  );
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

  function underlyingReader() {
    return {
      async readArtifact({ ref }) {
        const current = JSON.parse(await readFile(recordsPath, "utf8"));
        const record = current[ref];
        if (!record) {
          const error = new Error(`missing artifact: ${ref}`);
          error.code = "ENOENT";
          throw error;
        }
        return {
          content: record.content,
          sourceRef: `filesystem-artifact:${ref}`
        };
      }
    };
  }

  try {
    await run({
      directory,
      manifestPath,
      recordsPath,
      underlyingReader,
      async readRecords() {
        return JSON.parse(await readFile(recordsPath, "utf8"));
      },
      async writeRecords(value) {
        await writeFile(recordsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function resolveWith({ manifestPath, underlyingReader, qaHandoff = handoff() }) {
  const store = createJsonArtifactManifestStore({ path: manifestPath });
  const reader = createManifestArtifactReader({
    reader: underlyingReader(),
    manifestStore: store
  });
  const order = makeQaWorkOrder(qaObjective(), qaHandoff);
  return {
    reader,
    context: await resolveQaContext(order, { artifactReader: reader })
  };
}

async function expectOracleManifestError(promiseFactory, code) {
  await assert.rejects(
    promiseFactory,
    (error) => {
      assert.match(error.message, /qa context resolution failed/);
      assert.equal(error.cause?.code, code);
      return true;
    }
  );
}

test("BB-043 producer capture binds accepted artifacts without persisting payload bodies", () => {
  const captured = manifest();
  assert.equal(captured.producerWorkOrderId, "backend:bb043");
  assert.equal(captured.producerRevision, "rev-2");
  assert.deepEqual(captured.acceptanceDecision, {
    id: "decision:backend-accepted",
    digest: "sha256:backend-accepted"
  });
  assert.equal(captured.entries.length, 2);
  assert.equal(captured.entries[0].storedRevision, "rev-2");
  assert.equal(captured.entries[0].availability, ArtifactAvailability.AVAILABLE);
  assert.match(captured.entries[0].contentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(captured.retention, retention());

  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes("export const healthy"), false);
  assert.equal(serialized.includes("assert.equal(healthy"), false);
});

test("BB-043 producer capture requires exact accepted artifact coverage and ACCEPT completion", () => {
  assert.throws(
    () => captureAcceptedBackendArtifactManifest({
      backendRun: {
        ...acceptedBackendRun(),
        completion: {
          ...acceptedBackendRun().completion,
          action: "CONTINUE"
        }
      },
      producedArtifacts: producedArtifacts(),
      retention: retention()
    }),
    /requires ACCEPTED Backend completion/
  );

  assert.throws(
    () => captureAcceptedBackendArtifactManifest({
      backendRun: acceptedBackendRun(),
      producedArtifacts: producedArtifacts().slice(0, 1),
      retention: retention()
    }),
    /must exactly cover accepted Backend artifacts/
  );

  assert.throws(
    () => captureAcceptedBackendArtifactManifest({
      backendRun: acceptedBackendRun(),
      producedArtifacts: producedArtifacts().map((artifact, index) => index === 0
        ? { ...artifact, storedRevision: "rev-1" }
        : artifact),
      retention: retention()
    }),
    /produced artifact revision mismatch/
  );
});

test("BB-043 fresh reader reconstructs a valid manifest and preserves existing QA context shape", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    const producerStore = createJsonArtifactManifestStore({ path: manifestPath });
    const manifestRef = await producerStore.putManifest(manifest());
    assert.match(manifestRef, /^artifact-manifest:\/\/sha256:[0-9a-f]{64}$/);

    // Fresh store/reader instances reconstruct only from persisted filesystem state.
    const { reader, context } = await resolveWith({ manifestPath, underlyingReader });
    assert.equal(context.artifacts.length, 2);
    assert.deepEqual(
      context.artifacts.map((artifact) => ({
        ref: artifact.ref,
        path: artifact.path,
        sourceRef: artifact.sourceRef,
        sourceClass: artifact.provenance.sourceClass
      })),
      [
        {
          ref: "artifact://stable/server",
          path: "src/server.js",
          sourceRef: "filesystem-artifact:artifact://stable/server",
          sourceClass: "APPLICATION_ARTIFACT"
        },
        {
          ref: "artifact://stable/tests",
          path: "test/server.test.js",
          sourceRef: "filesystem-artifact:artifact://stable/tests",
          sourceClass: "APPLICATION_ARTIFACT"
        }
      ]
    );
    assert.deepEqual(reader.stats(), {
      manifestLookups: 2,
      underlyingReads: 2,
      bytesHashed: Buffer.byteLength("export const healthy = true;\n") +
        Buffer.byteLength("assert.equal(healthy, true);\n"),
      validationFailures: 0
    });
  });
});

test("BB-043 changed bytes behind a stable ref fail before QA receives context", async () => {
  await withFixture(async ({ manifestPath, underlyingReader, readRecords, writeRecords }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());
    const records = await readRecords();
    records["artifact://stable/server"].content = "export const healthy = false;\n";
    await writeRecords(records);

    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader }),
      ArtifactManifestErrorCode.CONTENT_MISMATCH
    );
  });
});

test("BB-043 missing payload is distinct from manifest/provenance failure and preserves source cause", async () => {
  await withFixture(async ({ manifestPath, underlyingReader, readRecords, writeRecords }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());
    const records = await readRecords();
    delete records["artifact://stable/server"];
    await writeRecords(records);

    await assert.rejects(
      () => resolveWith({ manifestPath, underlyingReader }),
      (error) => {
        assert.equal(error.cause?.code, ArtifactManifestErrorCode.UNAVAILABLE);
        assert.equal(error.cause?.cause?.code, "ENOENT");
        return true;
      }
    );
  });
});

test("BB-043 missing manifest fails closed without falling back to the underlying reader", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    let reads = 0;
    const countedReader = () => ({
      async readArtifact(request) {
        reads += 1;
        return underlyingReader().readArtifact(request);
      }
    });

    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader: countedReader }),
      ArtifactManifestErrorCode.MANIFEST_MISSING
    );
    assert.equal(reads, 0);
  });
});

test("BB-043 producer work-order, revision and acceptance-decision mismatches remain distinct failures", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());

    await expectOracleManifestError(
      () => resolveWith({
        manifestPath,
        underlyingReader,
        qaHandoff: handoff({ producerWorkOrderId: "backend:other" })
      }),
      ArtifactManifestErrorCode.PRODUCER_MISMATCH
    );

    await expectOracleManifestError(
      () => resolveWith({
        manifestPath,
        underlyingReader,
        qaHandoff: handoff({ revision: "rev-1" })
      }),
      ArtifactManifestErrorCode.PRODUCER_REVISION_MISMATCH
    );

    await expectOracleManifestError(
      () => resolveWith({
        manifestPath,
        underlyingReader,
        qaHandoff: handoff({
          acceptanceDecision: {
            id: "decision:other",
            digest: "sha256:backend-accepted"
          }
        })
      }),
      ArtifactManifestErrorCode.ACCEPTANCE_DECISION_MISMATCH
    );

    await expectOracleManifestError(
      () => resolveWith({
        manifestPath,
        underlyingReader,
        qaHandoff: handoff({
          acceptanceDecision: {
            id: "decision:backend-accepted",
            digest: "sha256:other"
          }
        })
      }),
      ArtifactManifestErrorCode.ACCEPTANCE_DECISION_MISMATCH
    );
  });
});

test("BB-043 stored revision and explicit unavailable metadata fail closed before the underlying read", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    const original = manifest();

    const wrongStoredRevision = defineApplicationArtifactManifest({
      kind: original.kind,
      version: original.version,
      producerWorkOrderId: original.producerWorkOrderId,
      producerRevision: original.producerRevision,
      acceptanceDecision: original.acceptanceDecision,
      retention: original.retention,
      entries: original.entries.map((entry, index) => index === 0
        ? { ...entry, storedRevision: "rev-1" }
        : entry)
    });
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(wrongStoredRevision);
    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader }),
      ArtifactManifestErrorCode.STORED_REVISION_MISMATCH
    );
  });

  await withFixture(async ({ manifestPath, underlyingReader }) => {
    const original = manifest();
    const unavailable = defineApplicationArtifactManifest({
      kind: original.kind,
      version: original.version,
      producerWorkOrderId: original.producerWorkOrderId,
      producerRevision: original.producerRevision,
      acceptanceDecision: original.acceptanceDecision,
      retention: original.retention,
      entries: original.entries.map((entry, index) => index === 0
        ? { ...entry, availability: ArtifactAvailability.UNAVAILABLE }
        : entry)
    });
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(unavailable);
    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader }),
      ArtifactManifestErrorCode.UNAVAILABLE
    );
  });
});

test("BB-043 partial manifest rejects the missing artifact instead of accepting an unvalidated read", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    const original = manifest();
    const partial = defineApplicationArtifactManifest({
      kind: original.kind,
      version: original.version,
      producerWorkOrderId: original.producerWorkOrderId,
      producerRevision: original.producerRevision,
      acceptanceDecision: original.acceptanceDecision,
      retention: original.retention,
      entries: [original.entries[0]]
    });
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(partial);

    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader }),
      ArtifactManifestErrorCode.MANIFEST_MISSING
    );
  });
});

test("BB-043 conflicting manifests for one exact provenance fail closed", async () => {
  await withFixture(async ({ manifestPath, underlyingReader }) => {
    const original = manifest();
    const changed = defineApplicationArtifactManifest({
      kind: original.kind,
      version: original.version,
      producerWorkOrderId: original.producerWorkOrderId,
      producerRevision: original.producerRevision,
      acceptanceDecision: original.acceptanceDecision,
      retention: original.retention,
      entries: original.entries.map((entry, index) => index === 0
        ? { ...entry, contentDigest: "sha256:" + "0".repeat(64) }
        : entry)
    });
    const store = createJsonArtifactManifestStore({ path: manifestPath });
    await store.putManifest(original);
    await store.putManifest(changed);

    await expectOracleManifestError(
      () => resolveWith({ manifestPath, underlyingReader }),
      ArtifactManifestErrorCode.MANIFEST_CONFLICT
    );
  });
});
