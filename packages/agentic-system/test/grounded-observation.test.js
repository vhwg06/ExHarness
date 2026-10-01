import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineGroundedObservation,
  createGroundedObservationProjector,
  observationIdFor,
} from "../src/grounded-observation.js";
import { createJsonImmutableArtifactStore, createOrganizationArtifactRegistry } from "../src/organization-artifact-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";
import { createProductClosureController } from "../src/product-closure.js";
import { createProductLineageStore } from "../src/product-lineage.js";
import { createDomainExecutionArtifactRegistry, createJsonExecutionAttemptStore } from "../src/domain-execution-store.js";
import { createOrganizationObserver } from "../src/organization-observer.js";
import { executionAttemptSubjectKey } from "../src/domain-execution-control.js";

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function memoryStore() {
  const artifacts = new Map();
  return Object.freeze({
    async put(kind, value) {
      assert.equal(typeof kind, "string");
      const artifact = structuredClone(value);
      const ref = `${kind}:sha256:${digestOf(artifact)}`;
      const existing = artifacts.get(ref);
      if (existing !== undefined) assert.deepEqual(existing, artifact);
      artifacts.set(ref, artifact);
      return ref;
    },
    async resolve(ref) {
      const found = artifacts.get(ref) ?? null;
      return found === null ? null : structuredClone(found);
    },
  });
}

const pin = (ref) => {
  const match = ref.match(/:sha256:([a-f0-9]{64})$/);
  assert.ok(match, `fixture ref must be content addressed: ${ref}`);
  return { ref, digest: match[1] };
};

const SUBJECT = Object.freeze({
  kind: "CAUSAL_OBSERVATION_SUBJECT",
  version: 1,
  mode: "HISTORICAL",
  productId: "product-1",
  rootIntentRef: "intent:root-1",
  historyGeneration: 2,
  historyDigest: "h".repeat(64),
  historyCommitRef: `history-commit:sha256:${"a".repeat(64)}`,
  policyRef: "policy:1",
  policyRevision: 1,
  waiverRefs: [],
  waiverSetDigest: "w".repeat(64),
  projectionRef: `projection:sha256:${"b".repeat(64)}`,
});

const BINDING = Object.freeze({
  kind: "EXECUTION_ATTEMPT_BINDING",
  version: 1,
  executionAttemptId: "execution-attempt-id:abc123",
  workId: "work-1",
  owningDomain: "backend",
  workloadType: "backend-objective",
  workContractRef: "contract:1",
  claimReleaseReceiptRef: "receipt:1",
  executionPolicyRef: "policy:1",
  executionStrategyRef: "strategy:1",
  runtimeBinding: { adapterRef: "adapter:1", expectedRuntimeCodeRef: "runtime:1" },
});

const ATTESTATION = Object.freeze({
  kind: "RUNTIME_EXECUTION_ATTESTATION",
  version: 1,
  executionAttemptId: "execution-attempt-id:abc123",
  bindingRef: null,
  runtimeInvocationId: "runtime-invocation-1",
  runtimeKind: "test",
  runtimeDeploymentRef: "runtime:1",
  adapterRef: "adapter:1",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:01:00.000Z",
  effectRefs: [],
  traceRefs: [],
});

const WORK = Object.freeze({ workId: "work-1", workContractRef: "contract:1", projectId: "product-1" });

