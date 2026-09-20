import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  ClaimReleaseStatus,ExecutionAttemptStatus,
  claimReleaseSubjectKey,createDomainExecutionArtifactRegistry,createDomainExecutionController,
  createDomainExecutionPolicyPublisher,createJsonClaimReleaseStore,
  createJsonExecutionAttemptStore,createJsonImmutableArtifactStore,createOrganizationArtifactRegistry,
  defineExecutionStrategyDescriptor,defineOrganizationWorkContract,executionAttemptSubjectKey,
  executionPolicySubjectKey,resolveExecutionJudgmentBundle
} from "../src/index.js";
import {createJsonDomainExecutionPolicyStore} from "../src/domain-execution-store.js";

const SHA_A="a".repeat(64), SHA_B="b".repeat(64);
const output={ref:"requirement-set:sha256:"+SHA_A,digest:SHA_A};
const now="2026-09-20T02:30:00.000Z";

async function fixture({dispatchThrows=false,completionVerdict="ACCEPT"}={}){
  const dir=await mkdtemp(join(tmpdir(),"exharness-bb048-"));
  const immutable=createJsonImmutableArtifactStore({path:join(dir,"artifacts.json")});
  const org=createOrganizationArtifactRegistry({store:immutable});
  const domain=createDomainExecutionArtifactRegistry({store:immutable});
  const releaseStore=createJsonClaimReleaseStore({path:join(dir,"release-heads.json")});
  const policyStore=createJsonDomainExecutionPolicyStore({path:join(dir,"policy-heads.json")});
  const attemptStore=createJsonExecutionAttemptStore({path:join(dir,"attempt-heads.json")});
  const contract=defineOrganizationWorkContract({
    projectId:"project-1",rootItemId:"ROOT-1",rootIntentId:"INTENT-1",acceptedDecisionRef:"decision:accepted",
    materializationAuthorizationId:"mat-auth-1",materializationAuthorizationRef:"materialization-authorization:sha256:"+SHA_B,
    materializationAuthorizationGeneration:1,materializationAuthorizationRevision:"mat-rev-1",authorityPolicyRevision:"authority-policy-1",
    implementationArtifactRef:"implementation-input:bb048",sliceId:"slice-ba-1",obligationKey:"write-requirements",
    obligationSubjectKey:"obligation-subject-1",materializationKey:"materialization-key-1",boardItemId:"BA-1",
    owningDomain:"BUSINESS_ANALYSIS",workloadType:"requirements-analysis",summary:"Write one bounded requirement set",
    dependencyIds:[],requiredArtifactRefs:["user-intent:sha256:"+SHA_B],expectedArtifactKind:"REQUIREMENT_SET",
    expectedOutputRefs:[output.ref],acceptanceRefs:["acceptance:requirements-v1"]
  });
  assert.equal(await org.putWorkContract(contract),contract.contractRef);
  const receipt={kind:"CLAIM_RELEASE_RECEIPT",version:1,projectId:contract.projectId,rootItemId:contract.rootItemId,rootIntentId:contract.rootIntentId,itemId:contract.boardItemId,claimGeneration:1,workContractRef:contract.contractRef,boardOwner:"ba-worker",principalRef:"principal:ba-worker"};
  const receiptRef=await org.putClaimReleaseReceipt(receipt);
  const releaseKey=claimReleaseSubjectKey(contract.projectId,contract.boardItemId,1);
  assert.equal(await releaseStore.compareAndSwap(releaseKey,null,{status:ClaimReleaseStatus.RELEASED,receiptRef}),true);

  let executable=true,claimChecks=0,currentClaim={claimGeneration:1,receiptRef};
  const claimController={async assertExecutable(args){claimChecks+=1;assert.deepEqual(args,{itemId:contract.boardItemId,...currentClaim});if(!executable)throw new TypeError("claim stale");return true;}};
  async function advanceClaim(claimGeneration){
    const nextReceipt={...receipt,claimGeneration};
    const nextReceiptRef=await org.putClaimReleaseReceipt(nextReceipt);
    const nextKey=claimReleaseSubjectKey(contract.projectId,contract.boardItemId,claimGeneration);
    assert.equal(await releaseStore.compareAndSwap(nextKey,null,{status:ClaimReleaseStatus.RELEASED,receiptRef:nextReceiptRef}),true);
    currentClaim={claimGeneration,receiptRef:nextReceiptRef};
    return nextReceiptRef;
  }
  const strategy=defineExecutionStrategyDescriptor({strategyId:"ba.application-core-loop",strategyVersion:"1.0.0",strategyKind:"application-core-loop",compatibleWorkloadTypes:[contract.workloadType],compatibleWorkContractVersions:[1],adapterRef:"adapter:ba-core-loop@1",runtimeBindingMode:"IMMUTABLE_LOCAL",expectedRuntimeCodeRef:"git:sha256:"+SHA_B,contextRefs:["context:ba-v1"],toolsetRef:"toolset:ba-v1",modelProfileRef:null,harnessRef:"harness:core-v1"});
  const strategyRef=await domain.putExecutionStrategyDescriptor(strategy);
  const publisher=createDomainExecutionPolicyPublisher({policyAuthority:{async verifyExecutionPolicyPublisher({publisher}){assert.equal(publisher.identity,"policy-admin");return {authorityRef:"authority:domain-policy-publisher"};}},artifactRegistry:domain,executionPolicyStore:policyStore});
  const policyKey=executionPolicySubjectKey(contract.owningDomain,contract.workloadType);
  const published=await publisher.publish({publisher:{identity:"policy-admin"},policy:{policyId:policyKey,generation:1,status:"ACTIVE",domain:contract.owningDomain,workloadType:contract.workloadType,compatibleWorkContractVersions:[1],strategyRef,publishedByAuthorityRef:"spoofed"}});
  assert.equal(published.policy.publishedByAuthorityRef,"authority:domain-policy-publisher");

  let dispatches=0,recoveries=0,publications=0;
  const success=()=>({status:"SUCCEEDED",runtimeInvocationId:"runtime-invocation-1",runtimeDeploymentRef:"strategy-self-report-ignored",startedAt:now,finishedAt:now,effectRefs:["effect:1"],traceRefs:["trace:1"],outputArtifactRefs:[output],verificationCandidateRefs:["evidence:requirement-check"],counterevidenceRefs:[],proposedDerivationEdges:[{outputRef:output.ref,derivedFrom:[contract.requiredArtifactRefs[0]]}],accepted:true});
  const runtimeAdapter={adapterRef:strategy.adapterRef,runtimeKind:"local-process",runtimeDeploymentRef:strategy.expectedRuntimeCodeRef,producerAuthorityRef:"authority:trusted-runtime",async dispatch(){dispatches+=1;if(dispatchThrows)throw new Error("crash-after-dispatch");return success();},async recover(){recoveries+=1;return success();}};
  const completionEvaluator={authorityRef:"authority:ba-completion",async evaluate(){return {verdict:completionVerdict,criterionResults:[{criterionId:"requirements-complete",verdict:completionVerdict==="ACCEPT"?"PASS":"FAIL",evidenceRefs:["evidence:requirement-check"]}],counterevidenceRefs:[]};}};
  const publicationGate={authorityRef:"authority:ba-writer",producerPrincipalRef:"principal:ba-worker",async publish(){publications+=1;return {publishedArtifactRefs:[output],publishedClaimRefs:[],acceptedDerivationEdges:[{outputRef:output.ref,derivedFrom:[contract.requiredArtifactRefs[0]]}],publicationStoreRevision:"requirements-store:42"};}};
  const makeController=(overridePolicyStore=policyStore,adapter=runtimeAdapter,overrideAttemptStore=attemptStore)=>createDomainExecutionController({claimController,claimReleaseStore:releaseStore,organizationArtifactRegistry:org,artifactRegistry:domain,executionPolicyStore:overridePolicyStore,executionAttemptStore:overrideAttemptStore,runtimeAdapter:adapter,completionEvaluator,publicationGate});
  return {dir,immutable,org,domain,releaseStore,policyStore,attemptStore,contract,receiptRef,claimController,publisher,policyKey,strategy,strategyRef,runtimeAdapter,makeController,advanceClaim,setExecutable:v=>{executable=v;},counts:()=>({claimChecks,dispatches,recoveries,publications})};
}

