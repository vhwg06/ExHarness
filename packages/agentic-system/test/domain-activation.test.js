import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createEvidenceArtifact,environmentRefFromValue,subjectFromValue} from "../../core-harness/src/index.js";
import {createJsonExecutionAuthorityPolicyStore,createJsonMaterializationAuthorizationStore} from "../src/organization-authority-store.js";
import {createJsonDomainExecutionPolicyStore} from "../src/domain-execution-store.js";
import {
  ActivationOutcome,ActivationReason,AuthorityHeadStatus,BackendRecoveryAction,BackendWorkStatus,ExecutionAttemptStatus,
  FrontendWorkStatus,createApplicationOrchestrator,createBackendExecutionStrategy,createDomainActivation,createDomainActivationHost,
  createDomainActivationSource,createDomainExecutionArtifactRegistry,createDomainExecutionController,createDomainExecutionPolicyPublisher,
  createFrontendExecutionStrategy,createFrontendWorker,createJsonBlackboardStore,createJsonClaimReleaseStore,createJsonExecutionAttemptStore,
  createJsonImmutableArtifactStore,createObligationCurrentnessReader,createOrganizationArtifactRegistry,createOrganizationAuthorityPublisher,
  createOrganizationWorkClaimController,createOrganizationWorkDiscovery,createOrganizationWorkMaterializer,createSessionHandoffSurface,
  defineExecutionStrategyDescriptor,executionPolicySubjectKey,resolveExecutionJudgmentBundle
} from "../src/index.js";

// Shared BB-053 fixture: real Board, materializer, discovery, organization claim controller and
// per-domain DomainExecutionControllers. Only runtime workers, completion and publication are stubs.
export const PROJECT="project-1", ROOT_INTENT="root", DECISION="decision://accepted-1";
export const PRINCIPALS=Object.freeze({
  fe:{identity:"fe-1",principalRef:"principal://fe-1"},
  be:{identity:"be-1",principalRef:"principal://be-1"},
  ba:{identity:"ba-1",principalRef:"principal://ba-1"}
});
const TOKEN_FOR={FRONTEND:"fe",BACKEND:"be",BUSINESS_ANALYSIS:"ba"};
const reviewTrust={trustPolicyFor(){return {};},verifySignature(){return false;},verifyEvaluatorAuthority(){return false;},verifyEvidenceAuthority(){return false;}};

export function evidence(claim,status="PASS"){
  return createEvidenceArtifact({
    subject:subjectFromValue({claim},{type:"domain-candidate"}),kind:"VERIFICATION",
    producer:{identity:"test:"+claim,roles:["verifier"]},environment:environmentRefFromValue({runner:"test"},{name:"test"}),
    content:{claim,status},metadata:{claim,verificationStatus:status},generatedAt:"2026-09-30T00:00:00.000Z"
  });
}
export const appliedResult=(domain,{claims,status}={})=>{
  const prefix=domain==="FRONTEND"?"frontend":"backend";
  return {
    status:status??(domain==="FRONTEND"?FrontendWorkStatus.APPLIED:BackendWorkStatus.APPLIED),
    summary:prefix+" change applied",revision:prefix+"-rev-2",
    artifacts:[{ref:"workspace://"+prefix+"-rev-2/src/"+prefix+".js",path:"src/"+prefix+".js"}],
    evidence:(claims??[prefix+".mutation",prefix+".typecheck",prefix+".tests"]).map(c=>evidence(c)),
    gaps:[],blockers:(status==="BLOCKED"?["blocked by test"]:[])
  };
};
export const repositoryReader={async readFile({repositoryRef,revision,path}){return {content:"// "+path+"\n",sourceRef:repositoryRef+"@"+revision+":"+path};}};
export const objectiveFor=(domain,key)=>({task:"Implement "+key,repository:{ref:"repo://"+domain.toLowerCase(),revision:"rev-1"},requiredFiles:["src/"+key+".js"]});

