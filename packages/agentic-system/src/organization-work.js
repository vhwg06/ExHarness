import { createHash } from "node:crypto";
import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),name+" must be a non-empty string");return value;}
function textArray(value,name,{min=0}={}){invariant(Array.isArray(value)&&value.length>=min,name+" must contain at least "+min+" item(s)");return value.map((entry,index)=>requireText(entry,name+"["+index+"]"));}
function freeze(value){return Object.freeze(structuredClone(value));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}

export function organizationProjectBindingFromBoard(board){
  invariant(board&&Array.isArray(board.items),"Blackboard snapshot is required");
  const roots=board.items.filter((item)=>item.origin?.kind==="USER_INTENT_ROOT");
  invariant(roots.length===1,"organization work requires exactly one USER_INTENT_ROOT");
  const root=roots[0];
  const projectId=requireText(root.origin?.projectId,"user-intent root projectId");
  const rootIntentId=requireText(root.origin?.userIntent?.id,"user-intent root intent id");
  invariant(root.status==="DONE","user-intent root must be DONE");
  return freeze({projectId,rootItemId:requireText(root.id,"user-intent root item id"),rootIntentId});
}

export function obligationSubjectKey({projectId,rootIntentId,implementationArtifactRef,obligationKey}){
  return digest({
    projectId:requireText(projectId,"projectId"),
    rootIntentId:requireText(rootIntentId,"rootIntentId"),
    implementationArtifactRef:requireText(implementationArtifactRef,"implementationArtifactRef"),
    obligationKey:requireText(obligationKey,"obligationKey")
  });
}

export function materializationSubjectKey({obligationSubjectKey:subjectKey,acceptedDecisionRef,authorizationRef}){
  return digest({
    obligationSubjectKey:requireText(subjectKey,"obligationSubjectKey"),
    acceptedDecisionRef:requireText(acceptedDecisionRef,"acceptedDecisionRef"),
    authorizationRef:requireText(authorizationRef,"authorizationRef")
  });
}

export function defineOrganizationWorkContract(raw){
  invariant(raw&&typeof raw==="object"&&!Array.isArray(raw),"OrganizationWorkContract must be an object");
  const acceptedDecisionRef=requireText(raw.acceptedDecisionRef??raw.researchDecisionRef,"OrganizationWorkContract.acceptedDecisionRef");
  const requiredArtifactRefs=textArray(raw.requiredArtifactRefs??raw.inputRefs??[],"OrganizationWorkContract.requiredArtifactRefs");
  const contract={
    kind:"ORGANIZATION_WORK_CONTRACT",
    version:1,
    projectId:requireText(raw.projectId,"OrganizationWorkContract.projectId"),
    rootItemId:requireText(raw.rootItemId,"OrganizationWorkContract.rootItemId"),
    rootIntentId:requireText(raw.rootIntentId,"OrganizationWorkContract.rootIntentId"),
    researchDecisionRef:acceptedDecisionRef,
    acceptedDecisionRef,
    materializationAuthorizationId:requireText(raw.materializationAuthorizationId,"OrganizationWorkContract.materializationAuthorizationId"),
    materializationAuthorizationRef:requireText(raw.materializationAuthorizationRef,"OrganizationWorkContract.materializationAuthorizationRef"),
    materializationAuthorizationGeneration:Number(raw.materializationAuthorizationGeneration),
    materializationAuthorizationRevision:requireText(raw.materializationAuthorizationRevision,"OrganizationWorkContract.materializationAuthorizationRevision"),
    authorityPolicyRevision:requireText(raw.authorityPolicyRevision,"OrganizationWorkContract.authorityPolicyRevision"),
    implementationArtifactRef:requireText(raw.implementationArtifactRef,"OrganizationWorkContract.implementationArtifactRef"),
    sliceId:requireText(raw.sliceId,"OrganizationWorkContract.sliceId"),
    obligationKey:requireText(raw.obligationKey,"OrganizationWorkContract.obligationKey"),
    obligationSubjectKey:requireText(raw.obligationSubjectKey,"OrganizationWorkContract.obligationSubjectKey"),
    materializationKey:requireText(raw.materializationKey,"OrganizationWorkContract.materializationKey"),
    boardItemId:requireText(raw.boardItemId,"OrganizationWorkContract.boardItemId"),
    owningDomain:requireText(raw.owningDomain,"OrganizationWorkContract.owningDomain"),
    workloadType:requireText(raw.workloadType,"OrganizationWorkContract.workloadType"),
    summary:requireText(raw.summary,"OrganizationWorkContract.summary"),
    dependencyIds:textArray(raw.dependencyIds??[],"OrganizationWorkContract.dependencyIds"),
    requiredArtifactRefs,
    inputRefs:requiredArtifactRefs,
    expectedArtifactKind:requireText(raw.expectedArtifactKind,"OrganizationWorkContract.expectedArtifactKind"),
    expectedOutputRefs:textArray(raw.expectedOutputRefs??[],"OrganizationWorkContract.expectedOutputRefs"),
    acceptanceRefs:textArray(raw.acceptanceRefs??[],"OrganizationWorkContract.acceptanceRefs",{min:1})
  };
  invariant(
    Number.isInteger(contract.materializationAuthorizationGeneration)&&contract.materializationAuthorizationGeneration>0,
    "OrganizationWorkContract.materializationAuthorizationGeneration must be positive"
  );
  const contractRef="organization-work-contract:sha256:"+digest(contract);
  return freeze({...contract,contractRef});
}

