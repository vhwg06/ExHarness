import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ActivationOutcome,ExecutionAttemptStatus,createFrontendBackendDomainRuntime,executionAttemptSubjectKey,resolveExecutionJudgmentBundle} from "../src/index.js";
import {appliedResult,backendAdapter,deferred,domainFixture,frontendAdapter} from "./domain-activation.test.js";

async function parallelFixture(t,{frontendFailsAfterStart=false,backendFailsAfterStart=false}={}){
  const f=await domainFixture(t);
  const events=[],feStarted=deferred(),beStarted=deferred(),workerCalls={FRONTEND:0,BACKEND:0};
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f,{executor:{async execute(order){
    workerCalls.FRONTEND+=1;events.push("FRONTEND:dispatchStarted:"+order.id);feStarted.resolve();
    await beStarted.promise;
    if(frontendFailsAfterStart){events.push("FRONTEND:outage");throw new Error("frontend runtime outage");}
    events.push("FRONTEND:completed");return appliedResult("FRONTEND");
  }}})});
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f,{async execute(order){
    workerCalls.BACKEND+=1;events.push("BACKEND:dispatchStarted:"+order.id);beStarted.resolve();
    await feStarted.promise;
    if(backendFailsAfterStart){events.push("BACKEND:outage");throw new Error("backend runtime outage");}
    events.push("BACKEND:completed");return appliedResult("BACKEND");
  }})});
  const feWork=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  const beWork=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  const errors={FRONTEND:[],BACKEND:[]};
  const frontend=f.hostFor(fe,{onError:e=>errors.FRONTEND.push(e)}),backend=f.hostFor(be,{onError:e=>errors.BACKEND.push(e)});
  const runtime=createFrontendBackendDomainRuntime({backendHost:backend.host,frontendHost:frontend.host});
  return {f,fe,be,feWork,beWork,events,workerCalls,frontend,backend,runtime,errors};
}

test("AC-5/INV-6 distinct FE/BE contracts, policies and adapters both dispatch before either completes",async t=>{
  const p=await parallelFixture(t);
  const started=await p.runtime.startAll();
  assert.deepEqual(Object.fromEntries(Object.entries(started).map(([k,v])=>[k,v.status])),{BACKEND:"fulfilled",FRONTEND:"fulfilled"});
  const firstTwo=p.events.slice(0,2).map(e=>e.split(":").slice(0,2).join(":")).sort();
  assert.deepEqual(firstTwo,["BACKEND:dispatchStarted","FRONTEND:dispatchStarted"]);
  assert.ok(p.events.indexOf("FRONTEND:completed")>1&&p.events.indexOf("BACKEND:completed")>1);
  await p.runtime.stopAll();
  const identities={};
  for(const [domain,stack,work] of [["FRONTEND",p.fe,p.feWork],["BACKEND",p.be,p.beWork]]){
    const head=await stack.attemptStore.current(executionAttemptSubjectKey({projectId:work.contract.projectId,itemId:work.item.id,workContractRef:work.contract.contractRef}));
    assert.equal(head.value.status,ExecutionAttemptStatus.TERMINAL);
    const packet=await resolveExecutionJudgmentBundle({artifactRegistry:p.f.registry,organizationArtifactRegistry:p.f.org,bundleRef:head.value.judgmentBundleRef});
    assert.equal(packet.completionDecision.verdict,"ACCEPT");
    identities[domain]={contract:work.contract.contractRef,input:work.inputRef,binding:head.value.bindingRef,attempt:head.value.executionAttemptId,policy:packet.binding.executionPolicyRef,strategy:packet.binding.executionStrategyRef,adapter:packet.binding.runtimeBinding.adapterRef,principal:packet.publicationReceipt.producerPrincipalRef};
  }
  for(const field of Object.keys(identities.FRONTEND))assert.notEqual(identities.FRONTEND[field],identities.BACKEND[field],field+" must differ");
  assert.deepEqual(p.f.counts.dispatches,{FRONTEND:1,BACKEND:1});
});

test("AC-6/INV-7 a Frontend outage after both dispatches start stays host-local; Backend reaches terminal",async t=>{
  const p=await parallelFixture(t,{frontendFailsAfterStart:true});
  const started=await p.runtime.startAll();
  assert.equal(started.BACKEND.status,"fulfilled");assert.equal(started.FRONTEND.status,"fulfilled");
  assert.ok(p.events.indexOf("FRONTEND:outage")>1&&p.events.indexOf("BACKEND:completed")>1);
  const beHead=await p.be.attemptStore.current(executionAttemptSubjectKey({projectId:p.beWork.contract.projectId,itemId:p.beWork.item.id,workContractRef:p.beWork.contract.contractRef}));
  const feHead=await p.fe.attemptStore.current(executionAttemptSubjectKey({projectId:p.feWork.contract.projectId,itemId:p.feWork.item.id,workContractRef:p.feWork.contract.contractRef}));
  assert.equal(beHead.value.status,ExecutionAttemptStatus.TERMINAL);
  assert.equal(feHead.value.status,ExecutionAttemptStatus.RECOVERY_REQUIRED);
  const bePacket=await resolveExecutionJudgmentBundle({artifactRegistry:p.f.registry,organizationArtifactRegistry:p.f.org,bundleRef:beHead.value.judgmentBundleRef});
  assert.equal(bePacket.completionDecision.verdict,"ACCEPT");
  assert.equal(JSON.stringify(bePacket).includes("FRONTEND"),false,"Backend judgment carries no failed-domain state");
  // The failure is visible only as the Frontend host's own settled reconcile result.
  const feRescan=await p.frontend.host.scanOnce();
  assert.deepEqual(feRescan,[]);
  await p.runtime.stopAll();
  assert.deepEqual(p.workerCalls,{FRONTEND:1,BACKEND:1});
});

test("AC-6 reverse outage: a Backend failure cannot gate Frontend progress",async t=>{
  const p=await parallelFixture(t,{backendFailsAfterStart:true});
  const direct=await Promise.allSettled([p.frontend.activation.reconcile(p.feWork.key),p.backend.activation.reconcile(p.beWork.key)]);
  assert.equal(direct[0].status,"fulfilled");assert.equal(direct[0].value.state,ActivationOutcome.EXECUTED);
  assert.equal(direct[0].value.execution.state,ExecutionAttemptStatus.TERMINAL);
  assert.equal(direct[1].status,"rejected");assert.match(direct[1].reason.message,/backend runtime outage/);
});

test("INV-6 Frontend modules import no Backend stage/session/completion; Backend strategy never calls Backend->QA",async()=>{
  const read=name=>readFile(new URL("../src/"+name,import.meta.url),"utf8");
  const imports=src=>[...src.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]);
  for(const name of ["frontend-contracts.js","frontend-completion.js","frontend-worker.js","frontend-application.js","frontend-execution-strategy.js"]){
    for(const spec of imports(await read(name)))assert.doesNotMatch(spec,/backend|qa-|durable-backend-qa|session-store/,name+" imports "+spec);
  }
  const backend=imports(await read("backend-execution-strategy.js"));
  for(const spec of backend)assert.doesNotMatch(spec,/durable-backend-qa|qa-|backend-qa/,"Backend strategy imports "+spec);
  const composition=(await read("domain-runtime-composition.js")).split("\n").filter(line=>!line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(composition,/queue|mutex|lock\(|stage|nextRole|nextDomain/i);
  assert.match(composition,/Promise\.allSettled/);
});