export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
export function manualTimer(){
  const handles=new Map();let next=1;
  return {
    setInterval(fn){const id=next++;handles.set(id,fn);return id;},
    clearInterval(id){handles.delete(id);},
    get active(){return handles.size;},
    async tick(){await Promise.all([...handles.values()].map(fn=>fn()));}
  };
}

export async function domainFixture(t){
  const dir=await mkdtemp(join(tmpdir(),"exharness-bb053-"));
  t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:20}));
  const orchestrator=createApplicationOrchestrator({store:createJsonBlackboardStore({path:join(dir,"board.json")}),reviewTrust});
  await createSessionHandoffSurface({orchestrator,projectId:PROJECT}).initialize({userIntent:{id:ROOT_INTENT,source:"USER",objective:"Build product",bullets:[],constraints:[]},items:[]});
  const artifactStore=createJsonImmutableArtifactStore({path:join(dir,"artifacts.json")});
  const org=createOrganizationArtifactRegistry({store:artifactStore});
  const registry=createDomainExecutionArtifactRegistry({store:artifactStore});
  const materializationAuthorizationStore=createJsonMaterializationAuthorizationStore({path:join(dir,"materialization.json")});
  const executionAuthorityPolicyStore=createJsonExecutionAuthorityPolicyStore({path:join(dir,"execution-authority.json")});
  const claimReleaseStore=createJsonClaimReleaseStore({path:join(dir,"release.json")});
  const admin={identity:"authority-admin"};
  const publisher=createOrganizationAuthorityPublisher({
    organizationAuthority:{
      verifyMaterializationAuthorizationIssuer:async({publisher})=>publisher.identity===admin.identity?{authorityRef:"authority://organization-admin"}:null,
      verifyExecutionAuthorityPolicyPublisher:async({publisher})=>publisher.identity===admin.identity?{authorityRef:"authority://organization-admin"}:null
    },artifactRegistry:org,materializationAuthorizationStore,executionAuthorityPolicyStore
  });
  await publisher.publishExecutionAuthorityPolicy({publisher:admin,policy:{policyId:"organization-execution-authority",projectId:PROJECT,authorityPolicyRevision:"organization-authority-policy:v1",generation:1,status:AuthorityHeadStatus.ACTIVE,bindings:[
    {principalRef:PRINCIPALS.fe.principalRef,authorizedDomains:["FRONTEND"]},
    {principalRef:PRINCIPALS.be.principalRef,authorizedDomains:["BACKEND"]},
    {principalRef:PRINCIPALS.ba.principalRef,authorizedDomains:["BUSINESS_ANALYSIS"]}
  ]}});
  const executionPrincipalProvider={
    async resolve(context){const p=PRINCIPALS[context?.token];if(!p)throw new TypeError("trusted execution principal is unavailable");return p;},
    async resolveByIdentity(identity){const p=Object.values(PRINCIPALS).find(x=>x.identity===identity);if(!p)throw new TypeError("trusted execution principal is unavailable");return p;}
  };
  const materializer=createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry:org});
  const discovery=createOrganizationWorkDiscovery({orchestrator,artifactRegistry:org});
  const realClaim=createOrganizationWorkClaimController({orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry:org,executionPrincipalProvider,executionAuthorityPolicyId:"organization-execution-authority"});
  const counts={claimCalls:0,claimSuccesses:0,releases:0,attempts:{},dispatches:{},dispatchStarted:{},recoveries:{},executes:{},publications:{}};
  const bump=(bucket,domain)=>{counts[bucket][domain]=(counts[bucket][domain]??0)+1;};
  let releaseHook=null;
  const claimController=Object.freeze({
    ...realClaim,
    async claim(args){counts.claimCalls+=1;const result=await realClaim.claim(args);counts.claimSuccesses+=1;return result;},
    async release(args){const released=await realClaim.release(args);counts.releases+=1;if(releaseHook)await releaseHook(released);return released;}
  });

  async function addWork({key,owningDomain,workloadType=owningDomain.toLowerCase()+"-change",objective=objectiveFor(owningDomain,key),dependencyIds=[],extraInputs=[]}){
    const inputRef=await org.putDomainExecutionInput({projectId:PROJECT,owningDomain,workloadType,objective});
    const authorizationId="auth:"+key;
    await publisher.publishMaterializationAuthorization({publisher:admin,authorization:{authorizationId,projectId:PROJECT,rootIntentId:ROOT_INTENT,authorityPolicyRevision:"organization-authority-policy:v1",generation:1,status:AuthorityHeadStatus.ACTIVE,acceptedDecisionRef:DECISION,implementationArtifactRef:"artifact://"+key,authorizedSliceIds:[key],authorizedObligationKeys:[key],owningDomain,workloadType}});
    const work=await materializer.materialize({authorizationId,decision:{ref:DECISION,obligationKeys:[key]},obligation:{key,sliceId:key,summary:"Implement "+key,owningDomain,workloadType,dependencyIds,requiredArtifactRefs:[inputRef,...extraInputs],expectedArtifactKind:owningDomain+"_CHANGE",expectedOutputRefs:[],acceptanceRefs:["acceptance://"+key]}});
    return {...work,inputRef,key:{projectId:PROJECT,workId:work.item.id,owningDomain}};
  }

  async function domainStack({domain,workloadType=domain.toLowerCase()+"-change",adapter,strategyVersion="1.0.0"}){
    const policyStore=createJsonDomainExecutionPolicyStore({path:join(dir,domain+"-policy.json")});
    const attemptStoreRaw=createJsonExecutionAttemptStore({path:join(dir,domain+"-attempts.json")});
    const attemptStore={
      current:(key)=>attemptStoreRaw.current(key),
      async compareAndSwap(key,expected,next){const ok=await attemptStoreRaw.compareAndSwap(key,expected,next);if(ok&&expected===null)bump("attempts",domain);return ok;}
    };
    const strategy=defineExecutionStrategyDescriptor({strategyId:domain.toLowerCase()+".application",strategyVersion,strategyKind:"application-core-loop",compatibleWorkloadTypes:[workloadType],compatibleWorkContractVersions:[1],adapterRef:adapter.adapterRef,runtimeBindingMode:"IMMUTABLE_LOCAL",expectedRuntimeCodeRef:adapter.runtimeDeploymentRef,contextRefs:["context:"+domain],toolsetRef:"toolset:"+domain,modelProfileRef:null,harnessRef:"harness:"+domain});
    const strategyRef=await registry.putExecutionStrategyDescriptor(strategy);
    const policyPublisher=createDomainExecutionPolicyPublisher({policyAuthority:{async verifyExecutionPolicyPublisher({publisher}){return publisher.identity==="policy-admin"?{authorityRef:"authority:"+domain+"-policy"}:null;}},artifactRegistry:registry,executionPolicyStore:policyStore});
    const policyKey=executionPolicySubjectKey(domain,workloadType);
    await policyPublisher.publish({publisher:{identity:"policy-admin"},policy:{policyId:policyKey,generation:1,status:"ACTIVE",domain,workloadType,compatibleWorkContractVersions:[1],strategyRef}});
    const counted={
      adapterRef:adapter.adapterRef,runtimeKind:adapter.runtimeKind,runtimeDeploymentRef:adapter.runtimeDeploymentRef,producerAuthorityRef:adapter.producerAuthorityRef,
      async dispatch(input){bump("dispatches",domain);return adapter.dispatch(input);},
      async recover(input){bump("recoveries",domain);return adapter.recover(input);}
    };
    const principal=PRINCIPALS[TOKEN_FOR[domain]];
    const published=new Map();
    const publicationGate={
      authorityRef:"authority:"+domain+"-writer",producerPrincipalRef:principal.principalRef,
      async withCurrentWriteAuthority({domain:d,producerPrincipalRef},action){assert.equal(d,domain);assert.equal(producerPrincipalRef,principal.principalRef);return action({authorityRef:"authority:"+domain+"-writer",revision:domain+"-writer:1"});},
      async publishIdempotent(args){
        if(published.has(args.publicationKey))return published.get(args.publicationKey);
        bump("publications",domain);
        const result={publicationKey:args.publicationKey,publishedArtifactRefs:args.outcome.outputArtifactRefs,publishedClaimRefs:[],acceptedDerivationEdges:args.outcome.proposedDerivationEdges,publicationStoreRevision:domain+"-store:"+published.size};
        published.set(args.publicationKey,result);return result;
      }
    };
    const completionEvaluator={authorityRef:"authority:"+domain+"-completion",async evaluate({outcome}){
      const pass=outcome.status==="SUCCEEDED";
      return {verdict:pass?"ACCEPT":"BLOCKED",criterionResults:[{criterionId:domain+"-complete",verdict:pass?"PASS":"FAIL",evidenceRefs:outcome.verificationCandidateRefs}],counterevidenceRefs:[]};
    }};
    const controller=createDomainExecutionController({claimController,claimReleaseStore,organizationArtifactRegistry:org,artifactRegistry:registry,executionPolicyStore:policyStore,executionAttemptStore:attemptStore,runtimeAdapter:counted,completionEvaluator,publicationGate});
    const executionController=Object.freeze({async execute(args){bump("executes",domain);return controller.execute(args);}});
    return {domain,workloadType,policyStore,attemptStore,strategy,strategyRef,policyKey,executionController};
  }

  function activationFor(stack,{principalToken=TOKEN_FOR[stack.domain],owningDomain=stack.domain,source=createDomainActivationSource({discovery}),obligationCurrentness=null}={}){
    return createDomainActivation({owningDomain,principalContext:{token:principalToken},source,claimController,executionController:stack.executionController,obligationCurrentness,readBlackboard:()=>orchestrator.readBlackboard()});
  }
  function hostFor(stack,{timer=manualTimer(),activation=activationFor(stack),onError=null}={}){
    return {timer,activation,host:createDomainActivationHost({owningDomain:stack.domain,discovery:createDomainActivationSource({discovery}),activation,scanIntervalMs:50,timer,onError})};
  }
  const item=async(id)=>(await orchestrator.readBlackboard()).items.find(entry=>entry.id===id);
  return {dir,orchestrator,org,registry,artifactStore,discovery,claimController,realClaim,claimReleaseStore,counts,addWork,domainStack,activationFor,hostFor,item,setReleaseHook:h=>{releaseHook=h;}};
}

