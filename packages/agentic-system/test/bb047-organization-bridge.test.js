import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthorityHeadStatus,
  BlackboardStatus,
  ClaimReleaseStatus,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createJsonClaimReleaseStore,
  createJsonImmutableArtifactStore,
  createOrganizationArtifactRegistry,
  createOrganizationAuthorityPublisher,
  createJsonExecutionAuthorityPolicyStore,
  createJsonMaterializationAuthorizationStore,
  createOrganizationWorkClaimController,
  createOrganizationWorkMaterializer
} from "../src/index.js";

function reviewTrustStub(){
  return {
    trustPolicyFor(){return {};},
    verifySignature(){return false;},
    verifyEvaluatorAuthority(){return false;},
    verifyEvidenceAuthority(){return false;}
  };
}

async function publish(store,key,value){
  const current=await store.current(key);
  const ok=await store.compareAndSwap(key,current?.revision??null,value);
  assert.equal(ok,true);
  return store.current(key);
}

function decision(){return {ref:"decision://accepted-1",obligationKeys:["requirements"]};}
function obligation(){return {
  key:"requirements",
  summary:"Analyze product requirements",
  owningDomain:"BUSINESS_ANALYSIS",
  workloadType:"requirements-analysis",
  inputRefs:["intent://root"],
  expectedOutputRefs:["artifact://srs"],
  acceptanceRefs:["acceptance://requirements"]
};}
function materializationHead(){return {
  authorizationId:"auth-1",
  generation:1,
  status:AuthorityHeadStatus.ACTIVE,
  authorizationRef:"authorization://auth-1/g1",
  acceptedDecisionRef:"decision://accepted-1",
  obligationKeys:["requirements"],
  owningDomain:"BUSINESS_ANALYSIS",
  workloadType:"requirements-analysis"
};}
function policyHead(){return {
  policyId:"organization-execution-authority",
  generation:1,
  status:AuthorityHeadStatus.ACTIVE,
  policyRef:"policy://organization-execution-authority/g1",
  principalDomains:{
    "ba-1":["BUSINESS_ANALYSIS"],
    "be-1":["BACKEND"]
  }
};}

async function withFixture(run){
  const root=await mkdtemp(join(tmpdir(),"exharness-bb047-"));
  try{
    const orchestrator=createApplicationOrchestrator({
      store:createJsonBlackboardStore({path:join(root,"board.json")}),
      reviewTrust:reviewTrustStub()
    });
    const materializationAuthorizationStore=createJsonMaterializationAuthorizationStore({path:join(root,"materialization.json")});
    const executionAuthorityPolicyStore=createJsonExecutionAuthorityPolicyStore({path:join(root,"policy.json")});
    const claimReleaseStore=createJsonClaimReleaseStore({path:join(root,"release.json")});
    const artifactRegistry=createOrganizationArtifactRegistry({store:createJsonImmutableArtifactStore({path:join(root,"artifacts.json")})});
    const organizationAuthority={
      verifyMaterializationAuthorizationIssuer:async({publisher})=>publisher.identity==="authority-admin",
      verifyExecutionAuthorityPolicyPublisher:async({publisher})=>publisher.identity==="authority-admin"
    };
    const publisher=createOrganizationAuthorityPublisher({organizationAuthority,artifactRegistry,materializationAuthorizationStore,executionAuthorityPolicyStore});
    await publisher.publishMaterializationAuthorization({publisher:{identity:"authority-admin"},authorization:materializationHead()});
    await publisher.publishExecutionAuthorityPolicy({publisher:{identity:"authority-admin"},policy:policyHead()});
    const materializer=createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry});
    const materialized=await materializer.materialize({
      authorizationId:"auth-1",
      decision:decision(),
      obligation:obligation()
    });
    const controller=createOrganizationWorkClaimController({
      orchestrator,
      materializationAuthorizationStore,
      executionAuthorityPolicyStore,
      claimReleaseStore,
      artifactRegistry
    });
    await run({
      root,orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,
      claimReleaseStore,artifactRegistry,publisher,materializer,materialized,controller
    });
  }finally{
    await rm(root,{recursive:true,force:true});
  }
}

