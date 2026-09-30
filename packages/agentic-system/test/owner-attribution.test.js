import test from "node:test";
import assert from "node:assert/strict";
import { defineOrganizationWorkContract } from "../src/organization-work.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

const AUTH_REF = "materialization-authorization:sha256:" + "b".repeat(64);

function contractFor(boardItemId, owningDomain, overrides = {}) {
  return defineOrganizationWorkContract({
    projectId: "project-1", rootItemId: "ROOT-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: AUTH_REF,
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: "implementation-input:seed", sliceId: "slice-1", obligationKey: `obligation-${boardItemId}`,
    obligationSubjectKey: `obligation-subject-${boardItemId}`, materializationKey: `materialization-${boardItemId}`, boardItemId,
    owningDomain, workloadType: "solution-design", summary: `Bounded work ${boardItemId}`,
    dependencyIds: [], requiredArtifactRefs: ["user-intent:sha256:" + "b".repeat(64)], expectedArtifactKind: "DESIGN_DOC",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design-v1"], ...overrides,
  });
}

async function seedWork(w, boardItemId, owningDomain, status = "READY") {
  const contract = contractFor(boardItemId, owningDomain);
  assert.equal(await w.organizationArtifactRegistry.putWorkContract(contract), contract.contractRef);
  w.board.items.push({
    id: boardItemId, status, owner: status === "CLAIMED" ? "worker-sa" : null,
    claimGeneration: status === "CLAIMED" ? 2 : null,
    origin: { kind: "ORGANIZATION_MATERIALIZATION", workContractRef: contract.contractRef, owningDomain, workloadType: "solution-design" },
  });
  return contract;
}

test("Each remaining work item maps to its exact owning domain and lifecycle/claim state", async (t) => {
  const w = await newObserverWorld(t, "owner");
  await seedEligibleProduct(w);
  await seedWork(w, "WORK-SA-1", "SA", "READY");
  await seedWork(w, "WORK-BE-1", "BE", "CLAIMED");
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const remaining = await w.observer.listRemainingWork({ subject: current.subject });
  assert.equal(remaining.length, 2);
  const sa = remaining.find((r) => r.workId === "WORK-SA-1");
  const be = remaining.find((r) => r.workId === "WORK-BE-1");
  assert.equal(sa.owningDomain, "SA");
  assert.equal(sa.lifecycleStatus, "READY");
  assert.deepEqual(sa.claimState, { owner: null, claimGeneration: null });
  assert.equal(be.owningDomain, "BE");
  assert.equal(be.lifecycleStatus, "CLAIMED");
  assert.deepEqual(be.claimState, { owner: "worker-sa", claimGeneration: 2 });
  for (const entry of remaining) {
    assert.ok(entry.evidenceRefs.length > 0);
    assert.ok(entry.evidenceRefs.includes(current.subject.projectionRef));
  }
});

test("Ownership is evidence from the canonical contract, never a routing decision", async (t) => {
  const w = await newObserverWorld(t, "owner-evidence");
  await seedEligibleProduct(w);
  const contract = await seedWork(w, "WORK-SA-9", "SA", "READY");
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const remaining = await w.reconstruction.listRemainingWork({ subject: current.subject });
  const entry = remaining.find((r) => r.workId === "WORK-SA-9");
  assert.equal(entry.owningDomain, contract.owningDomain);
  assert.ok(entry.evidenceRefs.includes(contract.contractRef));
  const stored = await w.organizationArtifactRegistry.resolveWorkContract(contract.contractRef);
  assert.equal(stored.owningDomain, entry.owningDomain);
  // The observer never chooses a next domain: no routing surface exists.
  for (const forbidden of ["selectNextDomain", "chooseOwner", "assignOwner", "routeWork", "scheduleNext", "dispatch"]) {
    assert.equal(w.observer[forbidden], undefined, `${forbidden} must be absent`);
  }
});

test("A caller-selected domain subset cannot change the remaining-work result", async (t) => {
  const w = await newObserverWorld(t, "owner-subset");
  await seedEligibleProduct(w);
  await seedWork(w, "WORK-SA-1", "SA", "READY");
  await seedWork(w, "WORK-BE-1", "BE", "READY");
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await assert.rejects(w.observer.listRemainingWork({ subject: current.subject, owningDomain: "SA" }), /no caller-selected/);
  await assert.rejects(w.reconstruction.listRemainingWork({ subject: current.subject, workIds: ["WORK-SA-1"] }), /no caller-selected/);
  const full = await w.observer.listRemainingWork({ subject: current.subject });
  assert.equal(full.length, 2);
});