// Adapters built from the real Frontend/Backend execution strategies over stub workers.
export function frontendAdapter(f,{executor}={}){
  const frontendWorker=createFrontendWorker({executor:executor??{async execute(){return appliedResult("FRONTEND");}}});
  return createFrontendExecutionStrategy({adapterRef:"adapter:frontend@1",runtimeDeploymentRef:"git:sha256:"+"f".repeat(64),producerAuthorityRef:"authority:frontend-runtime",resolveDomainExecutionInput:f.org.resolveDomainExecutionInput,repositoryReader,frontendWorker,now:()=>"2026-09-30T04:00:00.000Z"});
}
export function backendAdapter(f,{execute}={}){
  const backendWorker={
    async execute(order,context){return execute?execute(order,context):appliedResult("BACKEND");},
    async recover(){return {action:BackendRecoveryAction.RETRY_EXECUTION,result:null,blockers:[]};}
  };
  return createBackendExecutionStrategy({adapterRef:"adapter:backend@1",runtimeDeploymentRef:"git:sha256:"+"b".repeat(64),producerAuthorityRef:"authority:backend-runtime",resolveDomainExecutionInput:f.org.resolveDomainExecutionInput,repositoryReader,backendWorker,now:()=>"2026-09-30T04:00:00.000Z"});
}

