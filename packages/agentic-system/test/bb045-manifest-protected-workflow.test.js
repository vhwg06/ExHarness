
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ArtifactManifestErrorCode,
  BackendQaWorkflowStage,
  BackendRecoveryAction,
  BackendWorkStatus,
  BlackboardStatus,
  QaWorkStatus,
  createAcceptedBackendArtifactManifestPublisher,
  createApplicationOrchestrator,
  createDurableBackendQaWorkflow,
  createJsonArtifactManifestStore,
  createJsonBlackboardStore,
  createManifestArtifactReader,
  createSessionHandoffSurface,
  defineBackendCompletionPolicy,
  defineBackendObjective,
  defineQaCompletionPolicy,
  defineQaObjective
} from "../src/index.js";

const ITEM_ID = "BB-045-FIXTURE";
const backendPolicy = defineBackendCompletionPolicy({ requiredEvidenceClaims: [], requireArtifacts: true });
const qaPolicy = defineQaCompletionPolicy({ requiredEvidenceClaims: [] });

function reviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function backendObjective() {
  return defineBackendObjective({
    id: "bb045-backend",
    task: "Produce one accepted Backend revision.",
    repository: { ref: "repo://bb045", revision: "rev-1" },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: []
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "bb045-qa",
    task: "Verify exact accepted Backend bytes.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: ["Only manifest-bound accepted bytes reach QA."]
  });
}

function result() {
  return {
    status: BackendWorkStatus.APPLIED,
    summary: "Applied fixture Backend change.",
    revision: "rev-2",
    artifacts: [
      { ref: "workspace://rev-2/src/server.js", path: "src/server.js" },
      { ref: "workspace://rev-2/test/server.test.js", path: "test/server.test.js" }
    ],
    evidence: [],
    gaps: [],
    blockers: []
  };
}

function contents() {
  return new Map([
    ["workspace://rev-2/src/server.js", "export const healthy = true;\n"],
    ["workspace://rev-2/test/server.test.js", "assert.equal(healthy, true);\n"]
  ]);
}

function repoReader() {
  return {
    async readFile({ repositoryRef, revision, path }) {
      return {
        content: "// " + repositoryRef + "@" + revision + ":" + path + "\n",
        sourceRef: repositoryRef + "@" + revision + ":" + path
      };
    }
  };
}

function worker(control) {
  return {
    async execute() {
      control.execute += 1;
      return structuredClone(result());
    },
    async recover() {
      control.recover += 1;
      return {
        action: BackendRecoveryAction.COMPLETED,
        sessionId: "bb045-recovered",
        result: structuredClone(result()),
        blockers: [],
        effects: [],
        reconciliations: []
      };
    }
  };
}

function qa(control) {
  return {
    async execute(_order, context) {
      control.calls += 1;
      return {
        status: QaWorkStatus.VERIFIED,
        summary: "Verified manifest-bound bytes.",
        verifiedRevision: context.upstream.revision,
        inspectedArtifacts: context.artifacts.map(({ ref, path }) => ({ ref, path })),
        evidence: [],
        issues: [],
        blockers: []
      };
    }
  };
}

function directReader(map) {
  return {
    async readArtifact({ ref }) {
      const content = map.get(ref);
      if (content == null) throw new Error("missing artifact: " + ref);
      return { content, sourceRef: "producer-store:" + ref };
    }
  };
}

function producerReader(map) {
  return {
    async readProducedArtifact({ ref, revision }) {
      const content = map.get(ref);
      if (content == null) throw new Error("missing producer artifact: " + ref);
      return { content, storedRevision: revision };
    }
  };
}