async function cleanup(f){await rm(f.dir,{recursive:true,force:true});}

test("raw ExecutionPolicy head storage is not exposed on the application package surface",async()=>{
  const publicApi=await import("../src/index.js");
  assert.equal("createJsonDomainExecutionPolicyStore" in publicApi,false);
});

test("policy promotion cannot pass the final guard before first-attempt CAS commits",async()=>{
  const f=await fixture();
  try{
    const v2=defineExecutionStrategyDescriptor({...f.strategy,strategyVersion:"2.0.0"});
    const v2ref=await f.domain.putExecutionStrategyDescriptor(v2);
    let promotionPromise=null;
    let observedDuringCas=null;
    const guardedAttemptStore={
      current:(key)=>f.attemptStore.current(key),
      async compareAndSwap(key,expectedRevision,nextValue){
        if(expectedRevision===null&&promotionPromise==null){
          promotionPromise=f.publisher.publish({
            publisher:{identity:"policy-admin"},
            policy:{policyId:f.policyKey,generation:2,status:"ACTIVE",domain:f.contract.owningDomain,workloadType:f.contract.workloadType,compatibleWorkContractVersions:[1],strategyRef:v2ref}
          });
          await new Promise(resolve=>setTimeout(resolve,10));
          observedDuringCas=await f.policyStore.current(f.policyKey);
        }
        return f.attemptStore.compareAndSwap(key,expectedRevision,nextValue);
      }
    };
    const result=await f.makeController(f.policyStore,f.runtimeAdapter,guardedAttemptStore).execute({
      itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef
    });
    assert.equal(observedDuringCas.value.generation,1);
    const binding=await f.domain.resolveExecutionAttemptBinding(result.bindingRef);
    assert.equal(binding.executionPolicyRef,(await f.domain.resolveExecutionJudgmentBundle(result.judgmentBundleRef)).pins.executionPolicy.ref);
    await promotionPromise;
    assert.equal((await f.policyStore.current(f.policyKey)).value.generation,2);
  }finally{await cleanup(f);}
});