function sameObservation(left,right){
  return left.revision===right.revision&&left.generation===right.generation&&left.artifactRef===right.artifactRef;
}

async function resolveAuthorization(head,{
  artifactRegistry,
  authorizationId,
  project,
  decisionRef,
  obligationKey,
  sliceId,
  owningDomain,
  workloadType
}){
  invariant(head?.value,"materialization authorization is unavailable");
  invariant(head.value.status===AuthorityHeadStatus.ACTIVE,"materialization authorization is not active");
  const ref=requireText(head.value.artifactRef,"materialization authorization artifactRef");
  const value=await artifactRegistry.resolveMaterializationAuthorization(ref);
  invariant(value,"materialization authorization artifact is unavailable");
  invariant(value.kind==="MATERIALIZATION_AUTHORIZATION_GRANT"&&value.version===1,"materialization authorization artifact kind/version mismatch");
  invariant(
    value.authorizationId===authorizationId&&
    value.generation===head.value.generation&&
    value.status===head.value.status,
    "materialization authorization artifact/head mismatch"
  );
  invariant(value.projectId===project.projectId,"materialization authorization project mismatch");
  invariant(value.rootIntentId===project.rootIntentId,"materialization authorization root intent mismatch");
  invariant(value.acceptedDecisionRef===decisionRef,"materialization authorization decision mismatch");
  requireText(value.implementationArtifactRef,"materialization authorization implementationArtifactRef");
  requireText(value.authorityPolicyRevision,"materialization authorization authorityPolicyRevision");
  requireText(value.issuedByAuthorityRef,"materialization authorization issuedByAuthorityRef");
  invariant(
    Array.isArray(value.authorizedObligationKeys)&&
    !value.authorizedObligationKeys.includes("*")&&
    value.authorizedObligationKeys.includes(obligationKey),
    "obligation is outside materialization authorization scope"
  );
  invariant(
    Array.isArray(value.authorizedSliceIds)&&
    !value.authorizedSliceIds.includes("*")&&
    value.authorizedSliceIds.includes(sliceId),
    "slice is outside materialization authorization scope"
  );
  if(value.owningDomain!=null) invariant(value.owningDomain===owningDomain,"materialization authorization domain mismatch");
  if(value.workloadType!=null) invariant(value.workloadType===workloadType,"materialization authorization workload mismatch");
  return {
    value,
    artifactRef:ref,
    observation:freeze({revision:head.revision,generation:head.value.generation,artifactRef:ref})
  };
}

