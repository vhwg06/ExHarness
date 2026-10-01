import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  createResolutionStore,
  createSourceCatalog,
  createDurableResolutionCoordinator,
  evaluateReceiptCurrentness,
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
  // A delivered receipt binds its requirement and resolution identities, so
  // the fixture receipt carries the real semantic ids under test.
  return defineContextResolutionReceipt({
    reuseKey: reuseKey({ requirementId: req.requirementId, resolverConfigDigest: configDigest, sourceObservations }),
    requirementId: req.requirementId,
    resolutionId: res.resolutionId,
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

const WORK = Object.freeze({ workId: "work-1", workContractRef: "contract:1", projectId: "product-1" });

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
    async describeExecution(args) {
      if (!args || typeof args.workId !== "string") throw new TypeError("describeExecution requires work coordinates");
      return { executionAttemptId: BINDING_ARTIFACT.executionAttemptId, runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
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
    ...WORK,
    subject: SUBJECT,
    bindingRef,
    attestationRefs: [attestationRef],
  });
  return { store, observation, observationRef };
}

async function bind({ store, observation, observationRef, req, res, receipt, receiptRef, status = "CURRENT", receiptReader = null }) {
  const binder = createObservationContextBinder({ artifactStore: store, receiptCurrentness: currentnessOf(status), receiptReader });
  return binder.bindObservationContext({ observation, observationRef, requirement: req, resolution: res, receipt, receiptRef });
}

// Blob locators must carry exact stored bytes: the helper stores the receipt
// and returns its real immutable-store ref.
async function blobReceiptRef(store, receipt) {
  return store.put("context-resolution-receipt", structuredClone(receipt));
}

test("GROUNDED requires COMPLETE resolution, receipt and CURRENT currentness", async () => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = await blobReceiptRef(w.store, receipt);
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
  const receiptRef = await blobReceiptRef(w.store, receipt);
  const ok = await bind({ ...w, req, res: optionalPartial, receipt, receiptRef });
  assert.deepEqual(classifyGrounding({ observation: w.observation, binding: ok.binding }), {
    status: "GROUNDED",
    reasons: [],
  });
  const requiredPartial = resolutionFor(req, [item("docs")], [{ evidenceId: "code", reason: "MISSING" }]);
  assert.equal(requiredPartial.status, "UNSATISFIED");
  const blockedReceipt = receiptFor(req, requiredPartial);
  const blockedRef = await blobReceiptRef(w.store, blockedReceipt);
  const blocked = await bind({ ...w, req, res: requiredPartial, receipt: blockedReceipt, receiptRef: blockedRef });
  const verdict = classifyGrounding({ observation: w.observation, binding: blocked.binding });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("UNSATISFIED_CONTEXT"));
});

