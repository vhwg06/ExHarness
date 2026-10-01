import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createDomainExecutionArtifactRegistry } from "../src/domain-execution-store.js";
import { createGroundedObservationProjector, buildGroundedFindingInput } from "../src/grounded-observation.js";
import { createObservationContextBinder } from "../src/observation-context-binding.js";
import { defineContextRequirement, defineContextResolution, defineContextResolutionReceipt, reuseKey } from "../../oracle/src/index.js";

const execFileAsync = promisify(execFile);
const BUDGET = { maxItems: 4, maxMaterializedBytes: 4096, maxProviderCalls: 4, maxResolutionSteps: 3 };

function subjectFor(generation) {
  return {
    kind: "CAUSAL_OBSERVATION_SUBJECT",
    version: 1,
    mode: generation === 2 ? "HISTORICAL" : "CURRENT",
    productId: "product-1",
    rootIntentRef: "intent:root-1",
    historyGeneration: generation,
    historyDigest: generation === 2 ? "h".repeat(64) : "n".repeat(64),
    historyCommitRef: `history-commit:sha256:${generation === 2 ? "a".repeat(64) : "c".repeat(64)}`,
    policyRef: "policy:1",
    policyRevision: 1,
    waiverRefs: [],
    waiverSetDigest: "w".repeat(64),
    projectionRef: `projection:sha256:${generation === 2 ? "b".repeat(64) : "d".repeat(64)}`,
  };
}