function assertPublishedItem(item,{itemId,contract,authorizationId,authorizationRef,authorizationGeneration,authorizationRevision,implementationArtifactRef}){
  invariant(item&&item.id===itemId,"deterministic materialization item is unavailable after conflict");
  invariant(item.origin?.kind==="ORGANIZATION_MATERIALIZATION","deterministic materialization origin mismatch");
  invariant(item.origin.workContractRef===contract.contractRef,"deterministic materialization work contract mismatch");
  invariant(item.origin.obligationSubjectKey===contract.obligationSubjectKey,"deterministic materialization logical subject mismatch");
  invariant(item.origin.materializationKey===contract.materializationKey,"deterministic materialization key mismatch");
  invariant(item.origin.authorizationId===authorizationId,"deterministic materialization authorization subject mismatch");
  invariant(item.origin.authorizationRef===authorizationRef,"deterministic materialization authorization ref mismatch");
  invariant(item.origin.authorizationGeneration===authorizationGeneration,"deterministic materialization authorization generation mismatch");
  invariant(item.origin.authorizationRevision===authorizationRevision,"deterministic materialization authorization revision mismatch");
  invariant(item.origin.implementationArtifactRef===implementationArtifactRef,"deterministic materialization implementation artifact mismatch");
  return item;
}

function materializationReceipt(contract){
  return freeze({
    kind:"ORGANIZATION_MATERIALIZATION_RECEIPT",
    version:1,
    projectId:contract.projectId,
    rootItemId:contract.rootItemId,
    rootIntentId:contract.rootIntentId,
    boardItemId:contract.boardItemId,
    obligationSubjectKey:contract.obligationSubjectKey,
    materializationKey:contract.materializationKey,
    workContractRef:contract.contractRef,
    materializationAuthorizationId:contract.materializationAuthorizationId,
    materializationAuthorizationRef:contract.materializationAuthorizationRef,
    materializationAuthorizationGeneration:contract.materializationAuthorizationGeneration
  });
}

