import { createHash } from "node:crypto";
import { AuthorityHeadStatus, ClaimReleaseStatus } from "./organization-authority-store.js";
import { defineOrganizationWorkContract, organizationProjectBindingFromBoard } from "./organization-work.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),name+" must be a non-empty string");return value;}
function freeze(value){return Object.freeze(structuredClone(value));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function itemFor(board,id){const item=board.items.find((candidate)=>candidate.id===id);invariant(item,"Blackboard item not found: "+id);return item;}

export function claimReleaseSubjectKey(projectId,itemId,generation){
  invariant(Number.isInteger(generation)&&generation>0,"claim generation must be positive");
  return "claim-release:"+digest({
    projectId:requireText(projectId,"projectId"),
    itemId:requireText(itemId,"itemId"),
    claimGeneration:generation
  });
}

class AuthorityFailure extends Error{
  constructor(kind,message){super(message);this.kind=kind;}
}

function normalizePrincipal(principal){
  invariant(principal&&typeof principal==="object"&&!Array.isArray(principal),"trusted execution principal is required");
  return freeze({
    identity:requireText(principal.identity,"trusted execution principal identity"),
    principalRef:requireText(principal.principalRef,"trusted execution principal ref")
  });
}

async function resolveExecutionPrincipal(executionPrincipalProvider,principalContext){
  invariant(executionPrincipalProvider&&typeof executionPrincipalProvider.resolve==="function","executionPrincipalProvider.resolve is required");
  return normalizePrincipal(await executionPrincipalProvider.resolve(freeze(principalContext??{})));
}

async function resolveExecutionPrincipalByIdentity(executionPrincipalProvider,identity){
  invariant(executionPrincipalProvider&&typeof executionPrincipalProvider.resolveByIdentity==="function","executionPrincipalProvider.resolveByIdentity is required");
  const principal=normalizePrincipal(await executionPrincipalProvider.resolveByIdentity(requireText(identity,"Board owner")));
  invariant(principal.identity===identity,"trusted principal recovery identity mismatch");
  return principal;
}

function sameObservation(left,right){
  return left.revision===right.revision&&
    left.value.generation===right.value.generation&&
    left.value.artifactRef===right.value.artifactRef;
}

async function resolveAuthority({head,resolve,subjectField,subject,kind,requireActive=true}){
  if(!head?.value) throw new AuthorityFailure(kind,"authority head unavailable");
  if(requireActive&&head.value.status!==AuthorityHeadStatus.ACTIVE) throw new AuthorityFailure(kind,"authority head is not active");
  const ref=requireText(head.value.artifactRef,"authority artifactRef");
  const artifact=await resolve(ref);
  if(!artifact) throw new AuthorityFailure(kind,"authority artifact not found: "+ref);
  if(
    artifact[subjectField]!==subject||
    artifact.generation!==head.value.generation||
    artifact.status!==head.value.status
  ) throw new AuthorityFailure(kind,"authority artifact/head mismatch");
  return {head,artifact,artifactRef:ref};
}

function materializationAuthorizationId(item){
  invariant(item.origin?.kind==="ORGANIZATION_MATERIALIZATION","organization work origin is required");
  return requireText(item.origin.authorizationId,"organization work authorizationId");
}

async function currentAuthorities({
  materializationAuthorizationStore,
  executionAuthorityPolicyStore,
  artifactRegistry,
  item,
  policyId,
  principal,
  contract
}){
  const authorizationId=materializationAuthorizationId(item);
  const [materializationHead,policyHead]=await Promise.all([
    materializationAuthorizationStore.current(authorizationId),
    executionAuthorityPolicyStore.current(policyId)
  ]);

  const materialization=await resolveAuthority({
    head:materializationHead,
    resolve:(ref)=>artifactRegistry.resolveMaterializationAuthorization(ref),
    subjectField:"authorizationId",
    subject:authorizationId,
    kind:"WORK"
  });
  const grant=materialization.artifact;
  if(materialization.artifactRef!==item.origin.authorizationRef) throw new AuthorityFailure("WORK","materialization authorization ref no longer matches Board provenance");
  if(grant.generation!==item.origin.authorizationGeneration) throw new AuthorityFailure("WORK","materialization authorization generation no longer matches Board provenance");
  if(materialization.head.revision!==item.origin.authorizationRevision) throw new AuthorityFailure("WORK","materialization authorization revision no longer matches Board provenance");
  if(grant.projectId!==contract.projectId) throw new AuthorityFailure("WORK","materialization authorization project mismatch");
  if(grant.implementationArtifactRef!==item.origin.implementationArtifactRef) throw new AuthorityFailure("WORK","materialization authorization implementation artifact mismatch");
  if(grant.acceptedDecisionRef!==contract.acceptedDecisionRef) throw new AuthorityFailure("WORK","materialization authorization decision mismatch");
  if(!grant.authorizedObligationKeys?.includes(contract.obligationKey)) throw new AuthorityFailure("WORK","work contract outside materialization authorization scope");
  if(grant.owningDomain!=null&&grant.owningDomain!==contract.owningDomain) throw new AuthorityFailure("WORK","materialization authorization domain mismatch");
  if(grant.workloadType!=null&&grant.workloadType!==contract.workloadType) throw new AuthorityFailure("WORK","materialization authorization workload mismatch");

  const policy=await resolveAuthority({
    head:policyHead,
    resolve:(ref)=>artifactRegistry.resolveExecutionAuthorityPolicy(ref),
    subjectField:"policyId",
    subject:policyId,
    kind:"EXECUTION"
  });
  if(policy.artifact.projectId!==contract.projectId) throw new AuthorityFailure("EXECUTION","execution authority policy project mismatch");
  if(!policy.artifact.principalDomains?.[principal.identity]?.includes(contract.owningDomain))
    throw new AuthorityFailure("EXECUTION","principal "+principal.identity+" is not authorized for domain "+contract.owningDomain);

  return {materialization,policy};
}

async function authorityObservations({
  materializationAuthorizationStore,
  executionAuthorityPolicyStore,
  artifactRegistry,
  item,
  policyId,
  projectId
}){
  const authorizationId=materializationAuthorizationId(item);
  const [materializationHead,policyHead]=await Promise.all([
    materializationAuthorizationStore.current(authorizationId),
    executionAuthorityPolicyStore.current(policyId)
  ]);
  const materialization=await resolveAuthority({
    head:materializationHead,
    resolve:(ref)=>artifactRegistry.resolveMaterializationAuthorization(ref),
    subjectField:"authorizationId",
    subject:authorizationId,
    kind:"WORK",
    requireActive:false
  });
  const policy=await resolveAuthority({
    head:policyHead,
    resolve:(ref)=>artifactRegistry.resolveExecutionAuthorityPolicy(ref),
    subjectField:"policyId",
    subject:policyId,
    kind:"EXECUTION",
    requireActive:false
  });
  invariant(materialization.artifact.projectId===projectId,"materialization authority observation project mismatch");
  invariant(policy.artifact.projectId===projectId,"execution authority observation project mismatch");
  return {materialization,policy};
}

function authorityObservationArtifact(authority,subjectField){
  return freeze({
    subjectId:authority.artifact[subjectField],
    revision:authority.head.revision,
    generation:authority.artifact.generation,
    status:authority.artifact.status,
    artifactRef:authority.artifactRef
  });
}

function assertSameAuthorities(before,after){
  if(!sameObservation(before.materialization.head,after.materialization.head))
    throw new AuthorityFailure("WORK","materialization authority changed across durable mutation");
  if(!sameObservation(before.policy.head,after.policy.head))
    throw new AuthorityFailure("EXECUTION","execution authority changed across durable mutation");
}

function assertBoardContract(item,contract,project){
  invariant(item.origin?.kind==="ORGANIZATION_MATERIALIZATION","Blackboard item "+item.id+" is not organization-managed work");
  invariant(item.origin.workContractRef===contract.contractRef,"Blackboard item "+item.id+" work contract mismatch");
  invariant(item.origin.owningDomain===contract.owningDomain,"Blackboard item "+item.id+" owning domain mismatch");
  invariant(
    item.origin.projectId===project.projectId&&
    item.origin.rootItemId===project.rootItemId&&
    item.origin.rootIntentId===project.rootIntentId,
    "Blackboard item "+item.id+" project/root mismatch"
  );
  invariant(
    contract.projectId===project.projectId&&
    contract.rootItemId===project.rootItemId&&
    contract.rootIntentId===project.rootIntentId,
    "work contract project/root mismatch"
  );
}

export function createOrganizationWorkClaimController({
  orchestrator,
  materializationAuthorizationStore,
  executionAuthorityPolicyStore,
  claimReleaseStore,
  artifactRegistry,
  executionPrincipalProvider,
  executionAuthorityPolicyId
}){
  const policyId=requireText(executionAuthorityPolicyId,"executionAuthorityPolicyId");
  invariant(orchestrator&&typeof orchestrator.readBlackboard==="function"&&typeof orchestrator.claim==="function","claim controller requires ApplicationOrchestrator");
  invariant(orchestrator&&typeof orchestrator.blockOrganizationMaterialization==="function","claim controller requires materialization blocking");
  invariant(artifactRegistry&&typeof artifactRegistry.resolveWorkContract==="function","claim controller requires artifact registry");
  invariant(typeof artifactRegistry.putClaimReleaseReceipt==="function"&&typeof artifactRegistry.resolveClaimReleaseReceipt==="function","claim controller requires claim release artifact registry");
  invariant(typeof artifactRegistry.putClaimAuthorityInvalidation==="function"&&typeof artifactRegistry.resolveClaimAuthorityInvalidation==="function","claim controller requires claim invalidation artifact registry");
  invariant(executionPrincipalProvider&&typeof executionPrincipalProvider.resolve==="function","claim controller requires trusted executionPrincipalProvider");
  invariant(typeof executionPrincipalProvider.resolveByIdentity==="function","claim controller requires executionPrincipalProvider.resolveByIdentity");
  for(const [name,store] of Object.entries({materializationAuthorizationStore,executionAuthorityPolicyStore,claimReleaseStore})){
    invariant(store&&typeof store.current==="function"&&typeof store.compareAndSwap==="function",name+" must support current/CAS");
  }

  async function resolveContractForItem(itemId){
    const board=await orchestrator.readBlackboard();
    const project=organizationProjectBindingFromBoard(board);
    const item=itemFor(board,itemId);
    const ref=requireText(item.origin?.workContractRef,"Blackboard item "+itemId+" workContractRef");
    const artifact=await artifactRegistry.resolveWorkContract(ref);
    invariant(artifact,"work contract artifact not found: "+ref);
    const contract=defineOrganizationWorkContract(artifact);
    invariant(contract.contractRef===ref,"work contract artifact ref mismatch: "+ref);
    assertBoardContract(item,contract,project);
    return {board,item,contract,project};
  }

  async function fenceRelease(projectId,itemId,generation,invalidationRef){
    const key=claimReleaseSubjectKey(projectId,itemId,generation);
    const current=await claimReleaseStore.current(key);
    if(current==null) return null;
    if(current.value.status===ClaimReleaseStatus.FENCED) return freeze(current.value);
    invariant(current.value.status===ClaimReleaseStatus.RELEASED,"claim release head state is invalid");
    const next={
      status:ClaimReleaseStatus.FENCED,
      receiptRef:requireText(current.value.receiptRef,"claim release receiptRef"),
      fencedByRef:requireText(invalidationRef,"invalidationRef")
    };
    if(await claimReleaseStore.compareAndSwap(key,current.revision,next)) return freeze(next);
    const after=await claimReleaseStore.current(key);
    invariant(
      after?.value?.status===ClaimReleaseStatus.FENCED&&after.value.receiptRef===next.receiptRef,
      "claim release fencing conflict"
    );
    return freeze(after.value);
  }

  function invalidationCause(error){
    return error?.kind==="WORK"?"WORK_AUTHORIZATION_INVALIDATED":"EXECUTION_AUTHORITY_INVALIDATED";
  }

  async function persistInvalidation({
    item,
    contract,
    principalRef=null,
    observed,
    cause,
    reasonRef,
    releasedClaimReceiptRef=null
  }){
    const artifact=freeze({
      kind:"CLAIM_AUTHORITY_INVALIDATION",
      version:1,
      projectId:contract.projectId,
      rootItemId:contract.rootItemId,
      rootIntentId:contract.rootIntentId,
      itemId:item.id,
      expectedOwner:requireText(item.owner,"invalidated claim owner"),
      expectedClaimGeneration:item.claimGeneration,
      cause,
      principalRef:principalRef==null?null:requireText(principalRef,"principalRef"),
      reasonRef:requireText(reasonRef,"reasonRef"),
      observedMaterializationAuthorization:authorityObservationArtifact(observed.materialization,"authorizationId"),
      observedExecutionAuthorityPolicy:authorityObservationArtifact(observed.policy,"policyId"),
      releasedClaimReceiptRef:releasedClaimReceiptRef==null?null:requireText(releasedClaimReceiptRef,"releasedClaimReceiptRef")
    });
    const invalidationRef=await artifactRegistry.putClaimAuthorityInvalidation(artifact);
    return {artifact,invalidationRef};
  }

  async function applyInvalidation({item,contract,principalRef,observed,cause,reasonRef,releasedClaimReceiptRef=null}){
    const persisted=await persistInvalidation({item,contract,principalRef,observed,cause,reasonRef,releasedClaimReceiptRef});
    const invalidated=await orchestrator.invalidateOrganizationClaim({
      itemId:item.id,
      expectedOwner:item.owner,
      expectedClaimGeneration:item.claimGeneration,
      kind:cause,
      invalidationRef:persisted.invalidationRef,
      invalidation:persisted.artifact
    });
    await fenceRelease(contract.projectId,item.id,item.claimGeneration,persisted.invalidationRef);
    return {item:invalidated.result,invalidationRef:persisted.invalidationRef};
  }

  async function findReplayInvalidation(item,{reasonRef,cause,expectedOwner,expectedClaimGeneration}){
    for(const ref of item.evidenceRefs??[]){
      if(!ref.startsWith("claim-authority-invalidation:sha256:")) continue;
      const artifact=await artifactRegistry.resolveClaimAuthorityInvalidation(ref);
      if(!artifact) continue;
      if(
        artifact.itemId===item.id&&
        artifact.expectedOwner===expectedOwner&&
        artifact.expectedClaimGeneration===expectedClaimGeneration&&
        artifact.cause===cause&&
        artifact.reasonRef===reasonRef
      ) return {artifact,invalidationRef:ref};
    }
    return null;
  }

  function buildReceipt({item,contract,principal,observed}){
    return freeze({
      kind:"CLAIM_RELEASE_RECEIPT",
      version:1,
      projectId:contract.projectId,
      rootItemId:contract.rootItemId,
      rootIntentId:contract.rootIntentId,
      itemId:item.id,
      boardOwner:principal.identity,
      principalRef:principal.principalRef,
      claimGeneration:item.claimGeneration,
      workContractRef:contract.contractRef,
      materializationAuthorizationId:materializationAuthorizationId(item),
      materializationAuthorizationRef:observed.materialization.artifactRef,
      materializationAuthorizationGeneration:observed.materialization.artifact.generation,
      executionAuthorityPolicyId:policyId,
      executionAuthorityPolicyRef:observed.policy.artifactRef,
      executionAuthorityPolicyGeneration:observed.policy.artifact.generation
    });
  }

  async function publishRelease({item,contract,principal,observed}){
    const receipt=buildReceipt({item,contract,principal,observed});
    const receiptRef=await artifactRegistry.putClaimReleaseReceipt(receipt);
    const key=claimReleaseSubjectKey(contract.projectId,item.id,item.claimGeneration);
    const current=await claimReleaseStore.current(key);
    if(current!=null){
      invariant(
        current.value.status===ClaimReleaseStatus.RELEASED&&current.value.receiptRef===receiptRef,
        "conflicting claim release already exists"
      );
    }else{
      invariant(
        await claimReleaseStore.compareAndSwap(key,null,{status:ClaimReleaseStatus.RELEASED,receiptRef}),
        "conflicting claim release CAS"
      );
    }
    return freeze({...receipt,receiptRef});
  }

  async function resolveReleasedReceipt({item,contract}){
    const key=claimReleaseSubjectKey(contract.projectId,item.id,item.claimGeneration);
    const head=await claimReleaseStore.current(key);
    if(head==null) return {head:null,receipt:null};
    const receiptRef=requireText(head.value.receiptRef,"claim release receiptRef");
    const receipt=await artifactRegistry.resolveClaimReleaseReceipt(receiptRef);
    invariant(receipt,"claim release receipt artifact not found: "+receiptRef);
    invariant(
      receipt.projectId===contract.projectId&&
      receipt.rootItemId===contract.rootItemId&&
      receipt.rootIntentId===contract.rootIntentId&&
      receipt.itemId===item.id&&
      receipt.claimGeneration===item.claimGeneration&&
      receipt.workContractRef===contract.contractRef,
      "claim release receipt subject mismatch"
    );
    return {head,receipt:freeze({...receipt,receiptRef})};
  }

  function assertReceiptAuthority(receipt,observed,item){
    invariant(receipt.materializationAuthorizationId===materializationAuthorizationId(item),"claim release materialization subject mismatch");
    invariant(receipt.executionAuthorityPolicyId===policyId,"claim release execution policy subject mismatch");
    invariant(
      observed.materialization.artifactRef===receipt.materializationAuthorizationRef&&
      observed.materialization.artifact.generation===receipt.materializationAuthorizationGeneration,
      "materialization authorization head changed"
    );
    invariant(
      observed.policy.artifactRef===receipt.executionAuthorityPolicyRef&&
      observed.policy.artifact.generation===receipt.executionAuthorityPolicyGeneration,
      "execution authority policy head changed"
    );
  }

  return Object.freeze({
    async claim({itemId,principalContext}){
      const {item:before,contract}=await resolveContractForItem(itemId);
      const principal=await resolveExecutionPrincipal(executionPrincipalProvider,principalContext);
      let observed;
      try{
        observed=await currentAuthorities({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item:before,policyId,principal,contract
        });
      }catch(error){
        if(error?.kind==="WORK"&&(before.status==="READY"||before.status==="REOPENED")){
          await orchestrator.blockOrganizationMaterialization({
            itemId,
            authorizationRef:before.origin.authorizationRef,
            authorizationGeneration:before.origin.authorizationGeneration,
            reasonRef:"preclaim-work-authority:"+contract.contractRef
          });
        }
        throw error;
      }

      const claimed=await orchestrator.claim({itemId,owner:principal.identity});
      try{
        const after=await currentAuthorities({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item:claimed.result,policyId,principal,contract
        });
        assertSameAuthorities(observed,after);
      }catch(error){
        await applyInvalidation({
          item:claimed.result,
          contract,
          principalRef:principal.principalRef,
          observed,
          cause:invalidationCause(error),
          reasonRef:"claim-freshness:"+policyId+":"+claimed.result.claimGeneration
        });
        throw error;
      }

      return freeze({
        item:claimed.result,
        contract,
        principal:principal.identity,
        principalRef:principal.principalRef,
        materializationAuthorizationGeneration:observed.materialization.artifact.generation,
        executionAuthorityPolicyGeneration:observed.policy.artifact.generation,
        released:false
      });
    },

    async release({itemId,claimGeneration,principalContext}){
      invariant(Number.isInteger(claimGeneration)&&claimGeneration>0,"claimGeneration must be positive");
      const {item,contract}=await resolveContractForItem(itemId);
      const principal=await resolveExecutionPrincipal(executionPrincipalProvider,principalContext);
      invariant(
        item.status==="CLAIMED"&&item.owner===principal.identity&&item.claimGeneration===claimGeneration,
        "organization claim tuple changed before release"
      );
      const observed=await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
        item,policyId,principal,contract
      });
      const released=await publishRelease({item,contract,principal,observed});

      try{
        const after=await currentAuthorities({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item,policyId,principal,contract
        });
        assertSameAuthorities(observed,after);
      }catch(error){
        const reasonRef="release-freshness:"+released.receiptRef;
        const persisted=await persistInvalidation({
          item,
          contract,
          principalRef:principal.principalRef,
          observed,
          cause:invalidationCause(error),
          reasonRef,
          releasedClaimReceiptRef:released.receiptRef
        });
        await orchestrator.invalidateOrganizationClaim({
          itemId,
          expectedOwner:principal.identity,
          expectedClaimGeneration:claimGeneration,
          kind:persisted.artifact.cause,
          invalidationRef:persisted.invalidationRef,
          invalidation:persisted.artifact
        });
        await fenceRelease(contract.projectId,itemId,claimGeneration,persisted.invalidationRef);
        throw error;
      }

      return released;
    },

    async assertExecutable({itemId,claimGeneration,receiptRef}){
      const {item,contract}=await resolveContractForItem(itemId);
      invariant(item.status==="CLAIMED"&&item.claimGeneration===claimGeneration,"Board claim tuple no longer matches released capability");
      const key=claimReleaseSubjectKey(contract.projectId,itemId,claimGeneration);
      const current=await claimReleaseStore.current(key);
      invariant(current?.value?.status===ClaimReleaseStatus.RELEASED&&current.value.receiptRef===receiptRef,"claim release is not current/released");
      const receipt=await artifactRegistry.resolveClaimReleaseReceipt(receiptRef);
      invariant(receipt,"claim release receipt artifact not found: "+receiptRef);
      invariant(
        receipt.projectId===contract.projectId&&
        receipt.rootItemId===contract.rootItemId&&
        receipt.rootIntentId===contract.rootIntentId&&
        receipt.itemId===itemId&&
        receipt.claimGeneration===claimGeneration&&
        receipt.workContractRef===contract.contractRef&&
        item.owner===receipt.boardOwner,
        "claim release receipt subject mismatch"
      );
      const principal=freeze({
        identity:receipt.boardOwner,
        principalRef:requireText(receipt.principalRef,"receipt principalRef")
      });
      const authority=await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
        item,policyId,principal,contract
      });
      assertReceiptAuthority(receipt,authority,item);
      return true;
    },

    async recoverClaim({itemId,principalContext,reason}){
      const {item:before,contract}=await resolveContractForItem(itemId);
      const principal=await resolveExecutionPrincipal(executionPrincipalProvider,principalContext);
      invariant(before.status==="CLAIMED","organization claim must be CLAIMED before recovery");
      const observed=await currentAuthorities({
        materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
        item:before,policyId,principal,contract
      });
      const recovered=await orchestrator.recoverClaim({
        itemId,
        owner:principal.identity,
        reason:requireText(reason,"reason")
      });
      await fenceRelease(contract.projectId,itemId,before.claimGeneration,"claim-recovery:"+recovered.result.claimGeneration);
      try{
        const after=await currentAuthorities({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item:recovered.result,policyId,principal,contract
        });
        assertSameAuthorities(observed,after);
      }catch(error){
        await applyInvalidation({
          item:recovered.result,
          contract,
          principalRef:principal.principalRef,
          observed,
          cause:invalidationCause(error),
          reasonRef:"recovery-freshness:"+recovered.result.claimGeneration
        });
        throw error;
      }
      return freeze({item:recovered.result,contract,released:false});
    },

    async reconcileOrganizationClaimAuthority({itemId}){
      const {item,contract}=await resolveContractForItem(itemId);
      if(item.status!=="CLAIMED") return freeze({state:"NO_CURRENT_CLAIM",item});

      const principal=await resolveExecutionPrincipalByIdentity(executionPrincipalProvider,item.owner);
      let observed;
      try{
        observed=await currentAuthorities({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item,policyId,principal,contract
        });
      }catch(error){
        const snapshot=await authorityObservations({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item,policyId,projectId:contract.projectId
        });
        const invalidated=await applyInvalidation({
          item,
          contract,
          principalRef:principal.principalRef,
          observed:snapshot,
          cause:invalidationCause(error),
          reasonRef:"reconcile-authority:"+item.claimGeneration
        });
        return freeze({state:"INVALIDATED",...invalidated});
      }

      const released=await resolveReleasedReceipt({item,contract});
      if(released.head==null){
        const published=await publishRelease({item,contract,principal,observed});
        try{
          const after=await currentAuthorities({
            materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
            item,policyId,principal,contract
          });
          assertSameAuthorities(observed,after);
          return freeze({state:"RELEASED",receipt:published});
        }catch(error){
          const invalidated=await applyInvalidation({
            item,
            contract,
            principalRef:principal.principalRef,
            observed,
            cause:invalidationCause(error),
            reasonRef:"reconcile-release-freshness:"+published.receiptRef,
            releasedClaimReceiptRef:published.receiptRef
          });
          return freeze({state:"INVALIDATED",...invalidated});
        }
      }

      if(released.head.value.status===ClaimReleaseStatus.FENCED){
        const invalidated=await applyInvalidation({
          item,
          contract,
          principalRef:principal.principalRef,
          observed,
          cause:"ABANDONED_PROVISIONAL_CLAIM",
          reasonRef:"reconcile-fenced-release:"+released.receipt.receiptRef,
          releasedClaimReceiptRef:released.receipt.receiptRef
        });
        return freeze({state:"INVALIDATED",...invalidated});
      }

      invariant(released.head.value.status===ClaimReleaseStatus.RELEASED,"claim release head state is invalid");
      try{
        assertReceiptAuthority(released.receipt,observed,item);
      }catch(error){
        const invalidated=await applyInvalidation({
          item,
          contract,
          principalRef:principal.principalRef,
          observed,
          cause:"ABANDONED_PROVISIONAL_CLAIM",
          reasonRef:"reconcile-release-mismatch:"+released.receipt.receiptRef,
          releasedClaimReceiptRef:released.receipt.receiptRef
        });
        return freeze({state:"INVALIDATED",...invalidated});
      }
      return freeze({state:"RELEASED",receipt:released.receipt});
    },

    async invalidateOrganizationClaim({
      itemId,
      expectedOwner,
      expectedClaimGeneration,
      kind,
      invalidationRef
    }){
      const {item:initial,contract}=await resolveContractForItem(itemId);
      const reasonRef=requireText(invalidationRef,"invalidation reason ref");
      let persisted=await findReplayInvalidation(initial,{
        reasonRef,
        cause:kind,
        expectedOwner,
        expectedClaimGeneration
      });

      if(persisted==null){
        const observed=await authorityObservations({
          materializationAuthorizationStore,executionAuthorityPolicyStore,artifactRegistry,
          item:initial,policyId,projectId:contract.projectId
        });
        const item=initial.status==="CLAIMED"?
          initial:
          freeze({...initial,owner:expectedOwner,claimGeneration:expectedClaimGeneration});
        persisted=await persistInvalidation({
          item,
          contract,
          observed,
          cause:kind,
          reasonRef
        });
      }

      const current=itemFor(await orchestrator.readBlackboard(),itemId);
      let item;
      if(current.status==="CLAIMED"){
        item=(await orchestrator.invalidateOrganizationClaim({
          itemId,
          expectedOwner,
          expectedClaimGeneration,
          kind,
          invalidationRef:persisted.invalidationRef,
          invalidation:persisted.artifact
        })).result;
      }else{
        const expectedStatus=kind==="WORK_AUTHORIZATION_INVALIDATED"?"BLOCKED":"REOPENED";
        invariant(
          current.status===expectedStatus&&
          current.owner==null&&
          current.claimGeneration===expectedClaimGeneration&&
          current.evidenceRefs.includes(persisted.invalidationRef),
          "organization invalidation replay mismatch"
        );
        item=current;
      }
      await fenceRelease(contract.projectId,itemId,expectedClaimGeneration,persisted.invalidationRef);
      return freeze({...item,invalidationRef:persisted.invalidationRef});
    }
  });
}
