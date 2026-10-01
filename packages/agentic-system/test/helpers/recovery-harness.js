// Deterministic adversarial-recovery harness (test-only).
//
// The harness injects kills and pauses ONLY at production durable boundaries
// (before/after lineage publication commits, around terminal attempt commits,
// inside stub runtime adapters) by wrapping test-owned seams. It never
// replaces a production CAS/currentness guard, never adds a lock around a
// production commit, and never sleeps: every pause is released by an explicit
// deterministic barrier rendezvous driven by the test itself.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthorityHeadStatus,
  ClaimReleaseStatus,
  claimReleaseSubjectKey,
  createApplicationOrchestrator,
  createCommittedPublicationReader,
  createDomainExecutionArtifactRegistry,
  createDomainExecutionController,
  createDomainExecutionPolicyPublisher,
  createJsonBlackboardStore,
  createJsonClaimReleaseStore,
  createJsonExecutionAttemptStore,
  createJsonImmutableArtifactStore,
  createOrganizationArtifactRegistry,
  createOrganizationAuthorityPublisher,
  createOrganizationWorkClaimController,
  createOrganizationWorkMaterializer,
  createSessionHandoffSurface,
  defineExecutionStrategyDescriptor,
  defineOrganizationWorkContract,
  executionAttemptSubjectKey,
  executionPolicySubjectKey,
  resolveExecutionJudgmentBundle,
} from "../../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../../src/domain-execution-store.js";
import {
  createJsonExecutionAuthorityPolicyStore,
  createJsonMaterializationAuthorizationStore,
} from "../../src/organization-authority-store.js";
import {
  createDomainPublicationGate,
  createDomainWriteAuthority,
} from "../../src/domain-write-authority.js";
import { createProductLineageStore, productRevision } from "../../src/product-lineage.js";

export const NOW = "2026-09-30T12:00:00.000Z";
export const hex = (seed) => createHash("sha256").update(String(seed)).digest("hex");

// Each opened cell is a distinct simulated process: its stub runtime stamps a
// cell-unique invocation id, so a fresh recovery never reproduces the crashed
// run's attestation bytes. Convergence must therefore come from committed
// publication/terminal reuse, never from byte-identical replay.
let cellSequence = 0;

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

// Rendezvous: `released` resolves once `size` parties have called `arrive()`.
// Used to force true overlap (both workers inside the crash window) without
// imposing any order on the production commits that follow.
export function rendezvous(size) {
  assert.ok(Number.isInteger(size) && size > 0, "rendezvous size must be positive");
  let count = 0;
  let open;
  const released = new Promise((resolve) => {
    open = resolve;
  });
  return {
    released,
    arrive() {
      count += 1;
      if (count >= size) open();
    },
  };
}

export async function withScratch(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  return dir;
}

// One directed crash. Throwing weakens the attempted write; it never adds
// serialization around production state.
export function crash(message = "simulated process crash") {
  const error = new Error(message);
  error.code = "SIMULATED_CRASH";
  return error;
}

// ---------------------------------------------------------------------------
// Execution cell: one domain over file-backed durable stores with the REAL
// domain write authority, REAL lineage-backed publication gate and REAL
// execution controller. Kill switches:
//   kill.beforePublicationCommits: throw this many publish attempts before the
//     lineage commit (crash after domain output, before publication).
//   kill.terminalCommits: when true, every attempt-head transition to TERMINAL
//     throws (crash after publication, before terminal commit/continuation).
//   hooks.beforeRuntime / hooks.afterRuntime: deterministic pauses inside the
//     test-owned stub runtime adapter (pauses test code, not production).
//   hooks.beforeTerminalCas: deterministic pause inside the harness attempt
//     CAS wrapper before the production call (still no production lock held).
//   The wrapper keeps attemptCasLog (wrapper-in/production/wrapper-out) proving
//     1:1 transparent delegation to the production CAS function.
// A "fresh process" is a brand-new cell reopened over the same directory with
// fresh counters and no shared memory: `reopenExecutionCell(dir, seed)`.
// ---------------------------------------------------------------------------
export const EXEC_DOMAIN = "BUSINESS_ANALYSIS";
export const EXEC_WORKLOAD = "requirements-analysis";