function fakeObserver({ factEntries, attestationRef, executionAttemptId }) {
  const chain = factEntries;
  return Object.freeze({
    async queryHistorical() {
      return { mode: "HISTORICAL", subjectRef: null, subject: SUBJECT };
    },
    async queryCurrent() {
      return { mode: "CURRENT", subjectRef: "subject:ref", subject: SUBJECT };
    },
    async chainEvidence() {
      return structuredClone(chain);
    },
    async describeExecution(args) {
      if (!args || typeof args.workId !== "string" || typeof args.workContractRef !== "string" || typeof args.projectId !== "string") {
        throw new TypeError("describeExecution requires workId+workContractRef+projectId");
      }
      return { executionAttemptId, runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
    },
    async explainWhyNotDone() {
      return { readiness: "NOT_READY", blockers: [], evidenceRefs: [] };
    },
    async listRemainingWork() {
      return [];
    },
    async traceObligation() {
      return {};
    },
    async measureTiming() {
      return {};
    },
  });
}

async function world({ facts = null } = {}) {
  const store = memoryStore();
  const qaRef = await store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-1" });
  const chain = facts ?? [
    { factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, SUBJECT.projectionRef] },
    {
      factKind: "PRODUCT_OUTCOME_CLAIM",
      ref: null,
      status: "MISSING_PROVENANCE",
      evidenceRefs: [SUBJECT.historyCommitRef],
    },
  ];
  const bindingRef = await store.put("ExecutionAttemptBinding", { ...BINDING });
  const attestationRef = await store.put("RuntimeExecutionAttestation", { ...ATTESTATION, bindingRef });
  const registries = {
    async resolveExecutionAttemptBinding(ref) {
      return store.resolve(ref);
    },
    async resolveRuntimeExecutionAttestation(ref) {
      return store.resolve(ref);
    },
  };
  const observer = fakeObserver({ factEntries: chain, attestationRef, executionAttemptId: BINDING.executionAttemptId });
  return { store, registries, observer, bindingRef, attestationRef, qaRef };
}

test("execution coordinates are mandatory; the observer default path needs declared identity", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  await assert.rejects(
    () =>
      projector.projectObservation({
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
      }),
    /execution coordinates/,
  );
});

test("cross-attempt and cross-invocation pin substitution is rejected", async () => {
  const w = await world();
  // A second, fully valid attempt for other work lives in the same store.
  const otherBindingRef = await w.store.put("ExecutionAttemptBinding", {
    ...BINDING,
    executionAttemptId: "execution-attempt-id:other-work",
    workId: "work-9",
  });
  const otherAttestationRef = await w.store.put("RuntimeExecutionAttestation", {
    ...ATTESTATION,
    bindingRef: otherBindingRef,
    executionAttemptId: "execution-attempt-id:other-work",
    runtimeInvocationId: "runtime-invocation-other",
  });
  // A second invocation of the same attempt (recovery) also lives in the store.
  const secondInvocationRef = await w.store.put("RuntimeExecutionAttestation", {
    ...ATTESTATION,
    bindingRef: w.bindingRef,
    runtimeInvocationId: "runtime-invocation-2",
  });
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  // The declared WORK coordinates describe attempt A: pins for attempt B are
  // valid refs but belong to other work, so they are rejected, never mixed.
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: otherBindingRef,
        attestationRefs: [otherAttestationRef],
      }),
    /does not match the observer attempt/,
  );
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [otherAttestationRef],
      }),
    /not part of the observer attempt|relation mismatch/,
  );
  // Mixing two invocations of one attempt is rejected instead of silently
  // recording only the first.
  const mixedObserver = fakeObserver({
    factEntries: [
      { factKind: "QUALITY_ACCEPTANCE", ref: w.qaRef, evidenceRefs: [w.qaRef, SUBJECT.projectionRef] },
    ],
    attestationRef: w.attestationRef,
    executionAttemptId: BINDING.executionAttemptId,
  });
  const mixedProjector = createGroundedObservationProjector({
    observer: {
      ...mixedObserver,
      async describeExecution(args) {
        const base = await mixedObserver.describeExecution(args);
        return { ...base, runtimeInvocations: [{ attestationRef: w.attestationRef }, { attestationRef: secondInvocationRef }] };
      },
    },
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  await assert.rejects(
    () =>
      mixedProjector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef, secondInvocationRef],
      }),
    /mix several runtime invocations/,
  );
});

test("projector binds exact subject, attempt, invocation and attestation identity", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const { observation, observationRef } = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    providerEvents: [
      { provider: "test-adapter", eventKind: "RUNTIME_STARTED", eventId: "runtime-invocation-1", attemptBindingRef: w.bindingRef },
    ],
    narrative: [{ text: "the run looked fine", trust: "UNTRUSTED_NARRATIVE" }],
    measurements: [{ key: "durationMs", value: 60000, unit: "ms", evidenceRef: w.attestationRef, reason: null }],
  });
  assert.equal(observation.kind, "GROUNDED_OBSERVATION_V1");
  assert.equal(observation.execution.executionAttemptId, "execution-attempt-id:abc123");
  assert.equal(observation.execution.runtimeInvocationId, "runtime-invocation-1");
  assert.equal(observation.execution.binding.ref, w.bindingRef);
  assert.equal(observation.execution.attestations[0].ref, w.attestationRef);
  assert.equal(observation.subject.mode, "HISTORICAL");
  assert.equal(observation.observationId, observationIdFor(observation));
  assert.match(observationRef, /^grounded-observation:sha256:[a-f0-9]{64}$/);
  const stored = await w.store.resolve(observationRef);
  assert.equal(stored.observationId, observation.observationId);
});

