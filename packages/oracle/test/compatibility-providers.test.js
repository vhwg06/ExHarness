import test from "node:test";
import assert from "node:assert/strict";
import { readRepositorySources, readApplicationArtifacts } from "../src/index.js";

const repositoryRequest = { repositoryRef: "repo://sample", revision: "r1", requiredFiles: ["a.js", "b.js"] };
const decision = { id: "accepted", digest: "sha256:accepted" };
const artifactRequest = {
  requiredArtifacts: [{ ref: "artifact://one", path: "a.js" }, { ref: "artifact://two" }],
  producerWorkOrderId: "backend-1", revision: "r2", acceptanceDecision: decision
};

test("repository provider reads in requested order and retains source refs", async () => {
  const seen = [];
  const result = await readRepositorySources(repositoryRequest, { repositoryReader: {
    async readFile(request) { seen.push(request); return { content: request.path, sourceRef: `${request.repositoryRef}@${request.revision}:${request.path}` }; }
  } });
  assert.deepEqual(seen, repositoryRequest.requiredFiles.map(path => ({ repositoryRef: "repo://sample", revision: "r1", path })));
  assert.deepEqual(result.repository, { ref: "repo://sample", revision: "r1" });
  assert.deepEqual(result.files.map(file => file.sourceRef), ["repo://sample@r1:a.js", "repo://sample@r1:b.js"]);
});

test("application artifact provider keeps identity and provenance", async () => {
  const seen = [];
  const result = await readApplicationArtifacts(artifactRequest, { artifactReader: {
    async readArtifact(request) { seen.push(request); return { content: "payload", sourceRef: request.ref }; }
  } });
  assert.deepEqual(seen, [
    { ref: "artifact://one", path: "a.js", producerWorkOrderId: "backend-1", revision: "r2", acceptanceDecision: decision },
    { ref: "artifact://two", path: null, producerWorkOrderId: "backend-1", revision: "r2", acceptanceDecision: decision }
  ]);
  assert.deepEqual(result.artifacts[0].provenance, { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId: "backend-1", acceptanceDecision: decision });
  assert.equal(Object.hasOwn(result.artifacts[1], "path"), false);
});

test("providers fail closed on absent readers, rejection and malformed results", async () => {
  await assert.rejects(() => readRepositorySources(repositoryRequest), /repositoryReader\.readFile/);
  await assert.rejects(() => readApplicationArtifacts(artifactRequest), /artifactReader\.readArtifact/);
  const root = new Error("offline");
  await assert.rejects(() => readRepositorySources(repositoryRequest, { repositoryReader: { readFile: async () => { throw root; } } }),
    error => error.cause === root && /backend context resolution failed for a\.js/.test(error.message));
  await assert.rejects(() => readApplicationArtifacts(artifactRequest, { artifactReader: { readArtifact: async () => { throw root; } } }),
    error => error.cause === root && /qa context resolution failed for artifact:\/\/one/.test(error.message));
  await assert.rejects(() => readRepositorySources(repositoryRequest, { repositoryReader: { readFile: async () => ({ content: "ok" }) } }), /sourceRef/);
  await assert.rejects(() => readApplicationArtifacts(artifactRequest, { artifactReader: { readArtifact: async () => ({ sourceRef: "ref" }) } }), /content/);
});