export async function openExecutionCell(dir, seed, { kill = {}, hooks = {} } = {}) {
  const runtimeNonce = `cell-process-${++cellSequence}`;
  const killState = {
    beforePublicationCommits: kill.beforePublicationCommits ?? 0,
    terminalCommits: kill.terminalCommits ?? false,
  };
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const org = createOrganizationArtifactRegistry({ store: immutable });
  const domain = createDomainExecutionArtifactRegistry({ store: immutable });
  const releaseStore = createJsonClaimReleaseStore({ path: join(dir, "release-heads.json") });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  const attemptRaw = createJsonExecutionAttemptStore({ path: join(dir, "attempt-heads.json") });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore: immutable });
  const writeAuthority = createDomainWriteAuthority({
    path: join(dir, "writers.json"),
    artifactStore: immutable,
    policyAuthority: {
      async verifyDomainWriteAuthorityPublisher() {
        return { authorityRef: "write-policy-admin" };
      },
    },
  });
  const principal = `principal:${seed}-worker`;
  await writeAuthority.publish({
    publisher: "admin",
    policy: {
      domain: EXEC_DOMAIN,
      generation: 1,
      principalRefs: [principal],
      semanticKinds: ["requirement"],
      obligations: [],
    },
  }).catch((error) => {
    if (!/must advance/.test(error.message)) throw error;
  });

  const counts = { dispatch: 0, recover: 0, lineagePublications: 0, reconciliations: 0, publishAttempts: 0 };
  // Idempotent runtime outputs are a deterministic function of the durable
  // WorkContract (expectedOutputRefs), never process memory: a fresh process
  // reproduces the same outputs for the same binding.
  const outputFor = (input) => {
    if (hooks.outputFor) return hooks.outputFor(input);
    const refs = input.contract?.expectedOutputRefs ?? [];
    return refs.map((ref) => ({ ref, digest: String(ref).split(":").at(-1) }));
  };
  const recordFor = (subjectKey, content) =>
    productRevision({
      kind: "SEMANTIC_CLAIM",
      projectId: "project-1",
      rootIntentId: "INTENT-1",
      domain: EXEC_DOMAIN,
      semanticKind: "requirement",
      subjectKey,
      content,
    });

  async function addWork({ key, subjectKey = `req-${key}`, content = `requirement ${key}` }) {
    const record = recordFor(subjectKey, content);    await immutable.put("semantic-claim", record.value);
    const contract = defineOrganizationWorkContract({
      projectId: "project-1",
      rootItemId: "ROOT-1",
      rootIntentId: "INTENT-1",
      acceptedDecisionRef: "decision:accepted",
      materializationAuthorizationId: "mat-auth-1",
      materializationAuthorizationRef: `materialization-authorization:sha256:${hex("mat")}`,
      materializationAuthorizationGeneration: 1,
      materializationAuthorizationRevision: "mat-rev-1",
      authorityPolicyRevision: "authority-policy-1",
      implementationArtifactRef: `implementation-input:${key}`,
      sliceId: `slice-${key}`,
      obligationKey: `obligation-${key}`,
      obligationSubjectKey: `obligation-subject-${key}`,
      materializationKey: `materialization-${key}`,
      boardItemId: key,
      owningDomain: EXEC_DOMAIN,
      workloadType: EXEC_WORKLOAD,
      summary: `Requirement work ${key}`,
      dependencyIds: [],
      requiredArtifactRefs: [],
      expectedArtifactKind: "REQUIREMENT_SET",
      expectedOutputRefs: [record.ref],
      acceptanceRefs: [`acceptance:${key}`],
    });
    await org.putWorkContract(contract);
    const receipt = {
      kind: "CLAIM_RELEASE_RECEIPT",
      version: 1,
      projectId: contract.projectId,
      rootItemId: contract.rootItemId,
      rootIntentId: contract.rootIntentId,
      itemId: key,
      claimGeneration: 1,
      workContractRef: contract.contractRef,
      boardOwner: `${seed}-worker`,
      principalRef: principal,
    };
    const receiptRef = await org.putClaimReleaseReceipt(receipt);
    await releaseStore
      .compareAndSwap(claimReleaseSubjectKey(contract.projectId, key, 1), null, {
        status: ClaimReleaseStatus.RELEASED,
        receiptRef,
      })
      .then((ok) => {
        if (!ok) throw new Error("claim release CAS conflict in harness");
      });
    const policyKey = executionPolicySubjectKey(EXEC_DOMAIN, EXEC_WORKLOAD);
    if (!(await policyStore.current(policyKey))) {
      const strategyRef = await domain.putExecutionStrategyDescriptor(
        defineExecutionStrategyDescriptor({
          strategyId: "ba.application-core-loop",
          strategyVersion: "1.0.0",
          strategyKind: "application-core-loop",
          compatibleWorkloadTypes: [EXEC_WORKLOAD],
          compatibleWorkContractVersions: [1],
          adapterRef: "adapter:ba-core-loop@1",
          runtimeBindingMode: "IMMUTABLE_LOCAL",
          expectedRuntimeCodeRef: `git:sha256:${hex("ba-runtime")}`,
          contextRefs: [],
          toolsetRef: null,
          modelProfileRef: null,
          harnessRef: null,
        }),
      );
      await createDomainExecutionPolicyPublisher({
        policyAuthority: {
          async verifyExecutionPolicyPublisher() {
            return { authorityRef: "authority:domain-policy-publisher" };
          },
        },
        artifactRegistry: domain,
        executionPolicyStore: policyStore,
      }).publish({
        publisher: { identity: "policy-admin" },
        policy: {
          policyId: policyKey,
          generation: 1,
          status: "ACTIVE",
          domain: EXEC_DOMAIN,
          workloadType: EXEC_WORKLOAD,
          compatibleWorkContractVersions: [1],
          strategyRef,
        },
      });
    }
    const output = { ref: record.ref, digest: record.ref.split(":").at(-1) };
    return { contract, receiptRef, record, output };
  }

  const runtimeAdapter = {
    adapterRef: "adapter:ba-core-loop@1",
    runtimeKind: "local-process",
    runtimeDeploymentRef: `git:sha256:${hex("ba-runtime")}`,
    producerAuthorityRef: "authority:trusted-runtime",
    async dispatch(input) {
      counts.dispatch += 1;
      if (hooks.beforeRuntime) await hooks.beforeRuntime(input);
      const result = {
        status: "SUCCEEDED",
        runtimeInvocationId: `invocation:${runtimeNonce}:${input.runtimeInvocationKey}`,
        startedAt: NOW,
        finishedAt: NOW,
        effectRefs: [],
        traceRefs: [],
        outputArtifactRefs: outputFor(input),
        verificationCandidateRefs: [],
        counterevidenceRefs: [],
        proposedDerivationEdges: [],
      };
      if (hooks.afterRuntime) await hooks.afterRuntime(input, result);
      return result;
    },
    async recover(input) {
      counts.recover += 1;
      if (hooks.beforeRuntime) await hooks.beforeRuntime(input);
      const result = {
        status: "SUCCEEDED",
        runtimeInvocationId: `invocation:${runtimeNonce}:${input.runtimeInvocationKey}`,
        startedAt: NOW,
        finishedAt: NOW,
        effectRefs: [],
        traceRefs: [],
        outputArtifactRefs: outputFor(input),
        verificationCandidateRefs: [],
        counterevidenceRefs: [],
        proposedDerivationEdges: [],
      };
      if (hooks.afterRuntime) await hooks.afterRuntime(input, result);
      return result;
    },
  };

  const completionEvaluator = {
    authorityRef: "authority:ba-completion",
    async evaluate() {
      return {
        verdict: "ACCEPT",
        criterionResults: [{ criterionId: "requirements-complete", verdict: "PASS", evidenceRefs: [] }],
        counterevidenceRefs: [],
      };
    },
  };
  const gate = createDomainPublicationGate({
    writeAuthority,
    lineage,
    artifactRegistry: domain,
    resolveProductOutput: (ref) => immutable.resolve(ref),
    producerPrincipalRef: principal,
    reconcileWork: async () => {
      counts.reconciliations += 1;
      if (hooks.reconcileWork) await hooks.reconcileWork();
    },
  });
  const publicationGate = {
    ...gate,
    async publishIdempotent(args) {
      counts.publishAttempts += 1;
      if (killState.beforePublicationCommits > 0) {
        killState.beforePublicationCommits -= 1;
        throw crash("simulated kill after domain output before publication commit");
      }
      const before = Object.keys((await lineage.snapshot()).publications).length;
      const result = await gate.publishIdempotent(args);
      const after = Object.keys((await lineage.snapshot()).publications).length;
      if (after > before) counts.lineagePublications += 1;
      return result;
    },
  };
  const claimController = {
    async assertExecutable() {
      return true;
    },
    async withExecutablePublicationGuard(args, action) {
      // Durable truth only: the receipt is content-addressed, so a fresh
      // process recovers the exact work-contract ref without memory.
      const receipt = await org.resolveClaimReleaseReceipt(args.receiptRef);
      assert.ok(receipt && receipt.itemId === args.itemId, `claim receipt mismatch for ${args.itemId}`);
      return {
        result: await action({
          workContractRef: receipt.workContractRef,
          claimRelease: { receiptRef: args.receiptRef },
        }),
      };
    },
  };
  const attemptCasLog = [];
  const productionCompareAndSwap = attemptRaw.compareAndSwap.bind(attemptRaw);
  const attemptStore = {
    current: (key) => attemptRaw.current(key),
    async compareAndSwap(key, expected, next) {
      // Delegation log for transparency proofs: one wrapper-in entry per
      // call, exactly one production entry with identical arguments, and one
      // wrapper-out entry carrying the unchanged production result. Any raise
      // inside the wrapper would break the 1:1:1 balance.
      attemptCasLog.push({ side: "wrapper-in", key, expected, next: structuredClone(next) });
      if (hooks.beforeTerminalCas && next?.status === "TERMINAL") await hooks.beforeTerminalCas({ key, expected, next });
      if (killState.terminalCommits && next?.status === "TERMINAL") {
        throw crash("simulated kill after publication before terminal commit");
      }
      const result = await productionCompareAndSwap(key, expected, next).catch((error) => {
        // Production contention (e.g. the file lock held by a concurrent
        // worker) is logged and rethrown unchanged: the wrapper never
        // invents its own failure.
        attemptCasLog.push({ side: "production", key, expected, next: structuredClone(next), error: String(error?.message ?? error) });
        throw error;
      });
      attemptCasLog.push({ side: "production", key, expected, next: structuredClone(next), result });
      attemptCasLog.push({ side: "wrapper-out", result });
      return result;
    },
  };
  const committedPublications = createCommittedPublicationReader({ lineage, artifactRegistry: domain });
  const controller = createDomainExecutionController({
    claimController,
    claimReleaseStore: releaseStore,
    organizationArtifactRegistry: org,
    artifactRegistry: domain,
    executionPolicyStore: policyStore,
    executionAttemptStore: attemptStore,
    runtimeAdapter,
    completionEvaluator,
    publicationGate,
    committedPublications,
  });

  return {
    dir,
    seed,
    principal,
    immutable,
    org,
    domain,
    lineage,
    gate: publicationGate,
    committedPublications,
    controller,
    claimController,
    counts,
    killState,
    attemptCasLog,
    addWork,
    recordFor,
    attemptSubjectKey: (contract) =>
      executionAttemptSubjectKey({
        projectId: contract.projectId,
        itemId: contract.boardItemId,
        workContractRef: contract.contractRef,
      }),
    async readAttemptHead(contract) {
      return attemptRaw.current(
        executionAttemptSubjectKey({
          projectId: contract.projectId,
          itemId: contract.boardItemId,
          workContractRef: contract.contractRef,
        }),
      );
    },
    async resolveBundle(result) {
      return resolveExecutionJudgmentBundle({
        artifactRegistry: domain,
        organizationArtifactRegistry: org,
        bundleRef: result.judgmentBundleRef,
      });
    },
  };
}