test("missing or mismatched subject, binding or attestation digests are rejected", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        subjectDigest: "0".repeat(64),
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
      }),
    /subject digest mismatch/,
  );
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: "ExecutionAttemptBinding:sha256:" + "f".repeat(64),
        attestationRefs: [w.attestationRef],
      }),
    /unavailable/,
  );
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [`RuntimeExecutionAttestation:sha256:${"e".repeat(64)}`],
      }),
    /not part of the observer attempt|unavailable/,
  );
  const { observation } = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  const tampered = structuredClone(observation);
  tampered.execution.binding = { ref: w.bindingRef, digest: "0".repeat(64) };
  assert.throws(() => defineGroundedObservation(tampered), /pin digest mismatch/);
  const noSubject = structuredClone(observation);
  delete noSubject.subject.subjectDigest;
  assert.throws(() => defineGroundedObservation(noSubject), /subjectDigest/);
});

test("forged or unbound provider events are rejected; provider ids never establish identity", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
        providerEvents: [
          { provider: "evil", eventKind: "RUNTIME_STARTED", eventId: "execution-attempt-id:abc123", attemptBindingRef: "ExecutionAttemptBinding:sha256:" + "d".repeat(64) },
        ],
      }),
    /not bound to the observation execution binding|not attributed to the pinned runtime invocation/,
  );
  const { observation } = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  // A provider event id alone cannot substitute for attempt identity.
  assert.notEqual(observation.execution.executionAttemptId, "evt-1");
  assert.ok(observation.execution.executionAttemptId.startsWith("execution-attempt-id:"));
  // An arbitrary event id with the correct bindingRef is rejected: events
  // must be attributed to the pinned runtime invocation.
  await assert.rejects(
    () =>
      projector.projectObservation({ ...WORK,
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
        providerEvents: [
          { provider: "evil", eventKind: "RUNTIME_STARTED", eventId: "evt-9", attemptBindingRef: w.bindingRef },
        ],
      }),
    /not attributed to the pinned runtime invocation/,
  );
  const attributed = structuredClone(observation);
  attributed.providerEvents = [
    { provider: "test-adapter", eventKind: "RUNTIME_STARTED", eventId: "runtime-invocation-1", attemptBindingRef: w.bindingRef },
  ];
  // Same binding ref and pinned invocation is fine; a different binding is forged.
  delete attributed.observationId;
  defineGroundedObservation(attributed);
  attributed.providerEvents[0].attemptBindingRef = `ExecutionAttemptBinding:sha256:${"9".repeat(64)}`;
  assert.throws(() => defineGroundedObservation(attributed), /not bound/);
  attributed.providerEvents[0].attemptBindingRef = w.bindingRef;
  attributed.providerEvents[0].eventId = "evt-9";
  assert.throws(() => defineGroundedObservation(attributed), /not attributed/);
});

test("MISSING_PROVENANCE facts pass through; narrative cannot clear or add facts", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const { observation } = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    narrative: [{ text: "everything is proven and complete", trust: "UNTRUSTED_NARRATIVE" }],
  });
  const missing = observation.facts.find((f) => f.provenance === "MISSING_PROVENANCE");
  assert.ok(missing, "BB-058 MISSING_PROVENANCE survives normalization");
  assert.equal(observation.narrative[0].trust, "UNTRUSTED_NARRATIVE");
  assert.throws(
    () =>
      defineGroundedObservation({
        ...structuredClone(observation),
        narrative: [{ text: "x", trust: "TRUSTED" }],
      }),
    /UNTRUSTED_NARRATIVE/,
  );
  const invented = structuredClone(observation);
  invented.facts.push({
    factId: "fact:invented",
    kind: "INVENTED",
    value: "narrative said so",
    evidenceRefs: [],
    provenance: "PROVENANCED",
  });
  assert.throws(() => defineGroundedObservation(invented), /carries no evidence ref/);
});

