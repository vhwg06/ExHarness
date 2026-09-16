import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

class ArtifactIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArtifactIntegrityError";
    this.code = code;
  }
}

function key({ ref, path = null }) {
  return `${ref}::${path ?? ""}`;
}

function createFixtureReader(records) {
  return {
    async readArtifact(request) {
      const record = records.get(key(request));
      if (!record) {
        const error = new Error(`artifact content unavailable: ${request.ref}`);
        error.code = "ENOENT";
        throw error;
      }
      return structuredClone(record);
    }
  };
}

function createManifestReader({ reader, manifest }) {
  return {
    async readArtifact(request) {
      const entry = manifest.get(key(request));
      if (!entry) {
        throw new ArtifactIntegrityError(
          "ARTIFACT_MANIFEST_MISSING",
          `artifact manifest missing for ${request.ref}`
        );
      }
      if (entry.producerRevision !== request.revision) {
        throw new ArtifactIntegrityError(
          "ARTIFACT_PRODUCER_REVISION_MISMATCH",
          `artifact producer revision mismatch for ${request.ref}: expected ${request.revision}; manifest has ${entry.producerRevision}`
        );
      }

      let resolved;
      try {
        resolved = await reader.readArtifact(request);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new ArtifactIntegrityError(
            "ARTIFACT_UNAVAILABLE",
            `artifact content unavailable for retained ref ${request.ref}`
          );
        }
        throw error;
      }

      const actualDigest = digest(resolved.content);
      if (actualDigest !== entry.contentDigest) {
        throw new ArtifactIntegrityError(
          "ARTIFACT_CONTENT_MISMATCH",
          `artifact content identity mismatch for ${request.ref}`
        );
      }

      return {
        ...structuredClone(resolved),
        manifest: {
          contentDigest: entry.contentDigest,
          producerRevision: entry.producerRevision,
          producerWorkOrderId: entry.producerWorkOrderId,
          pinnedBy: [...entry.pinnedBy]
        }
      };
    }
  };
}

async function outcome(run) {
  try {
    const value = await run();
    return { status: "ACCEPTED", sourceRef: value.sourceRef ?? null, manifestVerified: value.manifest != null };
  } catch (error) {
    return { status: "REJECTED", code: error?.code ?? "GENERIC_ERROR", message: error?.message ?? String(error) };
  }
}

const refA = { ref: "artifact://backend/report", path: "report.json" };
const refB = { ref: "artifact://backend/summary", path: "summary.txt" };
const producerRevision = "backend-rev-7";
const requestBase = {
  ...refA,
  producerWorkOrderId: "backend-order-7",
  revision: producerRevision,
  acceptanceDecision: { id: "decision-7", digest: "sha256:decision-7" }
};

const originalA = "{\"result\":\"verified\"}\n";
const changedA = "{\"result\":\"silently-changed\"}\n";
const originalB = "summary: verified\n";

const manifest = new Map([
  [key(refA), {
    contentDigest: digest(originalA),
    producerRevision,
    producerWorkOrderId: "backend-order-7",
    pinnedBy: ["BB-100:PENDING_REVIEW"]
  }],
  [key(refB), {
    contentDigest: digest(originalB),
    producerRevision,
    producerWorkOrderId: "backend-order-7",
    pinnedBy: ["BB-100:PENDING_REVIEW"]
  }]
]);

async function compare(records, request, candidateManifest = manifest) {
  const baseline = createFixtureReader(records);
  const candidate = createManifestReader({ reader: baseline, manifest: candidateManifest });
  return {
    baseline: await outcome(() => baseline.readArtifact(request)),
    manifest: await outcome(() => candidate.readArtifact(request))
  };
}

const scenarios = {};

scenarios.unchanged = await compare(new Map([
  [key(refA), { content: originalA, sourceRef: "artifact-store:report@7" }]
]), requestBase);

scenarios.changedBehindStableRef = await compare(new Map([
  [key(refA), { content: changedA, sourceRef: "artifact-store:report@7" }]
]), requestBase);

scenarios.deletedContent = await compare(new Map(), requestBase);

scenarios.mismatchedProducerRevision = await compare(new Map([
  [key(refA), { content: originalA, sourceRef: "artifact-store:report@7" }]
]), {
  ...requestBase,
  revision: "backend-rev-8"
});

const partialManifest = new Map([[key(refA), manifest.get(key(refA))]]);
scenarios.partialManifest = await compare(new Map([
  [key(refB), { content: originalB, sourceRef: "artifact-store:summary@7" }]
]), {
  ...refB,
  producerWorkOrderId: "backend-order-7",
  revision: producerRevision,
  acceptanceDecision: { id: "decision-7", digest: "sha256:decision-7" }
}, partialManifest);

assert.equal(scenarios.unchanged.baseline.status, "ACCEPTED");
assert.equal(scenarios.unchanged.manifest.status, "ACCEPTED");
assert.equal(scenarios.unchanged.manifest.manifestVerified, true);
assert.equal(scenarios.changedBehindStableRef.baseline.status, "ACCEPTED");
assert.equal(scenarios.changedBehindStableRef.manifest.code, "ARTIFACT_CONTENT_MISMATCH");
assert.equal(scenarios.deletedContent.manifest.code, "ARTIFACT_UNAVAILABLE");
assert.equal(scenarios.mismatchedProducerRevision.baseline.status, "ACCEPTED");
assert.equal(scenarios.mismatchedProducerRevision.manifest.code, "ARTIFACT_PRODUCER_REVISION_MISMATCH");
assert.equal(scenarios.partialManifest.baseline.status, "ACCEPTED");
assert.equal(scenarios.partialManifest.manifest.code, "ARTIFACT_MANIFEST_MISSING");

const report = {
  evidenceClass: "DETERMINISTIC_SYNTHETIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  scenarios,
  metrics: {
    baseline: {
      acceptedUnchanged: 1,
      falseAcceptanceChangedContent: 1,
      falseAcceptanceWrongRevision: 1,
      acceptedWithoutManifest: 1,
      explicitIntegrityRejections: 0
    },
    manifest: {
      verifiedUnchanged: 1,
      changedContentRejected: 1,
      wrongRevisionRejected: 1,
      unavailableContentDiagnosed: 1,
      missingManifestRejected: 1,
      falseAcceptanceCount: 0
    }
  },
  retentionExample: {
    ref: refA.ref,
    pinnedBy: ["BB-100:PENDING_REVIEW"],
    meaning: "retention obligation only; not correctness or availability proof"
  }
};

console.log(JSON.stringify(report, null, 2));