test("BB-048 emits a resolvable judgment chain and keeps runtime result separate from acceptance/publication",async()=>{
  const f=await fixture();
  try{
    const controller=f.makeController();
    const result=await controller.execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef,input:{question:"derive requirements"}});
    assert.equal(result.state,ExecutionAttemptStatus.TERMINAL);
    assert.equal(f.counts().dispatches,1);
    assert.equal(f.counts().publications,1);
    const packet=await resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:result.judgmentBundleRef});
    assert.equal(packet.binding.workContractRef,f.contract.contractRef);
    assert.equal(packet.runtimeAttestations[0].runtimeDeploymentRef,f.strategy.expectedRuntimeCodeRef);
    assert.equal(packet.outcome.status,"SUCCEEDED");
    assert.equal(packet.completionDecision.verdict,"ACCEPT");
    assert.ok(packet.publicationReceipt);
    assert.notEqual(packet.outcome.status,packet.completionDecision.verdict);
    const freshImmutable=createJsonImmutableArtifactStore({path:join(f.dir,"artifacts.json")});
    const fresh=await resolveExecutionJudgmentBundle({artifactRegistry:createDomainExecutionArtifactRegistry({store:freshImmutable}),organizationArtifactRegistry:createOrganizationArtifactRegistry({store:freshImmutable}),bundleRef:result.judgmentBundleRef});
    assert.equal(fresh.binding.executionAttemptId,result.executionAttemptId);
    const replay=await controller.execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef});
    assert.equal(replay.replayed,true);assert.equal(f.counts().dispatches,1);
    const alternate=defineExecutionStrategyDescriptor({...f.strategy,strategyVersion:"9.9.9"});
    const alternateRef=await f.domain.putExecutionStrategyDescriptor(alternate);
    const originalBundle=await f.domain.resolveExecutionJudgmentBundle(result.judgmentBundleRef);
    const forgedRef=await f.domain.putExecutionJudgmentBundle({...originalBundle,pins:{...originalBundle.pins,executionStrategy:{ref:alternateRef,digest:alternateRef.split(":").at(-1)}}});
    await assert.rejects(()=>resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:forgedRef}),/binding policy\/strategy relation mismatch/);
    const badDigestRef=await f.domain.putExecutionJudgmentBundle({...originalBundle,pins:{...originalBundle.pins,outcome:{...originalBundle.pins.outcome,digest:"c".repeat(64)}}});
    await assert.rejects(()=>resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:badDigestRef}),/execution outcome pin digest mismatch/);
    const missingOutcomeRef="execution-attempt-outcome:sha256:"+"d".repeat(64);
    const missingRef=await f.domain.putExecutionJudgmentBundle({...originalBundle,pins:{...originalBundle.pins,outcome:{ref:missingOutcomeRef,digest:"d".repeat(64)}}});
    await assert.rejects(()=>resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:missingRef}),/judgment source artifact missing/);
  }finally{await cleanup(f);}
});

