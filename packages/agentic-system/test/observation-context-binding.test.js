import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGroundedObservationProjector } from "../src/grounded-observation.js";
import {
  defineObservationContextBinding,
  createObservationContextBinder,
  classifyGrounding,
} from "../src/observation-context-binding.js";
import {
  defineContextRequirement,
  defineContextResolution,
  defineContextResolutionReceipt,
  reuseKey,
} from "../../oracle/src/index.js";

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
const requiredEvidence = {
  id: "code",
  necessity: "REQUIRED",
  need: "Read exact file",
  source: { kind: "REPOSITORY", ref: "repo", snapshot: { mode: "EXACT", ref: "rev-1" }, itemRefs: ["src/a.js"] },
};
const optionalEvidence = {
  id: "docs",
  necessity: "OPTIONAL",
  need: "Read docs",
  source: { kind: "REPOSITORY", ref: "repo", snapshot: { mode: "EXACT", ref: "rev-1" }, itemRefs: ["src/b.js"] },
};

function requirement(evidence = [requiredEvidence]) {
  return defineContextRequirement({ consumerRef: "worker", semanticNeed: "Understand code", evidence, budget: BUDGET });
}
function item(evidenceId = "code", overrides = {}) {
  return {
    evidenceId,
    rank: 0,
    source: { kind: "REPOSITORY", ref: "repo", snapshotRef: "rev-1", itemRef: evidenceId === "code" ? "src/a.js" : "src/b.js" },
    currentness: { validators: [{ kind: "REVISION", value: "rev-1", strength: "STRONG" }] },
    provenance: [],
    content: `content:${evidenceId}`,
    ...overrides,
  };
}
function resolutionFor(req, items, unresolved) {
  const status = unresolved.some((u) => req.evidence.find((e) => e.id === u.evidenceId)?.necessity === "REQUIRED")
    ? "UNSATISFIED"
    : unresolved.length
      ? "PARTIAL"
      : "COMPLETE";
  return defineContextResolution(
    {
      requirementId: req.requirementId,
      step: { index: 0, previousResolutionId: null },
      status,
      items,
      unresolved,
      consumed: { items: items.length, materializedBytes: 4096, providerCalls: 1, resolutionSteps: 1 },
    },
    req,
  );
}
function receiptFor(req, res) {
  const configDigest = "b".repeat(64);
  const sourceObservations = [
    {
      evidenceId: "code",
      source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
      observed: { state: "PRESENT", snapshotRef: "s1" },
    },
  ];
  return defineContextResolutionReceipt({
    reuseKey: reuseKey({ requirementId: "a".repeat(64), resolverConfigDigest: configDigest, sourceObservations }),
    requirementId: "a".repeat(64),
    resolutionId: "c".repeat(64),
    materializationId: "materialization-1",
    resolutionArtifactRef: "artifact:1",
    resolverConfigDigest: configDigest,
    sourceObservations,
    itemLineage: [{ itemDigest: "e".repeat(64), sourceObservationIds: ["code"], provenanceRefs: [] }],
  });
}

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

const BINDING_ARTIFACT = Object.freeze({
  executionAttemptId: "execution-attempt-id:bind-1",
  workId: "work-1",
});
const ATTESTATION_ARTIFACT = Object.freeze({
  executionAttemptId: "execution-attempt-id:bind-1",
  bindingRef: null,
  runtimeInvocationId: "runtime-invocation-bind-1",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:01:00.000Z",
});

const currentnessOf = (status, changed = []) => async () => ({
  status,
  changedEvidenceIds: changed,
  evaluatorIdentity: "test:static",
});

