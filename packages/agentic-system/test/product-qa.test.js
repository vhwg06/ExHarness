import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
// ---- shared Integration E/F fixture (duplicated per test file: no helper module is in write scope) ----
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  ClaimReleaseStatus,claimReleaseSubjectKey,createDomainExecutionArtifactRegistry,createDomainExecutionController,
  createDomainExecutionPolicyPublisher,createJsonClaimReleaseStore,createJsonExecutionAttemptStore,
  createJsonImmutableArtifactStore,createOrganizationArtifactRegistry,defineExecutionStrategyDescriptor,
  defineOrganizationWorkContract,executionPolicySubjectKey,
  createDeploymentArtifactRegistry,publishDeployableArtifact,createDevOpsExecutionStrategy,DEVOPS_DOMAIN,
  createDeploymentReleaseController,createDeploymentMutationGuard,createAcceptancePolicyResolver,createAcceptanceSnapshotBuilder,
  createRuntimeObserver,createProductQaExecutionStrategy,createProductQaCompletionEvaluator,createQualityAcceptancePublisher,PRODUCT_QA_DOMAIN
} from "../src/index.js";
import {createJsonDomainExecutionPolicyStore} from "../src/domain-execution-store.js";
import {createJsonCasHeadStore} from "../src/organization-authority-store.js";

const NOW="2026-09-30T12:00:00.000Z";
const hex=(seed)=>createHash("sha256").update(String(seed)).digest("hex");
const digestOf=(seed)=>"sha256:"+hex(seed);
const ENV="environment:staging";

async function openWorld(dir,{mutationGuard=createDeploymentMutationGuard()}={}){
  const immutable=createJsonImmutableArtifactStore({path:join(dir,"artifacts.json")});
  const w={dir,immutable,org:createOrganizationArtifactRegistry({store:immutable}),domain:createDomainExecutionArtifactRegistry({store:immutable}),
    deploy:createDeploymentArtifactRegistry({store:immutable}),releaseHeads:createJsonCasHeadStore({path:join(dir,"release-heads.json")}),
    acceptanceHeads:createJsonCasHeadStore({path:join(dir,"acceptance-heads.json")}),claimReleases:createJsonClaimReleaseStore({path:join(dir,"claim-releases.json")}),
    policies:createJsonDomainExecutionPolicyStore({path:join(dir,"policy-heads.json")}),attempts:createJsonExecutionAttemptStore({path:join(dir,"attempt-heads.json")}),mutationGuard};
  w.releases=createDeploymentReleaseController({artifactRegistry:w.deploy,releaseHeadStore:w.releaseHeads,domainArtifactRegistry:w.domain,organizationArtifactRegistry:w.org,mutationGuard});
  w.policyResolver=createAcceptancePolicyResolver({artifactRegistry:w.deploy});
  w.snapshots=createAcceptanceSnapshotBuilder({deploymentReleaseController:w.releases,artifactRegistry:w.deploy,acceptancePolicyResolver:w.policyResolver});
  w.acceptances=createQualityAcceptancePublisher({domainArtifactRegistry:w.domain,organizationArtifactRegistry:w.org,deploymentReleaseController:w.releases,artifactRegistry:w.deploy,qualityAcceptanceHeadStore:w.acceptanceHeads,snapshotResolver:w.snapshots,acceptanceAuthorityRef:"authority:product-qa-acceptance"});
  return w;
}
async function newWorld(t,options){const dir=await mkdtemp(join(tmpdir(),"exharness-bb054-"));t.after(()=>rm(dir,{recursive:true,force:true}));return openWorld(dir,options);}