test("recovery reuses the exact binding and ignores a later policy promotion",async()=>{
  const f=await fixture({dispatchThrows:true});
  try{
    const first=f.makeController();
    await assert.rejects(()=>first.execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef}),/crash-after-dispatch/);
    const key=executionAttemptSubjectKey({projectId:f.contract.projectId,itemId:f.contract.boardItemId,workContractRef:f.contract.contractRef});
    const crashed=await f.attemptStore.current(key);assert.equal(crashed.value.status,ExecutionAttemptStatus.RECOVERY_REQUIRED);const originalBinding=crashed.value.bindingRef;
    const v2=defineExecutionStrategyDescriptor({...f.strategy,strategyVersion:"2.0.0"});const v2ref=await f.domain.putExecutionStrategyDescriptor(v2);
    await f.publisher.publish({publisher:{identity:"policy-admin"},policy:{policyId:f.policyKey,generation:2,status:"ACTIVE",domain:f.contract.owningDomain,workloadType:f.contract.workloadType,compatibleWorkContractVersions:[1],strategyRef:v2ref}});
    const forbiddenPolicyRead={async current(){throw new Error("current policy must not be read during recovery");},async compareAndSwap(){throw new Error("policy mutation forbidden");}};
    const result=await f.makeController(forbiddenPolicyRead).execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef});
    assert.equal(result.recovered,true);assert.equal(result.bindingRef,originalBinding);assert.equal(f.counts().recoveries,1);
    const binding=await f.domain.resolveExecutionAttemptBinding(result.bindingRef);assert.equal(binding.executionStrategyRef,f.strategyRef);
  }finally{await cleanup(f);}
});

test("claim-generation takeover recovers the same semantic attempt while recording the current release",async()=>{
  const f=await fixture({dispatchThrows:true});
  try{
    await assert.rejects(()=>f.makeController().execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef}),/crash-after-dispatch/);
    const key=executionAttemptSubjectKey({projectId:f.contract.projectId,itemId:f.contract.boardItemId,workContractRef:f.contract.contractRef});
    const crashed=await f.attemptStore.current(key);
    const originalBinding=crashed.value.bindingRef;
    const receipt2=await f.advanceClaim(2);
    const result=await f.makeController().execute({itemId:f.contract.boardItemId,claimGeneration:2,receiptRef:receipt2});
    assert.equal(result.bindingRef,originalBinding);
    const packet=await resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:result.judgmentBundleRef});
    assert.equal(packet.binding.claimReleaseReceiptRef,f.receiptRef);
    assert.equal(packet.receipt.claimGeneration,1);
    assert.equal(packet.runtimeClaimReceipts.at(-1).claimGeneration,2);
    assert.equal(packet.runtimeAttestations.at(-1).dispatchAuthoritySnapshot.claimReleaseHead.receiptRef,receipt2);
  }finally{await cleanup(f);}
});

test("stale released claim fails before policy resolution or runtime dispatch",async()=>{
  const f=await fixture();
  try{
    f.setExecutable(false);
    const noPolicyRead={async current(){throw new Error("policy should not be read");},async compareAndSwap(){return false;}};
    await assert.rejects(()=>f.makeController(noPolicyRead).execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef}),/claim stale/);
    assert.equal(f.counts().dispatches,0);
  }finally{await cleanup(f);}
});

test("strategy descriptor refuses a cross-domain dispatcher kind",()=>{
  assert.throws(()=>defineExecutionStrategyDescriptor({
    strategyId:"org.cross-domain",
    strategyVersion:"1.0.0",
    strategyKind:"cross-domain-dispatcher",
    compatibleWorkloadTypes:["requirements-analysis"],
    compatibleWorkContractVersions:[1],
    adapterRef:"adapter:cross-domain@1",
    runtimeBindingMode:"IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef:"git:sha256:"+SHA_B,
    contextRefs:[]
  }),/unsupported strategy kind/);
});

test("strategy success cannot self-authorize domain ACCEPT or publication",async()=>{
  const f=await fixture({completionVerdict:"BLOCKED"});
  try{
    const result=await f.makeController().execute({itemId:f.contract.boardItemId,claimGeneration:1,receiptRef:f.receiptRef});
    const packet=await resolveExecutionJudgmentBundle({artifactRegistry:f.domain,organizationArtifactRegistry:f.org,bundleRef:result.judgmentBundleRef});
    assert.equal(packet.outcome.status,"SUCCEEDED");assert.equal(packet.completionDecision.verdict,"BLOCKED");assert.equal(packet.publicationReceipt,null);assert.equal(f.counts().publications,0);
  }finally{await cleanup(f);}
});