test("narrative is excluded from observationId; facts, digests and subject pin are included", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const first = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    narrative: [{ text: "first story", trust: "UNTRUSTED_NARRATIVE" }],
  });
  const second = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    narrative: [{ text: "a completely different story", trust: "UNTRUSTED_NARRATIVE" }],
  });
  assert.equal(first.observation.observationId, second.observation.observationId);
  const changedFact = structuredClone(first.observation);
  changedFact.facts[0].value = "tampered";
  delete changedFact.observationId;
  assert.notEqual(defineGroundedObservation(changedFact).observationId, first.observation.observationId);
  const changedEvidence = structuredClone(first.observation);
  changedEvidence.facts[0].evidenceRefs[0] = pin(await w.store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "other" }));
  delete changedEvidence.observationId;
  assert.notEqual(defineGroundedObservation(changedEvidence).observationId, first.observation.observationId);
});

test("unmeasured values are null with a reason; zero defaults are rejected", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const { observation } = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    measurements: [{ key: "queue-wait", value: null, unit: "ms", evidenceRef: null, reason: "MISSING_PROVENANCE" }],
  });
  assert.equal(observation.measurements[0].value, null);
  const zeroDefault = structuredClone(observation);
  zeroDefault.measurements = [{ key: "queue-wait", value: 0, unit: "ms", evidenceRef: null, reason: "MISSING_PROVENANCE" }];
  delete zeroDefault.observationId;
  assert.throws(() => defineGroundedObservation(zeroDefault), /must be null, never zero/);
  const missingReason = structuredClone(observation);
  missingReason.measurements = [{ key: "queue-wait", value: null, unit: "ms", evidenceRef: null, reason: null }];
  delete missingReason.observationId;
  assert.throws(() => defineGroundedObservation(missingReason), /reason/);
});

test("write-capable ports are rejected at construction", async () => {
  const w = await world();
  const withPublish = { ...w.observer, publish: async () => {} };
  assert.throws(
    () => createGroundedObservationProjector({ observer: withPublish, artifactRegistry: w.registries, artifactStore: w.store }),
    /forbidden write-capable method publish/,
  );
  const withCas = { ...w.store, compareAndSwap: async () => true };
  assert.throws(
    () => createGroundedObservationProjector({ observer: w.observer, artifactRegistry: w.registries, artifactStore: withCas }),
    /forbidden write-capable method compareAndSwap/,
  );
  const withDispatch = { ...w.registries, dispatch: async () => {} };
  assert.throws(
    () => createGroundedObservationProjector({ observer: w.observer, artifactRegistry: withDispatch, artifactStore: w.store }),
    /forbidden write-capable method dispatch/,
  );
});