// Runs one real DomainExecutionController attempt for a domain WorkContract whose single
// DomainExecutionInput carries objective; returns the terminal controller result.
async function runDomain(w,{domain,workloadType,objective,adapter,verdict="ACCEPT",completionEvaluator,item}){
  const inputRef=await w.org.putDomainExecutionInput({projectId:"project-1",owningDomain:domain,workloadType,objective});
  const contract=defineOrganizationWorkContract({projectId:"project-1",rootItemId:"ROOT-1",rootIntentId:"INTENT-1",acceptedDecisionRef:"decision:accepted",
    materializationAuthorizationId:"mat-auth-1",materializationAuthorizationRef:"materialization-authorization:sha256:"+hex("mat"),materializationAuthorizationGeneration:1,
    materializationAuthorizationRevision:"mat-rev-1",authorityPolicyRevision:"authority-policy-1",implementationArtifactRef:"implementation-input:bb054",sliceId:"slice-"+item,
    obligationKey:"obligation-"+item,obligationSubjectKey:"obligation-subject-"+item,materializationKey:"materialization-"+item,boardItemId:item,owningDomain:domain,workloadType,
    summary:"Integration E/F "+domain+" work",dependencyIds:[],requiredArtifactRefs:[inputRef],expectedArtifactKind:domain+"_EVIDENCE",expectedOutputRefs:[],acceptanceRefs:["acceptance:"+domain]});
  await w.org.putWorkContract(contract);
  const receiptRef=await w.org.putClaimReleaseReceipt({kind:"CLAIM_RELEASE_RECEIPT",version:1,projectId:contract.projectId,rootItemId:contract.rootItemId,rootIntentId:contract.rootIntentId,itemId:item,claimGeneration:1,workContractRef:contract.contractRef,boardOwner:domain+"-worker",principalRef:"principal:"+domain});
  await w.claimReleases.compareAndSwap(claimReleaseSubjectKey(contract.projectId,item,1),null,{status:ClaimReleaseStatus.RELEASED,receiptRef});
  const policyKey=executionPolicySubjectKey(domain,workloadType);
  if(!(await w.policies.current(policyKey))){
    const strategyRef=await w.domain.putExecutionStrategyDescriptor(defineExecutionStrategyDescriptor({strategyId:domain+".strategy",strategyVersion:"1.0.0",strategyKind:"application-core-loop",compatibleWorkloadTypes:[workloadType],compatibleWorkContractVersions:[1],adapterRef:adapter.adapterRef,runtimeBindingMode:"IMMUTABLE_LOCAL",expectedRuntimeCodeRef:adapter.runtimeDeploymentRef,contextRefs:[],toolsetRef:null,modelProfileRef:null,harnessRef:null}));
    await createDomainExecutionPolicyPublisher({policyAuthority:{async verifyExecutionPolicyPublisher(){return {authorityRef:"authority:policy-publisher"};}},artifactRegistry:w.domain,executionPolicyStore:w.policies})
      .publish({publisher:{identity:"policy-admin"},policy:{policyId:policyKey,generation:1,status:"ACTIVE",domain,workloadType,compatibleWorkContractVersions:[1],strategyRef}});
  }
  const claimController={async assertExecutable(){return true;},async withExecutablePublicationGuard(args,action){const lifecycleObservation={lifecycle:{itemId:item,status:"CLAIMED",claimGeneration:1},claimRelease:{subjectKey:claimReleaseSubjectKey(contract.projectId,item,1),revision:"release:1",receiptRef:args.receiptRef},principalRef:"principal:"+domain,workContractRef:contract.contractRef};return {observation:lifecycleObservation.lifecycle,result:await action(lifecycleObservation)};}};
  const publicationGate={authorityRef:"authority:"+domain+"-writer",producerPrincipalRef:"principal:"+domain,async withCurrentWriteAuthority(_scope,action){return action({authorityRef:"authority:"+domain+"-writer",revision:"writer:1"});},
    async publishIdempotent({publicationKey,outcome}){return {publicationKey,publishedArtifactRefs:outcome.outputArtifactRefs,acceptedDerivationEdges:outcome.proposedDerivationEdges,publishedClaimRefs:[],publicationStoreRevision:"publication:1"};}};
  const evaluator=completionEvaluator??{authorityRef:"authority:"+domain+"-completion",async evaluate(){return {verdict,criterionResults:[{criterionId:domain+"-done",verdict:verdict==="ACCEPT"?"PASS":"FAIL",evidenceRefs:[]}],counterevidenceRefs:[]};}};
  const controller=createDomainExecutionController({claimController,claimReleaseStore:w.claimReleases,organizationArtifactRegistry:w.org,artifactRegistry:w.domain,executionPolicyStore:w.policies,executionAttemptStore:w.attempts,runtimeAdapter:adapter,completionEvaluator:evaluator,publicationGate});
  const result=await controller.execute({itemId:item,claimGeneration:1,receiptRef});
  return {...result,contract,inputRef};
}
function outputAdapter(name,outputs){return {adapterRef:"adapter:"+name+"@1",runtimeKind:"fixture",runtimeDeploymentRef:"git:sha256:"+hex(name),producerAuthorityRef:"authority:"+name+"-runtime",
  async dispatch(){return {status:"SUCCEEDED",runtimeInvocationId:"invocation:"+name,startedAt:NOW,finishedAt:NOW,effectRefs:[],traceRefs:[],outputArtifactRefs:outputs,verificationCandidateRefs:[],counterevidenceRefs:[],proposedDerivationEdges:[]};},
  async recover(){return this.dispatch();}};}