test("INV-3 activation exposes only exact-key reconcile and domain scan; no ranking, next-role or stage API",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const activation=f.activationFor(fe);
  const source=createDomainActivationSource({discovery:f.discovery});
  const {host}=f.hostFor(fe);
  assert.deepEqual(Object.keys(activation).sort(),["owningDomain","reconcile"]);
  assert.deepEqual(Object.keys(source).sort(),["read","scan"]);
  assert.deepEqual(Object.keys(host).sort(),["notify","owningDomain","scanOnce","start","stop"]);
  for(const surface of [activation,source,host])for(const forbidden of ["nextRole","nextDomain","priority","rank","stage","schedule","select"])assert.equal(forbidden in surface,false);
  await assert.rejects(activation.reconcile({projectId:PROJECT,owningDomain:"FRONTEND"}),/workId/);
});

test("AC-3 wrong host, key or contract domain cannot claim, attempt or dispatch",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const backendWork=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  const feActivation=f.activationFor(fe);
  // Host domain FRONTEND, key domain BACKEND.
  const hostMismatch=await feActivation.reconcile(backendWork.key);
  assert.equal(hostMismatch.state,ActivationOutcome.REJECTED);assert.equal(hostMismatch.reason,ActivationReason.DOMAIN_MISMATCH);
  // Key forged to FRONTEND for BACKEND-owned work: canonical FRONTEND read finds nothing.
  const keyForged=await feActivation.reconcile({...backendWork.key,owningDomain:"FRONTEND"});
  assert.equal(keyForged.state,ActivationOutcome.NOOP);assert.equal(keyForged.reason,ActivationReason.NOT_ACTIONABLE);
  // A lying source that returns the BACKEND contract for a FRONTEND key is rejected before claim.
  const lying={async read(){return {item:backendWork.item,contract:backendWork.contract};}};
  const contractMismatch=await f.activationFor(fe,{source:lying}).reconcile({...backendWork.key,owningDomain:"FRONTEND"});
  assert.equal(contractMismatch.state,ActivationOutcome.REJECTED);assert.equal(contractMismatch.reason,ActivationReason.CONTRACT_MISMATCH);
  // A correctly scoped BACKEND activation with a FRONTEND principal is refused by the claim authority.
  await assert.rejects(f.activationFor(be,{principalToken:"fe"}).reconcile(backendWork.key));
  assert.equal(f.counts.claimSuccesses,0);
  assert.deepEqual(f.counts.attempts,{});assert.deepEqual(f.counts.dispatches,{});assert.deepEqual(f.counts.executes,{});
  assert.equal((await f.item(backendWork.item.id)).status,"READY");
  const ok=await f.activationFor(be).reconcile(backendWork.key);
  assert.equal(ok.state,ActivationOutcome.EXECUTED);assert.equal(ok.execution.state,ExecutionAttemptStatus.TERMINAL);
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
});

