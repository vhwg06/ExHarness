import test from "node:test";
import assert from "node:assert/strict";
import { ORGANIZATION_OBSERVER_QUERY_SURFACE } from "../src/organization-observer.js";
import { newObserverWorld, seedEligibleProduct } from "./causal-reconstruction.test.js";

const FORBIDDEN = [
  "claim", "release", "dispatch", "execute", "recover", "publish", "accept", "reject",
  "selectNextDomain", "chooseOwner", "assignOwner", "routeWork", "scheduleNext",
  "resolveStrategy", "selectStrategy", "mutate", "appendTransition", "close", "invalidate",
  "claimController", "executionPolicyStore", "recoveryController", "policyPublisher",
];

test("Observer exposes exactly the query surface and no authority handle", async (t) => {
  const w = await newObserverWorld(t, "authority");
  assert.deepEqual(Object.keys(w.observer).sort(), [...ORGANIZATION_OBSERVER_QUERY_SURFACE].sort());
  for (const name of FORBIDDEN) {
    assert.equal(w.observer[name], undefined, `${name} must be absent from the observer`);
  }
  assert.deepEqual(Object.keys(w.reconstruction).sort(), [
    "chainEvidence", "describeExecution", "explainBlockers", "listRemainingWork",
    "measureTiming", "reconstructPinned", "resolveCurrentSubject", "traceObligation",
  ].sort());
});

test("Observation cannot mutate acceptance, currentness, board or product heads", async (t) => {
  const w = await newObserverWorld(t, "authority-readonly");
  await seedEligibleProduct(w);
  const historyBefore = await w.productHistory.current({ productId: "product-1" });
  const acceptanceBefore = await w.acceptanceAuthority.resolveCurrent({ productId: "product-1" });
  const boardBefore = await w.boardReader.readBlackboard();
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  await w.observer.queryHistorical({ subject: { ...current.subject, mode: "HISTORICAL" } });
  await w.observer.explainWhyNotDone({ subject: current.subject });
  await w.observer.listRemainingWork({ subject: current.subject });
  await w.observer.chainEvidence({ subject: current.subject });
  await w.observer.measureTiming({ workId: "WORK-ABSENT", projectId: "project-1", workContractRef: "organization-work-contract:sha256:" + "0".repeat(64) });
  const historyAfter = await w.productHistory.current({ productId: "product-1" });
  const acceptanceAfter = await w.acceptanceAuthority.resolveCurrent({ productId: "product-1" });
  const boardAfter = await w.boardReader.readBlackboard();
  assert.deepEqual(historyAfter, historyBefore);
  assert.deepEqual(acceptanceAfter, acceptanceBefore);
  assert.deepEqual(boardAfter, boardBefore);
});

test("Observation paths reject dispatch, recovery and next-domain authority", async (t) => {
  const w = await newObserverWorld(t, "authority-reject");
  await seedEligibleProduct(w);
  const current = await w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1" });
  // No query method accepts authority arguments; each rejects unknown keys.
  await assert.rejects(w.observer.explainWhyNotDone({ subject: current.subject, nextDomain: "SA" }), /no caller-selected/);
  await assert.rejects(w.observer.listRemainingWork({ subject: current.subject, dispatch: true }), /no caller-selected/);
  await assert.rejects(w.observer.describeExecution({ workId: "W", recover: true }), /no caller-selected/);
  await assert.rejects(w.observer.queryCurrent({ productId: "product-1", rootIntentRef: "intent:root-1", strategyRef: "x" }), /no caller-selected/);
  assert.equal(typeof w.observer.queryCurrent, "function");
  assert.equal(typeof w.observer.queryHistorical, "function");
});
