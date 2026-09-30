// BB-089 A1/A2: opt-in Oracle path for declared Backend/QA context.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BackendContextSchema,
  OracleContextBlockedError,
  QaContextSchema,
  backendContextRequirement,
  defineBackendObjective,
  makeBackendWorkOrder,
  makeQaWorkOrder,
  prepareBackendObjective,
  projectBackendContext,
  projectQaContext,
  qaContextRequirement,
  recoverBackendObjective,
  resolveBackendContext,
  resolveQaContext,
  runBackendObjective,
  runQaObjective
} from "../src/index.js";

// The delivered RetrievalPlanner reserves min(8192, remaining) bytes per declared item, so a
// three-file order needs a budget that covers three reservations.
const BUDGET = { maxMaterializedBytes: 3 * 8192 };

function backendObjective() {
  return defineBackendObjective({
    id: "bb089-backend",
    task: "Adopt the Oracle path for declared Backend context.",
    repository: { ref: "repo://bb089", revision: "rev-7" },
    requiredFiles: ["src/server.js", "test/server.test.js", "src/routes/users.js"],
    constraints: ["resolve exactly the declared files"]
  });
}

const FILES = new Map([
  ["src/server.js", "export function createServer() { return 'ok'; }\n"],
  ["test/server.test.js", "// server tests\n"],
  ["src/routes/users.js", "export const users = [];\n"]
]);

function repositoryReader({ fail = null, files = FILES } = {}) {
  const calls = [];
  return {
    calls,
    async readFile({ repositoryRef, revision, path }) {
      calls.push({ repositoryRef, revision, path });
      if (path === fail) throw new Error(`disk read failed for ${path}`);
      if (!files.has(path)) throw new Error(`missing file: ${path}`);
      return { content: files.get(path), sourceRef: `${repositoryRef}@${revision}:${path}` };
    }
  };
}

function handoff() {
  return {
    producerWorkOrderId: "backend:bb089",
    revision: "rev-8",
    acceptanceDecision: { id: "decision:bb089-accepted", digest: "sha256:bb089-accepted" },
    artifacts: [
      { ref: "artifact://bb089/server", path: "src/server.js" },
      { ref: "artifact://bb089/tests", path: "test/server.test.js" }
    ]
  };
}

function qaObjective() {
  return {
    id: "qa:bb089",
    task: "Verify the accepted Backend artifacts.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: ["Inspect exactly the accepted Backend bytes."]
  };
}

const ARTIFACTS = new Map([
  ["artifact://bb089/server", "export const healthy = true;\n"],
  ["artifact://bb089/tests", "assert.equal(healthy, true);\n"]
]);

function artifactReader({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async readArtifact(request) {
      calls.push(structuredClone(request));
      if (request.ref === fail) {
        const error = new Error(`artifact store unavailable for ${request.ref}`);
        error.code = "STORE_UNAVAILABLE";
        throw error;
      }
      return { content: ARTIFACTS.get(request.ref), sourceRef: `artifact-store:${request.ref}@${request.revision}` };
    }
  };
}

function stubWorker() {
  const received = [];
  const blocked = { status: "BLOCKED", summary: "stub worker records context only", blockers: ["stub worker"] };
  return {
    received,
    async execute(order, context) { received.push({ order, context }); return structuredClone(blocked); },
    async recover(order, context) { received.push({ order, context }); return { action: "BLOCKED", blockers: ["stub worker"] }; }
  };
}

