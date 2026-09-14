import assert from "node:assert/strict";
import test from "node:test";
import {
  AVOCapability,
  EvaluationVerdict
} from "../../core-harness/src/index.js";
import {
  BackendRunAction,
  BackendWorkStatus,
  createBackendWorker,
  defineBackendObjective,
  makeBackendWorkOrder,
  resolveBackendContext,
  runBackendObjective
} from "../src/index.js";

function objective() {
  return defineBackendObjective({
    id: "health-endpoint",
    task: "Add a GET /health endpoint without changing the existing /users behavior.",
    repository: {
      ref: "repo://example-backend",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: ["preserve the existing /users response contract"]
  });
}

function repositoryReader() {
  const files = new Map([
    ["src/server.js", "export function createServer() {}\n"],
    ["test/server.test.js", "// existing server tests\n"]
  ]);

  return {
    async readFile({ repositoryRef, revision, path }) {
      assert.equal(repositoryRef, "repo://example-backend");
      assert.equal(revision, "rev-1");
      if (!files.has(path)) throw new Error(`missing file: ${path}`);
      return {
        content: files.get(path),
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function appliedStrategy() {
  return {
    async run({ input, invoke }) {
      assert.equal(input.work.kind, "BACKEND");
      assert.equal(input.work.order.objectiveId, "health-endpoint");
      assert.equal(input.work.context.files.length, 2);

      const action = await invoke(AVOCapability.ACT, {
        kind: "APPLY_BACKEND_CHANGE",
        target: "src/server.js"
      });
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
      await invoke(AVOCapability.PROMOTE);

      return {
        status: BackendWorkStatus.APPLIED,
        summary: "Added the health endpoint and its test.",
        revision: action.candidate.version,
        artifacts: action.result.artifacts,
        blockers: []
      };
    }
  };
}

function workspace() {
  return {
    async act({ candidate, work, action }) {
      assert.equal(action.kind, "APPLY_BACKEND_CHANGE");
      assert.equal(work.context.repository.revision, "rev-1");
      return {
        mutated: true,
        candidate: {
          id: candidate.id,
          version: "rev-2"
        },
        result: {
          artifacts: [
            {
              ref: "workspace://rev-2/src/server.js",
              path: "src/server.js"
            },
            {
              ref: "workspace://rev-2/test/server.test.js",
              path: "test/server.test.js"
            }
          ]
        }
      };
    }
  };
}

test("S2 resolves only the Backend files declared by the concrete order", async () => {
  const order = makeBackendWorkOrder(objective());
  const seen = [];
  const reader = repositoryReader();
  const context = await resolveBackendContext(order, {
    repositoryReader: {
      async readFile(request) {
        seen.push(request.path);
        return reader.readFile(request);
      }
    }
  });

  assert.deepEqual(seen, ["src/server.js", "test/server.test.js"]);
  assert.equal(context.repository.ref, "repo://example-backend");
  assert.equal(context.files[0].sourceRef, "repo://example-backend@rev-1:src/server.js");
});

test("S2 resolution failure names the declared file and source boundary", async () => {
  const order = makeBackendWorkOrder(objective());

  await assert.rejects(
    () => resolveBackendContext(order, {
      repositoryReader: {
        async readFile({ path }) {
          if (path === "test/server.test.js") throw new Error("not found");
          return { content: "ok", sourceRef: `repo://example-backend@rev-1:${path}` };
        }
      }
    }),
    /backend context resolution failed for test\/server\.test\.js from repo:\/\/example-backend@rev-1: not found/
  );
});

test("S3 BackendWorker executes the concrete work through ExHarness and requires promotion for APPLIED", async () => {
  const order = makeBackendWorkOrder(objective());
  const context = await resolveBackendContext(order, { repositoryReader: repositoryReader() });
  const worker = createBackendWorker({ strategy: appliedStrategy(), workspace: workspace() });

  const result = await worker.execute(order, context);

  assert.equal(result.status, BackendWorkStatus.APPLIED);
  assert.equal(result.revision, "rev-2");
  assert.equal(result.artifacts.length, 2);
});

test("S3 rejects an APPLIED result that did not advance ExHarness lineage", async () => {
  const order = makeBackendWorkOrder(objective());
  const context = await resolveBackendContext(order, { repositoryReader: repositoryReader() });
  const worker = createBackendWorker({
    workspace: workspace(),
    strategy: {
      async run({ invoke }) {
        const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
        await invoke(AVOCapability.EVALUATE);
        return {
          status: BackendWorkStatus.APPLIED,
          summary: "claimed success without promotion",
          revision: action.candidate.version,
          artifacts: action.result.artifacts,
          blockers: []
        };
      }
    }
  });

  await assert.rejects(
    () => worker.execute(order, context),
    /APPLIED BackendWorkResult requires ExHarness lineage promotion/
  );
});

test("S4 runs one Backend objective end-to-end with concrete deterministic composition", async () => {
  const backendWorker = createBackendWorker({ strategy: appliedStrategy(), workspace: workspace() });

  const run = await runBackendObjective(objective(), {
    repositoryReader: repositoryReader(),
    backendWorker
  });

  assert.equal(run.objectiveId, "health-endpoint");
  assert.equal(run.order.id, "health-endpoint:backend");
  assert.equal(run.result.status, BackendWorkStatus.APPLIED);
  assert.deepEqual(run.decision, {
    action: BackendRunAction.RETURN,
    reason: "backend change applied"
  });
});
