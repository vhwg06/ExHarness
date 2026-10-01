// Adversarial QA/closure recovery: deployment drift blocks stale acceptance
// while historical evidence stays immutable, and closure racing upstream
// supersession never leaves a stale outcome current (AC-5, AC-6). Pauses are
// explicit barriers; no sleeps, no test-only locks.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaimReleaseStatus, claimReleaseSubjectKey, createDomainExecutionArtifactRegistry, createDomainExecutionController,
  createDomainExecutionPolicyPublisher, createJsonClaimReleaseStore, createJsonExecutionAttemptStore,
  createJsonImmutableArtifactStore, createOrganizationArtifactRegistry, defineExecutionStrategyDescriptor,
  defineOrganizationWorkContract, executionPolicySubjectKey,
  createDeploymentArtifactRegistry, publishDeployableArtifact, createDevOpsExecutionStrategy, DEVOPS_DOMAIN,
  createDeploymentReleaseController, createDeploymentMutationGuard, createAcceptancePolicyResolver, createAcceptanceSnapshotBuilder,
  createRuntimeObserver, createProductQaExecutionStrategy, createProductQaCompletionEvaluator, createQualityAcceptancePublisher, PRODUCT_QA_DOMAIN,
  DeploymentReleaseDriftError, qualityAcceptanceSubjectKey,
  createProductMutationGuard, createProductHistoryController,
  createProductAcceptanceAuthority, createProductStateProjectionBuilder, createProductClosureController,
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../src/domain-execution-store.js";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { deferred, withScratch } from "./helpers/recovery-harness.js";

const NOW = "2026-09-30T12:00:00.000Z";
const hex = (seed) => createHash("sha256").update(String(seed)).digest("hex");
const digestOf = (seed) => "sha256:" + hex(seed);
const ENV = "environment:staging";