async function groundedWorld() {
  const store = memoryStore();
  const qaRef = await store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-1" });
  const chain = [{ factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, SUBJECT.projectionRef] }];
  const bindingRef = await store.put("ExecutionAttemptBinding", { ...BINDING_ARTIFACT });
  const attestationRef = await store.put("RuntimeExecutionAttestation", { ...ATTESTATION_ARTIFACT, bindingRef });
  const registries = {
    async resolveExecutionAttemptBinding(ref) {
      return store.resolve(ref);
    },
    async resolveRuntimeExecutionAttestation(ref) {
      return store.resolve(ref);
    },
  };
  const observer = Object.freeze({
    async queryHistorical() {
      return { mode: "HISTORICAL", subject: SUBJECT };
    },
    async queryCurrent() {
      return { mode: "CURRENT", subject: SUBJECT };
    },
    async chainEvidence() {
      return structuredClone(chain);
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
  const projector = createGroundedObservationProjector({ observer, artifactRegistry: registries, artifactStore: store });
  const { observation, observationRef } = await projector.projectObservation({
    subject: SUBJECT,
    bindingRef,
    attestationRefs: [attestationRef],
  });
  return { store, observation, observationRef };
}

async function bind({ store, observation, observationRef, req, res, receipt, receiptRef, status = "CURRENT" }) {
  const binder = createObservationContextBinder({ artifactStore: store, receiptCurrentness: currentnessOf(status) });
  return binder.bindObservationContext({ observation, observationRef, requirement: req, resolution: res, receipt, receiptRef });
}

test("GROUNDED requires COMPLETE resolution, receipt and CURRENT currentness", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const { binding, bindingRef } = await bind({ ...w, req, res, receipt, receiptRef });
  assert.equal(binding.kind, "OBSERVATION_CONTEXT_BINDING_V1");
  assert.equal(binding.resolutionStatus, "COMPLETE");
  assert.equal(binding.receiptRef, receiptRef);
  assert.equal(binding.currentness.status, "CURRENT");
  assert.equal(binding.bindingId.length, 64);
  assert.match(bindingRef, /^observation-context-binding:sha256:[a-f0-9]{64}$/);
  const verdict = classifyGrounding({ observation: w.observation, binding });
  assert.deepEqual(verdict, { status: "GROUNDED", reasons: [] });
  const stored = await w.store.resolve(bindingRef);
  assert.equal(stored.bindingId, binding.bindingId);
});

test("PARTIAL with only OPTIONAL unresolved stays GROUNDED; REQUIRED unresolved blocks", async () => {
  const w = await groundedWorld();
  const req = requirement([requiredEvidence, optionalEvidence]);
  const optionalPartial = resolutionFor(req, [item("code")], [{ evidenceId: "docs", reason: "DEFERRED" }]);
  assert.equal(optionalPartial.status, "PARTIAL");
  const receipt = receiptFor(req, optionalPartial);
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const ok = await bind({ ...w, req, res: optionalPartial, receipt, receiptRef });
  assert.deepEqual(classifyGrounding({ observation: w.observation, binding: ok.binding }), {
    status: "GROUNDED",
    reasons: [],
  });
  const requiredPartial = resolutionFor(req, [item("docs")], [{ evidenceId: "code", reason: "MISSING" }]);
  assert.equal(requiredPartial.status, "UNSATISFIED");
  const blocked = await bind({ ...w, req, res: requiredPartial, receipt, receiptRef });
  const verdict = classifyGrounding({ observation: w.observation, binding: blocked.binding });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("UNSATISFIED_CONTEXT"));
});

test("table-driven classification covers every typed reason", async () => {
  const w = await groundedWorld();
  const responseFor = async (reason) => {
    const req = requirement([requiredEvidence, optionalEvidence]);
    const completeRes = () => resolutionFor(req, [item("code"), item("docs")], []);
    const receiptPair = (res) => {
      const receipt = receiptFor(req, res);
      return { receipt, receiptRef: `context-resolution-receipt:sha256:${receipt.receiptId}` };
    };
    if (reason === "MISSING_PROVENANCE") {
      const res = resolutionFor(req, [item("code")], [{ evidenceId: "docs", reason: "DEFERRED" }]);
      const { receipt, receiptRef } = receiptPair(res);
      const tampered = structuredClone(w.observation);
      tampered.facts.push({
        factId: "fact:missing",
        kind: "PRODUCT_OUTCOME_CLAIM",
        value: null,
        evidenceRefs: [],
        provenance: "MISSING_PROVENANCE",
      });
      delete tampered.observationId;
      const { defineGroundedObservation } = await import("../src/grounded-observation.js");
      const observation = defineGroundedObservation(tampered);
      const observationRef = await w.store.put("grounded-observation", structuredClone(observation));
      const { binding } = await bind({ store: w.store, observation, observationRef, req, res, receipt, receiptRef });
      return classifyGrounding({ observation, binding });
    }
    if (reason === "CURRENTNESS_UNVERIFIABLE") {
      const res = resolutionFor(req, [item("docs")], [{ evidenceId: "code", reason: "MISSING" }]);
      const { binding } = await bind({ store: w.store, observation: w.observation, observationRef: w.observationRef, req, res, receipt: null, receiptRef: null });
      return classifyGrounding({ observation: w.observation, binding });
    }
    if (reason === "STALE_CONTEXT") {
      const res = completeRes();
      const { receipt, receiptRef } = receiptPair(res);
      const { binding } = await bind({ store: w.store, observation: w.observation, observationRef: w.observationRef, req, res, receipt, receiptRef, status: "STALE" });
      return classifyGrounding({ observation: w.observation, binding });
    }
    if (reason === "SUBJECT_MISMATCH") {
      const res = completeRes();
      const { receipt, receiptRef } = receiptPair(res);
      const other = requirement([{ ...requiredEvidence, id: "other", need: "Other need" }]);
      const { binding } = await bind({ store: w.store, observation: w.observation, observationRef: w.observationRef, req, res, receipt, receiptRef });
      return classifyGrounding({ observation: w.observation, binding, requirement: other });
    }
    if (reason === "MISSING") {
      // PARTIAL with a REQUIRED unresolved item cannot arise from the real
      // oracle contract (REQUIRED unresolved forces UNSATISFIED), so craft the
      // binding directly: classification must still fail closed with
      // MISSING_CONTEXT.
      const base = completeRes();
      const { receipt, receiptRef } = receiptPair(base);
      const crafted = defineObservationContextBinding({
        kind: "OBSERVATION_CONTEXT_BINDING_V1",
        version: 1,
        observationRef: w.observationRef,
        observationDigest: w.observation.observationId,
        requirementId: req.requirementId,
        resolutionId: base.resolutionId,
        resolutionStatus: "PARTIAL",
        unresolvedEvidence: [{ evidenceId: "code", necessity: "REQUIRED", reason: "MISSING" }],
        receiptRef,
        receiptDigest: receipt.receiptId,
        currentness: { status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:crafted" },
      });
      return classifyGrounding({ observation: w.observation, binding: crafted });
    }
    const res = resolutionFor(req, [item("docs")], [{ evidenceId: "code", reason }]);
    const { receipt, receiptRef } = receiptPair(res);
    const { binding } = await bind({ store: w.store, observation: w.observation, observationRef: w.observationRef, req, res, receipt, receiptRef });
    return classifyGrounding({ observation: w.observation, binding });
  };
  const expectations = {
    MISSING_PROVENANCE: "MISSING_PROVENANCE",
    MISSING_CONTEXT: "MISSING_CONTEXT",
    UNSATISFIED_CONTEXT: "UNSATISFIED_CONTEXT",
    STALE_CONTEXT: "STALE_CONTEXT",
    AMBIGUOUS_CONTEXT: "AMBIGUOUS_CONTEXT",
    CURRENTNESS_UNVERIFIABLE: "CURRENTNESS_UNVERIFIABLE",
    SUBJECT_MISMATCH: "SUBJECT_MISMATCH",
  };
  const resolutionReasonFor = {
    MISSING_CONTEXT: "MISSING",
    UNSATISFIED_CONTEXT: "SOURCE_FAILURE",
    STALE_CONTEXT: "STALE",
    AMBIGUOUS_CONTEXT: "AMBIGUOUS",
  };
  for (const [name, expected] of Object.entries(expectations)) {
    const verdict = await responseFor(resolutionReasonFor[name] ?? name);
    assert.equal(verdict.status, "UNRESOLVED", name);
    assert.ok(verdict.reasons.includes(expected), `${name} yields ${expected}: ${verdict.reasons}`);
  }
});

test("binding without a receipt classifies CURRENTNESS_UNVERIFIABLE; binder never self-certifies", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const binder = createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: currentnessOf("CURRENT") });
  const { binding } = await binder.bindObservationContext({
    observation: w.observation,
    observationRef: w.observationRef,
    requirement: req,
    resolution: res,
    receipt: null,
    receiptRef: null,
  });
  assert.equal(binding.receiptRef, null);
  assert.equal(binding.currentness.status, "CURRENTNESS_UNVERIFIABLE");
  const verdict = classifyGrounding({ observation: w.observation, binding });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("CURRENTNESS_UNVERIFIABLE"));
});

