import {productAssert as inv} from "./cross-domain-obligation.js";

// Reconciliation scans durable Board provenance, so interruption between semantic
// commit and Board fencing is recoverable without an in-memory event queue.
export function createDependencyInvalidationController({lineage,orchestrator,artifactRegistry,claimController}){
  async function reconcileWork(){
    const affected=[];
    for(const observed of (await orchestrator.readBlackboard()).items){
      if(observed.origin?.kind!=="ORGANIZATION_MATERIALIZATION")continue;
      const contract=await artifactRegistry.resolveWorkContract(observed.origin.workContractRef);
      if(!contract?.crossDomainObligationRef)continue;
      const state=await lineage.snapshot(),head=state.heads[contract.crossDomainObligationSubjectKey];
      if(head?.status==="ACTIVE"&&head.revisionRef===contract.crossDomainObligationRef)continue;
      const reasonRef="semantic-currentness:"+contract.crossDomainObligationRef;
      // Re-read after semantic IO; claim races retry via the canonical lifecycle.
      for(let attempt=0;attempt<5;attempt++){
        const item=(await orchestrator.readBlackboard()).items.find(i=>i.id===observed.id);
        if(!["READY","REOPENED","CLAIMED"].includes(item?.status))break;
        try{
          if(item.status==="CLAIMED")await claimController.invalidateOrganizationClaim({itemId:item.id,expectedOwner:item.owner,expectedClaimGeneration:item.claimGeneration,kind:"WORK_AUTHORIZATION_INVALIDATED",invalidationRef:reasonRef});
          else await orchestrator.blockOrganizationMaterialization({itemId:item.id,authorizationRef:item.origin.authorizationRef,authorizationGeneration:item.origin.authorizationGeneration,reasonRef});
          affected.push(item.id);break;
        }catch(error){if(attempt===4)throw error;}
      }
    }
    return affected;
  }
  async function invalidate({subjectKeys,reasonRef,status="STALE"}){
    inv(Array.isArray(subjectKeys),"semantic subject keys required");
    const impacted=await lineage.invalidate(subjectKeys,{status,reasonRef});
    return {impacted,affectedWork:await reconcileWork()};
  }
  return Object.freeze({invalidate,reconcileWork});
}