test("A1 Backend requirement maps declared files in order to REQUIRED EXACT REPOSITORY evidence", () => {
  const order = makeBackendWorkOrder(backendObjective());
  const requirement = backendContextRequirement(order, BUDGET);
  assert.equal(requirement.consumerRef, `backend-work-order:${order.id}`);
  assert.deepEqual(requirement.evidence.map((e) => e.id), ["file-0", "file-1", "file-2"]);
  assert.deepEqual(requirement.evidence.map((e) => e.source.itemRefs), order.requiredFiles.map((path) => [path]));
  for (const evidence of requirement.evidence) {
    assert.equal(evidence.necessity, "REQUIRED");
    assert.deepEqual(evidence.source.snapshot, { mode: "EXACT", ref: "rev-7" });
    assert.equal(evidence.source.kind, "REPOSITORY");
    assert.equal(evidence.source.ref, "repo://bb089");
  }
  assert.deepEqual(requirement.budget, { maxItems: 3, maxProviderCalls: 3, maxResolutionSteps: 1, maxMaterializedBytes: 24576 });
  const declared = new Set(order.requiredFiles);
  assert.equal(requirement.evidence.length, declared.size);
  assert.ok(requirement.evidence.every((e) => declared.has(e.source.itemRefs[0])), "no undeclared evidence");
});

test("A1 QA requirement maps declared path-bearing artifacts with producer/revision/acceptance provenance", () => {
  const order = makeQaWorkOrder(qaObjective(), handoff());
  const requirement = qaContextRequirement(order, BUDGET);
  assert.equal(requirement.consumerRef, `qa-work-order:${order.id}`);
  assert.deepEqual(requirement.evidence.map((e) => [e.id, e.source.ref, e.source.itemRefs]), [
    ["artifact-0", "artifact://bb089/server", ["src/server.js"]],
    ["artifact-1", "artifact://bb089/tests", ["test/server.test.js"]]
  ]);
  for (const evidence of requirement.evidence) {
    assert.equal(evidence.necessity, "REQUIRED");
    assert.equal(evidence.source.kind, "APPLICATION_ARTIFACT");
    assert.deepEqual(evidence.source.snapshot, { mode: "EXACT", ref: "rev-8" });
    assert.deepEqual(evidence.requiredProvenance, [
      { kind: "PRODUCER_WORK_ORDER", ref: "backend:bb089" },
      { kind: "ACCEPTANCE_DECISION", ref: "decision:bb089-accepted", digest: "sha256:bb089-accepted" }
    ]);
  }
  assert.deepEqual(requirement.budget, { maxItems: 2, maxProviderCalls: 2, maxResolutionSteps: 1, maxMaterializedBytes: 24576 });
});

test("A1 missing, zero, negative or fractional maxMaterializedBytes is rejected before any read", async () => {
  const order = makeBackendWorkOrder(backendObjective());
  const qaOrder = makeQaWorkOrder(qaObjective(), handoff());
  for (const oracleResolution of [{}, { maxMaterializedBytes: 0 }, { maxMaterializedBytes: -1 }, { maxMaterializedBytes: 1.5 }, null]) {
    const reader = repositoryReader();
    await assert.rejects(resolveBackendContext(order, { repositoryReader: reader, oracleResolution }), /maxMaterializedBytes must be a positive safe integer/);
    assert.equal(reader.calls.length, 0);
    const store = artifactReader();
    await assert.rejects(resolveQaContext(qaOrder, { artifactReader: store, oracleResolution }), /maxMaterializedBytes must be a positive safe integer/);
    assert.equal(store.calls.length, 0);
  }
});

test("A1 a pathless QA artifact is rejected with a typed error on the Oracle path but resolves on the compatibility path", async () => {
  const order = makeQaWorkOrder(qaObjective(), handoff());
  const pathless = { ...structuredClone(order), requiredArtifacts: [{ ref: "artifact://bb089/server" }] };
  assert.throws(() => qaContextRequirement(pathless, BUDGET), (error) => error instanceof TypeError && /pathless artifacts are supported only on the compatibility path/.test(error.message));
  const oracleReader = artifactReader();
  await assert.rejects(resolveQaContext(pathless, { artifactReader: oracleReader, oracleResolution: BUDGET }), TypeError);
  assert.equal(oracleReader.calls.length, 0);
  const compat = await resolveQaContext(pathless, { artifactReader: artifactReader() });
  assert.equal(compat.artifacts.length, 1);
  assert.equal(compat.artifacts[0].path, undefined);
});