export function createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry}){
  invariant(orchestrator&&typeof orchestrator.materializeAcceptedWork==="function","materializer requires orchestrator.materializeAcceptedWork");
  invariant(orchestrator&&typeof orchestrator.blockOrganizationMaterialization==="function","materializer requires orchestrator.blockOrganizationMaterialization");
  invariant(orchestrator&&typeof orchestrator.readBlackboard==="function","materializer requires orchestrator.readBlackboard");
  invariant(materializationAuthorizationStore&&typeof materializationAuthorizationStore.current==="function","materializer requires materialization authorization store");
  invariant(artifactRegistry&&typeof artifactRegistry.putWorkContract==="function","materializer requires artifact registry");
  invariant(typeof artifactRegistry.putMaterializationReceipt==="function","materializer requires materialization receipt registry");

  return Object.freeze({
    async materialize({authorizationId,decision,obligation}){
      const normalizedAuthorizationId=requireText(authorizationId,"authorizationId");
      invariant(decision&&typeof decision==="object","accepted decision is required");
      invariant(Array.isArray(decision.obligationKeys),"accepted decision obligationKeys are required");
      const obligationKey=requireText(obligation?.key,"obligation.key");
      invariant(decision.obligationKeys.includes(obligationKey),"obligation outside accepted decision scope: "+obligationKey);
      const sliceId=requireText(obligation?.sliceId,"obligation.sliceId");
      const acceptedDecisionRef=requireText(decision.ref,"accepted decision ref");
      const owningDomain=requireText(obligation.owningDomain,"obligation.owningDomain");
      const workloadType=requireText(obligation.workloadType,"obligation.workloadType");
      const summary=requireText(obligation.summary??obligationKey,"obligation.summary");
      const project=organizationProjectBindingFromBoard(await orchestrator.readBlackboard());

      const authHead=await materializationAuthorizationStore.current(normalizedAuthorizationId);
      const resolvedAuthorization=await resolveAuthorization(authHead,{
        artifactRegistry,
        authorizationId:normalizedAuthorizationId,
        project,
        decisionRef:acceptedDecisionRef,
        obligationKey,
        sliceId,
        owningDomain,
        workloadType
      });
      const observed=resolvedAuthorization.observation;
      const implementationArtifactRef=requireText(resolvedAuthorization.value.implementationArtifactRef,"materialization authorization implementationArtifactRef");
      const authorityPolicyRevision=requireText(resolvedAuthorization.value.authorityPolicyRevision,"materialization authorization authorityPolicyRevision");

      const logicalSubjectKey=obligationSubjectKey({
        projectId:project.projectId,
        rootIntentId:project.rootIntentId,
        implementationArtifactRef,
        obligationKey
      });
      const materializationKey=materializationSubjectKey({
        obligationSubjectKey:logicalSubjectKey,
        acceptedDecisionRef,
        authorizationRef:resolvedAuthorization.artifactRef
      });
      const itemId="ORG-"+materializationKey.slice(0,24);

      const contract=defineOrganizationWorkContract({
        ...project,
        acceptedDecisionRef,
        materializationAuthorizationId:normalizedAuthorizationId,
        materializationAuthorizationRef:resolvedAuthorization.artifactRef,
        materializationAuthorizationGeneration:observed.generation,
        materializationAuthorizationRevision:observed.revision,
        authorityPolicyRevision,
        implementationArtifactRef,
        sliceId,
        obligationKey,
        obligationSubjectKey:logicalSubjectKey,
        materializationKey,
        boardItemId:itemId,
        owningDomain,
        workloadType,
        summary,
        dependencyIds:obligation.dependencyIds??[],
        requiredArtifactRefs:obligation.requiredArtifactRefs??obligation.inputRefs??[],
        expectedArtifactKind:obligation.expectedArtifactKind,
        expectedOutputRefs:obligation.expectedOutputRefs??[],
        acceptanceRefs:obligation.acceptanceRefs
      });
      const persistedContractRef=await artifactRegistry.putWorkContract(contract);
      invariant(persistedContractRef===contract.contractRef,"persisted work contract ref mismatch");

      const revalidateAuthorization=async()=>{
        const current=await materializationAuthorizationStore.current(normalizedAuthorizationId);
        const resolved=await resolveAuthorization(current,{
          artifactRegistry,
          authorizationId:normalizedAuthorizationId,
          project,
          decisionRef:acceptedDecisionRef,
          obligationKey,
          sliceId,
          owningDomain,
          workloadType
        });
        invariant(sameObservation(observed,resolved.observation),"materialization authorization changed across publication");
        return true;
      };

      const publicationArgs={
        itemId,
        work:summary,
        owningDomain,
        workloadType,
        dependencyIds:contract.dependencyIds,
        obligationSubjectKey:logicalSubjectKey,
        materializationKey,
        workContractRef:contract.contractRef,
        authorizationId:normalizedAuthorizationId,
        authorizationRef:resolvedAuthorization.artifactRef,
        authorizationGeneration:observed.generation,
        authorizationRevision:observed.revision,
        implementationArtifactRef,
        projectId:project.projectId,
        rootItemId:project.rootItemId,
        rootIntentId:project.rootIntentId,
        revalidateAuthorization
      };

      let materialized;
      try{
        materialized=await orchestrator.materializeAcceptedWork(publicationArgs);
      }catch(error){
        if(!/transaction conflict/i.test(String(error?.message??""))) throw error;
        const board=await orchestrator.readBlackboard();
        const exact=board.items.find((item)=>item.id===itemId)??null;
        if(exact==null){
          const conflicting=board.items.find((item)=>
            item.origin?.kind==="ORGANIZATION_MATERIALIZATION"&&
            item.origin.obligationSubjectKey===logicalSubjectKey&&
            !["DONE","SUPERSEDED"].includes(item.status)
          )??null;
          invariant(conflicting==null,"live organization work already exists for obligationSubjectKey");
        }
        const item=assertPublishedItem(exact,{
          itemId,contract,
          authorizationId:normalizedAuthorizationId,
          authorizationRef:resolvedAuthorization.artifactRef,
          authorizationGeneration:observed.generation,
          authorizationRevision:observed.revision,
          implementationArtifactRef
        });
        materialized={result:item,snapshot:board};
      }

      const publishedItem=assertPublishedItem(materialized.result,{
        itemId,contract,
        authorizationId:normalizedAuthorizationId,
        authorizationRef:resolvedAuthorization.artifactRef,
        authorizationGeneration:observed.generation,
        authorizationRevision:observed.revision,
        implementationArtifactRef
      });

      try{
        await revalidateAuthorization();
      }catch(error){
        await orchestrator.blockOrganizationMaterialization({
          itemId,
          authorizationRef:resolvedAuthorization.artifactRef,
          authorizationGeneration:observed.generation,
          reasonRef:"materialization-authorization-drift:"+resolvedAuthorization.artifactRef
        });
        throw error;
      }

      const receipt=materializationReceipt(contract);
      const materializationReceiptRef=await artifactRegistry.putMaterializationReceipt(receipt);
      return freeze({
        item:publishedItem,
        contract,
        obligationSubjectKey:logicalSubjectKey,
        materializationKey,
        materializationReceiptRef,
        authorizationGeneration:observed.generation
      });
    }
  });
}

