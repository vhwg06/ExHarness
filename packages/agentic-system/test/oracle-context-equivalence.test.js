// BB-089 A3: Oracle path vs compatibility path equivalence, manifest protection and
// default-path preservation. The manifest fixture shape copies
// bb043-artifact-manifest-adapter.test.js without editing it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ArtifactManifestErrorCode,
  BackendCompletionAction,
  OracleContextBlockedError,
  captureAcceptedBackendArtifactManifest,
  createJsonArtifactManifestStore,
  createManifestArtifactReader,
  defineBackendObjective,
  makeBackendWorkOrder,
  makeQaWorkOrder,
  resolveBackendContext,
  resolveQaContext,
  runQaObjective
} from "../src/index.js";

const ORACLE = { maxMaterializedBytes: 4 * 8192 };

function acceptedBackendRun() {
  return {
    order: { id: "backend:bb089" },
    result: {
      revision: "rev-2",
      artifacts: [
        { ref: "artifact://stable/server", path: "src/server.js" },
        { ref: "artifact://stable/tests", path: "test/server.test.js" }
      ]
    },
    completion: { action: BackendCompletionAction.ACCEPT, decision: { id: "decision:backend-accepted", digest: "sha256:backend-accepted" } }
  };
}

function qaObjective() {
  return {
    id: "qa:bb089-equivalence",
    task: "Verify accepted Backend artifacts.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: ["Inspect exactly the accepted Backend bytes."]
  };
}

function producedArtifacts() {
  return [
    { ref: "artifact://stable/server", path: "src/server.js", content: "export const healthy = true;\n" },
    { ref: "artifact://stable/tests", path: "test/server.test.js", content: "assert.equal(healthy, true);\n" }
  ];
}

function manifest() {
  return captureAcceptedBackendArtifactManifest({
    backendRun: acceptedBackendRun(),
    producedArtifacts: producedArtifacts(),
    retention: { policyRevision: "artifact-retention@1", pinnedBy: ["BB-089:QA_PENDING"] }
  });
}