test("A2 COMPLETE Backend resolution projects to a BackendContextSchema-valid context with original sourceRef", async () => {
  const order = makeBackendWorkOrder(backendObjective());
  const reader = repositoryReader();
  const context = await resolveBackendContext(order, { repositoryReader: reader, oracleResolution: BUDGET });
  assert.deepEqual(BackendContextSchema.parse(context), context);
  assert.deepEqual(context.repository, { ref: "repo://bb089", revision: "rev-7" });
  assert.deepEqual(context.files.map((f) => f.path), order.requiredFiles);
  for (const file of context.files) {
    assert.equal(file.content, FILES.get(file.path));
    assert.equal(file.sourceRef, `repo://bb089@rev-7:${file.path}`);
  }
  assert.deepEqual(reader.calls, order.requiredFiles.map((path) => ({ repositoryRef: "repo://bb089", revision: "rev-7", path })));
});

test("A2 COMPLETE QA resolution projects to a QaContextSchema-valid context with acceptance provenance", async () => {
  const order = makeQaWorkOrder(qaObjective(), handoff());
  const context = await resolveQaContext(order, { artifactReader: artifactReader(), oracleResolution: BUDGET });
  assert.deepEqual(QaContextSchema.parse(context), context);
  assert.deepEqual(context.upstream, order.upstream);
  assert.deepEqual(context.acceptanceCriteria, order.acceptanceCriteria);
  assert.deepEqual(context.artifacts, order.requiredArtifacts.map((artifact) => ({
    ref: artifact.ref,
    path: artifact.path,
    content: ARTIFACTS.get(artifact.ref),
    sourceRef: `artifact-store:${artifact.ref}@rev-8`,
    provenance: { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId: "backend:bb089", acceptanceDecision: order.upstream.acceptanceDecision }
  })));
});

test("A2 a repository reader failure blocks with SOURCE_FAILURE and detail before any Worker call", async () => {
  const worker = stubWorker();
  await assert.rejects(
    runBackendObjective(backendObjective(), { repositoryReader: repositoryReader({ fail: "test/server.test.js" }), oracleResolution: BUDGET, backendWorker: worker }),
    (error) => {
      assert.ok(error instanceof OracleContextBlockedError);
      assert.equal(error.domain, "BACKEND");
      assert.equal(error.status, "UNSATISFIED");
      assert.deepEqual(error.unresolved, [{ evidenceId: "file-1", reason: "SOURCE_FAILURE" }]);
      assert.match(error.message, /file-1:SOURCE_FAILURE/);
      assert.match(error.message, /disk read failed for test\/server\.test\.js/);
      return true;
    }
  );
  assert.equal(worker.received.length, 0);
});

test("A2 a QA artifact reader failure blocks with SOURCE_FAILURE, keeps the reader error code, and never calls the Worker", async () => {
  const worker = stubWorker();
  await assert.rejects(
    runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: artifactReader({ fail: "artifact://bb089/tests" }), oracleResolution: BUDGET, qaWorker: worker }),
    (error) => {
      assert.ok(error instanceof OracleContextBlockedError);
      assert.equal(error.domain, "QA");
      assert.equal(error.status, "UNSATISFIED");
      assert.deepEqual(error.unresolved, [{ evidenceId: "artifact-1", reason: "SOURCE_FAILURE" }]);
      assert.match(error.message, /STORE_UNAVAILABLE: artifact store unavailable/);
      return true;
    }
  );
  assert.equal(worker.received.length, 0);
});

test("A2 declared context larger than maxMaterializedBytes is BUDGET_EXHAUSTED and blocks without truncation", async () => {
  const worker = stubWorker();
  const big = new Map([...FILES].map(([path, content]) => [path, content.repeat(40)]));
  await assert.rejects(
    runBackendObjective(backendObjective(), { repositoryReader: repositoryReader({ files: big }), oracleResolution: { maxMaterializedBytes: 1200 }, backendWorker: worker }),
    (error) => error instanceof OracleContextBlockedError && error.status === "UNSATISFIED" && error.unresolved.some((u) => u.reason === "BUDGET_EXHAUSTED")
  );
  assert.equal(worker.received.length, 0);
  const qaWorker = stubWorker();
  await assert.rejects(
    runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: artifactReader(), oracleResolution: { maxMaterializedBytes: 64 }, qaWorker }),
    (error) => error instanceof OracleContextBlockedError && error.unresolved.some((u) => u.reason === "BUDGET_EXHAUSTED")
  );
  assert.equal(qaWorker.received.length, 0);
});

