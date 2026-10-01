import test from "node:test";
import assert from "node:assert/strict";
import { defineExecutionStrategyDescriptor, executionAttemptSubjectKey, executionPolicySubjectKey } from "../src/domain-execution-control.js";
import { defineOrganizationWorkContract } from "../src/organization-work.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

const PROJECT = { projectId: "project-1", itemId: "WORK-SA-1" };

async function seedAttempt(w, { generation = 1, strategyVersion = "1.0.0", runtimeDeploymentRef = "git:runtime-sha-1", spans = [["2026-09-01T10:00:00.000Z", "2026-09-01T10:05:00.000Z"]] } = {}) {
  const contract = defineOrganizationWorkContract({
    projectId: "project-1", rootItemId: "ROOT-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + "b".repeat(64),
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: "implementation-input:seed", sliceId: "slice-1", obligationKey: "work-1",
    obligationSubjectKey: "obligation-subject-1", materializationKey: "materialization-1", boardItemId: PROJECT.itemId,
    owningDomain: "SA", workloadType: "solution-design", summary: "Bounded work",
    dependencyIds: [], requiredArtifactRefs: ["user-intent:sha256:" + "b".repeat(64)], expectedArtifactKind: "DESIGN_DOC",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design-v1"],
  });
  await w.organizationArtifactRegistry.putWorkContract(contract);
  const strategy = defineExecutionStrategyDescriptor({
    strategyId: "sa.core-loop", strategyVersion, strategyKind: "application-core-loop",
    compatibleWorkloadTypes: ["solution-design"], compatibleWorkContractVersions: [1],
    adapterRef: "adapter:sa-core@1", runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: runtimeDeploymentRef, contextRefs: ["context:sa-v1"],
    toolsetRef: "toolset:sa-v1", modelProfileRef: "model:sa-v1", harnessRef: "harness:sa-v1",
  });
  const strategyRef = await w.domainArtifactRegistry.putExecutionStrategyDescriptor(strategy);
  const policyKey = executionPolicySubjectKey("SA", "solution-design");
  const policyRef = await w.domainArtifactRegistry.putExecutionPolicy({
    kind: "EXECUTION_POLICY", version: 1, policyId: policyKey, generation, status: "ACTIVE",
    domain: "SA", workloadType: "solution-design", compatibleWorkContractVersions: [1],
    strategyRef, publishedByAuthorityRef: "authority:policy",
  });
  const executionAttemptId = `execution-attempt-id:seed-${generation}`;
  const binding = {
    kind: "EXECUTION_ATTEMPT_BINDING", version: 1, executionAttemptId, workId: PROJECT.itemId,
    owningDomain: "SA", workloadType: "solution-design", workContractRef: contract.contractRef,
    claimReleaseReceiptRef: "claim-release-receipt:gen1",
    observedClaimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
    executionPolicyRef: policyRef,
    observedExecutionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation, policyRef },
    executionStrategyRef: strategyRef,
    runtimeBinding: { kind: "application-core-loop", adapterRef: "adapter:sa-core@1", expectedRuntimeCodeRef: runtimeDeploymentRef, runtimeInvocationKey: "execution-invocation:seed", bindingMode: "IMMUTABLE_LOCAL" },
    contextRefs: ["context:sa-v1"], toolsetRef: "toolset:sa-v1", modelProfileRef: "model:sa-v1", harnessRef: "harness:sa-v1",
  };
  const bindingRef = await w.domainArtifactRegistry.putExecutionAttemptBinding(binding);
  const attestationRefs = [];
  for (const [index, [startedAt, finishedAt]] of spans.entries()) {
    attestationRefs.push(await w.domainArtifactRegistry.putRuntimeExecutionAttestation({
      kind: "RUNTIME_EXECUTION_ATTESTATION", version: 1, executionAttemptId, bindingRef,
      runtimeInvocationId: `runtime-invocation-seed-${generation}-${index}`, runtimeKind: "local-process",
      runtimeDeploymentRef, adapterRef: "adapter:sa-core@1", startedAt, finishedAt,
      effectRefs: [], traceRefs: ["trace:1"],
      dispatchAuthoritySnapshot: {
        claimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
        executionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation, policyRef },
      },
      producerAuthorityRef: "authority:runtime",
    }));
  }
  const attestationRef = attestationRefs[0];
  const outcomeRef = await w.domainArtifactRegistry.putExecutionAttemptOutcome({
    kind: "EXECUTION_ATTEMPT_OUTCOME", version: 1, executionAttemptId, bindingRef, status: "SUCCEEDED",
    runtimeAttestationRefs: attestationRefs, outputArtifactRefs: [], effectRefs: [],
    verificationCandidateRefs: [], counterevidenceRefs: [], startedAt: spans[0][0], finishedAt: spans.at(-1)[1], proposedDerivationEdges: [],
  });
  const attemptKey = executionAttemptSubjectKey({ projectId: PROJECT.projectId, itemId: PROJECT.itemId, workContractRef: contract.contractRef });
  const committed = await w.executionAttemptStore.compareAndSwap(attemptKey, null, {
    status: "ACTIVE", executionAttemptId, bindingRef, transitionRefs: [], outcomeRef,
    completionDecisionRef: null, publicationReceiptRef: null, judgmentBundleRef: null,
  });
  return { contract, strategyRef, policyRef, bindingRef, attestationRef, attestationRefs, outcomeRef, attemptKey, executionAttemptId, committed };
}