function handoff() {
  const run = acceptedBackendRun();
  return {
    producerWorkOrderId: run.order.id,
    revision: run.result.revision,
    acceptanceDecision: structuredClone(run.completion.decision),
    artifacts: structuredClone(run.result.artifacts)
  };
}

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb089-"));
  const manifestPath = join(directory, "manifests");
  const recordsPath = join(directory, "records.json");
  const records = Object.fromEntries(producedArtifacts().map((a) => [a.ref, { path: a.path, content: a.content }]));
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  const underlyingReader = () => ({
    async readArtifact({ ref }) {
      const current = JSON.parse(await readFile(recordsPath, "utf8"));
      if (!current[ref]) { const error = new Error(`missing artifact: ${ref}`); error.code = "ENOENT"; throw error; }
      return { content: current[ref].content, sourceRef: `filesystem-artifact:${ref}` };
    }
  });
  const manifestReader = () => createManifestArtifactReader({ reader: underlyingReader(), manifestStore: createJsonArtifactManifestStore({ path: manifestPath }) });
  try {
    await run({
      manifestPath,
      underlyingReader,
      manifestReader,
      async readRecords() { return JSON.parse(await readFile(recordsPath, "utf8")); },
      async writeRecords(value) { await writeFile(recordsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function backendObjective() {
  return defineBackendObjective({
    id: "bb089-equivalence",
    task: "Compare Backend context paths.",
    repository: { ref: "repo://bb089-eq", revision: "rev-3" },
    requiredFiles: ["src/server.js", "src/lib/util.js", "test/server.test.js"],
    constraints: []
  });
}

function repositoryReader() {
  const files = new Map([
    ["src/server.js", "import { util } from './lib/util.js';\nexport const server = util;\n"],
    ["src/lib/util.js", "export const util = 1;\n"],
    ["test/server.test.js", "// tests\n"]
  ]);
  return { async readFile({ repositoryRef, revision, path }) { return { content: files.get(path), sourceRef: `${repositoryRef}@${revision}:${path}` }; } };
}

// Golden fixture of the pre-change compatibility output (readRepositorySources / readApplicationArtifacts shape).
const BACKEND_GOLDEN = {
  repository: { ref: "repo://bb089-eq", revision: "rev-3" },
  files: [
    { path: "src/server.js", content: "import { util } from './lib/util.js';\nexport const server = util;\n", sourceRef: "repo://bb089-eq@rev-3:src/server.js" },
    { path: "src/lib/util.js", content: "export const util = 1;\n", sourceRef: "repo://bb089-eq@rev-3:src/lib/util.js" },
    { path: "test/server.test.js", content: "// tests\n", sourceRef: "repo://bb089-eq@rev-3:test/server.test.js" }
  ]
};
const DECISION = { id: "decision:backend-accepted", digest: "sha256:backend-accepted" };
const QA_GOLDEN_ARTIFACTS = [
  { ref: "artifact://stable/server", path: "src/server.js", content: "export const healthy = true;\n", sourceRef: "filesystem-artifact:artifact://stable/server", provenance: { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId: "backend:bb089", acceptanceDecision: DECISION } },
  { ref: "artifact://stable/tests", path: "test/server.test.js", content: "assert.equal(healthy, true);\n", sourceRef: "filesystem-artifact:artifact://stable/tests", provenance: { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId: "backend:bb089", acceptanceDecision: DECISION } }
];

test("A3 Backend contexts are deepEqual across the compatibility and Oracle paths and equal the golden fixture", async () => {
  const order = makeBackendWorkOrder(backendObjective());
  const compat = await resolveBackendContext(order, { repositoryReader: repositoryReader() });
  const oracle = await resolveBackendContext(order, { repositoryReader: repositoryReader(), oracleResolution: ORACLE });
  assert.deepEqual(compat, BACKEND_GOLDEN);
  assert.deepEqual(oracle, compat);
});

test("A3 QA contexts are deepEqual across paths for the direct reader and the manifest-validating reader", async () => {
  await withFixture(async ({ manifestPath, underlyingReader, manifestReader }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());
    const order = makeQaWorkOrder(qaObjective(), handoff());
    const directCompat = await resolveQaContext(order, { artifactReader: underlyingReader() });
    const directOracle = await resolveQaContext(order, { artifactReader: underlyingReader(), oracleResolution: ORACLE });
    assert.deepEqual(directCompat.artifacts, QA_GOLDEN_ARTIFACTS);
    assert.deepEqual(directOracle, directCompat);

    const manifestCompatReader = manifestReader();
    const manifestOracleReader = manifestReader();
    const manifestCompat = await resolveQaContext(order, { artifactReader: manifestCompatReader });
    const manifestOracle = await resolveQaContext(order, { artifactReader: manifestOracleReader, oracleResolution: ORACLE });
    assert.deepEqual(manifestCompat, directCompat);
    assert.deepEqual(manifestOracle, manifestCompat);
    // The manifest validation ran unchanged on the Oracle path: same lookups, reads and hashed bytes.
    assert.deepEqual(manifestOracleReader.stats(), manifestCompatReader.stats());
    assert.equal(manifestOracleReader.stats().validationFailures, 0);
  });
});

test("A3 changed bytes behind a stable ref block on both paths before QA; the Oracle error carries ARTIFACT_CONTENT_MISMATCH", async () => {
  await withFixture(async ({ manifestPath, manifestReader, readRecords, writeRecords }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());
    const records = await readRecords();
    records["artifact://stable/server"].content = "export const healthy = false;\n";
    await writeRecords(records);

    const compatWorker = { calls: 0, async execute() { this.calls++; throw new Error("QA worker must not run"); } };
    await assert.rejects(
      runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: manifestReader(), qaWorker: compatWorker }),
      (error) => /qa context resolution failed/.test(error.message) && error.cause?.code === ArtifactManifestErrorCode.CONTENT_MISMATCH
    );
    assert.equal(compatWorker.calls, 0);

    const oracleWorker = { calls: 0, async execute() { this.calls++; throw new Error("QA worker must not run"); } };
    await assert.rejects(
      runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: manifestReader(), oracleResolution: ORACLE, qaWorker: oracleWorker }),
      (error) => {
        assert.ok(error instanceof OracleContextBlockedError);
        assert.equal(error.status, "UNSATISFIED");
        assert.deepEqual(error.unresolved, [{ evidenceId: "artifact-0", reason: "SOURCE_FAILURE" }]);
        assert.match(error.message, /ARTIFACT_CONTENT_MISMATCH/);
        return true;
      }
    );
    assert.equal(oracleWorker.calls, 0);
  });
});