test("INV-1/INV-4 spoofed hint authority is inert: host principal, controller policy/strategy and adapter decide",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const work=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  const seen=[];
  const spy={async execute(args){seen.push(structuredClone(args));return fe.executionController.execute(args);}};
  const activation=f.activationFor({...fe,executionController:spy});
  const result=await activation.reconcile({...work.key,principalContext:{token:"be"},owner:"attacker",strategyRef:"strategy:forged",policyRef:"policy:forged",adapterRef:"adapter:forged",crossDomainObligationRef:"cross-domain-obligation:sha256:"+"0".repeat(64),publicationReceiptRef:"forged",priority:1,nextRole:"QA"});
  assert.equal(result.state,ActivationOutcome.EXECUTED);
  assert.deepEqual(seen.map(a=>Object.keys(a).sort()),[["claimGeneration","itemId","receiptRef"]]);
  assert.equal((await f.item(work.item.id)).owner,PRINCIPALS.fe.identity);
  const packet=await resolveExecutionJudgmentBundle({artifactRegistry:f.registry,organizationArtifactRegistry:f.org,bundleRef:result.execution.judgmentBundleRef});
  assert.equal(packet.binding.executionStrategyRef,fe.strategyRef);
  assert.equal(packet.binding.runtimeBinding.adapterRef,"adapter:frontend@1");
  assert.equal(packet.binding.workContractRef,work.contract.contractRef);
  assert.equal(packet.publicationReceipt.producerPrincipalRef,PRINCIPALS.fe.principalRef);
  assert.equal(packet.completionDecision.verdict,"ACCEPT");
});