test("Executed work resolves exact pinned policy, strategy, config and attempt/runtime identity", async (t) => {
  const w = await newObserverWorld(t, "exec-id");
  await seedEligibleProduct(w);
  const seeded = await seedAttempt(w);
  assert.equal(seeded.committed, true);
  const described = await w.observer.describeExecution({
    workId: PROJECT.itemId, workContractRef: seeded.contract.contractRef, projectId: PROJECT.projectId,
  });
  assert.equal(described.executionAttemptId, seeded.executionAttemptId);
  assert.equal(described.runtimeInvocationId, "runtime-invocation-seed-1-0");
  assert.equal(described.runtimeAttestationRef, seeded.attestationRef);
  assert.equal(described.policyRef, seeded.policyRef);
  assert.equal(described.strategyRef, seeded.strategyRef);
  assert.deepEqual(described.contextRefs, ["context:sa-v1"]);
  assert.equal(described.toolsetRef, "toolset:sa-v1");
  assert.equal(described.modelProfileRef, "model:sa-v1");
  assert.equal(described.harnessRef, "harness:sa-v1");
  assert.equal(described.runtimeDeploymentRef, "git:runtime-sha-1");
  assert.equal(described.runtimeAdapterRef, "adapter:sa-core@1");
  assert.ok(described.evidenceRefs.includes(seeded.bindingRef));
  assert.ok(described.evidenceRefs.includes(seeded.attestationRef));
  const attestation = await w.domainArtifactRegistry.resolveRuntimeExecutionAttestation(seeded.attestationRef);
  assert.equal(attestation.runtimeInvocationId, described.runtimeInvocationId);
});

test("A newer current policy head is never substituted for the pinned attempt binding", async (t) => {
  const w = await newObserverWorld(t, "exec-pin");
  await seedEligibleProduct(w);
  const seeded = await seedAttempt(w, { generation: 1 });
  assert.equal(seeded.committed, true);
  // A newer policy generation with a different strategy/runtime exists in the
  // artifact store. The second attempt head for the same work key conflicts.
  const newer = await seedAttempt(w, { generation: 2, strategyVersion: "2.0.0", runtimeDeploymentRef: "git:runtime-sha-2" });
  assert.equal(newer.committed, false, "a second attempt head for the same work key must conflict, not overwrite");
  const strategy2 = defineExecutionStrategyDescriptor({
    strategyId: "sa.core-loop", strategyVersion: "2.0.0", strategyKind: "application-core-loop",
    compatibleWorkloadTypes: ["solution-design"], compatibleWorkContractVersions: [1],
    adapterRef: "adapter:sa-core@1", runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: "git:runtime-sha-2", contextRefs: ["context:sa-v2"],
    toolsetRef: "toolset:sa-v2", modelProfileRef: null, harnessRef: null,
  });
  const strategyRef2 = await w.domainArtifactRegistry.putExecutionStrategyDescriptor(strategy2);
  const policyKey = executionPolicySubjectKey("SA", "solution-design");
  const policyRef2 = await w.domainArtifactRegistry.putExecutionPolicy({
    kind: "EXECUTION_POLICY", version: 1, policyId: policyKey, generation: 2, status: "ACTIVE",
    domain: "SA", workloadType: "solution-design", compatibleWorkContractVersions: [1],
    strategyRef: strategyRef2, publishedByAuthorityRef: "authority:policy",
  });
  const described = await w.observer.describeExecution({
    workId: PROJECT.itemId, workContractRef: seeded.contract.contractRef, projectId: PROJECT.projectId,
  });
  assert.equal(described.policyRef, seeded.policyRef);
  assert.notEqual(described.policyRef, policyRef2);
  assert.equal(described.strategyRef, seeded.strategyRef);
  assert.notEqual(described.strategyRef, strategyRef2);
  assert.equal(described.runtimeDeploymentRef, "git:runtime-sha-1");
  assert.deepEqual(described.contextRefs, ["context:sa-v1"]);
});

test("Recovery re-invocations list every runtime invocation of the pinned attempt", async (t) => {
  const w = await newObserverWorld(t, "exec-multi");
  await seedEligibleProduct(w);
  const seeded = await seedAttempt(w, { spans: [["2026-09-01T10:00:00.000Z", "2026-09-01T10:05:00.000Z"], ["2026-09-01T11:00:00.000Z", "2026-09-01T11:02:00.000Z"]] });
  assert.equal(seeded.committed, true);
  const described = await w.observer.describeExecution({
    workId: PROJECT.itemId, workContractRef: seeded.contract.contractRef, projectId: PROJECT.projectId,
  });
  assert.equal(described.attestationCount, 2);
  assert.deepEqual(described.runtimeInvocations.map((r) => r.runtimeInvocationId), [
    "runtime-invocation-seed-1-0",
    "runtime-invocation-seed-1-1",
  ]);
  assert.deepEqual(described.runtimeInvocations.map((r) => r.attestationRef), [seeded.attestationRef, seeded.attestationRefs[1]]);
  // The singular fields name the first invocation for backward compatibility.
  assert.equal(described.runtimeInvocationId, "runtime-invocation-seed-1-0");
  assert.equal(described.runtimeAttestationRef, seeded.attestationRef);
});
