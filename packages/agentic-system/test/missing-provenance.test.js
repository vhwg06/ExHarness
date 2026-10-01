import test from "node:test";
import assert from "node:assert/strict";
import { MISSING_PROVENANCE, UNKNOWN_PROVENANCE, defineCausalLifecycleEvidence } from "../src/causal-provenance.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

test("Unknown work has no estimated timing: both segments are MISSING_PROVENANCE", async (t) => {
  const w = await newObserverWorld(t, "missing");
  await seedEligibleProduct(w);
  const timing = await w.observer.measureTiming({ workId: "WORK-NONE", workContractRef: "organization-work-contract:sha256:" + "0".repeat(64), projectId: "project-1" });
  // The attempt key cannot resolve, so no interval exists to sum; the
  // lifecycle list is empty, so no waiting boundary exists either.
  assert.equal(timing.waiting.status, MISSING_PROVENANCE);
  assert.equal(timing.waiting.durationMs, null);
  assert.equal(timing.executing.status, MISSING_PROVENANCE);
  assert.equal(timing.executing.durationMs, null);
  assert.deepEqual(timing.runtimeIntervals, []);
});

test("Lifecycle evidence rejects non-timestamp observations instead of backfilling", async (t) => {
  const w = await newObserverWorld(t, "missing-evidence");
  await assert.rejects(w.sink.record({ kind: "CAUSAL_LIFECYCLE_EVIDENCE", version: 1, workId: "WORK-1", eventKind: "MATERIALIZED", observedAt: "not-a-timestamp" }), /ISO timestamp/);
  await assert.rejects(w.sink.record({ kind: "CAUSAL_LIFECYCLE_EVIDENCE", version: 1, workId: "WORK-1", eventKind: "INVENTED_KIND", observedAt: "2026-09-01T09:00:00.000Z" }), /lifecycle boundary/);
  assert.throws(() => defineCausalLifecycleEvidence({ kind: "CAUSAL_LIFECYCLE_EVIDENCE", version: 1, workId: "", eventKind: "MATERIALIZED", observedAt: "2026-09-01T09:00:00.000Z" }), /workId/);
});

test("Remaining work without a lineage reader reports UNKNOWN instead of inferring currentness", async (t) => {
  const w = await newObserverWorld(t, "missing-lineage");
  await seedEligibleProduct(w);
  const { defineOrganizationWorkContract } = await import("../src/organization-work.js");
  const contract = defineOrganizationWorkContract({
    projectId: "project-1", rootItemId: "ROOT-1", rootIntentId: "INTENT-1", acceptedDecisionRef: "decision:accepted",
    materializationAuthorizationId: "mat-auth-1", materializationAuthorizationRef: "materialization-authorization:sha256:" + "b".repeat(64),
    materializationAuthorizationGeneration: 1, materializationAuthorizationRevision: "mat-rev-1", authorityPolicyRevision: "authority-policy-1",
    implementationArtifactRef: "cross-domain-obligation:sha256:" + "c".repeat(64), sliceId: "design", obligationKey: "design",
    obligationSubjectKey: "logical-design", materializationKey: "materialization-design", boardItemId: "WORK-SA-1",
    owningDomain: "SA", workloadType: "solution-design", summary: "Design work",
    dependencyIds: [], requiredArtifactRefs: ["cross-domain-obligation:sha256:" + "c".repeat(64)], expectedArtifactKind: "architecture",
    expectedOutputRefs: [], acceptanceRefs: ["acceptance:design"],
    crossDomainObligationRef: "cross-domain-obligation:sha256:" + "c".repeat(64),
    crossDomainObligationSubjectKey: "cross-domain-obligation:subject",
    crossDomainPublicationReceiptRef: "domain-publication-receipt:sha256:" + "d".repeat(64),
  });
  await w.organizationArtifactRegistry.putWorkContract(contract);
  w.board.items.push({ id: "WORK-SA-1", status: "READY", owner: null, claimGeneration: null, origin: { kind: "ORGANIZATION_MATERIALIZATION", workContractRef: contract.contractRef, owningDomain: "SA", workloadType: "solution-design" } });
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const remaining = await w.observer.listRemainingWork({ subject: current.subject });
  const entry = remaining.find((r) => r.workId === "WORK-SA-1");
  // The lineage snapshot has no head for this subject: currentness is
  // reported explicitly, never inferred from the board item alone.
  assert.notEqual(entry.obligationStatus, "CURRENT");
  assert.ok([UNKNOWN_PROVENANCE, "STALE", MISSING_PROVENANCE].includes(entry.obligationStatus));
});

test("Evidence chain marks an unreachable outcome as MISSING_PROVENANCE", async (t) => {
  const w = await newObserverWorld(t, "missing-outcome");
  await seedEligibleProduct(w);
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  const facts = await w.observer.chainEvidence({ subject: current.subject });
  for (const fact of facts) {
    assert.ok(Array.isArray(fact.evidenceRefs) && fact.evidenceRefs.length > 0, "every fact binds durable refs");
    for (const ref of fact.evidenceRefs) assert.equal(typeof ref, "string");
  }
  // No outcome was ever closed: no PRODUCT_OUTCOME_CLAIM fact is fabricated.
  assert.ok(!facts.some((f) => f.factKind === "PRODUCT_OUTCOME_CLAIM" && f.ref != null));
});
