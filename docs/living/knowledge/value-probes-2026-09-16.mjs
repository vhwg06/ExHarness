// Isolated diagnostic probes, not production configuration or regression gates.
// Run from any directory: node docs/living/knowledge/value-probes-2026-09-16.mjs
import assert from "node:assert/strict";
import {
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createDurableBackendQaWorkflow
} from "../../../packages/agentic-system/src/index.js";

function memoryFs() {
  const files = new Map();
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  return {
    async mkdir() {},
    async readFile(path) { if (!files.has(path)) throw missing(); return files.get(path); },
    async writeFile(path, value) { files.set(path, value); },
    async rename(from, to) {
      if (!files.has(from)) throw missing();
      files.set(to, files.get(from)); files.delete(from);
    },
    async unlink(path) { if (!files.delete(path)) throw missing(); },
    async stat() { return { mtimeMs: Date.now() }; },
    async open(path) {
      if (files.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      files.set(path, "");
      return { async writeFile(value) { files.set(path, value); }, async close() {} };
    }
  };
}

const reviewTrust = {
  trustPolicyFor() { return {}; },
  verifySignature() { return false; },
  verifyEvaluatorAuthority() { return false; },
  verifyEvidenceAuthority() { return false; }
};

async function freshBoard() {
  const store = createJsonBlackboardStore({ path: "probe.json", fs: memoryFs() });
  const orchestrator = createApplicationOrchestrator({ store, reviewTrust });
  await orchestrator.seed([{ id: "probe", work: "isolated diagnostic", status: "READY" }]);
  return { store, orchestrator };
}

{
  const { store, orchestrator } = await freshBoard();
  await orchestrator.claim({ itemId: "probe", owner: "a" });
  const saved = await orchestrator.checkpoint({
    itemId: "probe", owner: "a",
    checkpoint: { pending: new Map([["experiment-1", "needs-review"]]), score: NaN }
  });
  const loaded = (await store.load()).items[0];
  assert.equal(saved.result.checkpoint.pending.get("experiment-1"), "needs-review");
  assert.deepEqual(loaded.checkpoint.pending, {});
  assert.equal(Number.isNaN(saved.result.checkpoint.score), true);
  assert.equal(loaded.checkpoint.score, null);
  console.log("payload: returned Map retains experiment; persisted pending={}, NaN becomes null");
}

for (const action of ["ESCALATE", "REQUEST_CONTEXT"]) {
  const { store, orchestrator } = await freshBoard();
  let executions = 0;
  const workflow = createDurableBackendQaWorkflow({
    orchestrator,
    repositoryReader: { async readFile() { return { content: "source", sourceRef: "repo://r/file" }; } },
    artifactReader: { async readArtifact() { throw new Error("QA must not run"); } },
    backendWorker: { async execute() {
      executions++;
      return { status: "APPLIED", summary: "has unresolved question", revision: "r2",
        artifacts: [], evidence: [], gaps: [{ id: "g", summary: "missing requirement" }] };
    } },
    // Intentionally remove evidence requirements to isolate continuation routing.
    // This probe does not establish acceptance under the default completion policy.
    backendCompletionPolicy: { requiredEvidenceClaims: [], requireArtifacts: false },
    backendAdvisor: { async assess() {
      return { action, gapIds: ["g"], rationale: "needs external clarification",
        contextNeeds: action === "REQUEST_CONTEXT" ? ["client contract"] : [] };
    } },
    qaWorker: { async execute() { throw new Error("QA must not run"); } }
  });
  await workflow.initialize({ itemId: "probe", owner: "a",
    backendObjective: { id: "backend", task: "change", repository: { ref: "repo", revision: "r1" }, requiredFiles: ["file"] },
    qaObjective: { id: "qa", task: "verify", requiredArtifactPaths: ["file"], acceptanceCriteria: ["works"] }
  });
  const run = await workflow.advance({ itemId: "probe", owner: "a" });
  assert.equal(run.backend.decision.action, action);
  const item = (await store.load()).items[0];
  assert.equal(item.status, "REOPENED");
  assert.deepEqual(item.blockers, []);
  assert.equal(JSON.stringify(item).includes("client contract"), false);
  await workflow.advance({ itemId: "probe", owner: "b" });
  assert.equal(executions, 2);
  console.log(`${action}: REOPENED, no durable blocker/context need; second advance executes Backend again`);
}
