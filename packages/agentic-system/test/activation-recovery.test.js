import test from "node:test";
import assert from "node:assert/strict";
import {ActivationOutcome,ActivationReason,ExecutionAttemptStatus} from "../src/index.js";
import {backendAdapter,domainFixture,frontendAdapter,manualTimer} from "./domain-activation.test.js";

test("AC-1/INV-2 persisted READY work is rediscovered by a fresh host after restart with no hint",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const work=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  // First host is started and killed before its notification is ever delivered; its timer and
  // in-flight hint state are discarded with it.
  const first=f.hostFor(be);
  await first.host.stop();
  assert.equal(first.timer.active,0);
  assert.deepEqual(f.counts.dispatches,{});
  // Fresh host, fresh activation, fresh timer: the immediate startup scan is the recovery truth.
  const fresh=f.hostFor(be);
  await fresh.host.start();
  assert.equal(fresh.timer.active,1);
  assert.equal((await f.item(work.item.id)).status,"CLAIMED");
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
  assert.deepEqual(f.counts.attempts,{BACKEND:1});
  await fresh.host.stop();
});

test("AC-7 periodic scans progress work persisted after start without any event or dispatcher",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const {host,timer}=f.hostFor(fe);
  await host.start();
  await host.start();
  assert.equal(timer.active,1,"start is idempotent");
  assert.deepEqual(f.counts.dispatches,{});
  const work=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  await timer.tick();
  await host.stop();
  assert.equal((await f.item(work.item.id)).status,"CLAIMED");
  assert.deepEqual(f.counts.dispatches,{FRONTEND:1});
  for(const forbidden of ["nextRole","nextDomain","stage","dispatchNext"])assert.equal(forbidden in host,false);
});

test("AC-2 repeated restarts and duplicate scans replay without a second attempt",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const work=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  for(let restart=0;restart<3;restart+=1){
    const {host}=f.hostFor(be);
    await Promise.all([host.start(),host.notify(work.key),host.scanOnce()]);
    await host.stop();
  }
  assert.equal(f.counts.claimSuccesses,1);
  assert.deepEqual(f.counts.attempts,{BACKEND:1});
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
});

test("AC-8/INV-8 stale hint for non-actionable work cannot resurrect it while unrelated work executes",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const stale=await f.addWork({key:"be-stale",owningDomain:"BACKEND"});
  const unrelated=await f.addWork({key:"be-unrelated",owningDomain:"BACKEND"});
  await f.orchestrator.blockOrganizationMaterialization({itemId:stale.item.id,authorizationRef:stale.item.origin.authorizationRef,authorizationGeneration:stale.item.origin.authorizationGeneration,reasonRef:"test:upstream-invalidated"});
  const {host}=f.hostFor(be);
  const hinted=await host.notify(stale.key);
  assert.equal(hinted.state,ActivationOutcome.NOOP);assert.equal(hinted.reason,ActivationReason.NOT_ACTIONABLE);
  assert.equal(f.counts.claimCalls,0);
  const scanned=await host.scanOnce();
  assert.deepEqual(scanned.map(entry=>entry.key.workId),[unrelated.item.id]);
  assert.equal(scanned[0].value.state,ActivationOutcome.EXECUTED);
  assert.equal(scanned[0].value.execution.state,ExecutionAttemptStatus.TERMINAL);
  assert.equal((await f.item(stale.item.id)).status,"BLOCKED");
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
});

test("INV-2 stop drains only in-flight work; hint/timer state is discarded and a new host rediscovers the rest",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const a=await f.addWork({key:"be-a",owningDomain:"BACKEND"});
  const b=await f.addWork({key:"be-b",owningDomain:"BACKEND"});
  const timer=manualTimer();
  const {host}=f.hostFor(be,{timer});
  const inFlight=host.notify(a.key);
  await host.stop();
  assert.equal(timer.active,0);
  assert.equal((await inFlight).state,ActivationOutcome.EXECUTED);
  assert.equal((await f.item(b.item.id)).status,"READY");
  const {host:next}=f.hostFor(be);
  const results=await next.scanOnce();
  assert.deepEqual(results.map(r=>r.key.workId),[b.item.id]);
  assert.deepEqual(f.counts.dispatches,{BACKEND:2});
});
