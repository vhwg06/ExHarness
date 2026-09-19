import { createHash } from "node:crypto";
import {
  AuthorityHeadStatus,
  ClaimReleaseStatus
} from "./organization-authority-store.js";
import { defineOrganizationWorkContract } from "./organization-work.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function freeze(value){return Object.freeze(structuredClone(value));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function releaseKey(itemId,generation){return `${requireText(itemId,"itemId")}:${generation}`;}

function itemFor(board,itemId){
  const item=board.items.find((candidate)=>candidate.id===itemId);
  invariant(item,`Blackboard item not found: ${itemId}`);
  return item;
}

function assertExecutionPolicy(head,{policyId,principal,domain}){
  invariant(head?.value,"execution authority policy is unavailable");
  const value=head.value;
  invariant(value.status===AuthorityHeadStatus.ACTIVE,"execution authority policy is not active");
  invariant(value.policyId===policyId,"execution authority policy subject mismatch");
  const domains=value.principalDomains?.[principal]??[];
  invariant(Array.isArray(domains)&&domains.includes(domain),`principal ${principal} is not authorized for domain ${domain}`);
  return value;
}

function assertMaterializationAuthorization(head,{authorizationId,contract}){
  invariant(head?.value,"materialization authorization is unavailable");
  const value=head.value;
  invariant(value.status===AuthorityHeadStatus.ACTIVE,"materialization authorization is not active");
  invariant(value.authorizationId===authorizationId,"materialization authorization subject mismatch");
  invariant(value.acceptedDecisionRef===contract.acceptedDecisionRef,"materialization authorization decision mismatch");
  invariant(Array.isArray(value.obligationKeys)&&value.obligationKeys.includes(contract.obligationKey),"work contract obligation is not authorized");
  if(value.owningDomain!=null) invariant(value.owningDomain===contract.owningDomain,"materialization authorization domain mismatch");
  if(value.workloadType!=null) invariant(value.workloadType===contract.workloadType,"materialization authorization workload mismatch");
  return value;
}

async function currentAuthorities({materializationAuthorizationStore,executionAuthorityPolicyStore,authorizationId,policyId,principal,contract}){
  const [materializationHead,policyHead]=await Promise.all([
    materializationAuthorizationStore.current(authorizationId),
    executionAuthorityPolicyStore.current(policyId)
  ]);
  return {
    materializationHead,
    materialization:assertMaterializationAuthorization(materializationHead,{authorizationId,contract}),
    policyHead,
    policy:assertExecutionPolicy(policyHead,{policyId,principal,domain:contract.owningDomain})
  };
}

function assertBoardContract(item,contract){
  invariant(item.origin?.kind==="ORGANIZATION_MATERIALIZATION",`Blackboard item ${item.id} is not organization-managed work`);
  invariant(item.origin.workContractRef===contract.contractRef,`Blackboard item ${item.id} work contract mismatch`);
  invariant(item.origin.owningDomain===contract.owningDomain,`Blackboard item ${item.id} owning domain mismatch`);
  invariant(item.origin.workloadType===contract.workloadType,`Blackboard item ${item.id} workload type mismatch`);
}

