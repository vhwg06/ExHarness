import test from "node:test";
import assert from "node:assert/strict";
import { createJsonCasHeadStore } from "../src/organization-authority-store.js";
import { createProductMutationGuard, createProductHistoryController } from "../src/product-history.js";
import { createProductAcceptanceAuthority } from "../src/product-acceptance-policy.js";
import { createProductStateProjectionBuilder } from "../src/product-state-projection.js";
import { createProductClosureController } from "../src/product-closure.js";
import { createDomainExecutionArtifactRegistry, createJsonExecutionAttemptStore } from "../src/domain-execution-store.js";
import { createOrganizationObserver } from "../src/organization-observer.js";
import { defineOrganizationWorkContract } from "../src/organization-work.js";
import { productRevision } from "../src/product-lineage.js";
import { fixture, claim, obligation } from "./cross-domain-obligation.test.js";

async function lineageWorld(t) {
  const f = await fixture(t);
  const guard = createProductMutationGuard();
  const productHistory = createProductHistoryController({ artifactStore: f.artifactStore, headStore: createJsonCasHeadStore({ path: `${f.dir}/history-heads.json` }), mutationGuard: guard });
  const acceptanceAuthority = createProductAcceptanceAuthority({ artifactStore: f.artifactStore, headStore: createJsonCasHeadStore({ path: `${f.dir}/policy-heads.json` }), mutationGuard: guard });
  const projectionBuilder = createProductStateProjectionBuilder({ productHistory, acceptanceAuthority, artifactStore: f.artifactStore, mutationGuard: guard });
  const closureController = createProductClosureController({ projectionBuilder, productHistory, acceptanceAuthority, artifactStore: f.artifactStore, outcomeHeadStore: createJsonCasHeadStore({ path: `${f.dir}/outcomes.json` }), mutationGuard: guard });
  const board = { items: [] };
  const boardReader = { async readBlackboard() { return structuredClone({ items: board.items }); } };
  const observer = createOrganizationObserver({
    productHistory, acceptanceAuthority, projectionBuilder, artifactStore: f.artifactStore, lineage: f.lineage, boardReader,
    organizationArtifactRegistry: f.org, domainArtifactRegistry: createDomainExecutionArtifactRegistry({ store: f.artifactStore }),
    executionAttemptStore: createJsonExecutionAttemptStore({ path: `${f.dir}/attempts.json` }),
    evidenceHeadStore: createJsonCasHeadStore({ path: `${f.dir}/causal-heads.json` }), closureController,
  });
  return { ...f, guard, productHistory, acceptanceAuthority, projectionBuilder, closureController, board, boardReader, observer };
}

async function seedProduct(w) {
  await w.acceptanceAuthority.publishPolicy({ productId: "p", policy: { policyId: "policy-1", criterionRefs: ["criterion:design"] } });
  const relRef = await w.artifactStore.put("deployment-release", { kind: "DEPLOYMENT_RELEASE", version: 1, environmentRef: "env-1" });
  await w.productHistory.appendTransition({ productId: "p", transitionKind: "RELEASE_PUBLICATION", transitionRefs: [relRef], authorityHeads: {} });
  const qaRef = await w.artifactStore.put("quality-acceptance", { kind: "QUALITY_ACCEPTANCE", version: 1, environmentRef: "env-1", releaseRef: relRef });
  await w.productHistory.appendTransition({ productId: "p", transitionKind: "QUALITY_ACCEPTANCE", transitionRefs: [qaRef], authorityHeads: {} });
}

test("A failed or non-current obligation traces issuer, revision, downstream work and invalidation", async (t) => {
  const w = await lineageWorld(t);
  await seedProduct(w);
  const detail = claim("detail");
  await w.publish([detail]);
  const design = claim("detail-design", "v1", "SA");
  await w.publish([design], { domain: "SA", inputs: [productRevision(detail).ref] });
  const o = obligation(design);
  const issued = await w.publish([o], { domain: "SA", inputs: [productRevision(design).ref] });
  const obligationRef = productRevision(o).ref;
  const obligationSubjectKey = productRevision(o).subjectKey;
  const contract = defineOrganizationWorkContract({
    projectId: "p", rootItemId: "ROOT-p", rootIntentId: "intent", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + "b".repeat(64),
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: obligationRef, sliceId: "design", obligationKey: "design",
    obligationSubjectKey: "logical-design", materializationKey: "materialization-design", boardItemId: "WORK-SA-1",
    owningDomain: "SA", workloadType: "solution-design", summary: "Design the accepted requirement",
    dependencyIds: [], requiredArtifactRefs: [obligationRef], expectedArtifactKind: "architecture",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design"],
    crossDomainObligationRef: obligationRef, crossDomainObligationSubjectKey: obligationSubjectKey,
    crossDomainPublicationReceiptRef: issued.publicationReceiptRef,
  });
  await w.org.putWorkContract(contract);
  w.board.items.push({ id: "WORK-SA-1", status: "READY", owner: null, claimGeneration: null, origin: { kind: "ORGANIZATION_MATERIALIZATION", workContractRef: contract.contractRef, owningDomain: "SA", workloadType: "solution-design" } });
  // Supersede the obligation: the first revision becomes non-current.
  const revised = obligation(design, { requiredOutcome: "Revised design outcome" });
  await w.publish([revised], { domain: "SA", inputs: [productRevision(design).ref] });
  const current = await w.observer.queryCurrent({ productId: "p", rootIntentRef: "intent:root" });
  const traced = await w.observer.traceObligation({ subject: current.subject, obligationRef });
  assert.equal(traced.obligationRef, obligationRef);
  assert.equal(traced.obligationSubjectKey, obligationSubjectKey);
  assert.equal(traced.obligationStatus, "SUPERSEDED");
  assert.equal(traced.issuer.issuingSubjectKey, productRevision(design).subjectKey);
  assert.equal(traced.issuer.issuingRevisionRef, productRevision(design).ref);
  assert.ok(traced.invalidationEvidence.some((e) => e.subjectKey === obligationSubjectKey && e.status !== "ACTIVE"));
  assert.ok(traced.affectedWork.some((entry) => entry.workId === "WORK-SA-1" && entry.owningDomain === "SA"));
  assert.ok(traced.evidenceRefs.includes(obligationRef));
  // The historical revision bytes still resolve unchanged.
  assert.deepEqual(await w.lineage.resolve(obligationRef), productRevision(o).value);
});

test("Tracing by subject key follows the current revision while history stays pinned", async (t) => {
  const w = await lineageWorld(t);
  await seedProduct(w);
  const detail = claim("detail");
  await w.publish([detail]);
  const o = obligation(detail);
  // Issuer must be an accepted SA claim for the obligation path; publish the
  // issuer claim under SA first, then issue from it.
  const issuerSA = claim("detail", "v1", "SA");
  await w.publish([issuerSA], { domain: "SA", inputs: [productRevision(detail).ref] });
  const saObligation = { ...o, issuingSubjectKey: productRevision(issuerSA).subjectKey, issuingRevisionRef: productRevision(issuerSA).ref };
  await w.publish([saObligation], { domain: "SA", inputs: [productRevision(issuerSA).ref] });
  const current = await w.observer.queryCurrent({ productId: "p", rootIntentRef: "intent:root" });
  const traced = await w.observer.traceObligation({ subject: current.subject, obligationSubjectKey: productRevision(saObligation).subjectKey });
  assert.equal(traced.obligationStatus, "ACTIVE");
  assert.equal(traced.issuer.issuingRevisionRef, productRevision(issuerSA).ref);
});