// Accepted Frontend/Backend source delivery: a real ACCEPT completion + DomainPublicationReceipt.
async function sourceDelivery(w,kind,seed,verdict="ACCEPT"){
  const out={ref:kind.toLowerCase()+"-source:sha256:"+hex(seed),digest:hex(seed)};
  const run=await runDomain(w,{domain:kind,workloadType:kind.toLowerCase()+"-delivery",objective:{seed},adapter:outputAdapter(kind.toLowerCase()+"-delivery",[out]),verdict,item:kind+"-"+seed});
  return run.publicationReceiptRef??run.completionDecisionRef;
}
async function deployables(w,seed){
  const out={};
  for(const kind of ["BACKEND","FRONTEND"]){
    const sourceDeliveryRef=await sourceDelivery(w,kind,seed+"-"+kind);
    out[kind]=await publishDeployableArtifact({artifactRegistry:w.deploy,domainArtifactRegistry:w.domain,provenance:{componentKind:kind,sourceDeliveryRef,sourceRevision:hex("rev-"+seed+kind).slice(0,40),buildEvidenceRefs:["build-log:"+seed+kind],artifactDigest:digestOf("image-"+seed+kind),artifactUri:"registry.example/"+kind.toLowerCase()+"@"+digestOf("image-"+seed+kind),mutableTag:kind.toLowerCase()+":latest"}});
  }
  return out;
}
function devopsAdapter(w,{status="SUCCEEDED",calls=[]}={}){
  return createDevOpsExecutionStrategy({adapterRef:"adapter:devops@1",runtimeDeploymentRef:"git:sha256:"+hex("devops"),producerAuthorityRef:"authority:devops-runtime",resolveDomainExecutionInput:w.org.resolveDomainExecutionInput,artifactRegistry:w.deploy,domainArtifactRegistry:w.domain,now:()=>NOW,
    deployer:{async deploy(request){calls.push(request);return status==="SUCCEEDED"?{status,rolloutEvidenceRefs:["rollout:"+request.environmentRef+":"+request.components.map(c=>c.artifactDigest.slice(7,15)).join("+")]}:{status,reason:"ROLLOUT_FAILED"};}}});
}
async function deployRelease(w,seed,{verdict="ACCEPT",environmentRef=ENV}={}){
  const built=await deployables(w,seed);
  const run=await runDomain(w,{domain:DEVOPS_DOMAIN,workloadType:"deployment",objective:{environmentRef,configRef:"config:"+seed,deployableRefs:{BACKEND:built.BACKEND.deployableRef,FRONTEND:built.FRONTEND.deployableRef}},adapter:devopsAdapter(w),verdict,item:"DEVOPS-"+seed});
  return {built,run};
}
async function releaseFor(w,seed,options){const {built,run}=await deployRelease(w,seed,options);const published=await w.releases.publish({judgmentBundleRef:run.judgmentBundleRef});return {built,run,...published};}
async function acceptancePolicy(w,extra={}){return w.policyResolver.put({policyId:"policy:staging-v1",environmentRef:ENV,criterionRefs:["criterion:login","criterion:checkout"],verifierPolicyRef:"verifier-policy:v1",observerRefs:["observer:edge-probe"],...extra});}
function probeAdapter(served){return {calls:[],async observe(request){this.calls.push(request);return {observations:request.components.map(c=>({componentKind:c.componentKind,servedDigests:served[c.componentKind]??[],probeRefs:["probe:"+c.componentKind]}))};}};}
function qaStrategy(w,{observer,verifier}){
  return createProductQaExecutionStrategy({adapterRef:"adapter:product-qa@1",runtimeDeploymentRef:"git:sha256:"+hex("qa"),producerAuthorityRef:"authority:qa-runtime",resolveDomainExecutionInput:w.org.resolveDomainExecutionInput,snapshotResolver:w.snapshots,deploymentReleaseController:w.releases,runtimeObserver:observer,criterionVerifier:verifier??{async verify({criterionRef}){return {verdict:"PASS",evidenceRefs:["qa-check:"+criterionRef]};}},artifactRegistry:w.deploy,now:()=>NOW});
}
function observerFor(w,served,{observerRef="observer:edge-probe",adapter=probeAdapter(served)}={}){return createRuntimeObserver({observerRef,observerPolicyRef:"observer-policy:v1",adapter,artifactRegistry:w.deploy,snapshotResolver:w.snapshots,now:()=>NOW});}
async function runQa(w,{snapshotRef,observer,verifier,verdict,item="QA-1"}){
  const adapter=qaStrategy(w,{observer,verifier});
  const completionEvaluator=verdict?undefined:createProductQaCompletionEvaluator({authorityRef:"authority:product-qa-completion",artifactRegistry:w.deploy});
  return runDomain(w,{domain:PRODUCT_QA_DOMAIN,workloadType:"acceptance-qa",objective:{snapshotRef},adapter,verdict,completionEvaluator,item});
}
const servedFor=(release)=>Object.fromEntries(release.components.map(c=>[c.componentKind,[c.artifactDigest]]));
// ---- end shared fixture ----
import {qualityAcceptanceSubjectKey} from "../src/index.js";

