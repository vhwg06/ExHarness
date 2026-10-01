import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  defineGroundedObservation,
  createGroundedObservationProjector,
  observationIdFor,
} from "../src/grounded-observation.js";

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

function fakeObserver({ factEntries, attestationRef }) {
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
    async describeExecution() {
      return { runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
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
  const observer = fakeObserver({ factEntries: chain, attestationRef });
  return { store, registries, observer, bindingRef, attestationRef, qaRef };
}

test("projector binds exact subject, attempt, invocation and attestation identity", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const { observation, observationRef } = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    providerEvents: [
      { provider: "test-adapter", eventKind: "RUNTIME_STARTED", eventId: "evt-1", attemptBindingRef: w.bindingRef },
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
      projector.projectObservation({
        subject: SUBJECT,
        subjectDigest: "0".repeat(64),
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
      }),
    /subject digest mismatch/,
  );
  await assert.rejects(
    () =>
      projector.projectObservation({
        subject: SUBJECT,
        bindingRef: "ExecutionAttemptBinding:sha256:" + "f".repeat(64),
        attestationRefs: [w.attestationRef],
      }),
    /unavailable/,
  );
  await assert.rejects(
    () =>
      projector.projectObservation({
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [`RuntimeExecutionAttestation:sha256:${"e".repeat(64)}`],
      }),
    /unavailable/,
  );
  const { observation } = await projector.projectObservation({
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
      projector.projectObservation({
        subject: SUBJECT,
        bindingRef: w.bindingRef,
        attestationRefs: [w.attestationRef],
        providerEvents: [
          { provider: "evil", eventKind: "RUNTIME_STARTED", eventId: "execution-attempt-id:abc123", attemptBindingRef: "ExecutionAttemptBinding:sha256:" + "d".repeat(64) },
        ],
      }),
    /not bound to the observation execution binding/,
  );
  const { observation } = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  // A provider event id alone cannot substitute for attempt identity.
  assert.notEqual(observation.execution.executionAttemptId, "evt-1");
  assert.ok(observation.execution.executionAttemptId.startsWith("execution-attempt-id:"));
  const forged = structuredClone(observation);
  forged.providerEvents = [
    { provider: "evil", eventKind: "RUNTIME_STARTED", eventId: "evt-9", attemptBindingRef: w.bindingRef },
  ];
  // Same binding ref is fine; a different one is forged.
  delete forged.observationId;
  defineGroundedObservation(forged);
  forged.providerEvents[0].attemptBindingRef = `ExecutionAttemptBinding:sha256:${"9".repeat(64)}`;
  assert.throws(() => defineGroundedObservation(forged), /not bound/);
});

test("MISSING_PROVENANCE facts pass through; narrative cannot clear or add facts", async () => {
  const w = await world();
  const projector = createGroundedObservationProjector({
    observer: w.observer,
    artifactRegistry: w.registries,
    artifactStore: w.store,
  });
  const { observation } = await projector.projectObservation({
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
  const first = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
    narrative: [{ text: "first story", trust: "UNTRUSTED_NARRATIVE" }],
  });
  const second = await projector.projectObservation({
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
  const { observation } = await projector.projectObservation({
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
  const historical = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  const current = await projector.projectObservation({
    subject: { ...SUBJECT, mode: "CURRENT" },
    bindingRef: w.bindingRef,
    attestationRefs: [w.attestationRef],
  });
  assert.notEqual(historical.observation.observationId, current.observation.observationId);
  assert.equal(historical.observation.subject.mode, "HISTORICAL");
  assert.equal(current.observation.subject.mode, "CURRENT");
});
