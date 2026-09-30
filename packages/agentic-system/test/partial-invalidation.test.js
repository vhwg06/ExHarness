import test from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {boardFixture} from "./ba-sa-vertical.test.js";
import {claim,obligation} from "./cross-domain-obligation.test.js";
import {productRevision} from "../src/product-lineage.js";
import {createJsonDomainExecutionPolicyStore} from "../src/domain-execution-store.js";
import {
  ActivationOutcome,ActivationReason,ExecutionAttemptStatus,createDomainActivation,createDomainActivationSource,createDomainExecutionController,
  createDomainExecutionPolicyPublisher,createJsonExecutionAttemptStore,createOrganizationWorkDiscovery,defineExecutionStrategyDescriptor,executionPolicySubjectKey,
  obligationCurrentnessFromLineage
} from "../src/index.js";

async function saFixture(t){
  const f=await boardFixture(t);
  const detail=claim("detail"),list=claim("list");await f.publish([detail,list]);
  const a=obligation(detail),b=obligation(list,{obligationKey:"list-design"});
  await f.publish([a],{inputs:[productRevision(detail).ref]});await f.publish([b],{inputs:[productRevision(list).ref]});
  const wa=await f.materialize(a),wb=await f.materialize(b);
  const counts={claims:0,attempts:0,dispatches:0,executes:0};
  let releaseHook=null;
  const claimController={...f.claimController,
    async claim(args){counts.claims+=1;return f.claimController.claim(args);},
    async release(args){const r=await f.claimController.release(args);if(releaseHook)await releaseHook(r);return r;}};
  const policyStore=createJsonDomainExecutionPolicyStore({path:join(f.dir,"sa-activation-policy.json")});
  const strategy=defineExecutionStrategyDescriptor({strategyId:"sa-design",strategyVersion:"1",strategyKind:"application-core-loop",compatibleWorkloadTypes:["solution-design"],compatibleWorkContractVersions:[1],adapterRef:"sa-adapter:1",runtimeBindingMode:"IMMUTABLE_LOCAL",expectedRuntimeCodeRef:"git:sa-v1",contextRefs:[]});
  const strategyRef=await f.registry.putExecutionStrategyDescriptor(strategy);
  await createDomainExecutionPolicyPublisher({policyAuthority:{async verifyExecutionPolicyPublisher(){return {authorityRef:"sa-policy-authority"};}},artifactRegistry:f.registry,executionPolicyStore:policyStore})
    .publish({publisher:"sa-admin",policy:{policyId:executionPolicySubjectKey("SA","solution-design"),domain:"SA",workloadType:"solution-design",generation:1,strategyRef,compatibleWorkContractVersions:[1]}});
  const rawAttempts=createJsonExecutionAttemptStore({path:join(f.dir,"sa-activation-attempts.json")});
  const attemptStore={current:k=>rawAttempts.current(k),async compareAndSwap(k,e,n){const ok=await rawAttempts.compareAndSwap(k,e,n);if(ok&&e===null)counts.attempts+=1;return ok;}};
  const controller=createDomainExecutionController({claimController,claimReleaseStore:f.claimReleaseStore,organizationArtifactRegistry:f.org,artifactRegistry:f.registry,executionPolicyStore:policyStore,executionAttemptStore:attemptStore,
    runtimeAdapter:{adapterRef:strategy.adapterRef,runtimeKind:"local",runtimeDeploymentRef:strategy.expectedRuntimeCodeRef,producerAuthorityRef:"sa-runtime",
      async dispatch({contract}){counts.dispatches+=1;assert.equal(contract.owningDomain,"SA");return {status:"SUCCEEDED",runtimeInvocationId:"sa-"+contract.boardItemId,startedAt:"2026-09-30T00:00:00Z",finishedAt:"2026-09-30T00:00:01Z",outputArtifactRefs:[],proposedDerivationEdges:[]};},
      async recover(){throw new Error("unexpected recovery");}},
    completionEvaluator:{authorityRef:"sa-completion",async evaluate(){return {verdict:"ACCEPT",criterionResults:[{criterionId:"design",verdict:"PASS",evidenceRefs:[]}]};}},
    publicationGate:{authorityRef:"sa-writer",producerPrincipalRef:"principal:SA",async withCurrentWriteAuthority(_,action){return action({authorityRef:"sa-writer",revision:"sa-writer:1"});},async publishIdempotent(args){return {publicationKey:args.publicationKey,publishedArtifactRefs:[],publishedClaimRefs:[],acceptedDerivationEdges:[],publicationStoreRevision:"sa:1"};}}});
  const executionController={async execute(args){counts.executes+=1;return controller.execute(args);}};
  const source=createDomainActivationSource({discovery:createOrganizationWorkDiscovery({orchestrator:f.orchestrator,artifactRegistry:f.org})});
  const activation=createDomainActivation({owningDomain:"SA",principalContext:{token:"sa"},source,claimController,executionController,obligationCurrentness:obligationCurrentnessFromLineage({lineage:f.lineage}),readBlackboard:()=>f.orchestrator.readBlackboard()});
  const keyOf=w=>({projectId:"p",workId:w.item.id,owningDomain:"SA"});
  const status=async id=>(await f.orchestrator.readBlackboard()).items.find(i=>i.id===id).status;
  return {...f,a,b,wa,wb,counts,activation,source,keyOf,status,setReleaseHook:h=>{releaseHook=h;}};
}