test("table-driven classification covers every typed reason", async () => {
  const w = await groundedWorld();
  const responseFor = async (reason) => {
    const req = requirement([requiredEvidence, optionalEvidence]);
    const completeRes = () => resolutionFor(req, [item("code"), item("docs")], []);
    const receiptPair = async (res) => {
      const receipt = receiptFor(req, res);
      return { receipt, receiptRef: await blobReceiptRef(w.store, receipt) };
    };
    if (reason === "MISSING_PROVENANCE") {
      const res = resolutionFor(req, [item("code")], [{ evidenceId: "docs", reason: "DEFERRED" }]);
      const { receipt, receiptRef } = await receiptPair(res);
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
      const { receipt, receiptRef } = await receiptPair(res);
      const { binding } = await bind({ store: w.store, observation: w.observation, observationRef: w.observationRef, req, res, receipt, receiptRef, status: "STALE" });
      return classifyGrounding({ observation: w.observation, binding });
    }
    if (reason === "SUBJECT_MISMATCH") {
      const res = completeRes();
      const { receipt, receiptRef } = await receiptPair(res);
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
      const { receipt, receiptRef } = await receiptPair(base);
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
    const { receipt, receiptRef } = await receiptPair(res);
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
  const receiptRef = await blobReceiptRef(w.store, receipt);
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
  const receiptRef = await blobReceiptRef(w.store, receipt);
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
  const receiptRef = await blobReceiptRef(w.store, receipt);
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

test("binder rejects wrong-ref, wrong-resolution and tampered receipts", async (t) => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const newBinder = () => createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: currentnessOf("CURRENT") });

  // Wrong resolution: the receipt binds another resolution id. The locator
  // carries exact stored bytes so rejection is purely semantic.
  const otherRes = resolutionFor(req, [item("code", { content: "other" })], []);
  assert.notEqual(otherRes.resolutionId, res.resolutionId);
  const otherResRef = await blobReceiptRef(w.store, receipt);
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: otherRes,
      receipt, receiptRef: otherResRef,
    }),
    /different resolution/,
  );

  // Resolution answering another requirement is rejected at bind time.
  const otherReq = requirement([{ ...requiredEvidence, need: "Different need" }]);
  assert.notEqual(otherReq.requirementId, req.requirementId);
  const otherReqRes = resolutionFor(otherReq, [item()], []);
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: otherReqRes,
      receipt, receiptRef: otherResRef,
    }),
    /different requirement/,
  );

  // Receipt answering another requirement is rejected.
  const foreignReceipt = receiptFor(otherReq, otherReqRes);
  const foreignRef = await blobReceiptRef(w.store, foreignReceipt);
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation,
      observationRef: w.observationRef,
      requirement: req,
      resolution: res,
      receipt: foreignReceipt,
      receiptRef: foreignRef,
    }),
    /different requirement/,
  );

  // Wrong ref: exact stored bytes differ from the supplied receipt.
  const storedRef = await w.store.put("context-resolution-receipt", structuredClone(receipt));
  const tampered = structuredClone(receipt);
  tampered.materializationId = "tampered-materialization";
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: res, receipt: tampered, receiptRef: storedRef,
    }),
    /do not match the exact stored receipt/,
  );

  // Tampered semantic identity is rejected even when no stored bytes exist.
  const tamperedId = structuredClone(receipt);
  tamperedId.resolutionId = "0".repeat(64);
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: res,
      receipt: tamperedId, receiptRef: `context-resolution-receipt:sha256:${"1".repeat(64)}`,
    }),
    /different resolution/,
  );

  // A non-content-addressed receiptRef is rejected.
  await assert.rejects(
    () => newBinder().bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: res, receipt, receiptRef: "receipt:latest",
    }),
    /content-addressed/,
  );
});

test("classification is total and fail-closed on missing, invalid or contradictory proof", async (t) => {
  const w = await groundedWorld();
  const req = requirement();
  const res = resolutionFor(req, [item()], []);
  const receipt = receiptFor(req, res);
  const receiptRef = await blobReceiptRef(w.store, receipt);
  const { binding } = await bind({ ...w, req, res, receipt, receiptRef });

  // Missing observation proof never grounds.
  let verdict = classifyGrounding({ observation: null, binding });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("MISSING_PROVENANCE"));

  // Missing binding proof never grounds.
  verdict = classifyGrounding({ observation: w.observation, binding: null });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("MISSING_CONTEXT"));

  // Unsupported resolution status never grounds.
  verdict = classifyGrounding({ observation: w.observation, binding: { ...structuredClone(binding), resolutionStatus: "STALE" } });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("MISSING_CONTEXT"));

  // COMPLETE with REQUIRED unresolved evidence is contradictory and never grounds.
  const contradictory = await (async () => {
    const crafted = (await import("../src/observation-context-binding.js")).defineObservationContextBinding({
      kind: "OBSERVATION_CONTEXT_BINDING_V1", version: 1,
      observationRef: w.observationRef, observationDigest: w.observation.observationId,
      requirementId: req.requirementId, resolutionId: res.resolutionId,
      resolutionStatus: "COMPLETE",
      unresolvedEvidence: [{ evidenceId: "code", necessity: "REQUIRED", reason: "MISSING" }],
      receiptRef, receiptDigest: receipt.receiptId,
      currentness: { status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:crafted" },
    });
    return crafted;
  })();
  verdict = classifyGrounding({ observation: w.observation, binding: contradictory });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("MISSING_CONTEXT"));

  // Unsupported currentness never grounds.
  verdict = classifyGrounding({
    observation: w.observation,
    binding: { ...structuredClone(binding), currentness: { status: "UNKNOWN", changedEvidenceIds: [], evaluatorIdentity: "test:x" } },
  });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("CURRENTNESS_UNVERIFIABLE"));

  // Malformed necessity fails closed as REQUIRED.
  verdict = classifyGrounding({
    observation: w.observation,
    binding: { ...structuredClone(binding), resolutionStatus: "PARTIAL", unresolvedEvidence: [{ evidenceId: "code", necessity: "WHATEVER", reason: "MISSING" }] },
  });
  assert.equal(verdict.status, "UNRESOLVED");
  assert.ok(verdict.reasons.includes("MISSING_CONTEXT"));

  // Malformed binding and observation shapes never ground and never throw.
  verdict = classifyGrounding({ observation: { facts: "not-an-array" }, binding });
  assert.equal(verdict.status, "UNRESOLVED");
  verdict = classifyGrounding({ observation: w.observation, binding: "not-an-object" });
  assert.equal(verdict.status, "UNRESOLVED");

  // Malformed fact proof never grounds even when the observation id matches:
  // unknown provenance and PROVENANCED facts without exact pins are
  // unprovenanced.
  for (const facts of [
    [{ factId: "fact:0", kind: "X", value: "v", evidenceRefs: [], provenance: "nonsense" }],
    [{ factId: "fact:0", kind: "X", value: "v", evidenceRefs: [], provenance: "PROVENANCED" }],
    [{ factId: "fact:0", kind: "X", value: "v", evidenceRefs: [{ ref: "plain-ref", digest: "0".repeat(64) }], provenance: "PROVENANCED" }],
  ]) {
    const malformed = { ...structuredClone(w.observation), facts };
    // Bypass the observation validator with a hand-built id: classification
    // alone must still refuse to ground malformed fact proof.
    malformed.observationId = w.observation.observationId;
    verdict = classifyGrounding({ observation: malformed, binding });
    assert.equal(verdict.status, "UNRESOLVED", JSON.stringify(facts));
    assert.ok(verdict.reasons.includes("MISSING_PROVENANCE"));
  }
});

