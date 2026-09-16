import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BlackboardStatus,
  UserIntentSource,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createSessionHandoffSurface
} from "../../../packages/agentic-system/src/index.js";
import { makeQaWorkOrder } from "../../../packages/agentic-system/src/qa-contracts.js";
import { resolveQaContext } from "../../../packages/agentic-system/src/oracle.js";

const PROJECT_ID = "bb039-project";
const ITEM_ID = "bb039-qa-continuation";

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
const originalRecords = {
  [handoff.artifacts[0].ref]: { content: "export const healthy = true;\n", revision: "rev-2" },
  [handoff.artifacts[1].ref]: { content: "assert.equal(healthy, true);\n", revision: "rev-2" }
};

function digest(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

const manifest = {
  version: 1,
  producerWorkOrderId: handoff.producerWorkOrderId,
  revision: handoff.revision,
  acceptanceDecision: handoff.acceptanceDecision,
  entries: handoff.artifacts.map(({ ref, path }) => ({
    ref,
    path,
    revision: originalRecords[ref].revision,
    contentDigest: digest(originalRecords[ref].content)
  }))
};
assert.equal(JSON.stringify(manifest).includes("export const"), false);

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

const userIntent = Object.freeze({
  id: "bb039-restart-probe",
  source: UserIntentSource.USER,
  objective: "Continue QA from durable Backend artifact refs after a fresh session.",
  bullets: ["Use durable refs and producer provenance."],
  constraints: ["Artifact identity is not correctness authority."]
});

function workItem() {
  return {
    id: ITEM_ID,
    work: "Continue QA from the accepted Backend handoff.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function makeOrchestrator(boardPath) {
  return createApplicationOrchestrator({
    store: createJsonBlackboardStore({ path: boardPath }),
    reviewTrust: reviewTrustStub()
  });
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function durableArtifactReader({ recordsPath, manifestPath, verifyManifest }) {
  return {
    async readArtifact(request) {
      const records = JSON.parse(await readFile(recordsPath, "utf8"));
      const stored = records[request.ref];
      if (!stored) throw new Error(`MISSING_ARTIFACT: ${request.ref}`);

      if (verifyManifest) {
        const activeManifest = await readManifest(manifestPath);
        if (!activeManifest) throw new Error(`MANIFEST_UNAVAILABLE: ${request.ref}`);
        const entry = activeManifest.entries.find(
          (candidate) => candidate.ref === request.ref && candidate.path === request.path
        );
        if (!entry ||
            activeManifest.producerWorkOrderId !== request.producerWorkOrderId ||
            activeManifest.revision !== request.revision ||
            activeManifest.acceptanceDecision.id !== request.acceptanceDecision.id ||
            activeManifest.acceptanceDecision.digest !== request.acceptanceDecision.digest ||
            entry.revision !== request.revision ||
            stored.revision !== request.revision) {
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

async function outcome(order, reader) {
  try {
    const context = await resolveQaContext(order, { artifactReader: reader });
    assert.equal(context.artifacts.length, 2);
    return "PASS";
  } catch (error) {
    for (const code of [
      "MISSING_ARTIFACT",
      "MANIFEST_UNAVAILABLE",
      "CONTENT_MISMATCH",
      "REVISION_OR_PROVENANCE_MISMATCH"
    ]) {
      if (error.message.includes(code)) return code;
    }
    throw error;
  }
}

const cases = [
  { id: "unchanged", baseline: "PASS", manifest: "PASS" },
  {
    id: "changed-content",
    mutateRecords(records) { records[handoff.artifacts[0].ref].content = "export const healthy = false;\n"; },
    baseline: "PASS",
    manifest: "CONTENT_MISMATCH"
  },
  {
    id: "missing-content",
    mutateRecords(records) { delete records[handoff.artifacts[0].ref]; },
    baseline: "MISSING_ARTIFACT",
    manifest: "MISSING_ARTIFACT"
  },
  {
    id: "wrong-producer-revision",
    mutateRecords(records) { records[handoff.artifacts[0].ref].revision = "rev-1"; },
    baseline: "PASS",
    manifest: "REVISION_OR_PROVENANCE_MISMATCH"
  },
  {
    id: "partial-artifact-set",
    mutateRecords(records) { delete records[handoff.artifacts[1].ref]; },
    baseline: "MISSING_ARTIFACT",
    manifest: "MISSING_ARTIFACT"
  },
  {
    id: "manifest-unavailable",
    persistManifest: false,
    baseline: "PASS",
    manifest: "MANIFEST_UNAVAILABLE"
  },
  {
    id: "wrong-producer-work-order",
    mutateHandoff(value) { value.producerWorkOrderId = "backend:other-work-order"; },
    baseline: "PASS",
    manifest: "REVISION_OR_PROVENANCE_MISMATCH"
  },
  {
    id: "wrong-acceptance-decision-id",
    mutateHandoff(value) { value.acceptanceDecision.id = "decision:other"; },
    baseline: "PASS",
    manifest: "REVISION_OR_PROVENANCE_MISMATCH"
  },
  {
    id: "wrong-acceptance-decision-digest",
    mutateHandoff(value) { value.acceptanceDecision.digest = "sha256:other"; },
    baseline: "PASS",
    manifest: "REVISION_OR_PROVENANCE_MISMATCH"
  }
];

async function runCase(scenario) {
  const directory = await mkdtemp(join(tmpdir(), `exharness-bb039-${scenario.id}-`));
  try {
    const boardPath = join(directory, "blackboard.json");
    const storeDirectory = join(directory, "artifact-store");
    const recordsPath = join(storeDirectory, "records.json");
    const manifestPath = join(storeDirectory, "manifest.json");
    await mkdir(storeDirectory, { recursive: true });

    const records = structuredClone(originalRecords);
    scenario.mutateRecords?.(records);
    await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    if (scenario.persistManifest !== false) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    const persistedHandoff = structuredClone(handoff);
    scenario.mutateHandoff?.(persistedHandoff);

    const producerOrchestrator = makeOrchestrator(boardPath);
    const producerSurface = createSessionHandoffSurface({
      orchestrator: producerOrchestrator,
      projectId: PROJECT_ID
    });
    await producerSurface.initialize({ userIntent, items: [workItem()] });
    const claim = await producerOrchestrator.claim({ itemId: ITEM_ID, owner: "backend-session" });
    await producerOrchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "backend-session",
      generation: claim.result.claimGeneration,
      checkpoint: {
        kind: "BB039_QA_PENDING_FIXTURE",
        stage: "QA_PENDING",
        acceptedBackend: {
          handoff: persistedHandoff,
          completionDecision: structuredClone(persistedHandoff.acceptanceDecision)
        }
      },
      artifactRefs: persistedHandoff.artifacts.map((artifact) => artifact.ref),
      evidenceRefs: [persistedHandoff.acceptanceDecision.id],
      remainingWork: ["Run QA from durable handoff"]
    });

    // Fresh session: reconstruct only from the persisted Blackboard plus the
    // filesystem-backed content/manifest stores. No in-memory producer map or
    // producer-side Orchestrator object is reused below this point.
    const freshOrchestrator = makeOrchestrator(boardPath);
    const freshSurface = createSessionHandoffSurface({
      orchestrator: freshOrchestrator,
      projectId: PROJECT_ID
    });
    const session = await freshSurface.read();
    const target = session.workGraph.find((item) => item.id === ITEM_ID);
    assert.ok(target?.checkpoint?.acceptedBackend?.handoff, `${scenario.id}: fresh handoff missing`);
    const freshHandoff = target.checkpoint.acceptedBackend.handoff;
    for (const artifact of freshHandoff.artifacts) {
      assert.ok(
        session.references.artifacts.some((entry) => entry.itemId === ITEM_ID && entry.ref === artifact.ref),
        `${scenario.id}: artifact ref not durable across session`
      );
    }

    const freshOrder = makeQaWorkOrder(objective, freshHandoff);
    const baseline = await outcome(freshOrder, durableArtifactReader({
      recordsPath,
      manifestPath,
      verifyManifest: false
    }));
    const candidate = await outcome(freshOrder, durableArtifactReader({
      recordsPath,
      manifestPath,
      verifyManifest: true
    }));

    assert.equal(baseline, scenario.baseline, `${scenario.id}: baseline`);
    assert.equal(candidate, scenario.manifest, `${scenario.id}: manifest`);
    return { id: scenario.id, baseline, manifest: candidate, freshSession: true };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const results = [];
for (const scenario of cases) results.push(await runCase(scenario));

const identityViolations = results.filter(
  (result) => result.baseline === "PASS" &&
    ["CONTENT_MISMATCH", "REVISION_OR_PROVENANCE_MISMATCH"].includes(result.manifest)
);
assert.equal(identityViolations.length, 5);
assert.equal(results.every((result) => result.freshSession), true);

for (const result of results) {
  process.stdout.write(`${result.id}: baseline=${result.baseline}, manifest=${result.manifest}, freshSession=true\n`);
}
process.stdout.write(`${JSON.stringify({
  evidenceClass: "DETERMINISTIC_FRESH_SESSION_FIXTURE",
  productionEvidence: false,
  freshSessions: results.length,
  baselineUndetectedIdentityViolations: identityViolations.length,
  manifestUndetectedIdentityViolations: 0,
  manifestBytes: Buffer.byteLength(JSON.stringify(manifest)),
  refOnlyBytes: Buffer.byteLength(JSON.stringify(handoff.artifacts))
})}\n`);
