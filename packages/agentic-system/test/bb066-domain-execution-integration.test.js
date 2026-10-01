// BB-066 controller integration: coding-agent-sdk strategy kind through
// the production DomainExecutionController (file-backed stores in a temp dir).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDomainExecutionController,
  defineOrganizationWorkContract,
  createJsonImmutableArtifactStore,
  createOrganizationArtifactRegistry,
  createDomainExecutionArtifactRegistry,
  createJsonClaimReleaseStore,
  createJsonExecutionAttemptStore,
  defineExecutionStrategyDescriptor,
  createDomainExecutionPolicyPublisher,
  executionPolicySubjectKey,
  claimReleaseSubjectKey,
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../src/domain-execution-store.js";

const SHA = "0".repeat(64);
const FAKE_ADAPTER_IDENTITY = {
  adapterRef: "runtime-adapter:opencode-v1",
  runtimeKind: "coding-agent-sdk",
  runtimeDeploymentRef: "opencode-cli:1.18.34",
  producerAuthorityRef: "authority:test-runtime",
};

function serialGuard() {
  let tail = Promise.resolve();
  return async (action) => {
    const prev = tail;
    let release;
    tail = new Promise((r) => { release = r; });
    await prev;
    try { return await action(); } finally { release(); }
  };
}

async function harness({ adapter }) {
  const dir = mkdtempSync(join(tmpdir(), "bb066-integration-"));
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const org = createOrganizationArtifactRegistry({ store: immutable });
  const domain = createDomainExecutionArtifactRegistry({ store: immutable });
  const releaseStore = createJsonClaimReleaseStore({ path: join(dir, "release-heads.json") });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  const attemptStore = createJsonExecutionAttemptStore({ path: join(dir, "attempt-heads.json") });

  const contract = defineOrganizationWorkContract({
    projectId: "p", rootItemId: "r", rootIntentId: "i",
    acceptedDecisionRef: "decision:a", materializationAuthorizationId: "m",
    materializationAuthorizationRef: "materialization-authorization:sha256:" + SHA,
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mrev",
    authorityPolicyRevision: "arev", implementationArtifactRef: "implementation-input:x",
    sliceId: "s", obligationKey: "o", obligationSubjectKey: "os",
    materializationKey: "mk", boardItemId: "I-1", owningDomain: "DELIVERY",
    workloadType: "delivery-fixture-change", summary: "s", dependencyIds: [],
    requiredArtifactRefs: ["user-intent:sha256:" + SHA], expectedArtifactKind: "FIXTURE",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:x"],
  });
  const contractRef = await org.putWorkContract(contract);

  const claimController = {
    async assertExecutable() { return true; },
    async withExecutablePublicationGuard(_a, action) { return { observation: {}, result: await action({}) }; },
  };
  const strategy = defineExecutionStrategyDescriptor({
    strategyId: "opencode-local-v1", strategyVersion: "1.18.34",
    strategyKind: "coding-agent-sdk", compatibleWorkloadTypes: [contract.workloadType],
    compatibleWorkContractVersions: [1], adapterRef: "runtime-adapter:opencode-v1",
    runtimeBindingMode: "EXACT_PERSISTED_SESSION", expectedRuntimeCodeRef: "opencode-cli:1.18.34",
    contextRefs: [], toolsetRef: "toolset:opencode-default-v1",
    modelProfileRef: "model-profile:opencode-free-v1", harnessRef: "harness:test-v1",
  });
  const strategyRef = await domain.putExecutionStrategyDescriptor(strategy);
  const publisher = createDomainExecutionPolicyPublisher({
    policyAuthority: { async verifyExecutionPolicyPublisher() { return { authorityRef: "authority:policy" }; } },
    artifactRegistry: domain, executionPolicyStore: policyStore,
  });
  const policyKey = executionPolicySubjectKey(contract.owningDomain, contract.workloadType);
  await publisher.publish({
    publisher: { identity: "admin" },
    policy: { policyId: policyKey, generation: 1, status: "ACTIVE", domain: contract.owningDomain, workloadType: contract.workloadType, compatibleWorkContractVersions: [1], strategyRef },
  });

  const completionEvaluator = {
    authorityRef: "authority:completion",
    async evaluate() {
      return { verdict: "INCONCLUSIVE", criterionResults: [{ criterionId: "c", verdict: "INCONCLUSIVE", evidenceRefs: [] }], counterevidenceRefs: [] };
    },
  };
  const guard = serialGuard();
  const publicationGate = {
    authorityRef: "authority:writer", producerPrincipalRef: "principal:x",
    async withCurrentWriteAuthority(_a, action) { return guard(() => action({ authorityRef: "authority:writer", revision: "rev-1" })); },
    async publishIdempotent(a) {
      return { publicationKey: a.publicationKey, publishedArtifactRefs: [], acceptedDerivationEdges: [], publishedClaimRefs: [], publicationStoreRevision: "rev-1" };
    },
  };
  const controller = createDomainExecutionController({
    claimController, claimReleaseStore: releaseStore, organizationArtifactRegistry: org,
    artifactRegistry: domain, executionPolicyStore: policyStore, executionAttemptStore: attemptStore,
    runtimeAdapter: adapter, completionEvaluator, publicationGate,
  });
  const receiptRef = await org.putClaimReleaseReceipt({
    kind: "CLAIM_RELEASE_RECEIPT", version: 1, projectId: contract.projectId,
    rootItemId: contract.rootItemId, rootIntentId: contract.rootIntentId,
    itemId: contract.boardItemId, claimGeneration: 1, workContractRef: contractRef,
    boardOwner: "test", principalRef: "principal:x",
  });
  const releaseKey = claimReleaseSubjectKey(contract.projectId, contract.boardItemId, 1);
  await releaseStore.compareAndSwap(releaseKey, null, { status: "RELEASED", receiptRef });
  return { controller, itemId: contract.boardItemId, receiptRef, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const INPUT = {
  workspaceDescriptorRef: "workspace:test-v1", taskId: "TEST-01",
  promptRef: "prompt:test-v1", promptText: "Do the test thing.",
  outputRoot: "/tmp/bb066-integration", timeoutMs: 30000,
};

test("strategy kind coding-agent-sdk is accepted by the controller", async (t) => {
  let seen = null;
  const adapter = {
    ...FAKE_ADAPTER_IDENTITY,
    async dispatch({ binding, input, runtimeInvocationKey, signal }) {
      seen = { binding, input, runtimeInvocationKey, signal };
      const outRef = "opencode-candidate-source:sha256:" + "4".repeat(64);
      return {
        status: "SUCCEEDED", sessionId: "ses_x",
        runtimeInvocationId: "opencode-invocation:sha256:" + "1".repeat(64),
        startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:00:01.000Z",
        outputArtifactRefs: [{ ref: outRef, digest: "4".repeat(64) }],
        effectRefs: [], traceRefs: [],
        verificationCandidateRefs: ["opencode-process:sha256:" + "6".repeat(64)],
        counterevidenceRefs: [],
        proposedDerivationEdges: [],
      };
    },
    async recover() { throw new Error("unexpected recover"); },
  };
  const { controller, itemId, receiptRef, cleanup } = await harness({ adapter });
  t.after(cleanup);
  const out = await controller.execute({ itemId, claimGeneration: 1, receiptRef, input: INPUT });
  assert.equal(out.state, "TERMINAL");
  assert.ok(seen);
  // The adapter input carries the strategy binding; kind is coding-agent-sdk.
  assert.equal(seen.binding.runtimeBinding.kind, "coding-agent-sdk");
});

test("execute forwards an AbortSignal to the adapter out-of-band", async (t) => {
  let seenInput = null, seenSignal = null;
  const adapter = {
    ...FAKE_ADAPTER_IDENTITY,
    async dispatch({ binding, input, runtimeInvocationKey, signal }) {
      seenInput = input; seenSignal = signal;
      throw new Error("stop here");
    },
    async recover() { throw new Error("unexpected"); },
  };
  const { controller, itemId, receiptRef, cleanup } = await harness({ adapter });
  t.after(cleanup);
  const signal = new AbortController().signal;
  await assert.rejects(controller.execute({ itemId, claimGeneration: 1, receiptRef, input: INPUT, signal }), /stop here/);
  assert.ok(seenSignal === signal, "the same AbortSignal reaches the adapter");
  assert.ok(!("signal" in seenInput), "signal is out-of-band, never part of the semantic adapter input");
});

test("execute passes signal:null when the caller gives no signal", async (t) => {
  let seenSignal = "unset";
  const adapter = {
    ...FAKE_ADAPTER_IDENTITY,
    async dispatch({ signal }) { seenSignal = signal; throw new Error("stop here"); },
    async recover() { throw new Error("unexpected"); },
  };
  const { controller, itemId, receiptRef, cleanup } = await harness({ adapter });
  t.after(cleanup);
  await assert.rejects(controller.execute({ itemId, claimGeneration: 1, receiptRef, input: INPUT }), /stop here/);
  assert.equal(seenSignal, null);
});

test("execute rejects a non-AbortSignal", async (t) => {
  const adapter = { ...FAKE_ADAPTER_IDENTITY, async dispatch() { throw new Error("unreachable"); }, async recover() { throw new Error("unreachable"); } };
  const { controller, itemId, receiptRef, cleanup } = await harness({ adapter });
  t.after(cleanup);
  await assert.rejects(controller.execute({ itemId, claimGeneration: 1, receiptRef, input: INPUT, signal: {} }), /must be an AbortSignal or null/);
});