test("AC-2 concurrent duplicate scan/notify/reconcile hints converge to one claim, attempt and dispatch",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const work=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  const {host,activation}=f.hostFor(be);
  const secondHost=f.activationFor(be);
  const results=await Promise.all([host.scanOnce(),host.notify(work.key),activation.reconcile(work.key),secondHost.reconcile(work.key)]);
  const outcomes=[results[0][0].value,results[1],results[2],results[3]];
  assert.equal(outcomes.filter(o=>o.state===ActivationOutcome.EXECUTED).length,1);
  for(const o of outcomes.filter(o=>o.state!==ActivationOutcome.EXECUTED)){
    assert.equal(o.state,ActivationOutcome.NOOP);
    assert.ok([ActivationReason.DUPLICATE_IN_FLIGHT,ActivationReason.CLAIM_CONTENDED,ActivationReason.NOT_ACTIONABLE].includes(o.reason),o.reason);
  }
  assert.equal(f.counts.claimSuccesses,1);
  assert.deepEqual(f.counts.attempts,{BACKEND:1});assert.deepEqual(f.counts.dispatches,{BACKEND:1});
  // Replayed hints after terminal execution stay NOOP.
  const replay=await host.notify(work.key);
  assert.equal(replay.state,ActivationOutcome.NOOP);assert.equal(replay.reason,ActivationReason.NOT_ACTIONABLE);
  assert.deepEqual(await host.scanOnce(),[]);
  assert.deepEqual(f.counts.dispatches,{BACKEND:1});
});

test("AC-4 obligation drift between release and execute yields NOOP with no attempt or dispatch",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const work=await f.addWork({key:"be-api",owningDomain:"BACKEND"});
  // Reader over a controlled head: ACTIVE at pre-claim, SUPERSEDED after release.
  const contract={...work.contract,crossDomainObligationRef:"cross-domain-obligation:sha256:"+"1".repeat(64),crossDomainObligationSubjectKey:"cross-domain-obligation:subject-a"};
  let head={revisionRef:contract.crossDomainObligationRef,status:"ACTIVE"};
  const reader=createObligationCurrentnessReader({resolveObligation:async()=>({subjectKey:contract.crossDomainObligationSubjectKey}),currentHead:async()=>head});
  const source={async read(key){const found=await createDomainActivationSource({discovery:f.discovery}).read(key);return found&&{item:found.item,contract};}};
  const claimController={...f.claimController,async claim(args){const claimed=await f.claimController.claim(args);return {...claimed,contract};}};
  f.setReleaseHook(async()=>{head={revisionRef:"cross-domain-obligation:sha256:"+"2".repeat(64),status:"ACTIVE"};});
  const activation=createDomainActivation({owningDomain:"BACKEND",principalContext:{token:"be"},source,claimController,executionController:be.executionController,obligationCurrentness:reader});
  const result=await activation.reconcile(work.key);
  assert.equal(result.state,ActivationOutcome.NOOP);assert.equal(result.reason,ActivationReason.OBLIGATION_DRIFT_AFTER_RELEASE);
  assert.equal(f.counts.releases,1);
  assert.deepEqual(f.counts.attempts,{});assert.deepEqual(f.counts.dispatches,{});assert.deepEqual(f.counts.executes,{});
});

test("INV-5 activation and its currentness reader hold no obligation write capability",async t=>{
  const f=await domainFixture(t);
  const be=await f.domainStack({domain:"BACKEND",adapter:backendAdapter(f)});
  const reader=createObligationCurrentnessReader({resolveObligation:async()=>({subjectKey:"s"}),currentHead:async()=>null});
  assert.deepEqual(Object.keys(reader),["current"]);
  assert.deepEqual(await reader.current("cross-domain-obligation:sha256:"+"3".repeat(64)),{obligationRef:"cross-domain-obligation:sha256:"+"3".repeat(64),subjectKey:"s",revision:null,status:"ABSENT"});
  const activation=f.activationFor(be,{obligationCurrentness:reader});
  for(const forbidden of ["publish","invalidate","commitAcceptedPublication","putObligation","materialize","supersede"])assert.equal(forbidden in activation,false);
});
