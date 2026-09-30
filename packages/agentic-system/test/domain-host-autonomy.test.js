import test from "node:test";
import assert from "node:assert/strict";
import {ActivationOutcome,ActivationReason,createDomainActivationHost,createFrontendBackendDomainRuntime} from "../src/index.js";
import {backendAdapter,domainFixture,frontendAdapter} from "./domain-activation.test.js";

test("AC-1/AC-7 host start is idempotent and runs an immediate then periodic canonical scan",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const first=await f.addWork({key:"be-first",owningDomain:"BACKEND"});
  const {host,timer}=f.hostFor(be);
  await Promise.all([host.start(),host.start()]);
  assert.equal(timer.active,1);
  assert.equal((await f.item(first.item.id)).status,"CLAIMED");
  const later=await f.addWork({key:"be-later",owningDomain:"BACKEND"});
  await timer.tick();
  await host.stop();
  assert.equal((await f.item(later.item.id)).status,"CLAIMED");
  assert.equal(timer.active,0);
  assert.deepEqual(f.counts.dispatches,{BACKEND:2});
});

test("notify accepts only a same-domain exact key and never executes other-domain work",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const beWork=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  const {host}=f.hostFor(fe);
  const rejected=await host.notify(beWork.key);
  assert.equal(rejected.state,ActivationOutcome.REJECTED);assert.equal(rejected.reason,ActivationReason.DOMAIN_MISMATCH);
  await assert.rejects(host.notify({projectId:beWork.key.projectId,owningDomain:"FRONTEND"}),/workId/);
  assert.equal(f.counts.claimCalls,0);assert.deepEqual(f.counts.dispatches,{});
});

test("stop cancels and drains only its own host; the sibling host keeps scanning",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const frontend=f.hostFor(fe),backend=f.hostFor(be);
  const runtime=createFrontendBackendDomainRuntime({backendHost:backend.host,frontendHost:frontend.host});
  assert.deepEqual(Object.keys(runtime).sort(),["startAll","stopAll"]);
  await runtime.startAll();
  await frontend.host.stop();
  const feWork=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  const beWork=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  await frontend.timer.tick();await backend.timer.tick();
  assert.equal(frontend.timer.active,0);assert.equal(backend.timer.active,1);
  assert.equal((await f.item(feWork.item.id)).status,"READY");
  assert.equal((await f.item(beWork.item.id)).status,"CLAIMED");
  await runtime.stopAll();
});

test("INV-7 a failing Frontend host start does not gate Backend startup or progress",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const beWork=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  const backend=f.hostFor(be);
  const brokenDiscovery={async scan(){throw new Error("frontend discovery outage");}};
  const frontendHost={owningDomain:"FRONTEND",async start(){throw new Error("frontend host crashed");},async stop(){}};
  const runtime=createFrontendBackendDomainRuntime({backendHost:backend.host,frontendHost});
  const started=await runtime.startAll();
  assert.equal(started.FRONTEND.status,"rejected");assert.match(started.FRONTEND.error.message,/frontend host crashed/);
  assert.equal(started.BACKEND.status,"fulfilled");
  assert.equal((await f.item(beWork.item.id)).status,"CLAIMED");
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
  // A host whose scan fails reports through its own onError and stays startable/stoppable.
  const errors=[];
  const flaky=createDomainActivationHost({owningDomain:"FRONTEND",discovery:brokenDiscovery,activation:{owningDomain:"FRONTEND",async reconcile(){throw new Error("unused");}},scanIntervalMs:10,timer:{setInterval:()=>1,clearInterval(){}},onError:e=>errors.push(e.message)});
  await flaky.start();await flaky.stop();
  assert.deepEqual(errors,["frontend discovery outage"]);
  await runtime.stopAll();
});

test("composition requires separate hosts bound to their own domains and exposes no ordering API",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const backend=f.hostFor(be);
  assert.throws(()=>createFrontendBackendDomainRuntime({backendHost:backend.host,frontendHost:backend.host}),/separate hosts/);
  assert.throws(()=>createFrontendBackendDomainRuntime({backendHost:{...backend.host,owningDomain:"FRONTEND"},frontendHost:backend.host}),/BACKEND/);
  assert.throws(()=>createDomainActivationHost({owningDomain:"BACKEND",discovery:{scan(){}},activation:{owningDomain:"FRONTEND",reconcile(){}}}),/differ/);
});
