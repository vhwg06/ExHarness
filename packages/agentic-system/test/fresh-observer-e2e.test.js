import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";
import { createProductClosureController } from "../src/product-closure.js";
import { createProductLineageStore } from "../src/product-lineage.js";
import { createOrganizationArtifactRegistry } from "../src/organization-artifact-store.js";
import { createDomainExecutionArtifactRegistry, createJsonExecutionAttemptStore } from "../src/domain-execution-store.js";
import { createCausalLifecycleEvidenceSink, listCausalLifecycleEvidence } from "../src/causal-provenance.js";
import { createOrganizationObserver } from "../src/organization-observer.js";
import { createOrganizationWorkMaterializer } from "../src/organization-work.js";
import { executionAttemptSubjectKey, executionPolicySubjectKey } from "../src/domain-execution-control.js";
import { defineExecutionStrategyDescriptor } from "../src/domain-execution-control.js";

const MATERIALIZED_AT = "2026-09-01T09:00:00.000Z";
const STARTED_AT = "2026-09-01T10:00:00.000Z";
const FINISHED_AT = "2026-09-01T10:04:00.000Z";

function openStack(dir) {
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const productHistory = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history-heads.json") }), mutationGuard: guard });
  const acceptanceAuthority = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy-heads.json") }), mutationGuard: guard });
  const projectionBuilder = createProductStateProjectionBuilder({ productHistory, acceptanceAuthority, artifactStore, mutationGuard: guard });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(dir, "outcomes.json") });
  const closureController = createProductClosureController({ projectionBuilder, productHistory, acceptanceAuthority, artifactStore, outcomeHeadStore, mutationGuard: guard });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore });
  const organizationArtifactRegistry = createOrganizationArtifactRegistry({ store: artifactStore });
  const domainArtifactRegistry = createDomainExecutionArtifactRegistry({ store: artifactStore });
  const executionAttemptStore = createJsonExecutionAttemptStore({ path: join(dir, "attempts.json") });
  const evidenceHeadStore = createJsonCasHeadStore({ path: join(dir, "causal-heads.json") });
  const sink = createCausalLifecycleEvidenceSink({ artifactStore, evidenceHeadStore });
  return { artifactStore, guard, productHistory, acceptanceAuthority, projectionBuilder, closureController, outcomeHeadStore, lineage, organizationArtifactRegistry, domainArtifactRegistry, executionAttemptStore, evidenceHeadStore, sink };
}

