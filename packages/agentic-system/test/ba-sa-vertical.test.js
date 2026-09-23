import test from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {fixture,claim,obligation} from "./cross-domain-obligation.test.js";
import {productRevision} from "../src/product-lineage.js";
import {createDependencyInvalidationController} from "../src/dependency-invalidation.js";
import {createJsonMaterializationAuthorizationStore,createJsonExecutionAuthorityPolicyStore} from "../src/organization-authority-store.js";
import {createJsonDomainExecutionPolicyStore} from "../src/domain-execution-store.js";
import {createApplicationOrchestrator,createJsonBlackboardStore,createSessionHandoffSurface,createOrganizationAuthorityPublisher,createOrganizationWorkMaterializer,createOrganizationWorkClaimController,createJsonClaimReleaseStore,claimReleaseSubjectKey,createDomainExecutionPolicyPublisher,defineExecutionStrategyDescriptor,executionPolicySubjectKey,createJsonExecutionAttemptStore,createDomainExecutionController} from "../src/index.js";

export async function boardFixture(t){
  const f=await fixture(t);
  const orchestrator=createApplicationOrchestrator({store:createJsonBlackboardStore({path:join(f.dir,"board.json")}),reviewTrust:{trustPolicyFor(){return {};},verifySignature(){return false;},verifyEvaluatorAuthority(){return false;},verifyEvidenceAuthority(){return false;}}});
  await createSessionHandoffSurface({orchestrator,projectId:"p"}).initialize({userIntent:{id:"intent",source:"USER",objective:"Build product",bullets:[],constraints:[]},items:[]});
  const materializationAuthorizationStore=createJsonMaterializationAuthorizationStore({path:join(f.dir,"materialization.json")});
  const executionAuthorityPolicyStore=createJsonExecutionAuthorityPolicyStore({path:join(f.dir,"execution-authority.json")});
  const claimReleaseStore=createJsonClaimReleaseStore({path:join(f.dir,"release.json")});
  const publisher=createOrganizationAuthorityPublisher({organizationAuthority:{async verifyMaterializationAuthorizationIssuer({publisher}){return publisher.identity==="admin"?{authorityRef:"organization-admin"}:null;},async verifyExecutionAuthorityPolicyPublisher({publisher}){return publisher.identity==="admin"?{authorityRef:"organization-admin"}:null;}},artifactRegistry:f.org,materializationAuthorizationStore,executionAuthorityPolicyStore});
  await publisher.publishExecutionAuthorityPolicy({publisher:{identity:"admin"},policy:{policyId:"execution-authority",projectId:"p",authorityPolicyRevision:"org-v1",generation:1,status:"ACTIVE",bindings:[{principalRef:"principal:SA",authorizedDomains:["SA"]}]}});
  const principal={identity:"sa-worker",principalRef:"principal:SA"};
  const claimController=createOrganizationWorkClaimController({orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry:f.org,executionPrincipalProvider:{async resolve(context){assert.equal(context.token,"sa");return principal;},async resolveByIdentity(identity){assert.equal(identity,principal.identity);return principal;}},executionAuthorityPolicyId:"execution-authority",lineage:f.lineage});
  const materializer=createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry:f.org,lineage:f.lineage});
  const invalidator=createDependencyInvalidationController({lineage:f.lineage,orchestrator,artifactRegistry:f.org,claimController});
  async function materialize(o,id="authorization:"+o.obligationKey){
    const ref=productRevision(o).ref,current=await f.lineage.assertCurrent(ref),receipt=await f.registry.resolveDomainPublicationReceipt(current.head.publicationReceiptRef);
    await publisher.publishMaterializationAuthorization({publisher:{identity:"admin"},authorization:{authorizationId:id,projectId:"p",rootIntentId:"intent",authorityPolicyRevision:"org-v1",generation:1,status:"ACTIVE",acceptedDecisionRef:receipt.completionDecisionRef,implementationArtifactRef:ref,authorizedSliceIds:[o.obligationKey],authorizedObligationKeys:[o.obligationKey],owningDomain:o.targetDomain,workloadType:o.workloadType}});
    return materializer.materializeCrossDomain({authorizationId:id,obligationRef:ref});
  }
  return {...f,orchestrator,claimController,claimReleaseStore,materializer,materialize,invalidator,publisher};
}