test("AC-4 supersession after release fences execution through the post-release recheck; sibling executes",async t=>{
  const f=await saFixture(t);
  f.setReleaseHook(async()=>{f.setReleaseHook(null);await f.publish([claim("detail","v2")]);});
  const fenced=await f.activation.reconcile(f.keyOf(f.wa));
  assert.equal(fenced.state,ActivationOutcome.NOOP);assert.equal(fenced.reason,ActivationReason.OBLIGATION_DRIFT_AFTER_RELEASE);
  assert.equal(f.counts.attempts,0);assert.equal(f.counts.dispatches,0);assert.equal(f.counts.executes,0);
  // Canonical invalidation/release fencing stays with BB-052's dependency invalidation.
  assert.deepEqual(await f.invalidator.reconcileWork(),[f.wa.item.id]);
  assert.equal(await f.status(f.wa.item.id),"BLOCKED");
  const sibling=await f.activation.reconcile(f.keyOf(f.wb));
  assert.equal(sibling.state,ActivationOutcome.EXECUTED);assert.equal(sibling.execution.state,ExecutionAttemptStatus.TERMINAL);
  assert.equal(f.counts.dispatches,1);
});

test("AC-8/INV-8 partial upstream invalidation suppresses only A; stale hints stay inert; next scan executes B",async t=>{
  const f=await saFixture(t);
  await f.publish([claim("detail","v2")]);
  assert.equal((await f.lineage.snapshot()).heads[productRevision(f.a).subjectKey].status,"STALE");
  assert.equal((await f.lineage.snapshot()).heads[productRevision(f.b).subjectKey].status,"ACTIVE");
  const staleHint=await f.activation.reconcile(f.keyOf(f.wa));
  assert.equal(staleHint.state,ActivationOutcome.NOOP);assert.equal(staleHint.reason,ActivationReason.OBLIGATION_NOT_CURRENT);
  assert.equal(f.counts.claims,0);
  const keys=await f.source.scan({owningDomain:"SA"});
  const results=await Promise.all(keys.map(k=>f.activation.reconcile(k)));
  const byId=Object.fromEntries(results.map(r=>[r.key.workId,r]));
  assert.equal(byId[f.wa.item.id].reason,ActivationReason.OBLIGATION_NOT_CURRENT);
  assert.equal(byId[f.wb.item.id].state,ActivationOutcome.EXECUTED);
  assert.equal(f.counts.claims,1);assert.equal(f.counts.attempts,1);assert.equal(f.counts.dispatches,1);
  await f.invalidator.reconcileWork();
  const afterFence=await f.activation.reconcile(f.keyOf(f.wa));
  assert.equal(afterFence.reason,ActivationReason.NOT_ACTIONABLE);
  assert.equal(f.counts.claims,1);
});

test("INV-5 forged obligation hint data is inert and activation never writes product lineage",async t=>{
  const f=await saFixture(t);
  await f.publish([claim("detail","v2")]);
  const before=await f.lineage.snapshot();
  const forged=await f.activation.reconcile({...f.keyOf(f.wa),crossDomainObligationRef:productRevision(f.b).ref,crossDomainObligationSubjectKey:productRevision(f.b).subjectKey,status:"ACTIVE"});
  assert.equal(forged.reason,ActivationReason.OBLIGATION_NOT_CURRENT);
  await f.activation.reconcile(f.keyOf(f.wb));
  assert.deepEqual(await f.lineage.snapshot(),before);
  assert.equal(f.counts.dispatches,1);
});