test("STALE at binding time classifies STALE_CONTEXT", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const { binding } = await bind({ ...w, req, res, receipt, receiptRef, status: "STALE" });
  assert.equal(binding.currentness.status, "STALE");
  const verdict = classifyGrounding({ observation: w.observation, binding });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("STALE_CONTEXT"));
});

test("observation bound to another requirement or subject classifies SUBJECT_MISMATCH", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const { binding } = await bind({ ...w, req, res, receipt, receiptRef });
  const otherRequirement = requirement([{ ...requiredEvidence, need: "Different need" }]);
  // Same evidence ids but a different requirement identity.
  assert.notEqual(otherRequirement.requirementId, req.requirementId);
  const mismatched = classifyGrounding({ observation: w.observation, binding, requirement: otherRequirement });
  assert.equal(mismatched.status, "UNRESOLVED");
  assert.ok(mismatched.reasons.includes("SUBJECT_MISMATCH"));
  const otherObservation = { ...w.observation, observationId: "0".repeat(64) };
  const tampered = classifyGrounding({ observation: otherObservation, binding });
  assert.ok(tampered.reasons.includes("SUBJECT_MISMATCH"));
});

test("binder rejects write-capable ports and never resolves context", async () => {
  const w = await groundedWorld();
  assert.throws(
    () => createObservationContextBinder({ artifactStore: { ...w.store, accept: async () => {} }, receiptCurrentness: currentnessOf("CURRENT") }),
    /forbidden write-capable method accept/,
  );
  assert.throws(
    () => createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: "not-a-function" }),
    /injected receiptCurrentness function/,
  );
  const binder = createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: currentnessOf("CURRENT") });
  assert.equal(typeof binder.bindObservationContext, "function");
  assert.equal(binder.bindObservationContext.name, "bindObservationContext");
});

test("binding validator rejects unknown status and mismatched ids", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = `context-resolution-receipt:sha256:${receipt.receiptId}`;
  const { binding } = await bind({ ...w, req, res, receipt, receiptRef });
  assert.throws(
    () => defineObservationContextBinding({ ...structuredClone(binding), bindingId: undefined, resolutionStatus: "BROKEN" }),
    /resolutionStatus invalid/,
  );
  assert.throws(
    () => defineObservationContextBinding({ ...structuredClone(binding), bindingId: "0".repeat(64) }),
    /bindingId does not match/,
  );
});