test("durable CAS authority heads survive restart and stale writers fail closed",async()=>{
  const root=await mkdtemp(join(tmpdir(),"exharness-bb047-cas-"));
  try{
    const path=join(root,"authority.json");
    const first=createJsonExecutionAuthorityPolicyStore({path});
    const published=await publish(first,"policy",policyHead());
    const restarted=createJsonExecutionAuthorityPolicyStore({path});
    assert.deepEqual((await restarted.current("policy")).value,policyHead());
    const stale=await restarted.compareAndSwap("policy","stale-revision",{...policyHead(),generation:2});
    assert.equal(stale,false);
    assert.equal((await restarted.current("policy")).revision,published.revision);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("materialization is exact-scope, deterministic, and duplicate retries converge",async()=>{
  await withFixture(async({materializer,materialized,orchestrator})=>{
    const duplicate=await materializer.materialize({
      authorizationId:"auth-1",decision:decision(),obligation:obligation()
    });
    assert.equal(duplicate.item.id,materialized.item.id);
    assert.equal(duplicate.contract.contractRef,materialized.contract.contractRef);
    assert.equal((await orchestrator.readBlackboard()).items.length,1);
    await assert.rejects(
      ()=>materializer.materialize({
        authorizationId:"auth-1",
        decision:{ref:"decision://accepted-1",obligationKeys:["requirements"]},
        obligation:{...obligation(),key:"backend-code"}
      }),
      /outside accepted decision scope/
    );
  });
});

test("domain authorization precedes claim and CLAIMED stays provisional until durable release",async()=>{
  await withFixture(async({controller,materialized,orchestrator})=>{
    await assert.rejects(
      ()=>controller.claim({
        itemId:materialized.item.id,
        principal:{identity:"be-1"},
        authorizationId:"auth-1",
        policyId:"organization-execution-authority"
      }),
      /not authorized for domain BUSINESS_ANALYSIS/
    );
    assert.equal((await orchestrator.readBlackboard()).items[0].status,BlackboardStatus.READY);

    const claimed=await controller.claim({
      itemId:materialized.item.id,
      principal:{identity:"ba-1"},
      authorizationId:"auth-1",
      policyId:"organization-execution-authority"
    });
    assert.equal(claimed.item.status,BlackboardStatus.CLAIMED);
    await assert.rejects(
      ()=>controller.assertExecutable({
        itemId:materialized.item.id,
        claimGeneration:claimed.item.claimGeneration,
        receiptRef:"claim-release:none",
        authorizationId:"auth-1",
        policyId:"organization-execution-authority"
      }),
      /claim release is not current\/released/
    );

    const released=await controller.release({
      itemId:materialized.item.id,
      claimGeneration:claimed.item.claimGeneration,
      principal:{identity:"ba-1"},
      authorizationId:"auth-1",
      policyId:"organization-execution-authority"
    });
    const duplicate=await controller.release({
      itemId:materialized.item.id,
      claimGeneration:claimed.item.claimGeneration,
      principal:{identity:"ba-1"},
      authorizationId:"auth-1",
      policyId:"organization-execution-authority"
    });
    assert.equal(duplicate.receiptRef,released.receiptRef);
    assert.equal(await controller.assertExecutable({
      itemId:materialized.item.id,
      claimGeneration:claimed.item.claimGeneration,
      receiptRef:released.receiptRef,
      authorizationId:"auth-1",
      policyId:"organization-execution-authority"
    }),true);
  });
});

test("claim recovery advances generation and fences the prior released capability",async()=>{
  await withFixture(async({controller,materialized,claimReleaseStore})=>{
    const claimed=await controller.claim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const released=await controller.release({
      itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const recovered=await controller.recoverClaim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority",reason:"controller takeover"
    });
    assert.equal(recovered.item.claimGeneration,claimed.item.claimGeneration+1);
    const oldHead=await claimReleaseStore.current(`${materialized.item.id}:${claimed.item.claimGeneration}`);
    assert.equal(oldHead.value.status,ClaimReleaseStatus.FENCED);
    await assert.rejects(
      ()=>controller.assertExecutable({
        itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,
        receiptRef:released.receiptRef,authorizationId:"auth-1",policyId:"organization-execution-authority"
      }),
      /claim release is not current\/released/
    );
  });
});

test("authority head changes revoke execution entry without rewriting the historical receipt",async()=>{
  await withFixture(async({controller,materialized,executionAuthorityPolicyStore})=>{
    const claimed=await controller.claim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const released=await controller.release({
      itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const current=await executionAuthorityPolicyStore.current("organization-execution-authority");
    await executionAuthorityPolicyStore.compareAndSwap("organization-execution-authority",current.revision,{
      ...policyHead(),
      generation:2,
      status:AuthorityHeadStatus.REVOKED,
      policyRef:"policy://organization-execution-authority/g2"
    });
    await assert.rejects(
      ()=>controller.assertExecutable({
        itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,
        receiptRef:released.receiptRef,authorizationId:"auth-1",policyId:"organization-execution-authority"
      }),
      /execution authority policy is no longer active/
    );
  });
});

test("canonical Board invalidation commits before release fencing, so fence failure remains safe",async()=>{
  await withFixture(async({orchestrator,materialized,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore})=>{
    const base=createOrganizationWorkClaimController({
      orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore
    });
    const claimed=await base.claim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    await base.release({
      itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const failingReleaseStore={
      current:(key)=>claimReleaseStore.current(key),
      async compareAndSwap(key,expected,next){
        if(next.status===ClaimReleaseStatus.FENCED) throw new Error("injected release-fence failure");
        return claimReleaseStore.compareAndSwap(key,expected,next);
      }
    };
    const controller=createOrganizationWorkClaimController({
      orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,
      claimReleaseStore:failingReleaseStore
    });
    await assert.rejects(
      ()=>controller.invalidateOrganizationClaim({
        itemId:materialized.item.id,
        expectedOwner:"ba-1",
        expectedClaimGeneration:claimed.item.claimGeneration,
        kind:"EXECUTION_AUTHORITY_INVALIDATED",
        invalidationRef:"invalidation://policy-revoked"
      }),
      /injected release-fence failure/
    );
    const item=(await orchestrator.readBlackboard()).items[0];
    assert.equal(item.status,BlackboardStatus.REOPENED);
    assert.equal(item.owner,null);
    assert.equal(item.claimGeneration,claimed.item.claimGeneration);
  });
});

test("work-authorization invalidation blocks canonical work without incrementing generation",async()=>{
  await withFixture(async({controller,materialized,orchestrator})=>{
    const claimed=await controller.claim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const invalidated=await controller.invalidateOrganizationClaim({
      itemId:materialized.item.id,
      expectedOwner:"ba-1",
      expectedClaimGeneration:claimed.item.claimGeneration,
      kind:"WORK_AUTHORIZATION_INVALIDATED",
      invalidationRef:"invalidation://authorization-revoked"
    });
    assert.equal(invalidated.status,BlackboardStatus.BLOCKED);
    assert.equal(invalidated.claimGeneration,claimed.item.claimGeneration);
    assert.match(invalidated.blockers[0],/WORK_AUTHORIZATION_INVALIDATED/);
    assert.equal((await orchestrator.readBlackboard()).items[0].owner,null);
  });
});


test("fresh process resolves work contract from durable ref and rejects untrusted authority publisher",async()=>{
  await withFixture(async({root,materialized,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry})=>{
    const restartedOrchestrator=createApplicationOrchestrator({
      store:createJsonBlackboardStore({path:join(root,"board.json")}),
      reviewTrust:reviewTrustStub()
    });
    const restartedRegistry=createOrganizationArtifactRegistry({store:createJsonImmutableArtifactStore({path:join(root,"artifacts.json")})});
    assert.ok(await restartedRegistry.resolveWorkContract(materialized.contract.contractRef));
    const restarted=createOrganizationWorkClaimController({
      orchestrator:restartedOrchestrator,
      materializationAuthorizationStore,
      executionAuthorityPolicyStore,
      claimReleaseStore,
      artifactRegistry:restartedRegistry
    });
    const claimed=await restarted.claim({
      itemId:materialized.item.id,
      principal:{identity:"ba-1"},
      authorizationId:"auth-1",
      policyId:"organization-execution-authority"
    });
    assert.equal(claimed.contract.contractRef,materialized.contract.contractRef);

    const rejecting=createOrganizationAuthorityPublisher({
      organizationAuthority:{
        verifyMaterializationAuthorizationIssuer:async()=>false,
        verifyExecutionAuthorityPolicyPublisher:async()=>false
      },
      artifactRegistry,
      materializationAuthorizationStore,
      executionAuthorityPolicyStore
    });
    await assert.rejects(
      ()=>rejecting.publishExecutionAuthorityPolicy({
        publisher:{identity:"ba-1"},
        policy:{...policyHead(),generation:2}
      }),
      /authority publisher is not trusted/
    );
  });
});

test("same invalidation replay reconciles a prior Board-first fence crash",async()=>{
  await withFixture(async({orchestrator,materialized,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry})=>{
    const controller=createOrganizationWorkClaimController({
      orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry
    });
    const claimed=await controller.claim({
      itemId:materialized.item.id,principal:{identity:"ba-1"},
      authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    await controller.release({
      itemId:materialized.item.id,claimGeneration:claimed.item.claimGeneration,
      principal:{identity:"ba-1"},authorizationId:"auth-1",policyId:"organization-execution-authority"
    });
    const failing={
      current:(key)=>claimReleaseStore.current(key),
      async compareAndSwap(key,expected,next){
        if(next.status===ClaimReleaseStatus.FENCED) throw new Error("injected release-fence failure");
        return claimReleaseStore.compareAndSwap(key,expected,next);
      }
    };
    const first=createOrganizationWorkClaimController({
      orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,
      claimReleaseStore:failing,artifactRegistry
    });
    const args={
      itemId:materialized.item.id,expectedOwner:"ba-1",
      expectedClaimGeneration:claimed.item.claimGeneration,
      kind:"EXECUTION_AUTHORITY_INVALIDATED",
      invalidationRef:"invalidation://replayable"
    };
    await assert.rejects(()=>first.invalidateOrganizationClaim(args),/injected release-fence failure/);
    const restarted=createOrganizationWorkClaimController({
      orchestrator,materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore,artifactRegistry
    });
    const replayed=await restarted.invalidateOrganizationClaim(args);
    assert.equal(replayed.status,BlackboardStatus.REOPENED);
    assert.equal((await claimReleaseStore.current(`${materialized.item.id}:${claimed.item.claimGeneration}`)).value.status,ClaimReleaseStatus.FENCED);
  });
});