test("BA obligation deterministically materializes SA work and SA policy alone chooses execution",async t=>{
  const f=await boardFixture(t),requirement=claim("detail");await f.publish([requirement]);
  const o=obligation(requirement);await f.publish([o],{inputs:[productRevision(requirement).ref]});
  const work=await f.materialize(o);
  const replay=await f.materializer.materializeCrossDomain({authorizationId:"authorization:design",obligationRef:productRevision(o).ref});
  assert.equal(replay.item.id,work.item.id);assert.equal(replay.contract.contractRef,work.contract.contractRef);
  assert.equal(work.contract.owningDomain,"SA");
  assert.equal(work.contract.crossDomainObligationRef,productRevision(o).ref);
  const claimed=await f.claimController.claim({itemId:work.item.id,principalContext:{token:"sa"}});
  const released={receipt:await f.claimController.release({itemId:work.item.id,claimGeneration:claimed.item.claimGeneration,principalContext:{token:"sa"}})};
  const policyStore=createJsonDomainExecutionPolicyStore({path:join(f.dir,"sa-policy.json")});
  const strategy=defineExecutionStrategyDescriptor({strategyId:"sa-design",strategyVersion:"1",strategyKind:"application-core-loop",compatibleWorkloadTypes:["solution-design"],compatibleWorkContractVersions:[1],adapterRef:"sa-adapter:1",runtimeBindingMode:"IMMUTABLE_LOCAL",expectedRuntimeCodeRef:"git:sa-v1",contextRefs:[]});
  const strategyRef=await f.registry.putExecutionStrategyDescriptor(strategy);
  const policyPublisher=createDomainExecutionPolicyPublisher({policyAuthority:{async verifyExecutionPolicyPublisher({publisher}){assert.equal(publisher,"sa-admin");return {authorityRef:"sa-policy-authority"};}},artifactRegistry:f.registry,executionPolicyStore:policyStore});
  await policyPublisher.publish({publisher:"sa-admin",policy:{policyId:executionPolicySubjectKey("SA","solution-design"),domain:"SA",workloadType:"solution-design",generation:1,strategyRef,compatibleWorkContractVersions:[1]}});
  const architecture=productRevision(claim("architecture","design","SA"));
  await f.artifactStore.put("semantic-claim",architecture.value);
  let dispatches=0;
  const success=()=>({status:"SUCCEEDED",runtimeInvocationId:"sa-invocation",startedAt:"2026-09-22T00:00:00Z",finishedAt:"2026-09-22T00:00:01Z",outputArtifactRefs:[{ref:architecture.ref,digest:architecture.ref.split(":").at(-1)}],proposedDerivationEdges:[{outputRef:architecture.ref,derivedFrom:[productRevision(o).ref]}]});
  const controller=createDomainExecutionController({claimController:f.claimController,claimReleaseStore:f.claimReleaseStore,organizationArtifactRegistry:f.org,artifactRegistry:f.registry,executionPolicyStore:policyStore,executionAttemptStore:createJsonExecutionAttemptStore({path:join(f.dir,"attempts.json")}),runtimeAdapter:{adapterRef:strategy.adapterRef,runtimeKind:"local",runtimeDeploymentRef:strategy.expectedRuntimeCodeRef,producerAuthorityRef:"sa-runtime",async dispatch({binding}){dispatches++;assert.equal(binding.owningDomain,"SA");assert.equal(binding.executionStrategyRef,strategyRef);return success();},async recover(){return success();}},completionEvaluator:{authorityRef:"sa-completion",async evaluate(){return {verdict:"ACCEPT",criterionResults:[{criterionId:"design",verdict:"PASS",evidenceRefs:["verification:design"]}]};}},publicationGate:f.gates.SA});
  await controller.execute({itemId:work.item.id,claimGeneration:released.receipt.claimGeneration,receiptRef:released.receipt.receiptRef});
  assert.equal(dispatches,1);assert.equal((await f.lineage.assertCurrent(architecture.ref)).head.status,"ACTIVE");
});

test("semantic invalidation fences exact claimed obligation work and preserves unrelated work",async t=>{
  const f=await boardFixture(t),detail=claim("detail"),list=claim("list");await f.publish([detail,list]);
  const a=obligation(detail),b=obligation(list,{obligationKey:"list-design"});
  await f.publish([a],{inputs:[productRevision(detail).ref]});await f.publish([b],{inputs:[productRevision(list).ref]});
  const wa=await f.materialize(a),wb=await f.materialize(b);
  const claimed=await f.claimController.claim({itemId:wa.item.id,principalContext:{token:"sa"}});
  const released={receipt:await f.claimController.release({itemId:wa.item.id,claimGeneration:claimed.item.claimGeneration,principalContext:{token:"sa"}})};
  await f.publish([claim("detail","v2")]);
  await assert.rejects(f.claimController.assertExecutable({itemId:wa.item.id,claimGeneration:released.receipt.claimGeneration,receiptRef:released.receipt.receiptRef}),/not ACTIVE/);
  assert.deepEqual(await f.invalidator.reconcileWork(),[wa.item.id]);
  const board=await f.orchestrator.readBlackboard();
  assert.equal(board.items.find(i=>i.id===wa.item.id).status,"BLOCKED");
  assert.equal(board.items.find(i=>i.id===wb.item.id).status,"READY");
  assert.deepEqual(board.items.find(i=>i.id===wb.item.id).dependsOn,wb.item.dependsOn);
  assert.equal((await f.claimReleaseStore.current(claimReleaseSubjectKey("p",wa.item.id,released.receipt.claimGeneration))).value.status,"FENCED");
  await assert.rejects(f.materializer.materializeCrossDomain({authorizationId:"authorization:design",obligationRef:productRevision(a).ref}),/not ACTIVE/);
  await f.invalidator.invalidate({subjectKeys:[productRevision(b).subjectKey],status:"REVOKED",reasonRef:"revocation:test"});
  await assert.rejects(f.materializer.materializeCrossDomain({authorizationId:"authorization:list-design",obligationRef:productRevision(b).ref}),/not ACTIVE/);
  assert.equal((await f.orchestrator.readBlackboard()).items.find(i=>i.id===wb.item.id).status,"BLOCKED");
});