function item() {
  return {
    id: ITEM_ID,
    work: "Manifest-protected Backend to QA fixture.",
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

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb045-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const manifestPath = join(directory, "manifests");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrust()
    });
    const orchestrator = makeOrchestrator();
    await createSessionHandoffSurface({ orchestrator }).initialize({
      userIntent: {
        id: "bb045-intent",
        objective: "Keep QA behind durable manifest state.",
        bullets: [],
        constraints: []
      },
      items: [item()]
    });
    await run({ manifestPath, orchestrator, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function manifestParts(manifestPath, map = contents()) {
  const manifestStore = createJsonArtifactManifestStore({ path: manifestPath });
  const publisher = createAcceptedBackendArtifactManifestPublisher({
    manifestStore,
    producerArtifactReader: producerReader(map),
    retentionPolicy: {
      policyRevision: "bb045-retention@1",
      pinnedBy: [ITEM_ID + ":QA_PENDING"]
    }
  });
  const reader = createManifestArtifactReader({
    reader: directReader(map),
    manifestStore
  });
  return { manifestStore, publisher, reader, map };
}

function makeWorkflow({ orchestrator, artifactReader, backendWorker, publisher = null, qaWorker = qa({ calls: 0 }) }) {
  return createDurableBackendQaWorkflow({
    orchestrator,
    repositoryReader: repoReader(),
    artifactReader,
    backendWorker,
    qaWorker,
    backendCompletionPolicy: backendPolicy,
    qaCompletionPolicy: qaPolicy,
    artifactManifestPublisher: publisher
  });
}

async function initialize(instance) {
  await instance.initialize({
    itemId: ITEM_ID,
    owner: "session-a",
    backendObjective: backendObjective(),
    qaObjective: qaObjective()
  });
}

test("BB-045 keeps direct-reader mode compatible", async () => {
  await withFixture(async ({ orchestrator }) => {
    const c = { execute: 0, recover: 0 };
    const instance = makeWorkflow({
      orchestrator,
      artifactReader: directReader(contents()),
      backendWorker: worker(c)
    });
    await initialize(instance);
    const backend = await instance.advance({ itemId: ITEM_ID, owner: "session-a" });
    assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(backend.artifactManifestRef, null);
    assert.equal("artifactManifestRef" in backend.item.checkpoint.acceptedBackend, false);
  });
});

test("BB-045 persists exact manifest ref before protected QA_PENDING", async () => {
  await withFixture(async ({ manifestPath, orchestrator }) => {
    const parts = manifestParts(manifestPath);
    const instance = makeWorkflow({
      orchestrator,
      artifactReader: parts.reader,
      backendWorker: worker({ execute: 0, recover: 0 }),
      publisher: parts.publisher
    });
    await initialize(instance);
    const backend = await instance.advance({ itemId: ITEM_ID, owner: "session-a" });
    assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.match(backend.artifactManifestRef, /^artifact-manifest:\/\/sha256:/);
    assert.equal(backend.item.checkpoint.acceptedBackend.artifactManifestRef, backend.artifactManifestRef);
    assert.ok(backend.item.artifactRefs.includes(backend.artifactManifestRef));
    const manifest = await parts.manifestStore.readManifest(backend.artifactManifestRef);
    assert.equal(manifest.producerRevision, "rev-2");
  });
});

test("BB-045 fresh protected QA uses manifest-aware reader and submits exact manifest ref", async () => {
  await withFixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const firstParts = manifestParts(manifestPath);
    const first = makeWorkflow({
      orchestrator,
      artifactReader: firstParts.reader,
      backendWorker: worker({ execute: 0, recover: 0 }),
      publisher: firstParts.publisher
    });
    await initialize(first);
    const backend = await first.advance({ itemId: ITEM_ID, owner: "session-a" });
    const manifestRef = backend.item.checkpoint.acceptedBackend.artifactManifestRef;

    const freshParts = manifestParts(manifestPath);
    const fresh = makeWorkflow({
      orchestrator: makeOrchestrator(),
      artifactReader: freshParts.reader,
      backendWorker: worker({ execute: 0, recover: 0 })
    });
    const completed = await fresh.advance({ itemId: ITEM_ID, owner: "session-b" });
    assert.equal(completed.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
    assert.equal(completed.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(completed.item.submission.artifactManifestRef, manifestRef);
    assert.ok(completed.item.submission.artifactRefs.includes(manifestRef));
  });
});

test("BB-045 protected checkpoint blocks if fresh workflow loses manifest-aware reader", async () => {
  await withFixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const parts = manifestParts(manifestPath);
    const first = makeWorkflow({
      orchestrator,
      artifactReader: parts.reader,
      backendWorker: worker({ execute: 0, recover: 0 }),
      publisher: parts.publisher
    });
    await initialize(first);
    await first.advance({ itemId: ITEM_ID, owner: "session-a" });

    const qaControl = { calls: 0 };
    const fresh = makeWorkflow({
      orchestrator: makeOrchestrator(),
      artifactReader: directReader(contents()),
      backendWorker: worker({ execute: 0, recover: 0 }),
      qaWorker: qa(qaControl)
    });
    const blocked = await fresh.advance({ itemId: ITEM_ID, owner: "session-b" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);
    assert.match(blocked.item.blockers[0], /manifest-protected QA checkpoint requires artifactReader\.forManifest/);
    assert.equal(qaControl.calls, 0);
  });
});

test("BB-045 publication failure blocks in recovery-required mode and resume does not execute Backend again", async () => {
  await withFixture(async ({ manifestPath, orchestrator }) => {
    const c = { execute: 0, recover: 0 };
    const parts = manifestParts(manifestPath);
    let fail = true;
    const publisher = {
      async publishAcceptedBackendManifest(input) {
        if (fail) throw new Error("manifest store unavailable");
        return parts.publisher.publishAcceptedBackendManifest(input);
      }
    };
    const instance = makeWorkflow({
      orchestrator,
      artifactReader: parts.reader,
      backendWorker: worker(c),
      publisher
    });
    await initialize(instance);
    const blocked = await instance.advance({ itemId: ITEM_ID, owner: "session-a" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(blocked.item.checkpoint.backendRecoveryRequired, true);
    assert.equal(c.execute, 1);
    assert.equal(c.recover, 0);

    fail = false;
    await instance.resume({ itemId: ITEM_ID });
    const resumed = await instance.advance({ itemId: ITEM_ID, owner: "session-b" });
    assert.equal(resumed.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.match(resumed.item.checkpoint.acceptedBackend.artifactManifestRef, /^artifact-manifest:\/\/sha256:/);
    assert.equal(c.execute, 1);
    assert.equal(c.recover, 1);
  });
});

test("BB-045 orphan manifest is idempotently recovered after Board checkpoint interruption", async () => {
  await withFixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const c = { execute: 0, recover: 0 };
    const parts = manifestParts(manifestPath);
    let publishedRef = null;
    const publishing = {
      async publishAcceptedBackendManifest(input) {
        const out = await parts.publisher.publishAcceptedBackendManifest(input);
        publishedRef = out.manifestRef;
        return out;
      }
    };
    let failCheckpoint = true;
    const faulting = Object.freeze({
      ...orchestrator,
      async checkpoint(input) {
        if (failCheckpoint && input && input.checkpoint && input.checkpoint.stage === BackendQaWorkflowStage.QA_PENDING) {
          failCheckpoint = false;
          throw new Error("simulated checkpoint interruption");
        }
        return orchestrator.checkpoint(input);
      }
    });
    const first = makeWorkflow({
      orchestrator: faulting,
      artifactReader: parts.reader,
      backendWorker: worker(c),
      publisher: publishing
    });
    await initialize(first);
    await assert.rejects(
      () => first.advance({ itemId: ITEM_ID, owner: "session-a" }),
      /simulated checkpoint interruption/
    );
    assert.match(publishedRef, /^artifact-manifest:\/\/sha256:/);
    const afterCrash = (await orchestrator.readBlackboard()).items.find((entry) => entry.id === ITEM_ID);
    assert.equal(afterCrash.status, BlackboardStatus.CLAIMED);
    assert.equal(afterCrash.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);

    const freshParts = manifestParts(manifestPath);
    const fresh = makeWorkflow({
      orchestrator: makeOrchestrator(),
      artifactReader: freshParts.reader,
      backendWorker: worker(c),
      publisher: freshParts.publisher
    });
    const recovered = await fresh.recoverInterrupted({ itemId: ITEM_ID, owner: "session-b" });
    assert.equal(recovered.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(recovered.artifactManifestReused, true);
    assert.equal(recovered.item.checkpoint.acceptedBackend.artifactManifestRef, publishedRef);
    const durableManifest = await freshParts.manifestStore.readManifest(publishedRef);
    assert.deepEqual(
      recovered.item.checkpoint.acceptedBackend.completionDecision,
      durableManifest.acceptanceDecision,
      "recovery must retain the durable manifest publication acceptance provenance"
    );
    assert.equal(c.execute, 1);
    assert.equal(c.recover, 1);
  });
});

test("BB-045 changed payload after QA_PENDING blocks QA without reopening Backend execution", async () => {
  await withFixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const c = { execute: 0, recover: 0 };
    const parts = manifestParts(manifestPath);
    const first = makeWorkflow({
      orchestrator,
      artifactReader: parts.reader,
      backendWorker: worker(c),
      publisher: parts.publisher
    });
    await initialize(first);
    const backend = await first.advance({ itemId: ITEM_ID, owner: "session-a" });
    assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);

    parts.map.set("workspace://rev-2/src/server.js", "export const healthy = false;\n");

    const freshParts = manifestParts(manifestPath, parts.map);
    const fresh = makeWorkflow({
      orchestrator: makeOrchestrator(),
      artifactReader: freshParts.reader,
      backendWorker: worker(c)
    });
    const blocked = await fresh.advance({ itemId: ITEM_ID, owner: "session-b" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.match(blocked.item.blockers[0], /artifact content identity mismatch/);
    assert.equal(c.execute, 1);
    assert.equal(c.recover, 0);
  });
});

test("BB-045 orphan recovery tolerates timestamp-only decision drift but rejects semantic acceptance drift", async () => {
  await withFixture(async ({ manifestPath }) => {
    const parts = manifestParts(manifestPath);
    const backendRun = (decision) => ({
      order: { id: "bb045-backend:backend" },
      result: result(),
      completion: {
        action: "ACCEPT",
        decision
      }
    });
    const decision = (overrides = {}) => ({
      id: overrides.id ?? "decision:first",
      digest: overrides.digest ?? "sha256:first",
      type: "DECISION",
      subject: { id: "subject:backend-rev-2", digest: "sha256:subject" },
      boundary: "ACCEPTANCE",
      policy: { id: "backend-policy", version: "1", digest: overrides.policyDigest ?? "sha256:policy-1" },
      evaluator: {
        identity: overrides.evaluatorIdentity ?? "backend-completion-policy",
        version: "1",
        roles: ["evaluator"]
      },
      evidenceManifest: [],
      claims: [],
      unresolved: [],
      verdict: "ACCEPT",
      generatedAt: overrides.generatedAt ?? "2026-09-18T00:00:00.000Z",
      metadata: { backendStatus: "APPLIED", reasons: ["ACCEPTED"] }
    });

    const first = await parts.publisher.publishAcceptedBackendManifest({
      itemId: ITEM_ID,
      backendRun: backendRun(decision())
    });

    const timestampOnly = await parts.publisher.publishAcceptedBackendManifest({
      itemId: ITEM_ID,
      backendRun: backendRun(decision({
        id: "decision:second",
        digest: "sha256:second",
        generatedAt: "2026-09-18T00:01:00.000Z"
      }))
    });
    assert.equal(timestampOnly.manifestRef, first.manifestRef);
    assert.equal(timestampOnly.reused, true);
    assert.deepEqual(timestampOnly.manifest.acceptanceDecision, first.manifest.acceptanceDecision);

    for (const drift of [
      { id: "decision:policy-drift", digest: "sha256:policy-drift", policyDigest: "sha256:policy-2" },
      { id: "decision:evaluator-drift", digest: "sha256:evaluator-drift", evaluatorIdentity: "different-evaluator" }
    ]) {
      await assert.rejects(
        () => parts.publisher.publishAcceptedBackendManifest({
          itemId: ITEM_ID,
          backendRun: backendRun(decision({
            ...drift,
            generatedAt: "2026-09-18T00:02:00.000Z"
          }))
        }),
        (error) => {
          assert.equal(error.code, ArtifactManifestErrorCode.MANIFEST_CONFLICT);
          return true;
        }
      );
    }
  });
});

test("BB-045 accepted publication is idempotent and conflicting producer bytes fail closed", async () => {
  await withFixture(async ({ manifestPath }) => {
    const map = contents();
    const parts = manifestParts(manifestPath, map);
    const backendRun = {
      order: { id: "bb045-backend:backend" },
      result: result(),
      completion: {
        action: "ACCEPT",
        decision: { id: "decision:bb045", digest: "sha256:bb045" }
      }
    };
    const first = await parts.publisher.publishAcceptedBackendManifest({ itemId: ITEM_ID, backendRun });
    const second = await parts.publisher.publishAcceptedBackendManifest({ itemId: ITEM_ID, backendRun });
    assert.equal(second.manifestRef, first.manifestRef);

    map.set("workspace://rev-2/src/server.js", "export const healthy = false;\n");
    await assert.rejects(
      () => parts.publisher.publishAcceptedBackendManifest({ itemId: ITEM_ID, backendRun }),
      (error) => {
        assert.equal(error.code, ArtifactManifestErrorCode.MANIFEST_CONFLICT);
        return true;
      }
    );
  });
});