test("A2 delivered planner reservation: one declared item larger than 8,192 materialized bytes blocks even under a large budget", async () => {
  const worker = stubWorker();
  const files = new Map([...FILES, ["src/server.js", "x".repeat(9000)]]);
  await assert.rejects(
    runBackendObjective(backendObjective(), { repositoryReader: repositoryReader({ files }), oracleResolution: { maxMaterializedBytes: 1_000_000 }, backendWorker: worker }),
    (error) => error instanceof OracleContextBlockedError && error.unresolved.some((u) => u.evidenceId === "file-0" && u.reason === "BUDGET_EXHAUSTED")
  );
  assert.equal(worker.received.length, 0);
  const compat = await resolveBackendContext(makeBackendWorkOrder(backendObjective()), { repositoryReader: repositoryReader({ files }) });
  assert.equal(compat.files[0].content.length, 9000, "the compatibility path has no budget");
});

test("A2 projection rejects any non-COMPLETE or incomplete resolution defensively", () => {
  const order = makeBackendWorkOrder(backendObjective());
  const qaOrder = makeQaWorkOrder(qaObjective(), handoff());
  for (const status of ["PARTIAL", "UNSATISFIED"]) {
    assert.throws(() => projectBackendContext(order, { status, items: [] }), /requires a COMPLETE resolution/);
    assert.throws(() => projectQaContext(qaOrder, { status, items: [] }), /requires a COMPLETE resolution/);
  }
  assert.throws(() => projectBackendContext(order, { status: "COMPLETE", items: [] }), /exactly the declared items/);
});

test("A2 end-to-end: runBackendObjective, prepareBackendObjective, recoverBackendObjective and runQaObjective deliver the Oracle-projected context", async () => {
  const order = makeBackendWorkOrder(backendObjective());
  const expectedBackend = await resolveBackendContext(order, { repositoryReader: repositoryReader(), oracleResolution: BUDGET });

  const worker = stubWorker();
  const run = await runBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: BUDGET, backendWorker: worker });
  assert.equal(worker.received.length, 1);
  assert.deepEqual(worker.received[0].context, expectedBackend);
  assert.deepEqual(run.context, expectedBackend);

  const prepared = await prepareBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: BUDGET });
  assert.deepEqual(prepared.context, expectedBackend);

  const recoverer = stubWorker();
  const recovered = await recoverBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: BUDGET, backendWorker: recoverer });
  assert.deepEqual(recoverer.received[0].context, expectedBackend);
  assert.deepEqual(recovered.context, expectedBackend);

  // The option is really threaded: the same entry points block on an Oracle-only budget.
  for (const entry of [
    () => runBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: { maxMaterializedBytes: 16 }, backendWorker: stubWorker() }),
    () => prepareBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: { maxMaterializedBytes: 16 } }),
    () => recoverBackendObjective(backendObjective(), { repositoryReader: repositoryReader(), oracleResolution: { maxMaterializedBytes: 16 }, backendWorker: stubWorker() })
  ]) await assert.rejects(entry, OracleContextBlockedError);

  const qaOrder = makeQaWorkOrder(qaObjective(), handoff());
  const expectedQa = await resolveQaContext(qaOrder, { artifactReader: artifactReader(), oracleResolution: BUDGET });
  const qaWorker = stubWorker();
  const qaRun = await runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: artifactReader(), oracleResolution: BUDGET, qaWorker });
  assert.equal(qaWorker.received.length, 1);
  assert.deepEqual(qaWorker.received[0].context, expectedQa);
  assert.deepEqual(qaRun.context, expectedQa);
  await assert.rejects(runQaObjective(qaObjective(), { handoff: handoff(), artifactReader: artifactReader(), oracleResolution: { maxMaterializedBytes: 16 }, qaWorker: stubWorker() }), OracleContextBlockedError);
});