async function openWorld(dir, { mutationGuard = createDeploymentMutationGuard() } = {}) {
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const w = { dir, immutable, org: createOrganizationArtifactRegistry({ store: immutable }), domain: createDomainExecutionArtifactRegistry({ store: immutable }),
    deploy: createDeploymentArtifactRegistry({ store: immutable }), releaseHeads: createJsonCasHeadStore({ path: join(dir, "release-heads.json") }),
    acceptanceHeads: createJsonCasHeadStore({ path: join(dir, "acceptance-heads.json") }), claimReleases: createJsonClaimReleaseStore({ path: join(dir, "claim-releases.json") }),
    policies: createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") }), attempts: createJsonExecutionAttemptStore({ path: join(dir, "attempt-heads.json") }), mutationGuard };
  w.releases = createDeploymentReleaseController({ artifactRegistry: w.deploy, releaseHeadStore: w.releaseHeads, domainArtifactRegistry: w.domain, organizationArtifactRegistry: w.org, mutationGuard });
  w.policyResolver = createAcceptancePolicyResolver({ artifactRegistry: w.deploy });
  w.snapshots = createAcceptanceSnapshotBuilder({ deploymentReleaseController: w.releases, artifactRegistry: w.deploy, acceptancePolicyResolver: w.policyResolver });
  w.acceptances = createQualityAcceptancePublisher({ domainArtifactRegistry: w.domain, organizationArtifactRegistry: w.org, deploymentReleaseController: w.releases, artifactRegistry: w.deploy, qualityAcceptanceHeadStore: w.acceptanceHeads, snapshotResolver: w.snapshots, acceptanceAuthorityRef: "authority:product-qa-acceptance" });
  return w;
}
async function newWorld(t) { return openWorld(await withScratch(t, "exharness-bb057-qaclose-")); }

async function runDomain(w, { domain, workloadType, objective, adapter, verdict = "ACCEPT", completionEvaluator, item }) {
  const inputRef = await w.org.putDomainExecutionInput({ projectId: "project-1", owningDomain: domain, workloadType, objective });
  const contract = defineOrganizationWorkContract({ projectId: "project-1", rootItemId: "ROOT-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + hex("mat"), materializationAuthorizationGeneration: 1,
    materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1", implementationArtifactRef: "implementation-input:bb057", sliceId: "slice-" + item,
    obligationKey: "obligation-" + item, obligationSubjectKey: "obligation-subject-" + item, materializationKey: "materialization-" + item, boardItemId: item, owningDomain: domain, workloadType,
    summary: "Recovery QA " + domain + " work", dependencyIds: [], requiredArtifactRefs: [inputRef], expectedArtifactKind: domain + "_EVIDENCE", expectedOutputRefs: [], acceptanceRefs: ["acceptance:" + domain] });
  await w.org.putWorkContract(contract);
  const receiptRef = await w.org.putClaimReleaseReceipt({ kind: "CLAIM_RELEASE_RECEIPT", version: 1, projectId: contract.projectId, rootItemId: contract.rootItemId, rootIntentId: contract.rootIntentId, itemId: item, claimGeneration: 1, workContractRef: contract.contractRef, boardOwner: domain + "-worker", principalRef: "principal:" + domain });
  await w.claimReleases.compareAndSwap(claimReleaseSubjectKey(contract.projectId, item, 1), null, { status: ClaimReleaseStatus.RELEASED, receiptRef });
  const policyKey = executionPolicySubjectKey(domain, workloadType);
  if (!(await w.policies.current(policyKey))) {
    const strategyRef = await w.domain.putExecutionStrategyDescriptor(defineExecutionStrategyDescriptor({ strategyId: domain + ".strategy", strategyVersion: "1.0.0", strategyKind: "application-core-loop", compatibleWorkloadTypes: [workloadType], compatibleWorkContractVersions: [1], adapterRef: adapter.adapterRef, runtimeBindingMode: "IMMUTABLE_LOCAL", expectedRuntimeCodeRef: adapter.runtimeDeploymentRef, contextRefs: [], toolsetRef: null, modelProfileRef: null, harnessRef: null }));
    await createDomainExecutionPolicyPublisher({ policyAuthority: { async verifyExecutionPolicyPublisher() { return { authorityRef: "authority:policy-publisher" }; } }, artifactRegistry: w.domain, executionPolicyStore: w.policies })
      .publish({ publisher: { identity: "policy-admin" }, policy: { policyId: policyKey, generation: 1, status: "ACTIVE", domain, workloadType, compatibleWorkContractVersions: [1], strategyRef } });
  }
  const claimController = { async assertExecutable() { return true; }, async withExecutablePublicationGuard(args, action) { const lifecycleObservation = { lifecycle: { itemId: item, status: "CLAIMED", claimGeneration: 1 }, claimRelease: { subjectKey: claimReleaseSubjectKey(contract.projectId, item, 1), revision: "release:1", receiptRef: args.receiptRef }, principalRef: "principal:" + domain, workContractRef: contract.contractRef }; return { observation: lifecycleObservation.lifecycle, result: await action(lifecycleObservation) }; } };
  const publicationGate = { authorityRef: "authority:" + domain + "-writer", producerPrincipalRef: "principal:" + domain, async withCurrentWriteAuthority(_scope, action) { return action({ authorityRef: "authority:" + domain + "-writer", revision: "writer:1" }); },
    async publishIdempotent({ publicationKey, outcome }) { return { publicationKey, publishedArtifactRefs: outcome.outputArtifactRefs, acceptedDerivationEdges: outcome.proposedDerivationEdges, publishedClaimRefs: [], publicationStoreRevision: "publication:1" }; } };
  const evaluator = completionEvaluator ?? { authorityRef: "authority:" + domain + "-completion", async evaluate() { return { verdict, criterionResults: [{ criterionId: domain + "-done", verdict: verdict === "ACCEPT" ? "PASS" : "FAIL", evidenceRefs: [] }], counterevidenceRefs: [] }; } };
  const controller = createDomainExecutionController({ claimController, claimReleaseStore: w.claimReleases, organizationArtifactRegistry: w.org, artifactRegistry: w.domain, executionPolicyStore: w.policies, executionAttemptStore: w.attempts, runtimeAdapter: adapter, completionEvaluator: evaluator, publicationGate });
  const result = await controller.execute({ itemId: item, claimGeneration: 1, receiptRef });
  return { ...result, contract, inputRef };
}
function outputAdapter(name, outputs) {
  return { adapterRef: "adapter:" + name + "@1", runtimeKind: "fixture", runtimeDeploymentRef: "git:sha256:" + hex(name), producerAuthorityRef: "authority:" + name + "-runtime",
    async dispatch() { return { status: "SUCCEEDED", runtimeInvocationId: "invocation:" + name, startedAt: NOW, finishedAt: NOW, effectRefs: [], traceRefs: [], outputArtifactRefs: outputs, verificationCandidateRefs: [], counterevidenceRefs: [], proposedDerivationEdges: [] }; },
    async recover() { return this.dispatch(); } };
}
async function sourceDelivery(w, kind, seed, verdict = "ACCEPT") {
  const out = { ref: kind.toLowerCase() + "-source:sha256:" + hex(seed), digest: hex(seed) };
  const run = await runDomain(w, { domain: kind, workloadType: kind.toLowerCase() + "-delivery", objective: { seed }, adapter: outputAdapter(kind.toLowerCase() + "-delivery", [out]), verdict, item: kind + "-" + seed });
  return run.publicationReceiptRef ?? run.completionDecisionRef;
}
async function deployables(w, seed) {
  const out = {};
  for (const kind of ["BACKEND", "FRONTEND"]) {
    const sourceDeliveryRef = await sourceDelivery(w, kind, seed + "-" + kind);
    out[kind] = await publishDeployableArtifact({ artifactRegistry: w.deploy, domainArtifactRegistry: w.domain, provenance: { componentKind: kind, sourceDeliveryRef, sourceRevision: hex("rev-" + seed + kind).slice(0, 40), buildEvidenceRefs: ["build-log:" + seed + kind], artifactDigest: digestOf("image-" + seed + kind), artifactUri: "registry.example/" + kind.toLowerCase() + "@" + digestOf("image-" + seed + kind), mutableTag: kind.toLowerCase() + ":latest" } });
  }
  return out;
}
function devopsAdapter(w, { status = "SUCCEEDED", calls = [] } = {}) {
  return createDevOpsExecutionStrategy({ adapterRef: "adapter:devops@1", runtimeDeploymentRef: "git:sha256:" + hex("devops"), producerAuthorityRef: "authority:devops-runtime", resolveDomainExecutionInput: w.org.resolveDomainExecutionInput, artifactRegistry: w.deploy, domainArtifactRegistry: w.domain, now: () => NOW,
    deployer: { async deploy(request) { calls.push(request); return status === "SUCCEEDED" ? { status, rolloutEvidenceRefs: ["rollout:" + request.environmentRef + ":" + request.components.map((c) => c.artifactDigest.slice(7, 15)).join("+")] } : { status, reason: "ROLLOUT_FAILED" }; } } });
}
async function deployRelease(w, seed, { verdict = "ACCEPT", environmentRef = ENV } = {}) {
  const built = await deployables(w, seed);
  const run = await runDomain(w, { domain: DEVOPS_DOMAIN, workloadType: "deployment", objective: { environmentRef, configRef: "config:" + seed, deployableRefs: { BACKEND: built.BACKEND.deployableRef, FRONTEND: built.FRONTEND.deployableRef } }, adapter: devopsAdapter(w), verdict, item: "DEVOPS-" + seed });
  return { built, run };
}
async function releaseFor(w, seed, options) { const { built, run } = await deployRelease(w, seed, options); const published = await w.releases.publish({ judgmentBundleRef: run.judgmentBundleRef }); return { built, run, ...published }; }
async function acceptancePolicy(w, extra = {}) { return w.policyResolver.put({ policyId: "policy:staging-v1", environmentRef: ENV, criterionRefs: ["criterion:login", "criterion:checkout"], verifierPolicyRef: "verifier-policy:v1", observerRefs: ["observer:edge-probe"], ...extra }); }
function probeAdapter(served) { return { calls: [], async observe(request) { this.calls.push(request); return { observations: request.components.map((c) => ({ componentKind: c.componentKind, servedDigests: served[c.componentKind] ?? [], probeRefs: ["probe:" + c.componentKind] })) }; } }; }
function qaStrategy(w, { observer, verifier }) {
  return createProductQaExecutionStrategy({ adapterRef: "adapter:product-qa@1", runtimeDeploymentRef: "git:sha256:" + hex("qa"), producerAuthorityRef: "authority:qa-runtime", resolveDomainExecutionInput: w.org.resolveDomainExecutionInput, snapshotResolver: w.snapshots, deploymentReleaseController: w.releases, runtimeObserver: observer, criterionVerifier: verifier ?? { async verify({ criterionRef }) { return { verdict: "PASS", evidenceRefs: ["qa-check:" + criterionRef] }; } }, artifactRegistry: w.deploy, now: () => NOW });
}
function observerFor(w, served, { observerRef = "observer:edge-probe", adapter = probeAdapter(served) } = {}) { return createRuntimeObserver({ observerRef, observerPolicyRef: "observer-policy:v1", adapter, artifactRegistry: w.deploy, snapshotResolver: w.snapshots, now: () => NOW }); }
async function runQa(w, { snapshotRef, observer, verifier, verdict, item = "QA-1" }) {
  const adapter = qaStrategy(w, { observer, verifier });
  const completionEvaluator = verdict ? undefined : createProductQaCompletionEvaluator({ authorityRef: "authority:product-qa-completion", artifactRegistry: w.deploy });
  return runDomain(w, { domain: PRODUCT_QA_DOMAIN, workloadType: "acceptance-qa", objective: { snapshotRef }, adapter, verdict, completionEvaluator, item });
}
const servedFor = (release) => Object.fromEntries(release.components.map((c) => [c.componentKind, [c.artifactDigest]]));
async function snapshotOf(w, seed) {
  const released = await releaseFor(w, seed);
  const acceptancePolicyRef = await acceptancePolicy(w);
  return { released, ...await w.snapshots.build({ releaseRef: released.releaseRef, acceptancePolicyRef }) };
}

test("deployment drift during QA blocks current QualityAcceptance from the old snapshot while historical evidence stays immutable", async (t) => {
  const w = await newWorld(t);
  const { released, snapshotRef } = await snapshotOf(w, "drift-1");
  const qa = await runQa(w, { snapshotRef, observer: observerFor(w, servedFor(released.release)), item: "QA-drift-old" });
  assert.equal((await w.domain.resolveDomainCompletionDecision(qa.completionDecisionRef)).verdict, "ACCEPT");
  const published = (await w.domain.resolveDomainPublicationReceipt(qa.publicationReceiptRef)).publishedArtifactRefs.map((artifact) => artifact.ref);
  const criterionRef = published.find((ref) => ref.startsWith("qa-criterion-evidence:"));
  const observationRef = published.find((ref) => ref.startsWith("runtime-observation-evidence:"));
  const criterionBefore = await w.deploy.resolveQaCriterionEvidence(criterionRef);
  const observationBefore = await w.deploy.resolveRuntimeObservationEvidence(observationRef);
  // Drift lands before acceptance: the old snapshot can no longer become current.
  const second = await releaseFor(w, "drift-2");
  await assert.rejects(
    w.acceptances.publish({ judgmentBundleRef: qa.judgmentBundleRef, snapshotRef }),
    (error) => {
      assert.ok(error instanceof DeploymentReleaseDriftError, "expected a release-drift fence, got " + error);
      return true;
    },
  );
  assert.equal(await w.acceptanceHeads.current(qualityAcceptanceSubjectKey(ENV)), null, "no stale acceptance is current");
  assert.deepEqual(await w.deploy.resolveQaCriterionEvidence(criterionRef), criterionBefore, "historical QA evidence is immutable");
  assert.deepEqual(await w.deploy.resolveRuntimeObservationEvidence(observationRef), observationBefore, "historical observation is immutable");
  // The new release still reaches current acceptance through a fresh snapshot.
  const freshPolicyRef = await acceptancePolicy(w);
  const freshSnapshot = await w.snapshots.build({ releaseRef: second.releaseRef, acceptancePolicyRef: freshPolicyRef });
  const freshQa = await runQa(w, { snapshotRef: freshSnapshot.snapshotRef, observer: observerFor(w, servedFor(second.release)), item: "QA-drift-new" });
  const { acceptanceRef } = await w.acceptances.publish({ judgmentBundleRef: freshQa.judgmentBundleRef, snapshotRef: freshSnapshot.snapshotRef });
  const current = await w.acceptances.currentFor(ENV);
  assert.equal(current.current, true);
  assert.equal(current.acceptanceRef, acceptanceRef);
  assert.equal(current.acceptance.releaseRef, second.releaseRef, "current acceptance names the current release, never the drifted one");
});

test("a QA run started after release drift blocks before any observation or effect", async (t) => {
  const w = await newWorld(t);
  const { released, snapshotRef } = await snapshotOf(w, "late-1");
  await releaseFor(w, "late-2");
  const adapter = probeAdapter(servedFor(released.release));
  const qa = await runQa(w, { snapshotRef, observer: observerFor(w, null, { adapter }), item: "QA-late" });
  const outcome = await w.domain.resolveExecutionAttemptOutcome(qa.outcomeRef);
  assert.equal(outcome.status, "BLOCKED");
  assert.deepEqual(outcome.counterevidenceRefs, ["product-qa:release-drift:" + snapshotRef]);
  assert.equal(adapter.calls.length, 0, "no observation runs against a stale target");
  assert.equal(qa.publicationReceiptRef, null);
  await assert.rejects(w.acceptances.publish({ judgmentBundleRef: qa.judgmentBundleRef, snapshotRef }), /ACCEPT Product QA completion decision/);
  assert.equal(await w.acceptanceHeads.current(qualityAcceptanceSubjectKey(ENV)), null);
});

async function openClosureWorld(t) {
  const dir = await withScratch(t, "exharness-bb057-closure-");
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const guard = createProductMutationGuard();
  const history = createProductHistoryController({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "history.json") }), mutationGuard: guard });
  const acceptance = createProductAcceptanceAuthority({ artifactStore, headStore: createJsonCasHeadStore({ path: join(dir, "policy.json") }), mutationGuard: guard });
  const builder = createProductStateProjectionBuilder({ productHistory: history, acceptanceAuthority: acceptance, artifactStore, mutationGuard: guard });
  const outcomeHeadStore = createJsonCasHeadStore({ path: join(dir, "outcomes.json") });
  const closure = createProductClosureController({ projectionBuilder: builder, productHistory: history, acceptanceAuthority: acceptance, artifactStore, outcomeHeadStore, mutationGuard: guard });
  return { dir, artifactStore, guard, history, acceptance, builder, closure, outcomeHeadStore };
}
async function seedEligible(w, heads = {}) {
  await w.acceptance.publishPolicy({ productId: "product-1", policy: { policyId: "policy-1", criterionRefs: ["criterion:login"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: heads });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.history.appendTransition({ productId: "product-1", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: heads });
}

test("closure racing upstream supersession never leaves a stale outcome current", async (t) => {
  // Branch A: closure commits first, then supersession makes it historical.
  {
    const w = await openClosureWorld(t);
    await seedEligible(w);
    const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
    const closed = await w.closure.close({ projectionRef: atHn.projectionRef });
    assert.equal((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
    const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late-a", status: "ACTIVE" });
    await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
    const revalidated = await w.closure.currentOutcome({ productId: "product-1" });
    assert.equal(revalidated.status, "HISTORICAL");
    assert.equal(revalidated.reason, "PRODUCT_DRIFT");
    assert.equal(revalidated.outcomeRef, closed.outcomeRef, "history is preserved, currentness moved by new transition");
  }
  // Branch B: supersession lands first, the stale close aborts and nothing is current.
  {
    const w = await openClosureWorld(t);
    await seedEligible(w);
    const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
    const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late-b", status: "ACTIVE" });
    await w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
    await assert.rejects(w.closure.close({ projectionRef: atHn.projectionRef }), (error) => {
      assert.equal(error.code, "STALE_PROJECTION");
      return true;
    });
    assert.notEqual((await w.closure.currentOutcome({ productId: "product-1" })).status, "CURRENT");
  }
  // Branch C: true overlap under the shared production guard converges without stale currency.
  {
    const w = await openClosureWorld(t);
    await seedEligible(w);
    const atHn = await w.builder.build({ productId: "product-1", rootIntentRef: "intent:root-1" });
    const arrived = deferred();
    const release = deferred();
    const rawHeads = w.outcomeHeadStore;
    const gatedHeads = Object.freeze({
      current: (...args) => rawHeads.current(...args),
      async compareAndSwap(...args) {
        arrived.resolve();
        await release.promise;
        return rawHeads.compareAndSwap(...args);
      },
    });
    const gatedClosure = createProductClosureController({
      projectionBuilder: w.builder,
      productHistory: w.history,
      acceptanceAuthority: w.acceptance,
      artifactStore: w.artifactStore,
      outcomeHeadStore: gatedHeads,
      mutationGuard: w.guard,
    });
    const closing = gatedClosure.close({ projectionRef: atHn.projectionRef });
    await arrived.promise;
    // The competing Hn+1 append starts while close holds the shared
    // production guard across check and commit; production serialization
    // decides the order, the barrier only guarantees the overlap.
    const lateRef = await w.artifactStore.put("semantic-claim", { kind: "SEMANTIC_CLAIM", version: 1, productId: "product-1", subjectKey: "late-c", status: "ACTIVE" });
    const appending = w.history.appendTransition({ productId: "product-1", transitionKind: "ACCEPTED_PRODUCT_REVISION", transitionRefs: [lateRef], authorityHeads: {} });
    release.resolve();
    const closed = await closing;
    await appending;
    assert.equal(closed.head.value.historyGeneration, atHn.subject.historyGeneration);
    assert.equal((await w.history.current({ productId: "product-1" })).generation, atHn.subject.historyGeneration + 1);
    const revalidated = await w.closure.currentOutcome({ productId: "product-1" });
    assert.equal(revalidated.status, "HISTORICAL", "the raced outcome is historical, never stale-current");
    assert.equal(revalidated.outcomeRef, closed.outcomeRef);
  }
});