test("end-to-end compatibility with the delivered Oracle store, receipt scheme and currentness", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-oracle-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  // Delivered owner machinery only: real resolution store, catalog and
  // durable coordinator produce the receipt through package-root contracts.
  const oracleStore = createResolutionStore({ path: join(dir, "oracle") });
  const catalog = createSourceCatalog({
    snapshotAuthorities: [{ sourceKind: "REPOSITORY", refPrefix: "", observe: async () => ({ snapshotRef: "h" }) }],
  });
  const req = defineContextRequirement({
    consumerRef: "worker",
    semanticNeed: "Understand code",
    evidence: [{ id: "code", necessity: "REQUIRED", need: "Read exact file", source: { kind: "REPOSITORY", ref: "repo", snapshot: { mode: "CURRENT" } } }],
    budget: { maxItems: 4, maxMaterializedBytes: 400000, maxProviderCalls: 4, maxResolutionSteps: 3 },
  });
  const coordinator = createDurableResolutionCoordinator({
    catalog,
    store: oracleStore,
    resolverConfiguration: { contractRevision: "c1", plannerRevision: "p1", materializationRevision: "m1", providerBindings: {} },
    resolveFresh: async (requirement) => defineContextResolution({
      requirementId: requirement.requirementId,
      step: { index: 0, previousResolutionId: null },
      status: "COMPLETE",
      items: [
        {
          evidenceId: "code", rank: 0,
          source: { kind: "REPOSITORY", ref: "repo", snapshotRef: "h", itemRef: "a" },
          currentness: { validators: [{ kind: "REVISION", value: "h", strength: "STRONG" }] },
          provenance: [], content: "c1",
        },
      ],
      unresolved: [],
      consumed: { items: 1, materializedBytes: 400000, providerCalls: 1, resolutionSteps: 1 },
    }, requirement),
  });
  const first = await coordinator.resolve(req);
  assert.equal(first.outcome, "PUBLISHED");
  // The delivered locator scheme is receipt://<semantic receiptId>.
  assert.match(first.receiptRef, /^receipt:\/\/[a-f0-9]{64}$/);
  assert.equal(first.receiptRef, `receipt://${first.receipt.receiptId}`);
  // The owner reader recomputes and validates the semantic digest.
  const reread = await oracleStore.readReceipt(first.receiptRef);
  assert.equal(reread.receiptId, first.receipt.receiptId);

  const w = await groundedWorld();
  // Minimal immutable query-only wrapper of the real delivered Oracle
  // store: only readReceipt is exposed, never the writer instance with
  // putReceipt/putResolution/publishReuseSlot.
  const readOnlyReader = (store) => Object.freeze({
    readReceipt: (ref) => store.readReceipt(ref),
  });
  // Real currentness composition: the delivered evaluator over the
  // coordinator's own pre-observations is CURRENT.
  const binder = createObservationContextBinder({
    artifactStore: w.store,
    receiptCurrentness: async (receipt) => evaluateReceiptCurrentness(receipt, first.preObservations),
    receiptReader: readOnlyReader(oracleStore),
  });
  const { binding, bindingRef } = await binder.bindObservationContext({
    observation: w.observation,
    observationRef: w.observationRef,
    requirement: req,
    resolution: first.resolution,
    receipt: first.receipt,
    receiptRef: first.receiptRef,
  });
  assert.equal(binding.receiptRef, first.receiptRef);
  assert.equal(binding.receiptDigest, first.receipt.receiptId);
  assert.equal(binding.currentness.status, "CURRENT");
  assert.deepEqual(classifyGrounding({ observation: w.observation, binding }), { status: "GROUNDED", reasons: [] });
  const stored = await w.store.resolve(bindingRef);
  assert.equal(stored.bindingId, binding.bindingId);

  // Drifted observations make the same delivered composition STALE.
  const drifted = structuredClone(first.preObservations);
  drifted[0].observed.snapshotRef = "drifted";
  const staleBinder = createObservationContextBinder({
    artifactStore: w.store,
    receiptCurrentness: async (receipt) => evaluateReceiptCurrentness(receipt, drifted),
    receiptReader: readOnlyReader(oracleStore),
  });
  const stale = await staleBinder.bindObservationContext({
    observation: w.observation,
    observationRef: w.observationRef,
    requirement: req,
    resolution: first.resolution,
    receipt: first.receipt,
    receiptRef: first.receiptRef,
  });
  const staleVerdict = classifyGrounding({ observation: w.observation, binding: stale.binding });
  assert.equal(staleVerdict.status, "UNRESOLVED");
  assert.ok(staleVerdict.reasons.includes("STALE_CONTEXT"));

  // A native locator for another digest is rejected even with the real receipt.
  await assert.rejects(
    () => binder.bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: first.resolution,
      receipt: first.receipt, receiptRef: `receipt://${"0".repeat(64)}`,
    }),
    /locator does not equal the receipt semantic digest/,
  );

  // A native locator with no stored bytes is rejected: readReceipt MISSING.
  const emptyStore = createResolutionStore({ path: join(dir, "oracle-empty") });
  const emptyBinder = createObservationContextBinder({
    artifactStore: w.store,
    receiptCurrentness: async () => ({ status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:lying" }),
    receiptReader: readOnlyReader(emptyStore),
  });
  await assert.rejects(
    () => emptyBinder.bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: first.resolution,
      receipt: first.receipt, receiptRef: first.receiptRef,
    }),
    /missing or corrupt/,
  );

  // A tampered supplied body retaining the receiptId is rejected against the
  // exact stored bytes.
  const tampered = { ...structuredClone(first.receipt), materializationId: "tampered" };
  await assert.rejects(
    () => binder.bindObservationContext({
      observation: w.observation, observationRef: w.observationRef,
      requirement: req, resolution: first.resolution,
      receipt: tampered, receiptRef: first.receiptRef,
    }),
    /exact stored receipt bytes/,
  );
});

