import test from "node:test";
import assert from "node:assert/strict";
import { resolveBackendContext, resolveQaContext } from "../src/oracle.js";

test("Backend compatibility adapter parses order, reads in order and validates context", async () => {
  const seen = [];
  const context = await resolveBackendContext({ id: "w1", objectiveId: "o1", task: "implement", repositoryRef: "repo://x", revision: "r1", requiredFiles: ["a", "b"] }, {
    repositoryReader: { async readFile(request) { seen.push(request); return { content: request.path, sourceRef: `source:${request.path}` }; } }
  });
  assert.deepEqual(seen, [
    { repositoryRef: "repo://x", revision: "r1", path: "a" },
    { repositoryRef: "repo://x", revision: "r1", path: "b" }
  ]);
  assert.deepEqual(context.files.map(file => file.sourceRef), ["source:a", "source:b"]);
  await assert.rejects(() => resolveBackendContext({ id: "w1", objectiveId: "o1", task: "implement", repositoryRef: "repo://x", revision: "r1", requiredFiles: ["a"] }, { repositoryReader: { readFile: async () => ({ content: null, sourceRef: "x" }) } }), /content/);
});

test("QA compatibility adapter preserves application artifact provenance", async () => {
  const decision = { id: "d1", digest: "sha256:d1" };
  const seen = [];
  const context = await resolveQaContext({ id: "q1", objectiveId: "o1", task: "verify", upstream: { workOrderId: "w1", revision: "r1", acceptanceDecision: decision }, requiredArtifacts: [{ ref: "artifact://a", path: "a.js" }], acceptanceCriteria: ["passes"] }, {
    artifactReader: { async readArtifact(request) { seen.push(request); return { content: "ok", sourceRef: "store:a" }; } }
  });
  assert.deepEqual(seen, [{ ref: "artifact://a", path: "a.js", producerWorkOrderId: "w1", revision: "r1", acceptanceDecision: decision }]);
  assert.equal(context.artifacts[0].sourceRef, "store:a");
  assert.deepEqual(context.artifacts[0].provenance, { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId: "w1", acceptanceDecision: decision });
});