// Fresh process: brand-new controllers, stores and counters over the same
// durable directory. No in-memory state is carried across.
export async function reopenExecutionCell(dir, seed, options = {}) {
  return openExecutionCell(dir, seed, options);
}

// ---------------------------------------------------------------------------
// Claim cell: REAL Board, REAL materializer and REAL organization claim
// controller for one BACKEND principal, plus a thin execution stack whose
// stub runtime never runs when the real claim guards fence a stale
// generation. Used to prove claim-generation takeover fencing before
// dispatch and before publication.
// ---------------------------------------------------------------------------
const CLAIM_PRINCIPAL = { identity: "be-1", principalRef: "principal://be-1" };

export async function openClaimCell(t, prefix = "exharness-bb057-claim-") {
  const dir = await withScratch(t, prefix);
  const reviewTrust = {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; },
  };
  const orchestrator = createApplicationOrchestrator({
    store: createJsonBlackboardStore({ path: join(dir, "board.json") }),
    reviewTrust,
  });
  await createSessionHandoffSurface({ orchestrator, projectId: "project-1" }).initialize({
    userIntent: { id: "root", source: "USER", objective: "Build product", bullets: [], constraints: [] },
    items: [],
  });
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const org = createOrganizationArtifactRegistry({ store: artifactStore });
  const domain = createDomainExecutionArtifactRegistry({ store: artifactStore });
  const materializationAuthorizationStore = createJsonMaterializationAuthorizationStore({
    path: join(dir, "materialization.json"),
  });
  const executionAuthorityPolicyStore = createJsonExecutionAuthorityPolicyStore({
    path: join(dir, "execution-authority.json"),
  });
  const claimReleaseStore = createJsonClaimReleaseStore({ path: join(dir, "release.json") });
  const admin = { identity: "authority-admin" };
  const authorityPublisher = createOrganizationAuthorityPublisher({
    organizationAuthority: {
      verifyMaterializationAuthorizationIssuer: async ({ publisher }) =>
        publisher.identity === admin.identity ? { authorityRef: "authority://organization-admin" } : null,
      verifyExecutionAuthorityPolicyPublisher: async ({ publisher }) =>
        publisher.identity === admin.identity ? { authorityRef: "authority://organization-admin"} : null,
    },
    artifactRegistry: org,
    materializationAuthorizationStore,
    executionAuthorityPolicyStore,
  });
  await authorityPublisher.publishExecutionAuthorityPolicy({
    publisher: admin,
    policy: {
      policyId: "organization-execution-authority",
      projectId: "project-1",
      authorityPolicyRevision: "organization-authority-policy:v1",
      generation: 1,
      status: AuthorityHeadStatus.ACTIVE,
      bindings: [{ principalRef: CLAIM_PRINCIPAL.principalRef, authorizedDomains: ["BACKEND"] }],
    },
  });
  const executionPrincipalProvider = {
    async resolve() { return CLAIM_PRINCIPAL; },
    async resolveByIdentity(identity) {
      assert.equal(identity, CLAIM_PRINCIPAL.identity);
      return CLAIM_PRINCIPAL;
    },
  };
  const materializer = createOrganizationWorkMaterializer({
    orchestrator,
    materializationAuthorizationStore,
    artifactRegistry: org,
  });
  const claimController = createOrganizationWorkClaimController({
    orchestrator,
    materializationAuthorizationStore,
    executionAuthorityPolicyStore,
    claimReleaseStore,
    artifactRegistry: org,
    executionPrincipalProvider,
    executionAuthorityPolicyId: "organization-execution-authority",
  });

  async function addWork({ key }) {
    const authorizationId = `auth:${key}`;
    await authorityPublisher.publishMaterializationAuthorization({
      publisher: admin,
      authorization: {
        authorizationId,
        projectId: "project-1",
        rootIntentId: "root",
        authorityPolicyRevision: "organization-authority-policy:v1",
        generation: 1,
        status: AuthorityHeadStatus.ACTIVE,
        acceptedDecisionRef: "decision://accepted-1",
        implementationArtifactRef: `artifact://${key}`,
        authorizedSliceIds: [key],
        authorizedObligationKeys: [key],
        owningDomain: "BACKEND",
        workloadType: "backend-change",
      },
    });
    return materializer.materialize({
      authorizationId,
      decision: { ref: "decision://accepted-1", obligationKeys: [key] },
      obligation: {
        key,
        sliceId: key,
        summary: `Implement ${key}`,
        owningDomain: "BACKEND",
        workloadType: "backend-change",
        dependencyIds: [],
        requiredArtifactRefs: [],
        expectedArtifactKind: "BACKEND_CHANGE",
        expectedOutputRefs: [],
        acceptanceRefs: [`acceptance://${key}`],
      },
    });
  }

  const counts = { dispatches: 0, publications: 0 };
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy.json") });
  const attemptStore = createJsonExecutionAttemptStore({ path: join(dir, "attempts.json") });
  const strategyRef = await domain.putExecutionStrategyDescriptor(
    defineExecutionStrategyDescriptor({
      strategyId: "backend.application",
      strategyVersion: "1.0.0",
      strategyKind: "application-core-loop",
      compatibleWorkloadTypes: ["backend-change"],
      compatibleWorkContractVersions: [1],
      adapterRef: "adapter:backend@1",
      runtimeBindingMode: "IMMUTABLE_LOCAL",
      expectedRuntimeCodeRef: `git:sha256:${hex("backend-runtime")}`,
      contextRefs: [],
      toolsetRef: null,
      modelProfileRef: null,
      harnessRef: null,
    }),
  );
  const policyKey = executionPolicySubjectKey("BACKEND", "backend-change");
  await createDomainExecutionPolicyPublisher({
    policyAuthority: {
      async verifyExecutionPolicyPublisher() {
        return { authorityRef: "authority:backend-policy" };
      },
    },
    artifactRegistry: domain,
    executionPolicyStore: policyStore,
  }).publish({
    publisher: { identity: "policy-admin" },
    policy: {
      policyId: policyKey,
      generation: 1,
      status: "ACTIVE",
      domain: "BACKEND",
      workloadType: "backend-change",
      compatibleWorkContractVersions: [1],
      strategyRef,
    },
  });
  const runtimeAdapter = {
    adapterRef: "adapter:backend@1",
    runtimeKind: "local-process",
    runtimeDeploymentRef: `git:sha256:${hex("backend-runtime")}`,
    producerAuthorityRef: "authority:backend-runtime",
    async dispatch() {
      counts.dispatches += 1;
      return {
        status: "SUCCEEDED", runtimeInvocationId: "invocation:backend", startedAt: NOW, finishedAt: NOW,
        effectRefs: [], traceRefs: [], outputArtifactRefs: [], verificationCandidateRefs: [],
        counterevidenceRefs: [], proposedDerivationEdges: [],
      };
    },
    async recover() {
      counts.dispatches += 1;
      return {
        status: "SUCCEEDED", runtimeInvocationId: "invocation:backend-recover", startedAt: NOW, finishedAt: NOW,
        effectRefs: [], traceRefs: [], outputArtifactRefs: [], verificationCandidateRefs: [],
        counterevidenceRefs: [], proposedDerivationEdges: [],
      };
    },
  };
  const published = new Map();
  const publicationGate = {
    authorityRef: "authority:backend-writer",
    producerPrincipalRef: CLAIM_PRINCIPAL.principalRef,
    async withCurrentWriteAuthority(scope, action) {
      assert.equal(scope.domain, "BACKEND");
      return action({ authorityRef: "authority:backend-writer", revision: "backend-writer:1" });
    },
    async publishIdempotent(args) {
      if (published.has(args.publicationKey)) return published.get(args.publicationKey);
      counts.publications += 1;
      const result = {
        publicationKey: args.publicationKey,
        publishedArtifactRefs: args.outcome.outputArtifactRefs,
        publishedClaimRefs: [],
        acceptedDerivationEdges: args.outcome.proposedDerivationEdges,
        publicationStoreRevision: "backend-store:1",
      };
      published.set(args.publicationKey, result);
      return result;
    },
  };
  const completionEvaluator = {
    authorityRef: "authority:backend-completion",
    async evaluate({ outcome }) {
      const pass = outcome.status === "SUCCEEDED";
      return {
        verdict: pass ? "ACCEPT" : "BLOCKED",
        criterionResults: [{ criterionId: "backend-complete", verdict: pass ? "PASS" : "FAIL", evidenceRefs: [] }],
        counterevidenceRefs: [],
      };
    },
  };
  const executionController = createDomainExecutionController({
    claimController,
    claimReleaseStore,
    organizationArtifactRegistry: org,
    artifactRegistry: domain,
    executionPolicyStore: policyStore,
    executionAttemptStore: attemptStore,
    runtimeAdapter,
    completionEvaluator,
    publicationGate,
  });
  const item = async (id) => (await orchestrator.readBlackboard()).items.find((entry) => entry.id === id);
  return {
    dir, orchestrator, org, domain, claimController, executionController, counts, addWork, item,
    principalContext: {},
  };
}

// INV-1 probe: local recovery surfaces must not expose central scheduling or
// global reset authority.
export function assertNoCentralRecoveryAuthority(surfaces) {
  for (const [name, surface] of Object.entries(surfaces)) {
    assert.ok(surface && typeof surface === "object", `${name} surface required`);
    for (const forbidden of [
      "schedule",
      "scheduleNext",
      "nextRole",
      "nextDomain",
      "reset",
      "resetAll",
      "rerunAll",
      "rebuildAll",
      "recoverAll",
      "globalOrder",
      "manualOrder",
      "chooseWork",
      "selectNext",
    ]) {
      assert.equal(
        forbidden in Object(surface),
        false,
        `${name} must not expose central recovery/scheduling authority (${forbidden})`,
      );
    }
  }
}
