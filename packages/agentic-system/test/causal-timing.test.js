import test from "node:test";
import assert from "node:assert/strict";
import { defineExecutionStrategyDescriptor, executionAttemptSubjectKey, executionPolicySubjectKey } from "../src/domain-execution-control.js";
import { defineOrganizationWorkContract } from "../src/organization-work.js";
import { MISSING_PROVENANCE } from "../src/causal-provenance.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

const T0 = "2026-09-01T09:00:00.000Z";
const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-01T10:05:00.000Z";
const T3 = "2026-09-01T11:00:00.000Z";
const T4 = "2026-09-01T11:02:30.000Z";

async function seedTimedAttempt(w, attestations) {
  const contract = defineOrganizationWorkContract({
    projectId: "project-1", rootItemId: "ROOT-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + "b".repeat(64),
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: "implementation-input:seed", sliceId: "slice-1", obligationKey: "work-1",
    obligationSubjectKey: "obligation-subject-1", materializationKey: "materialization-1", boardItemId: "WORK-SA-1",
    owningDomain: "SA", workloadType: "solution-design", summary: "Bounded work",
    dependencyIds: [], requiredArtifactRefs: ["user-intent:sha256:" + "b".repeat(64)], expectedArtifactKind: "DESIGN_DOC",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design-v1"],
  });
  await w.organizationArtifactRegistry.putWorkContract(contract);
  const strategyRef = await w.domainArtifactRegistry.putExecutionStrategyDescriptor(defineExecutionStrategyDescriptor({
    strategyId: "sa.core-loop", strategyVersion: "1.0.0", strategyKind: "application-core-loop",
    compatibleWorkloadTypes: ["solution-design"], compatibleWorkContractVersions: [1],
    adapterRef: "adapter:sa-core@1", runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: "git:runtime-sha-1", contextRefs: ["context:sa-v1"],
    toolsetRef: "toolset:sa-v1", modelProfileRef: null, harnessRef: null,
  }));
  const policyKey = executionPolicySubjectKey("SA", "solution-design");
  const policyRef = await w.domainArtifactRegistry.putExecutionPolicy({
    kind: "EXECUTION_POLICY", version: 1, policyId: policyKey, generation: 1, status: "ACTIVE",
    domain: "SA", workloadType: "solution-design", compatibleWorkContractVersions: [1],
    strategyRef, publishedByAuthorityRef: "authority:policy",
  });
  const executionAttemptId = "execution-attempt-id:timed-1";
  const bindingRef = await w.domainArtifactRegistry.putExecutionAttemptBinding({
    kind: "EXECUTION_ATTEMPT_BINDING", version: 1, executionAttemptId, workId: "WORK-SA-1",
    owningDomain: "SA", workloadType: "solution-design", workContractRef: contract.contractRef,
    claimReleaseReceiptRef: "claim-release-receipt:gen1",
    observedClaimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
    executionPolicyRef: policyRef,
    observedExecutionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation: 1, policyRef },
    executionStrategyRef: strategyRef,
    runtimeBinding: { kind: "application-core-loop", adapterRef: "adapter:sa-core@1", expectedRuntimeCodeRef: "git:runtime-sha-1", runtimeInvocationKey: "execution-invocation:timed", bindingMode: "IMMUTABLE_LOCAL" },
    contextRefs: ["context:sa-v1"], toolsetRef: "toolset:sa-v1", modelProfileRef: null, harnessRef: null,
  });
  const attestationRefs = [];
  for (const [index, [startedAt, finishedAt]] of attestations.entries()) {
    attestationRefs.push(await w.domainArtifactRegistry.putRuntimeExecutionAttestation({
      kind: "RUNTIME_EXECUTION_ATTESTATION", version: 1, executionAttemptId, bindingRef,
      runtimeInvocationId: `runtime-invocation-timed-${index}`, runtimeKind: "local-process",
      runtimeDeploymentRef: "git:runtime-sha-1", adapterRef: "adapter:sa-core@1", startedAt, finishedAt,
      effectRefs: [], traceRefs: [],
      dispatchAuthoritySnapshot: {
        claimReleaseHead: { subjectKey: "claim-release:key", revision: "rev-1", receiptRef: "claim-release-receipt:gen1" },
        executionPolicyHead: { subjectKey: policyKey, revision: "policy-rev-1", generation: 1, policyRef },
      },
      producerAuthorityRef: "authority:runtime",
    }));
  }
  const outcomeRef = await w.domainArtifactRegistry.putExecutionAttemptOutcome({
    kind: "EXECUTION_ATTEMPT_OUTCOME", version: 1, executionAttemptId, bindingRef, status: "SUCCEEDED",
    runtimeAttestationRefs: attestationRefs, outputArtifactRefs: [], effectRefs: [],
    verificationCandidateRefs: [], counterevidenceRefs: [], startedAt: attestations[0][0], finishedAt: attestations.at(-1)[1], proposedDerivationEdges: [],
  });
  const attemptKey = executionAttemptSubjectKey({ projectId: "project-1", itemId: "WORK-SA-1", workContractRef: contract.contractRef });
  assert.equal(await w.executionAttemptStore.compareAndSwap(attemptKey, null, {
    status: "ACTIVE", executionAttemptId, bindingRef, transitionRefs: [], outcomeRef,
    completionDecisionRef: null, publicationReceiptRef: null, judgmentBundleRef: null,
  }), true);
  return { contract };
}