test("A3 a provenance mismatch (wrong acceptance decision) blocks on both paths", async () => {
  await withFixture(async ({ manifestPath, manifestReader }) => {
    await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest());
    const wrong = { ...handoff(), acceptanceDecision: { id: "decision:other", digest: "sha256:other" } };
    const order = makeQaWorkOrder(qaObjective(), wrong);
    await assert.rejects(resolveQaContext(order, { artifactReader: manifestReader() }), /qa context resolution failed/);
    await assert.rejects(resolveQaContext(order, { artifactReader: manifestReader(), oracleResolution: ORACLE }), OracleContextBlockedError);
  });
});

test("A3 the default path constructs no Oracle catalog, planner or resolver (module spy in a fresh process)", () => {
  const flag = "--experimental-test-module-mocks";
  const oracleIndex = fileURLToPath(new URL("../../oracle/src/index.js", import.meta.url));
  const adapter = fileURLToPath(new URL("../src/oracle.js", import.meta.url));
  const script = `
    import { mock } from "node:test";
    const real = await import(${JSON.stringify(oracleIndex)});
    const counts = { createSourceCatalog: 0, createRetrievalPlanner: 0, createOracleContextResolver: 0 };
    const spied = Object.fromEntries(Object.keys(counts).map((name) => [name, (...args) => { counts[name]++; return real[name](...args); }]));
    mock.module(${JSON.stringify(oracleIndex)}, { namedExports: { ...real, ...spied } });
    const { resolveBackendContext, resolveQaContext } = await import(${JSON.stringify(adapter)});
    const order = { id: "b", objectiveId: "o", task: "t", repositoryRef: "repo", revision: "r1", requiredFiles: ["a.js", "b.js"] };
    const repositoryReader = { async readFile({ path }) { return { content: path, sourceRef: "s:" + path }; } };
    const qaOrder = { id: "q", objectiveId: "o", task: "t", upstream: { workOrderId: "w", revision: "r2", acceptanceDecision: { id: "d", digest: "g" } }, requiredArtifacts: [{ ref: "artifact://x", path: "x.js" }], acceptanceCriteria: ["c"] };
    const artifactReader = { async readArtifact({ ref }) { return { content: ref, sourceRef: "a:" + ref }; } };
    const defaultBackend = await resolveBackendContext(order, { repositoryReader });
    const defaultQa = await resolveQaContext(qaOrder, { artifactReader });
    const afterDefault = { ...counts };
    const oracleBackend = await resolveBackendContext(order, { repositoryReader, oracleResolution: { maxMaterializedBytes: 16384 } });
    const oracleQa = await resolveQaContext(qaOrder, { artifactReader, oracleResolution: { maxMaterializedBytes: 8192 } });
    console.log(JSON.stringify({ afterDefault, afterOracle: counts, backendEqual: JSON.stringify(defaultBackend) === JSON.stringify(oracleBackend), qaEqual: JSON.stringify(defaultQa) === JSON.stringify(oracleQa) }));
  `;
  const run = (args) => execFileSync(process.execPath, [...args, "--no-warnings", "--input-type=module", "-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let out;
  try {
    out = run([flag]);
  } catch (error) {
    // A Node release where module mocking no longer needs (or accepts) the flag.
    if (!/bad option/.test(String(error.stderr))) throw error;
    out = run([]);
  }
  const result = JSON.parse(out.trim().split("\n").pop());
  assert.deepEqual(result.afterDefault, { createSourceCatalog: 0, createRetrievalPlanner: 0, createOracleContextResolver: 0 });
  assert.deepEqual(result.afterOracle, { createSourceCatalog: 2, createRetrievalPlanner: 2, createOracleContextResolver: 2 });
  assert.equal(result.backendEqual, true);
  assert.equal(result.qaEqual, true);
});
