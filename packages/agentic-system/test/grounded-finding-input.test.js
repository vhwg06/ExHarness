import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGroundedObservationProjector, defineGroundedFindingInput, buildGroundedFindingInput, assertGroundedFindingInputCurrent } from "../src/grounded-observation.js";
import { createObservationContextBinder } from "../src/observation-context-binding.js";
import { defineContextRequirement, defineContextResolution, defineContextResolutionReceipt, reuseKey } from "../../oracle/src/index.js";

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function memoryStore() {
  const artifacts = new Map();
  return Object.freeze({
    async put(kind, value) {
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

const BUDGET = { maxItems: 4, maxMaterializedBytes: 4096, maxProviderCalls: 4, maxResolutionSteps: 3 };
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

async function groundedInputWorld({ status = "CURRENT" } = {}) {
  const store = memoryStore();
  const qaRef = await store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-1" });
  const bindingRef = await store.put("ExecutionAttemptBinding", {
    executionAttemptId: "execution-attempt-id:finding-1",
    workId: "work-1",
  });
  const attestationRef = await store.put("RuntimeExecutionAttestation", {
    executionAttemptId: "execution-attempt-id:finding-1",
    bindingRef,
    runtimeInvocationId: "runtime-invocation-finding-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  });
  const observer = Object.freeze({
    async queryHistorical() {
      return { mode: "HISTORICAL", subject: SUBJECT };
    },
    async queryCurrent() {
      return { mode: "CURRENT", subject: SUBJECT };
    },
    async chainEvidence() {
      return [{ factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, SUBJECT.projectionRef] }];
    },
    async describeExecution() {
      return { runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
    },
    async explainWhyNotDone() {
      return {};
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
  const registries = {
    async resolveExecutionAttemptBinding(ref) {
      return store.resolve(ref);
    },
    async resolveRuntimeExecutionAttestation(ref) {
      return store.resolve(ref);
    },
  };
  const projector = createGroundedObservationProjector({ observer, artifactRegistry: registries, artifactStore: store });
  const { observation, observationRef } = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef,
    attestationRefs: [attestationRef],
  });
  const req = defineContextRequirement({
    consumerRef: "worker",
    semanticNeed: "Understand code",
    evidence: [{ id: "code", necessity: "REQUIRED", need: "Read exact file", source: { kind: "REPOSITORY", ref: "repo", snapshot: { mode: "EXACT", ref: "rev-1" }, itemRefs: ["src/a.js"] } }],
    budget: BUDGET,
  });
  const res = defineContextResolution(
    {
      requirementId: req.requirementId,
      step: { index: 0, previousResolutionId: null },
      status: "COMPLETE",
      items: [
        {
          evidenceId: "code",
          rank: 0,
          source: { kind: "REPOSITORY", ref: "repo", snapshotRef: "rev-1", itemRef: "src/a.js" },
          currentness: { validators: [{ kind: "REVISION", value: "rev-1", strength: "STRONG" }] },
          provenance: [],
          content: "hello",
        },
      ],
      unresolved: [],
      consumed: { items: 1, materializedBytes: 4096, providerCalls: 1, resolutionSteps: 1 },
    },
    req,
  );
  const configDigest = "b".repeat(64);
  const sourceObservations = [
    {
      evidenceId: "code",
      source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
      observed: { state: "PRESENT", snapshotRef: "s1" },
    },
  ];
  const receipt = defineContextResolutionReceipt({
    reuseKey: reuseKey({ requirementId: "a".repeat(64), resolverConfigDigest: configDigest, sourceObservations }),
    requirementId: "a".repeat(64),
    resolutionId: "c".repeat(64),
    materializationId: "materialization-1",
    resolutionArtifactRef: "artifact:1",
    resolverConfigDigest: configDigest,
    sourceObservations,
    itemLineage: [{ itemDigest: "e".repeat(64), sourceObservationIds: ["code"], provenanceRefs: [] }],
  });
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const binder = createObservationContextBinder({
    artifactStore: store,
    receiptCurrentness: async () => ({ status, changedEvidenceIds: [], evaluatorIdentity: "test:static" }),
  });
  const { binding, bindingRef: contextBindingRef } = await binder.bindObservationContext({
    observation,
    observationRef,
    requirement: req,
    resolution: res,
    receipt,
    receiptRef,
  });
  return { store, observation, observationRef, binding, contextBindingRef };
}

test("finding input is the only feedback-facing output and round-trips through the store", async () => {
  const w = await groundedInputWorld();
  const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
  const { input, inputRef } = await buildGroundedFindingInput(
    {
      observationRefs: [observationPin],
      contextBindingRef: w.contextBindingRef,
      groundingStatus: "GROUNDED",
      unresolvedReasons: [],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: w.store },
  );
  assert.equal(input.kind, "GROUNDED_FINDING_INPUT_V1");
  assert.equal(input.groundingStatus, "GROUNDED");
  assert.equal(input.inputId.length, 64);
  assert.match(inputRef, /^grounded-finding-input:sha256:[a-f0-9]{64}$/);
  const stored = await w.store.resolve(inputRef);
  assert.equal(stored.inputId, input.inputId);
  assert.ok(Object.isFrozen(input));
});

for (const key of ["finding", "impact", "disposition", "response", "verdict", "accepted", "promoted", "remediation", "principal"]) {
  test(`forbidden authority key is rejected at top level: ${key}`, async () => {
    const w = await groundedInputWorld();
    const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
    await assert.rejects(
      () =>
        buildGroundedFindingInput(
          {
            observationRefs: [observationPin],
            contextBindingRef: w.contextBindingRef,
            groundingStatus: "GROUNDED",
            unresolvedReasons: [],
            uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
            [key]: "smuggled authority",
          },
          { artifactStore: w.store },
        ),
      /forbidden authority key/,
    );
  });

  test(`forbidden authority key is rejected at depth: ${key}`, async () => {
    const w = await groundedInputWorld();
    const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
    await assert.rejects(
      () =>
        buildGroundedFindingInput(
          {
            observationRefs: [observationPin],
            contextBindingRef: w.contextBindingRef,
            groundingStatus: "UNRESOLVED",
            unresolvedReasons: ["STALE_CONTEXT"],
            uncertainty: {
              missingProvenanceFactIds: [],
              unresolvedEvidenceIds: [{ [key]: "nested" }],
              optionalUnresolvedEvidenceIds: [],
            },
          },
          { artifactStore: w.store },
        ),
      /forbidden authority key/,
    );
  });
}

test("UNRESOLVED input requires typed reasons; GROUNDED carries none", async () => {
  const w = await groundedInputWorld();
  const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
  await assert.rejects(
    () =>
      buildGroundedFindingInput(
        {
          observationRefs: [observationPin],
          contextBindingRef: w.contextBindingRef,
          groundingStatus: "UNRESOLVED",
          unresolvedReasons: [],
          uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
        },
        { artifactStore: w.store },
      ),
    /requires at least one typed reason/,
  );
  await assert.rejects(
    () =>
      buildGroundedFindingInput(
        {
          observationRefs: [observationPin],
          contextBindingRef: w.contextBindingRef,
          groundingStatus: "UNRESOLVED",
          unresolvedReasons: ["INVENTED_REASON"],
          uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
        },
        { artifactStore: w.store },
      ),
    /not a typed reason/,
  );
});

test("consumption recheck turns STALE into UNRESOLVED without rewriting the stored input", async () => {
  const w = await groundedInputWorld();
  const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
  const { input, inputRef } = await buildGroundedFindingInput(
    {
      observationRefs: [observationPin],
      contextBindingRef: w.contextBindingRef,
      groundingStatus: "GROUNDED",
      unresolvedReasons: [],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: w.store },
  );
  const before = await w.store.resolve(inputRef);
  const verdict = await assertGroundedFindingInputCurrent(input, {
    artifactStore: w.store,
    receiptCurrentness: async () => ({ status: "STALE", changedEvidenceIds: ["code"], evaluatorIdentity: "test:drift" }),
  });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("STALE_CONTEXT"));
  const after = await w.store.resolve(inputRef);
  assert.deepEqual(after, before);
  assert.equal(after.groundingStatus, "GROUNDED");
});

test("consumption with CURRENT preserves GROUNDED; missing receipt is unverifiable", async () => {
  const w = await groundedInputWorld();
  const observationPin = { ref: w.observationRef, digest: w.observationRef.match(/:sha256:([a-f0-9]{64})$/)[1] };
  const { input } = await buildGroundedFindingInput(
    {
      observationRefs: [observationPin],
      contextBindingRef: w.contextBindingRef,
      groundingStatus: "GROUNDED",
      unresolvedReasons: [],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: w.store },
  );
  const fresh = await assertGroundedFindingInputCurrent(input, {
    artifactStore: w.store,
    receiptCurrentness: async () => ({ status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:static" }),
  });
  assert.equal(fresh.status, "GROUNDED");
  const throwing = await assertGroundedFindingInputCurrent(input, {
    artifactStore: w.store,
    receiptCurrentness: async () => {
      throw new Error("oracle unavailable");
    },
  });
  assert.equal(throwing.status, "UNRESOLVED");
  assert.ok(throwing.reasons.includes("CURRENTNESS_UNVERIFIABLE"));
  // Direct validator also rejects forbidden keys embedded in uncertainty.
  const raw = structuredClone(input);
  delete raw.inputId;
  raw.uncertainty.verdict = "ACCEPT";
  assert.throws(() => defineGroundedFindingInput(raw), /forbidden authority key/);
});