export function createOrganizationWorkClaimController({
  orchestrator,
  materializationAuthorizationStore,
  executionAuthorityPolicyStore,
  claimReleaseStore
}){
  invariant(orchestrator&&typeof orchestrator.readBlackboard==="function"&&typeof orchestrator.claim==="function","claim controller requires ApplicationOrchestrator");
  for(const [name,store] of Object.entries({materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore})){
    invariant(store&&typeof store.current==="function"&&typeof store.compareAndSwap==="function",`${name} must support current/CAS`);
  }

  async function fenceRelease(itemId,generation,invalidationRef){
    const key=releaseKey(itemId,generation);
    const current=await claimReleaseStore.current(key);
    if(current==null) return null;
    if(current.value.status===ClaimReleaseStatus.FENCED) return freeze(current.value);
    const next={...current.value,status:ClaimReleaseStatus.FENCED,fencedByRef:requireText(invalidationRef,"invalidationRef")};
    if(await claimReleaseStore.compareAndSwap(key,current.revision,next)) return freeze(next);
    const after=await claimReleaseStore.current(key);
    invariant(after?.value?.status===ClaimReleaseStatus.FENCED,"claim release fencing conflict");
    return freeze(after.value);
  }

  return Object.freeze({
    async claim({itemId,contract:rawContract,principal,authorizationId,policyId}){
      const contract=defineOrganizationWorkContract(rawContract);
      const identity=requireText(principal?.identity,"principal.identity");
      requireText(authorizationId,"authorizationId");
      requireText(policyId,"policyId");
      const board=await orchestrator.readBlackboard();
      assertBoardContract(itemFor(board,itemId),contract);
      const authority=await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,
        authorizationId,policyId,principal:identity,contract
      });
      const claimed=await orchestrator.claim({itemId,owner:identity});
      return freeze({
        item:claimed,
        contract,
        principal:identity,
        materializationAuthorizationGeneration:authority.materialization.generation,
        executionAuthorityPolicyGeneration:authority.policy.generation,
        released:false
      });
    },

    async release({itemId,claimGeneration,contract:rawContract,principal,authorizationId,policyId}){
      invariant(Number.isInteger(claimGeneration)&&claimGeneration>0,"claimGeneration must be positive");
      const contract=defineOrganizationWorkContract(rawContract);
      const identity=requireText(principal?.identity,"principal.identity");
      const board=await orchestrator.readBlackboard();
      const item=itemFor(board,itemId);
      assertBoardContract(item,contract);
      invariant(item.status==="CLAIMED","organization claim must remain CLAIMED before release");
      invariant(item.owner===identity,"organization claim owner changed before release");
      invariant(item.claimGeneration===claimGeneration,"organization claim generation changed before release");
      const authority=await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,
        authorizationId,policyId,principal:identity,contract
      });
      const receipt={
        kind:"CLAIM_RELEASE_RECEIPT",
        version:1,
        itemId,
        principal:identity,
        claimGeneration,
        workContractRef:contract.contractRef,
        materializationAuthorizationId:authorizationId,
        materializationAuthorizationRef:requireText(authority.materialization.authorizationRef,"materialization authorization ref"),
        materializationAuthorizationGeneration:authority.materialization.generation,
        executionAuthorityPolicyId:policyId,
        executionAuthorityPolicyRef:requireText(authority.policy.policyRef,"execution authority policy ref"),
        executionAuthorityPolicyGeneration:authority.policy.generation
      };
      const receiptRef=`claim-release:sha256:${digest(receipt)}`;
      const key=releaseKey(itemId,claimGeneration);
      const current=await claimReleaseStore.current(key);
      if(current!=null){
        invariant(current.value.status===ClaimReleaseStatus.RELEASED&&current.value.receiptRef===receiptRef,"conflicting claim release already exists");
        return freeze({...receipt,receiptRef});
      }
      const head={status:ClaimReleaseStatus.RELEASED,receiptRef,receipt};
      if(!(await claimReleaseStore.compareAndSwap(key,null,head))){
        const after=await claimReleaseStore.current(key);
        invariant(after?.value?.status===ClaimReleaseStatus.RELEASED&&after.value.receiptRef===receiptRef,"conflicting claim release CAS");
      }
      return freeze({...receipt,receiptRef});
    },

    async assertExecutable({itemId,claimGeneration,receiptRef,authorizationId,policyId}){
      const current=await claimReleaseStore.current(releaseKey(itemId,claimGeneration));
      invariant(current?.value?.status===ClaimReleaseStatus.RELEASED,"claim release is not current/released");
      invariant(current.value.receiptRef===receiptRef,"claim release receipt mismatch");
      const receipt=current.value.receipt;
      const board=await orchestrator.readBlackboard();
      const item=itemFor(board,itemId);
      invariant(item.status==="CLAIMED"&&item.owner===receipt.principal&&item.claimGeneration===claimGeneration,"Board claim tuple no longer matches released capability");
      const materialization=await materializationAuthorizationStore.current(authorizationId);
      const policy=await executionAuthorityPolicyStore.current(policyId);
      invariant(materialization?.value?.status===AuthorityHeadStatus.ACTIVE,"materialization authorization is no longer active");
      invariant(materialization.value.generation===receipt.materializationAuthorizationGeneration&&materialization.value.authorizationRef===receipt.materializationAuthorizationRef,"materialization authorization head changed");
      invariant(policy?.value?.status===AuthorityHeadStatus.ACTIVE,"execution authority policy is no longer active");
      invariant(policy.value.generation===receipt.executionAuthorityPolicyGeneration&&policy.value.policyRef===receipt.executionAuthorityPolicyRef,"execution authority policy head changed");
      const domains=policy.value.principalDomains?.[receipt.principal]??[];
      invariant(domains.includes(item.origin.owningDomain),"released principal is no longer authorized for domain");
      return true;
    },

    async recoverClaim({itemId,contract:rawContract,principal,authorizationId,policyId,reason}){
      const contract=defineOrganizationWorkContract(rawContract);
      const identity=requireText(principal?.identity,"principal.identity");
      const before=itemFor(await orchestrator.readBlackboard(),itemId);
      invariant(before.status==="CLAIMED","organization claim must be CLAIMED before recovery");
      assertBoardContract(before,contract);
      await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,
        authorizationId,policyId,principal:identity,contract
      });
      const recovered=await orchestrator.recoverClaim({itemId,owner:identity,reason:requireText(reason,"reason")});
      await fenceRelease(itemId,before.claimGeneration,`claim-recovery:${recovered.claimGeneration}`);
      return freeze({item:recovered,contract,released:false});
    },

    async invalidateOrganizationClaim({itemId,expectedOwner,expectedClaimGeneration,kind,invalidationRef}){
      const item=await orchestrator.invalidateOrganizationClaim({
        itemId,expectedOwner,expectedClaimGeneration,kind,invalidationRef
      });
      await fenceRelease(itemId,expectedClaimGeneration,invalidationRef);
      return freeze(item);
    }
  });
}