test("Waiting and executing durations come from durable boundary timestamps", async (t) => {
  const w = await newObserverWorld(t, "timing");
  await seedEligibleProduct(w);
  const { contract } = await seedTimedAttempt(w, [[T1, T2], [T3, T4]]);
  await w.sink.record({ kind: "CAUSAL_LIFECYCLE_EVIDENCE", version: 1, workId: "WORK-SA-1", eventKind: "MATERIALIZED", observedAt: T0, projectId: "project-1", workContractRef: contract.contractRef, boundaryRef: contract.contractRef });
  const timing = await w.observer.measureTiming({ workId: "WORK-SA-1", workContractRef: contract.contractRef, projectId: "project-1" });
  assert.equal(timing.workId, "WORK-SA-1");
  assert.equal(timing.waiting.status, "AVAILABLE");
  assert.equal(timing.waiting.durationMs, Date.parse(T1) - Date.parse(T0));
  assert.equal(timing.waiting.fromBoundaryAt, T0);
  assert.equal(timing.executing.status, "AVAILABLE");
  assert.equal(timing.executing.durationMs, (Date.parse(T2) - Date.parse(T1)) + (Date.parse(T4) - Date.parse(T3)));
  assert.equal(timing.executing.invocationCount, 2);
  assert.equal(timing.runtimeIntervals.length, 2);
});

test("A missing waiting boundary is MISSING_PROVENANCE, never an estimate", async (t) => {
  const w = await newObserverWorld(t, "timing-missing");
  await seedEligibleProduct(w);
  // No MATERIALIZED evidence is recorded: the observer must not estimate.
  const { contract } = await seedTimedAttempt(w, [[T1, T2]]);
  const before = Date.now();
  const timing = await w.observer.measureTiming({ workId: "WORK-SA-1", workContractRef: contract.contractRef, projectId: "project-1" });
  const after = Date.now();
  assert.equal(timing.waiting.status, MISSING_PROVENANCE);
  assert.equal(timing.waiting.durationMs, null);
  assert.notEqual(timing.executing.status, MISSING_PROVENANCE);
  // The reported executing duration is exactly the persisted interval, and no
  // wall-clock value leaked into either duration.
  assert.equal(timing.executing.durationMs, Date.parse(T2) - Date.parse(T1));
  assert.ok(![before, after].includes(timing.executing.durationMs));
});