function requirement() {
  return defineContextRequirement({
    consumerRef: "worker",
    semanticNeed: "Understand code",
    evidence: [{ id: "code", necessity: "REQUIRED", need: "Read exact file", source: { kind: "REPOSITORY", ref: "repo", snapshot: { mode: "EXACT", ref: "rev-1" }, itemRefs: ["src/a.js"] } }],
    budget: BUDGET,
  });
}
function resolution(req) {
  return defineContextResolution(
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
}
function receipt(req, res) {
  const configDigest = "b".repeat(64);
  const sourceObservations = [
    {
      evidenceId: "code",
      source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
      observed: { state: "PRESENT", snapshotRef: "s1" },
    },
  ];
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

const CHILD_SCRIPT = `
import { readFile } from "node:fs/promises";
import { createJsonImmutableArtifactStore } from "__STORE_SPEC__";
import { createDomainExecutionArtifactRegistry } from "__DOMAIN_SPEC__";
import { createGroundedObservationProjector, buildGroundedFindingInput } from "__GROUNDED_SPEC__";
import { createObservationContextBinder } from "__BINDING_SPEC__";

const [fixturePath, storePath] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const store = createJsonImmutableArtifactStore({ path: storePath });
const registries = createDomainExecutionArtifactRegistry({ store });
const observer = {
  async queryHistorical() { return { mode: "HISTORICAL", subject: fixture.subject }; },
  async queryCurrent() { return { mode: "CURRENT", subject: fixture.subject }; },
  async chainEvidence() { return fixture.chain; },
  async describeExecution(args) {
    if (!args || typeof args.workId !== "string") throw new TypeError("describeExecution requires work coordinates");
    return { executionAttemptId: fixture.executionAttemptId, runtimeAttestationRef: fixture.attestationRef, runtimeInvocations: [{ attestationRef: fixture.attestationRef }] };
  },
  async explainWhyNotDone() { return {}; },
  async listRemainingWork() { return []; },
  async traceObligation() { return {}; },
  async measureTiming() { return {}; },
};
await store.put("quality-acceptance", fixture.qa);
await store.put(fixture.bindingKind, fixture.binding);
await store.put(fixture.attestationKind, { ...fixture.attestation, bindingRef: fixture.attestation.bindingRef ?? fixture.bindingRef });
await store.put("context-resolution-receipt", fixture.receipt);
const projector = createGroundedObservationProjector({ observer, artifactRegistry: registries, artifactStore: store });
const { observation, observationRef } = await projector.projectObservation({
  subject: fixture.subject,
  workId: fixture.workId,
  workContractRef: fixture.workContractRef,
  projectId: fixture.projectId,
  bindingRef: fixture.bindingRef,
  attestationRefs: [fixture.attestationRef],
});
const binder = createObservationContextBinder({
  artifactStore: store,
  receiptCurrentness: async () => ({ status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:static-currentness" }),
});
const { binding, bindingRef } = await binder.bindObservationContext({
  observation,
  observationRef,
  requirement: fixture.requirement,
  resolution: fixture.resolution,
  receipt: fixture.receipt,
  receiptRef: fixture.receiptRef,
});
const observationDigest = observationRef.match(/:sha256:([a-f0-9]{64})$/)?.[1];
const bindingDigest = bindingRef.match(/:sha256:([a-f0-9]{64})$/)?.[1];
const { input, inputRef } = await buildGroundedFindingInput(
  {
    observationRefs: [{ ref: observationRef, digest: observationDigest }],
    contextBindingRef: bindingRef,
    groundingStatus: "GROUNDED",
    unresolvedReasons: [],
    uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
  },
  { artifactStore: store },
);
void bindingDigest;
console.log(JSON.stringify({ observationId: observation.observationId, observationRef, bindingId: binding.bindingId, bindingRef, inputId: input.inputId, inputRef }));
`;

test("fresh process rebuild from the same pinned subject yields identical identities", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-fresh-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const store = createJsonImmutableArtifactStore({ path: join(dir, "parent-artifacts.json") });
  const qa = { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-1" };
  const qaRef = await store.put("quality-acceptance", qa);
  const subject = subjectFor(2);
  const chain = [{ factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, subject.projectionRef] }];
  const bindingValue = {
    kind: "EXECUTION_ATTEMPT_BINDING",
    version: 1,
    executionAttemptId: "execution-attempt-id:fresh-1",
    workId: "work-1",
  };
  const registries = createDomainExecutionArtifactRegistry({ store });
  const bindingRef = await registries.putExecutionAttemptBinding(bindingValue);
  const attestationValue = {
    kind: "RUNTIME_EXECUTION_ATTESTATION",
    version: 1,
    executionAttemptId: "execution-attempt-id:fresh-1",
    bindingRef,
    runtimeInvocationId: "runtime-invocation-fresh-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  };
  const attestationRef = await registries.putRuntimeExecutionAttestation(attestationValue);
  const observer = {
    async queryHistorical() {
      return { mode: "HISTORICAL", subject };
    },
    async queryCurrent() {
      return { mode: "CURRENT", subject };
    },
    async chainEvidence() {
      return structuredClone(chain);
    },
    async describeExecution(args) {
      if (!args || typeof args.workId !== "string") throw new TypeError("describeExecution requires work coordinates");
      return { executionAttemptId: "execution-attempt-id:fresh-1", runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
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
  };
  const projector = createGroundedObservationProjector({ observer, artifactRegistry: registries, artifactStore: store });
  const { observation, observationRef } = await projector.projectObservation({
    subject,
    workId: "work-1",
    workContractRef: "contract:1",
    projectId: "product-1",
    bindingRef,
    attestationRefs: [attestationRef],
  });
  const req = requirement();
  const res = resolution(req);
  const rec = receipt(req, res);
  const recRef = await store.put("context-resolution-receipt", structuredClone(rec));
  const binder = createObservationContextBinder({
    artifactStore: store,
    receiptCurrentness: async () => ({ status: "CURRENT", changedEvidenceIds: [], evaluatorIdentity: "test:static-currentness" }),
  });
  const { binding, bindingRef: contextBindingRef } = await binder.bindObservationContext({
    observation,
    observationRef,
    requirement: req,
    resolution: res,
    receipt: rec,
    receiptRef: recRef,
  });
  const observationDigest = observationRef.match(/:sha256:([a-f0-9]{64})$/)[1];
  const { input, inputRef } = await buildGroundedFindingInput(
    {
      observationRefs: [{ ref: observationRef, digest: observationDigest }],
      contextBindingRef,
      groundingStatus: "GROUNDED",
      unresolvedReasons: [],
      uncertainty: { missingProvenanceFactIds: [], unresolvedEvidenceIds: [], optionalUnresolvedEvidenceIds: [] },
    },
    { artifactStore: store },
  );

  // Simulate store loss: delete nothing on disk for the parent, but hand the
  // child only the pinned fixture so it must rebuild from durable content.
  const fixturePath = join(dir, "fixture.json");
  await writeFile(
    fixturePath,
    JSON.stringify({ subject, chain, qa, workId: "work-1", workContractRef: "contract:1", projectId: "product-1", executionAttemptId: "execution-attempt-id:fresh-1", bindingKind: "execution-attempt-binding", binding: bindingValue, bindingRef, attestationKind: "runtime-execution-attestation", attestation: attestationValue, attestationRef, requirement: req, resolution: res, receipt: rec, receiptRef: recRef }),
  );
  const childPath = join(dir, "rebuild-child.mjs");
  const root = new URL("../../..", import.meta.url).pathname;
  const childScript = CHILD_SCRIPT.replaceAll("__STORE_SPEC__", `${root}/packages/agentic-system/src/organization-artifact-store.js`)
    .replaceAll("__DOMAIN_SPEC__", `${root}/packages/agentic-system/src/domain-execution-store.js`)
    .replaceAll("__GROUNDED_SPEC__", `${root}/packages/agentic-system/src/grounded-observation.js`)
    .replaceAll("__BINDING_SPEC__", `${root}/packages/agentic-system/src/observation-context-binding.js`);
  await writeFile(childPath, childScript);
  const { stdout } = await execFileAsync(process.execPath, [childPath, fixturePath, join(dir, "child-artifacts.json")]);
  const rebuilt = JSON.parse(stdout.trim());
  assert.equal(rebuilt.observationId, observation.observationId);
  assert.equal(rebuilt.observationRef, observationRef);
  assert.equal(rebuilt.bindingId, binding.bindingId);
  assert.equal(rebuilt.bindingRef, contextBindingRef);
  assert.equal(rebuilt.inputId, input.inputId);
  assert.equal(rebuilt.inputRef, inputRef);
});

test("historical rebuild after newer heads keeps original ids; CURRENT head yields a new subject", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-generations-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const store = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const qaRef = await store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-1" });
  const qaRef2 = await store.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, env: "env-2" });
  const historicalSubject = subjectFor(2);
  const currentSubject = subjectFor(3);
  // The observer serves pinned facts per subject generation: newer canonical
  // heads never leak into the historical pin.
  const factsByGeneration = {
    2: [{ factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, historicalSubject.projectionRef] }],
    3: [
      { factKind: "QUALITY_ACCEPTANCE", ref: qaRef, evidenceRefs: [qaRef, currentSubject.projectionRef] },
      { factKind: "QUALITY_ACCEPTANCE", ref: qaRef2, evidenceRefs: [qaRef2, currentSubject.projectionRef] },
    ],
  };
  const registries = createDomainExecutionArtifactRegistry({ store });
  const bindingRef = await registries.putExecutionAttemptBinding({ kind: "EXECUTION_ATTEMPT_BINDING", version: 1, executionAttemptId: "execution-attempt-id:gen-1", workId: "work-1" });
  const attestationRef = await registries.putRuntimeExecutionAttestation({
    kind: "RUNTIME_EXECUTION_ATTESTATION",
    version: 1,
    executionAttemptId: "execution-attempt-id:gen-1",
    bindingRef,
    runtimeInvocationId: "runtime-invocation-gen-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
  });
  const observerFor = () => ({
    async queryHistorical({ subject }) {
      return { mode: "HISTORICAL", subject };
    },
    async queryCurrent() {
      return { mode: "CURRENT", subject: currentSubject };
    },
    async chainEvidence({ subject }) {
      return structuredClone(factsByGeneration[subject.historyGeneration] ?? []);
    },
    async describeExecution(args) {
      if (!args || typeof args.workId !== "string") throw new TypeError("describeExecution requires work coordinates");
      return { executionAttemptId: "execution-attempt-id:gen-1", runtimeAttestationRef: attestationRef, runtimeInvocations: [{ attestationRef }] };
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
  const projector = createGroundedObservationProjector({ observer: observerFor(), artifactRegistry: registries, artifactStore: store });
  const coords = { workId: "work-1", workContractRef: "contract:1", projectId: "product-1" };
  const first = await projector.projectObservation({ ...coords, subject: historicalSubject, bindingRef, attestationRefs: [attestationRef] });
  // Newer canonical heads arrive; rebuild the historical pin verbatim.
  const rebuilt = await projector.projectObservation({ ...coords, subject: historicalSubject, bindingRef, attestationRefs: [attestationRef] });
  assert.equal(rebuilt.observation.observationId, first.observation.observationId);
  assert.equal(rebuilt.observationRef, first.observationRef);
  // A CURRENT query after the transition pins a new subject and never mixes facts.
  const current = await projector.projectObservation({ ...coords, subject: currentSubject, bindingRef, attestationRefs: [attestationRef] });
  assert.notEqual(current.observation.observationId, first.observation.observationId);
  assert.equal(current.observation.facts.length, 2);
  assert.equal(first.observation.facts.length, 1);
  assert.ok(!first.observation.facts.some((f) => f.value === qaRef2));
});