test("Fresh-process rebuild from the same pinned subject yields identical causal facts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-obs-e2e-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const s = openStack(dir);
  const board = { items: [{ id: "ROOT-1", status: "DONE", origin: { kind: "USER_INTENT_ROOT", projectId: "project-1", userIntent: { id: "INTENT-1" } } }] };
  const boardReader = { async readBlackboard() { return structuredClone({ items: board.items }); } };
  const observer = () => createOrganizationObserver({ ...s, boardReader });

  await s.acceptanceAuthority.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:design"] } });
  const relRef = await s.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await s.productHistory.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await s.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await s.productHistory.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
  const rejectedRef = await s.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "req-1", status: "QUALITY_REJECTED" });
  await s.productHistory.appendTransition({ productId: "product-1", transitionKind: "SEMANTIC_PUBLICATION", transitionRefs: [rejectedRef], authorityHeads: {} });

  // The owning production boundary emits MATERIALIZED evidence at the real transition.
  const grantRef = await s.artifactStore.put("materialization-authorization", {
    kind: "MATERIALIZATION_AUTHORIZATION_GRANT", version: 1, authorizationId: "mat-auth-1", generation: 1, status: "ACTIVE",
    projectId: "project-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    implementationArtifactRef: "implementation-input:seed", authorityPolicyRevision: "authority-policy-1",
    issuedByAuthorityRef: "authority:mat", authorizedObligationKeys: ["work-1"], authorizedSliceIds: ["slice-1"],
  });
  const authHeads = createJsonCasHeadStore({ path: join(dir, "auth-heads.json") });
  await authHeads.compareAndSwap("mat-auth-1", null, { status: "ACTIVE", artifactRef: grantRef, generation: 1 });
  const orchestrator = {
    async readBlackboard() { return structuredClone({ items: board.items }); },
    async blockOrganizationMaterialization() { return { blocked: true }; },
    async materializeAcceptedWork(args) {
      const item = {
        id: args.itemId, status: "READY", dependsOn: ["ROOT-1"],
        origin: {
          kind: "ORGANIZATION_MATERIALIZATION", workContractRef: args.workContractRef, obligationSubjectKey: args.obligationSubjectKey,
          materializationKey: args.materializationKey, authorizationId: args.authorizationId, authorizationRef: args.authorizationRef,
          authorizationGeneration: args.authorizationGeneration, authorizationRevision: args.authorizationRevision,
          implementationArtifactRef: args.implementationArtifactRef, owningDomain: args.owningDomain, workloadType: args.workloadType,
          projectId: args.projectId, rootItemId: args.rootItemId, rootIntentId: args.rootIntentId,
        },
      };
      board.items.push(item);
      return { result: item, snapshot: { items: board.items } };
    },
  };
  const materializer = createOrganizationWorkMaterializer({
    orchestrator, materializationAuthorizationStore: authHeads, artifactRegistry: s.organizationArtifactRegistry,
    causalSink: s.sink, causalNow: () => MATERIALIZED_AT,
  });
  const materialized = await materializer.materialize({
    authorizationId: "mat-auth-1", decision: { ref: "decision:accepted", obligationKeys: ["work-1"] },
    obligation: {
      key: "work-1", sliceId: "slice-1", owningDomain: "SA", workloadType: "solution-design", summary: "Bounded design work",
      requiredArtifactRefs: [], expectedArtifactKind: "DESIGN_DOC", expectedOutputRefs: [], acceptanceRefs: ["acceptance:design-v1"],
    },
  });
  const workId = materialized.item.id;
  const lifecycle = await listCausalLifecycleEvidence({ artifactStore: s.artifactStore, evidenceHeadStore: s.evidenceHeadStore }, { workId });
  assert.ok(lifecycle.some((e) => e.evidence.eventKind === "MATERIALIZED" && e.evidence.observedAt === MATERIALIZED_AT));

  // One pinned execution with durable runtime attestation timestamps.
  const strategyRef = await s.domainArtifactRegistry.putExecutionStrategyDescriptor(defineExecutionStrategyDescriptor({
    strategyId: "sa.core-loop", strategyVersion: "1.0.0", strategyKind: "application-core-loop",
    compatibleWorkloadTypes: ["solution-design"], compatibleWorkContractVersions: [1],
    adapterRef: "adapter:sa-core@1", runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: "git:runtime-sha-1", contextRefs: ["context:sa-v1"],
    toolsetRef: "toolset:sa-v1", modelProfileRef: null, harnessRef: null,
  }));
  const policyKey = executionPolicySubjectKey("SA", "solution-design");
  const policyRef = await s.domainArtifactRegistry.putExecutionPolicy({
    kind: "EXECUTION_POLICY", version: 1, policyId: policyKey, generation: 1, status: "ACTIVE",
    domain: "SA", workloadType: "solution-design", compatibleWorkContractVersions: [1], strategyRef, publishedByAuthorityRef: "authority:policy",
  });
  const executionAttemptId = "execution-attempt-id:e2e-1";
  const bindingRef = await s.domainArtifactRegistry.putExecutionAttemptBinding({
    kind: "EXECUTION_ATTEMPT_BINDING", version: 1, executionAttemptId, workId,
    owningDomain: "SA", workloadType: "solution-design", workContractRef: materialized.contract.contractRef,
    claimReleaseReceiptRef: "claim-release-receipt:gen1",
    observedClaimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
    executionPolicyRef: policyRef,
    observedExecutionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation: 1, policyRef },
    executionStrategyRef: strategyRef,
    runtimeBinding: { kind: "application-core-loop", adapterRef: "adapter:sa-core@1", expectedRuntimeCodeRef: "git:runtime-sha-1", runtimeInvocationKey: "execution-invocation:e2e", bindingMode: "IMMUTABLE_LOCAL" },
    contextRefs: ["context:sa-v1"], toolsetRef: "toolset:sa-v1", modelProfileRef: null, harnessRef: null,
  });
  const attestationRef = await s.domainArtifactRegistry.putRuntimeExecutionAttestation({
    kind: "RUNTIME_EXECUTION_ATTESTATION", version: 1, executionAttemptId, bindingRef,
    runtimeInvocationId: "runtime-invocation-e2e-1", runtimeKind: "local-process",
    runtimeDeploymentRef: "git:runtime-sha-1", adapterRef: "adapter:sa-core@1", startedAt: STARTED_AT, finishedAt: FINISHED_AT,
    effectRefs: [], traceRefs: [],
    dispatchAuthoritySnapshot: {
      claimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
      executionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation: 1, policyRef },
    },
    producerAuthorityRef: "authority:runtime",
  });
  const outcomeRef = await s.domainArtifactRegistry.putExecutionAttemptOutcome({
    kind: "EXECUTION_ATTEMPT_OUTCOME", version: 1, executionAttemptId, bindingRef, status: "SUCCEEDED",
    runtimeAttestationRefs: [attestationRef], outputArtifactRefs: [], effectRefs: [],
    verificationCandidateRefs: [], counterevidenceRefs: [], startedAt: STARTED_AT, finishedAt: FINISHED_AT, proposedDerivationEdges: [],
  });
  const attemptKey = executionAttemptSubjectKey({ projectId: "project-1", itemId: workId, workContractRef: materialized.contract.contractRef });
  await s.executionAttemptStore.compareAndSwap(attemptKey, null, {
    status: "ACTIVE", executionAttemptId, bindingRef, transitionRefs: [], outcomeRef,
    completionDecisionRef: null, publicationReceiptRef: null, judgmentBundleRef: null,
  });

  const first = await observer().queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(first.readiness, "NOT_READY");
  assert.ok(first.blockers.some((b) => b.ref === rejectedRef));
  const remaining = await observer().listRemainingWork({ subject: first.subject });
  assert.ok(remaining.some((r) => r.workId === workId && r.owningDomain === "SA"));
  const execution = await observer().describeExecution({ subject: first.subject, workId, workContractRef: materialized.contract.contractRef, projectId: "project-1" });
  assert.equal(execution.executionAttemptId, executionAttemptId);
  assert.equal(execution.runtimeInvocationId, "runtime-invocation-e2e-1");
  const timing = await observer().measureTiming({ workId, workContractRef: materialized.contract.contractRef, projectId: "project-1" });
  assert.equal(timing.waiting.durationMs, Date.parse(STARTED_AT) - Date.parse(MATERIALIZED_AT));
  assert.equal(timing.executing.durationMs, Date.parse(FINISHED_AT) - Date.parse(STARTED_AT));

  // Observation persists no authority state: the store directory holds no
  // observation files, so "deleting cached projections" is a fresh reopen.
  const files = (await readdir(dir)).sort();
  assert.ok(!files.some((f) => f.includes("observation")), `no observation cache files: ${files.join(",")}`);
  const historyBefore = await s.productHistory.current({ productId: "product-1" });

  // Fresh process: all handles dropped, same files reopened, no memory.
  const fresh = openStack(dir);
  const freshBoardReader = { async readBlackboard() { return structuredClone({ items: board.items }); } };
  const freshObserver = createOrganizationObserver({ ...fresh, boardReader: freshBoardReader });
  const rebuilt = await freshObserver.queryHistorical({ subject: { ...first.subject, mode: "HISTORICAL" } });
  assert.deepEqual(rebuilt.blockers, first.blockers);
  assert.deepEqual(rebuilt.evidenceRefs, first.evidenceRefs);
  const freshRemaining = await freshObserver.listRemainingWork({ subject: { ...first.subject, mode: "HISTORICAL" } });
  // Board lifecycle is live truth, not pinned: the historical marker is
  // identical across processes instead of a silently mixed live list.
  assert.equal(freshRemaining.status, "NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT");
  assert.deepEqual(freshRemaining.items, []);
  const freshExecution = await freshObserver.describeExecution({ subject: { ...first.subject, mode: "HISTORICAL" }, workId, workContractRef: materialized.contract.contractRef, projectId: "project-1" });
  assert.deepEqual(freshExecution, execution);
  const freshTiming = await freshObserver.measureTiming({ workId, workContractRef: materialized.contract.contractRef, projectId: "project-1" });
  assert.deepEqual(freshTiming, timing);
  // Rebuilding observations never moved product truth.
  assert.deepEqual(await fresh.productHistory.current({ productId: "product-1" }), historyBefore);
});