async function qaWorld(t){
  const w=await newWorld(t);
  const released=await releaseFor(w,"qa");
  const acceptancePolicyRef=await acceptancePolicy(w);
  const {snapshotRef,snapshot}=await w.snapshots.build({releaseRef:released.releaseRef,acceptancePolicyRef});
  return {w,released,snapshotRef,snapshot,acceptancePolicyRef};
}
const noAcceptance=async w=>assert.equal(await w.acceptanceHeads.current(qualityAcceptanceSubjectKey(ENV)),null);

test("matching independent observation, passing criteria and an ACCEPT QA completion publish one QualityAcceptance", async t => {
  const {w,released,snapshotRef}=await qaWorld(t);
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,servedFor(released.release))});
  const decision=await w.domain.resolveDomainCompletionDecision(qa.completionDecisionRef);
  assert.equal(decision.verdict,"ACCEPT");
  await noAcceptance(w);
  const {acceptanceRef,acceptance}=await w.acceptances.publish({judgmentBundleRef:qa.judgmentBundleRef,snapshotRef});
  assert.match(acceptanceRef,/^quality-acceptance:sha256:/);
  assert.equal(acceptance.releaseRef,released.releaseRef);
  assert.equal(acceptance.snapshotRef,snapshotRef);
  assert.equal(acceptance.qaCompletionDecisionRef,qa.completionDecisionRef);
  assert.equal(acceptance.qaPublicationReceiptRef,qa.publicationReceiptRef);
  assert.equal(acceptance.acceptanceAuthorityRef,"authority:product-qa-acceptance");
  const current=await w.acceptances.currentFor(ENV);
  assert.equal(current.acceptanceRef,acceptanceRef);
  assert.equal(current.current,true);
});

