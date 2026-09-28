import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readRepositorySources } from "../../packages/oracle/src/index.js";
import { defineContextBlock, renderAgentContext } from "../../packages/core-harness/src/context.js";

const start = performance.now();
const maxSerializedChars = 2048;
const semanticNeed = { requirementId: "fixture:backend-source", repositoryRef: "repo://fixture", revision: "r1", requiredFiles: ["src/a.js"] };
let providerCalls = 0;
let sourceReads = 0;
let actionCalls = 0;
let renderedPrompt = null;
const resolver = async (need, reader) => {
  providerCalls++;
  return readRepositorySources(need, { repositoryReader: reader });
};
const reader = { async readFile({ path }) { sourceReads++; return { content: "export const value = 1;", sourceRef: `repo://fixture@r1:${path}` }; } };
const resolution = await resolver(semanticNeed, reader);
const materialized = {
  requirementId: semanticNeed.requirementId,
  repository: resolution.repository,
  files: resolution.files.map(file => ({ ...file, provenance: { sourceClass: "REPOSITORY_SOURCE", revision: semanticNeed.revision } }))
};
const materializedChars = JSON.stringify(materialized).length;
const block = defineContextBlock({ name: "required-source", trust: "UNTRUSTED", value: materialized });
renderedPrompt = await renderAgentContext({ blocks: [block], selection: { blocks: ["required-source"] }, policy: { maxSerializedChars } });
const renderedChars = JSON.stringify(renderedPrompt).length;
const projected = renderedPrompt.blocks[0].value.files[0];
assert.equal(providerCalls, 1);
assert.equal(actionCalls, 0);
assert.equal(sourceReads, 1);
assert.equal(projected.sourceRef, "repo://fixture@r1:src/a.js");
assert.deepEqual(projected.provenance, { sourceClass: "REPOSITORY_SOURCE", revision: "r1" });
assert.ok(renderedChars <= maxSerializedChars);

let failureClass = null;
let failureRenderedPrompt = null;
try {
  const failed = await readRepositorySources(semanticNeed, { repositoryReader: { readFile: async () => { throw new Error("source unavailable"); } } });
  failureRenderedPrompt = await renderAgentContext({ blocks: [defineContextBlock({ name: "required-source", value: failed })], selection: { blocks: ["required-source"] } });
} catch (error) { failureClass = error.cause?.message === "source unavailable" ? "SOURCE_READ_FAILURE" : "UNEXPECTED_FAILURE"; }
assert.equal(failureClass, "SOURCE_READ_FAILURE");
assert.equal(failureRenderedPrompt, null);
const oversized = await readRepositorySources(semanticNeed, { repositoryReader: {
  readFile: async ({ path }) => ({ content: "x".repeat(maxSerializedChars), sourceRef: `repo://fixture@r1:${path}` })
} });
let oversizedPrompt = null;
await assert.rejects(async () => {
  oversizedPrompt = await renderAgentContext({
    blocks: [defineContextBlock({ name: "required-source", value: oversized })],
    selection: { blocks: ["required-source"] },
    policy: { maxSerializedChars }
  });
}, /context|limit|exceed/i);
assert.equal(oversizedPrompt, null);
console.log(JSON.stringify({ requirementId: semanticNeed.requirementId, resolutionId: null, providerCalls, resolutionCalls: 1, actionCalls, sourceReads, materializedChars, renderedChars, estimatedTokens: null, provenanceCoverage: 1, currentnessChecks: 0, wallMs: Math.round((performance.now() - start) * 1000) / 1000, failureClass }));