test("historical and current subjects never mix", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const historical = await projector.projectObservation({ ...WORK,
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  const current = await projector.projectObservation({ ...WORK,
    subject: { ...SUBJECT, mode: "CURRENT" },
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  assert.notEqual(historical.observation.observationId, current.observation.observationId);
  assert.equal(historical.observation.subject.mode, "HISTORICAL");
  assert.equal(current.observation.subject.mode, "CURRENT");
});

test("default projection integrates with the real delivered observer, registry and attempt head", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-real-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
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
  const boardReader = { async readBlackboard() { return structuredClone({ items: [] }); } };
  const observer = createOrganizationObserver({ productHistory, acceptanceAuthority, projectionBuilder, artifactStore, lineage, boardReader, organizationArtifactRegistry, domainArtifactRegistry, executionAttemptStore, evidenceHeadStore, closureController, outcomeHeadStore });

  await acceptanceAuthority.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await productHistory.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await productHistory.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
  const current = await observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  assert.equal(current.mode, "CURRENT");

  // The previous incompatible default call fails against the delivered BB-058
  // observer: describeExecution requires declared work identity, never a
  // bare subject.
  await assert.rejects(() => observer.describeExecution({ subject: current.subject }), /workId|projectId|workContractRef|attempt/);

  const policyRef = await domainArtifactRegistry.putExecutionPolicy({ kind: "EXECUTION_POLICY", version: 1 });
  const strategyRef = await domainArtifactRegistry.putExecutionStrategyDescriptor({ kind: "EXECUTION_STRATEGY_DESCRIPTOR", version: 1 });
  const bindingRef = await domainArtifactRegistry.putExecutionAttemptBinding({
    kind: "EXECUTION_ATTEMPT_BINDING", version: 1,
    executionAttemptId: "execution-attempt-id:real-1", workId: "work-1",
    executionPolicyRef: policyRef, executionStrategyRef: strategyRef,
    runtimeBinding: { adapterRef: "adapter:1", expectedRuntimeCodeRef: "runtime:1" },
  });
  const attestationRef = await domainArtifactRegistry.putRuntimeExecutionAttestation({
    kind: "RUNTIME_EXECUTION_ATTESTATION", version: 1,
    executionAttemptId: "execution-attempt-id:real-1", bindingRef,
    runtimeInvocationId: "runtime-invocation-real-1",
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
  });
  const outcomeRef = await domainArtifactRegistry.putExecutionAttemptOutcome({
    kind: "EXECUTION_ATTEMPT_OUTCOME", version: 1, runtimeAttestationRefs: [attestationRef],
  });
  const attemptKey = executionAttemptSubjectKey({ projectId: "product-1", itemId: "work-1", workContractRef: "contract:1" });
  assert.equal(await executionAttemptStore.compareAndSwap(attemptKey, null, {
    status: "ACTIVE", executionAttemptId: "execution-attempt-id:real-1",
    bindingRef, transitionRefs: [], outcomeRef,
    completionDecisionRef: null, publicationReceiptRef: null, judgmentBundleRef: null,
  }), true);

  const projector = createGroundedObservationProjector({ observer, artifactRegistry: domainArtifactRegistry, artifactStore });
  // Default path: no caller pins; identity resolves through the delivered
  // observer + registry contracts for the declared work coordinates.
  const { observation, observationRef } = await projector.projectObservation({
    subject: current.subject,
    workId: "work-1",
    workContractRef: "contract:1",
    projectId: "product-1",
  });
  assert.equal(observation.execution.executionAttemptId, "execution-attempt-id:real-1");
  assert.equal(observation.execution.runtimeInvocationId, "runtime-invocation-real-1");
  assert.equal(observation.execution.binding.ref, bindingRef);
  assert.equal(observation.execution.attestations[0].ref, attestationRef);
  assert.equal(observation.subject.mode, "CURRENT");
  assert.equal(observation.observationId, observationIdFor(observation));
  assert.ok(observation.facts.length > 0);
  for (const fact of observation.facts) {
    assert.ok(fact.provenance === "PROVENANCED" || fact.provenance === "MISSING_PROVENANCE");
  }
  // Missing BB-058 provenance stays typed through the real chain: facts are
  // never inferred, and any unprovenanced outcome is MISSING_PROVENANCE.
  for (const fact of observation.facts) {
    if (fact.provenance === "MISSING_PROVENANCE") continue;
    assert.ok(fact.evidenceRefs.length > 0, "PROVENANCED facts carry evidence refs");
  }
  const outcome = observation.facts.find((f) => f.kind === "PRODUCT_OUTCOME_CLAIM");
  if (outcome) assert.equal(outcome.provenance, "MISSING_PROVENANCE");
  const stored = await artifactStore.resolve(observationRef);
  assert.equal(stored.observationId, observation.observationId);

  // A valid binding for other work is rejected against these coordinates.
  const otherBindingRef = await domainArtifactRegistry.putExecutionAttemptBinding({
    kind: "EXECUTION_ATTEMPT_BINDING", version: 1,
    executionAttemptId: "execution-attempt-id:real-2", workId: "work-2",
    executionPolicyRef: policyRef, executionStrategyRef: strategyRef,
    runtimeBinding: { adapterRef: "adapter:1", expectedRuntimeCodeRef: "runtime:1" },
  });
  const otherAttestationRef = await domainArtifactRegistry.putRuntimeExecutionAttestation({
    kind: "RUNTIME_EXECUTION_ATTESTATION", version: 1,
    executionAttemptId: "execution-attempt-id:real-2", bindingRef: otherBindingRef,
    runtimeInvocationId: "runtime-invocation-real-2",
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
  });
  await assert.rejects(
    () => projector.projectObservation({
      subject: current.subject,
      workId: "work-1", workContractRef: "contract:1", projectId: "product-1",
      bindingRef: otherBindingRef, attestationRefs: [otherAttestationRef],
    }),
    /does not match the observer attempt/,
  );
});
