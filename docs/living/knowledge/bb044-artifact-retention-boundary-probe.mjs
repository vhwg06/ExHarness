import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ArtifactAvailability,
  ArtifactManifestErrorCode,
  createJsonArtifactManifestStore,
  createManifestArtifactReader,
  defineApplicationArtifactManifest
} from "../../../packages/agentic-system/src/index.js";
import { BlackboardStatus } from "../../../packages/agentic-system/src/blackboard-orchestrator.js";

const REF = "artifact://bb044/report";
const PATH = "report.json";
const CONTENT = "{\"ok\":true}\n";
const DIGEST = "sha256:e5f1eb4d806641698a35efe20e098efd20d7d57a9b90ee69079d5bb650920726";

function manifest(availability) {
  return defineApplicationArtifactManifest({
    kind: "APPLICATION_ARTIFACT_MANIFEST",
    version: 1,
    producerWorkOrderId: "backend:bb044",
    producerRevision: "rev-7",
    acceptanceDecision: {
      id: "decision:bb044",
      digest: "sha256:decision-bb044"
    },
    retention: {
      policyRevision: "retention@1",
      pinnedBy: ["BB-200:PENDING_REVIEW"]
    },
    entries: [{
      ref: REF,
      path: PATH,
      storedRevision: "rev-7",
      contentDigest: DIGEST,
      availability
    }]
  });
}

function request() {
  return {
    ref: REF,
    path: PATH,
    producerWorkOrderId: "backend:bb044",
    revision: "rev-7",
    acceptanceDecision: {
      id: "decision:bb044",
      digest: "sha256:decision-bb044"
    }
  };
}

function activePins(snapshot, ref) {
  const active = new Set([
    BlackboardStatus.READY,
    BlackboardStatus.REOPENED,
    BlackboardStatus.CLAIMED,
    BlackboardStatus.PENDING_REVIEW,
    BlackboardStatus.REVIEWING,
    BlackboardStatus.PENDING_RECONCILIATION,
    BlackboardStatus.BLOCKED
  ]);
  return snapshot.items
    .filter((item) => active.has(item.status) && item.artifactRefs.includes(ref))
    .map((item) => `${item.id}:${item.status}`);
}

async function sourceFiles(directory) {
  const found = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) found.push(target);
    }
  }
  await visit(directory);
  return found;
}

async function concreteRetentionMethods() {
  const root = new URL("../../../packages/agentic-system/src/", import.meta.url);
  const files = await sourceFiles(root);
  const matches = [];
  const pattern = /\b(?:pinArtifact|unpinArtifact|releaseArtifact|deleteArtifact)\s*\(/g;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (pattern.test(text)) matches.push(file.toString());
    pattern.lastIndex = 0;
  }
  return matches;
}

async function manifestLifecycleConflict() {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb044-manifest-"));
  try {
    const store = createJsonArtifactManifestStore({ path: directory });
    await store.putManifest(manifest(ArtifactAvailability.AVAILABLE));
    await store.putManifest(manifest(ArtifactAvailability.UNAVAILABLE));

    const reader = createManifestArtifactReader({
      manifestStore: store,
      reader: {
        async readArtifact() {
          return { content: CONTENT, sourceRef: "fixture:bb044" };
        }
      }
    });

    try {
      await reader.readArtifact(request());
      return "UNEXPECTED_PASS";
    } catch (error) {
      assert.equal(error.code, ArtifactManifestErrorCode.MANIFEST_CONFLICT);
      return error.code;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function missingPayloadWithoutManifestMutation() {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb044-missing-"));
  try {
    const store = createJsonArtifactManifestStore({ path: directory });
    await store.putManifest(manifest(ArtifactAvailability.AVAILABLE));

    const reader = createManifestArtifactReader({
      manifestStore: store,
      reader: {
        async readArtifact() {
          const error = new Error("payload deleted after retention release");
          error.code = "ENOENT";
          throw error;
        }
      }
    });

    try {
      await reader.readArtifact(request());
      return "UNEXPECTED_PASS";
    } catch (error) {
      assert.equal(error.code, ArtifactManifestErrorCode.UNAVAILABLE);
      assert.equal(error.cause?.code, "ENOENT");
      return error.code;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const staleBoard = {
  version: 1,
  items: [{
    id: "BB-200",
    status: BlackboardStatus.DONE,
    artifactRefs: [REF]
  }]
};
const currentBoard = {
  version: 1,
  items: [{
    id: "BB-200",
    status: BlackboardStatus.REOPENED,
    artifactRefs: [REF]
  }]
};

const stalePins = activePins(staleBoard, REF);
const currentPins = activePins(currentBoard, REF);
assert.deepEqual(stalePins, []);
assert.deepEqual(currentPins, ["BB-200:REOPENED"]);

// A CAS on a separate retention store can fence retention writers against each
// other, but it cannot by itself prove that the Blackboard snapshot used to
// decide release is still current. This interleaving is the missing authority
// boundary, not a persistence-algorithm problem.
const retentionRevisionObserved = 4;
const retentionRevisionAtCommit = 4;
const genericSidecarCasWouldAccept = retentionRevisionObserved === retentionRevisionAtCommit;
assert.equal(genericSidecarCasWouldAccept, true);
assert.notDeepEqual(stalePins, currentPins);

const retentionMethods = await concreteRetentionMethods();
assert.deepEqual(retentionMethods, []);

const result = {
  evidenceClass: "DETERMINISTIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  currentBehavior: {
    immutableAvailabilityMutation: await manifestLifecycleConflict(),
    missingPayloadWithoutManifestMutation: await missingPayloadWithoutManifestMutation()
  },
  boardRace: {
    staleSnapshotPins: stalePins,
    currentSnapshotPins: currentPins,
    genericSidecarCasWouldAccept,
    genericSidecarAloneFencesBoardRace: false
  },
  repositoryPressure: {
    concretePayloadRetentionMethods: retentionMethods,
    concretePayloadRetentionStorePresent: false
  },
  conclusion: "DEFER_RUNTIME_RETENTION_AUTOMATION",
  minimumReentry: [
    "one concrete artifact payload store with explicit pin/release or delete authority",
    "a lifecycle-to-storage coordination contract that fences release against current Blackboard state",
    "failure/recovery semantics for payload release that do not turn storage metadata into correctness authority"
  ]
};

const expected = {
  evidenceClass: "DETERMINISTIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  currentBehavior: {
    immutableAvailabilityMutation: "ARTIFACT_MANIFEST_CONFLICT",
    missingPayloadWithoutManifestMutation: "ARTIFACT_UNAVAILABLE"
  },
  boardRace: {
    staleSnapshotPins: [],
    currentSnapshotPins: ["BB-200:REOPENED"],
    genericSidecarCasWouldAccept: true,
    genericSidecarAloneFencesBoardRace: false
  },
  repositoryPressure: {
    concretePayloadRetentionMethods: [],
    concretePayloadRetentionStorePresent: false
  },
  conclusion: "DEFER_RUNTIME_RETENTION_AUTOMATION",
  minimumReentry: [
    "one concrete artifact payload store with explicit pin/release or delete authority",
    "a lifecycle-to-storage coordination contract that fences release against current Blackboard state",
    "failure/recovery semantics for payload release that do not turn storage metadata into correctness authority"
  ]
};

assert.deepEqual(result, expected);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