export function createOrganizationWorkDiscovery({orchestrator,artifactRegistry}){
  invariant(orchestrator&&typeof orchestrator.readBlackboard==="function","organization discovery requires readBlackboard");
  invariant(artifactRegistry&&typeof artifactRegistry.resolveWorkContract==="function","organization discovery requires artifact registry");

  return Object.freeze({
    async listEligible({owningDomain}){
      const domain=requireText(owningDomain,"owningDomain");
      const board=await orchestrator.readBlackboard();
      const project=organizationProjectBindingFromBoard(board);
      const byId=new Map(board.items.map((item)=>[item.id,item]));
      const discovered=[];

      for(const item of board.items){
        if(item.origin?.kind!=="ORGANIZATION_MATERIALIZATION") continue;
        if(!["READY","REOPENED"].includes(item.status)) continue;
        if((item.dependsOn??[]).some((dependencyId)=>byId.get(dependencyId)?.status!=="DONE")) continue;

        const ref=requireText(item.origin.workContractRef,"organization workContractRef");
        const raw=await artifactRegistry.resolveWorkContract(ref);
        invariant(raw,"organization work contract artifact not found: "+ref);
        const contract=defineOrganizationWorkContract(raw);
        invariant(contract.contractRef===ref,"organization work contract ref mismatch");
        invariant(contract.boardItemId===item.id,"organization work contract Board item mismatch");
        invariant(contract.projectId===project.projectId&&contract.rootItemId===project.rootItemId&&contract.rootIntentId===project.rootIntentId,"organization work contract project/root mismatch");
        invariant(contract.obligationSubjectKey===item.origin.obligationSubjectKey&&contract.materializationKey===item.origin.materializationKey,"organization work identity mismatch");
        invariant(contract.materializationAuthorizationId===item.origin.authorizationId&&contract.materializationAuthorizationRef===item.origin.authorizationRef&&contract.materializationAuthorizationGeneration===item.origin.authorizationGeneration,"organization work authorization provenance mismatch");
        invariant(contract.owningDomain===item.origin.owningDomain,"organization work domain mismatch");
        if(contract.owningDomain!==domain) continue;
        discovered.push(freeze({item,contract}));
      }
      return freeze(discovered);
    }
  });
}