test("binder rejects write/lifecycle-capable receipt readers before any reader or injector call", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-reader-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const w = await groundedWorld();
  let injectorCalls = 0;
  const injector = async () => {
    injectorCalls += 1;
    return { status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:must-not-run" };
  };
  // The actual full delivered writer-capable Oracle store instance exposes
  // putReceipt/putResolution/publishReuseSlot: it must be rejected as a
  // receiptReader even though readReceipt would succeed.
  const writerStore = createResolutionStore({ path: join(dir, "oracle") });
  assert.equal(typeof writerStore.putReceipt, "function");
  assert.equal(typeof writerStore.publishReuseSlot, "function");
  assert.throws(
    () => createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: injector, receiptReader: writerStore }),
    /forbidden write-capable method putReceipt/,
  );
  // A lifecycle authority port exposing dispatch/accept/recover/
  // compareAndSwap/publish alongside readReceipt is likewise rejected.
  let readerCalls = 0;
  const lifecyclePort = Object.freeze({
    readReceipt: async () => {
      readerCalls += 1;
      return null;
    },
    dispatch: async () => {},
    accept: async () => {},
    recover: async () => {},
    compareAndSwap: async () => {},
    publish: async () => {},
    claim: async () => {},
  });
  assert.throws(
    () => createObservationContextBinder({ artifactStore: w.store, receiptCurrentness: injector, receiptReader: lifecyclePort }),
    /forbidden write-capable method/,
  );
  // Rejection happens at construction: neither the reader nor the injector
  // was ever invoked.
  assert.equal(readerCalls, 0);
  assert.equal(injectorCalls, 0);
});