test("an independent observer mismatch yields no QualityAcceptance", async t => {
  const {w,released,snapshotRef}=await qaWorld(t);
  const served={...servedFor(released.release),BACKEND:[digestOf("wrong-backend")]};
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,served)});
  assert.equal((await w.domain.resolveDomainCompletionDecision(qa.completionDecisionRef)).verdict,"REMEDIATION_REQUIRED");
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:qa.judgmentBundleRef,snapshotRef}),/requires an ACCEPT Product QA completion decision/);
  // Even a QA completion that wrongly says ACCEPT cannot accept a mismatched runtime identity.
  const forced=await runQa(w,{snapshotRef,observer:observerFor(w,served),verdict:"ACCEPT",item:"QA-forced"});
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:forced.judgmentBundleRef,snapshotRef}),/runtime identity MISMATCH is not acceptable/);
  await noAcceptance(w);
});

test("a mixed old/new rollout is not accepted by default", async t => {
  const {w,released,snapshotRef}=await qaWorld(t);
  const expected=servedFor(released.release);
  const served={...expected,FRONTEND:[...expected.FRONTEND,digestOf("old-frontend")]};
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,served)});
  assert.equal((await w.domain.resolveDomainCompletionDecision(qa.completionDecisionRef)).verdict,"REMEDIATION_REQUIRED");
  const forced=await runQa(w,{snapshotRef,observer:observerFor(w,served),verdict:"ACCEPT",item:"QA-mixed-forced"});
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:forced.judgmentBundleRef,snapshotRef}),/runtime identity MIXED is not acceptable/);
  await noAcceptance(w);
});

test("a matching runtime observation without an ACCEPT completion and publication creates no QualityAcceptance", async t => {
  const {w,released,snapshotRef}=await qaWorld(t);
  const failing={async verify({criterionRef}){return {verdict:criterionRef==="criterion:checkout"?"FAIL":"PASS",evidenceRefs:[]};}};
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,servedFor(released.release)),verifier:failing});
  const outcome=await w.domain.resolveExecutionAttemptOutcome(qa.outcomeRef);
  const observationRef=outcome.outputArtifactRefs.find(o=>o.ref.startsWith("runtime-observation-evidence:")).ref;
  assert.equal((await w.deploy.resolveRuntimeObservationEvidence(observationRef)).status,"MATCH");
  assert.equal(qa.publicationReceiptRef,null);
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:qa.judgmentBundleRef,snapshotRef}),/requires an ACCEPT Product QA completion decision/);
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:observationRef,snapshotRef}),/ExecutionJudgmentBundle ref kind mismatch/);
  await noAcceptance(w);
});

test("QA strategy SUCCEEDED with a non-ACCEPT completion creates no QualityAcceptance", async t => {
  const {w,released,snapshotRef}=await qaWorld(t);
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,servedFor(released.release)),verdict:"INCONCLUSIVE"});
  const outcome=await w.domain.resolveExecutionAttemptOutcome(qa.outcomeRef);
  assert.equal(outcome.status,"SUCCEEDED");
  assert.equal(qa.publicationReceiptRef,null);
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:qa.judgmentBundleRef,snapshotRef}),/QA SUCCEEDED or a matching observation alone is not acceptance/);
  await noAcceptance(w);
});

test("DevOps cannot issue a QA verdict and a QA judgment for another snapshot cannot accept this one", async t => {
  const {w,released,snapshotRef,acceptancePolicyRef}=await qaWorld(t);
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:released.run.judgmentBundleRef,snapshotRef}),/only a PRODUCT_QA judgment can publish QualityAcceptance/);
  const qa=await runQa(w,{snapshotRef,observer:observerFor(w,servedFor(released.release))});
  const otherPolicy=await acceptancePolicy(w,{policyId:"policy:staging-v2"});
  const other=await w.snapshots.build({releaseRef:released.releaseRef,acceptancePolicyRef:otherPolicy});
  assert.notEqual(other.snapshotRef,snapshotRef);
  await assert.rejects(w.acceptances.publish({judgmentBundleRef:qa.judgmentBundleRef,snapshotRef:other.snapshotRef}),/executed for another AcceptanceSnapshot/);
  assert.ok(acceptancePolicyRef);
  await noAcceptance(w);
});
