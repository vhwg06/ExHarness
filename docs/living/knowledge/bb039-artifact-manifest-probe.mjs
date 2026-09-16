import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeQaWorkOrder } from "../../../packages/agentic-system/src/qa-contracts.js";
import { resolveQaContext } from "../../../packages/agentic-system/src/oracle.js";

// Predeclared fixture gate: valid artifacts pass both modes; changed content and
// wrong producer revision pass the baseline but fail the manifest adapter;
// missing artifacts fail both modes; missing manifest fails closed before QA.
const handoff = {
  producerWorkOrderId: "backend:fixture-1",
  revision: "rev-2",
  acceptanceDecision: { id: "decision:accepted-1", digest: "sha256:accepted-1" },
  artifacts: [
    { ref: "artifact://rev-2/server", path: "src/server.js" },
    { ref: "artifact://rev-2/tests", path: "test/server.test.js" }
  ]
};
const objective = {
  id: "qa:fixture-1",
  task: "Inspect the accepted Backend revision",
  requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
  acceptanceCriteria: ["The inspected content belongs to the accepted revision"]
};
const order = makeQaWorkOrder(objective, handoff);
const original = new Map([
  [handoff.artifacts[0].ref, { content: "export const healthy = true;\n", revision: "rev-2" }],
  [handoff.artifacts[1].ref, { content: "assert.equal(healthy, true);\n", revision: "rev-2" }]
]);

function digest(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

// The producer-side manifest is captured while the accepted artifact bytes are
// available. It contains identity metadata only, never artifact payloads.
const manifest = JSON.parse(JSON.stringify({
  version: 1,
  producerWorkOrderId: handoff.producerWorkOrderId,
  revision: handoff.revision,
  acceptanceDecision: handoff.acceptanceDecision,
  entries: handoff.artifacts.map(({ ref, path }) => ({
    ref,
    path,
    revision: original.get(ref).revision,
    contentDigest: digest(original.get(ref).content)
  }))
}));
assert.equal(JSON.stringify(manifest).includes("export const"), false);

function artifactReader(records, { verifyManifest, activeManifest }) {
  return {
    async readArtifact(request) {
      const stored = records.get(request.ref);
      if (!stored) throw new Error(`MISSING_ARTIFACT: ${request.ref}`);
      if (verifyManifest) {
        if (!activeManifest) throw new Error(`MANIFEST_UNAVAILABLE: ${request.ref}`);
        const entry = activeManifest.entries.find((candidate) => candidate.ref === request.ref && candidate.path === request.path);
        if (!entry ||
            activeManifest.producerWorkOrderId !== request.producerWorkOrderId ||
            activeManifest.revision !== request.revision ||
            activeManifest.acceptanceDecision.id !== request.acceptanceDecision.id ||
            activeManifest.acceptanceDecision.digest !== request.acceptanceDecision.digest ||
            entry.revision !== request.revision || stored.revision !== request.revision) {
          throw new Error(`REVISION_OR_PROVENANCE_MISMATCH: ${request.ref}`);
        }
        if (digest(stored.content) !== entry.contentDigest) {
          throw new Error(`CONTENT_MISMATCH: ${request.ref}`);
        }
      }
      return { content: stored.content, sourceRef: `application-artifact:${request.ref}` };
    }
  };
}

const cases = [
  { id: "unchanged", mutate() {}, baseline: "PASS", manifest: "PASS" },
  {
    id: "changed-content",
    mutate(records) { records.get(handoff.artifacts[0].ref).content = "export const healthy = false;\n"; },
    baseline: "PASS", manifest: "CONTENT_MISMATCH"
  },
  {
    id: "missing-content",
    mutate(records) { records.delete(handoff.artifacts[0].ref); },
    baseline: "MISSING_ARTIFACT", manifest: "MISSING_ARTIFACT"
  },
  {
    id: "wrong-producer-revision",
    mutate(records) { records.get(handoff.artifacts[0].ref).revision = "rev-1"; },
    baseline: "PASS", manifest: "REVISION_OR_PROVENANCE_MISMATCH"
  },
  {
    id: "partial-artifact-set",
    mutate(records) { records.delete(handoff.artifacts[1].ref); },
    baseline: "MISSING_ARTIFACT", manifest: "MISSING_ARTIFACT"
  },
  {
    id: "manifest-unavailable",
    mutate() {},
    candidateManifest: null,
    baseline: "PASS", manifest: "MANIFEST_UNAVAILABLE"
  }
];

async function outcome(records, verifyManifest, activeManifest = manifest) {
  try {
    const context = await resolveQaContext(order, { artifactReader: artifactReader(records, { verifyManifest, activeManifest }) });
    assert.equal(context.artifacts.length, 2);
    return "PASS";
  } catch (error) {
    for (const code of ["MISSING_ARTIFACT", "MANIFEST_UNAVAILABLE", "CONTENT_MISMATCH", "REVISION_OR_PROVENANCE_MISMATCH"]) {
      if (error.message.includes(code)) return code;
    }
    throw error;
  }
}

for (const scenario of cases) {
  const records = new Map([...original].map(([ref, record]) => [ref, { ...record }]));
  scenario.mutate(records);
  const baseline = await outcome(records, false);
  const candidate = await outcome(records, true, scenario.candidateManifest);
  assert.equal(baseline, scenario.baseline, `${scenario.id}: baseline`);
  assert.equal(candidate, scenario.manifest, `${scenario.id}: manifest`);
  process.stdout.write(`${scenario.id}: baseline=${baseline}, manifest=${candidate}\n`);
}

process.stdout.write(`manifestBytes=${Buffer.byteLength(JSON.stringify(manifest))}, refOnlyBytes=${Buffer.byteLength(JSON.stringify(handoff.artifacts))}\n`);
