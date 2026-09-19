import { createHash } from "node:crypto";
import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),name+" must be a non-empty string");return value;}
function textArray(value,name,{min=0}={}){invariant(Array.isArray(value)&&value.length>=min,name+" must contain at least "+min+" item(s)");return value.map((x,i)=>requireText(x,name+"["+i+"]"));}
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

export function defineOrganizationWorkContract(raw){
  invariant(raw&&typeof raw==="object"&&!Array.isArray(raw),"OrganizationWorkContract must be an object");
  const contract={
    kind:"ORGANIZATION_WORK_CONTRACT",
    version:1,
    projectId:requireText(raw.projectId,"OrganizationWorkContract.projectId"),
    rootItemId:requireText(raw.rootItemId,"OrganizationWorkContract.rootItemId"),
    rootIntentId:requireText(raw.rootIntentId,"OrganizationWorkContract.rootIntentId"),
    obligationKey:requireText(raw.obligationKey,"OrganizationWorkContract.obligationKey"),
    acceptedDecisionRef:requireText(raw.acceptedDecisionRef,"OrganizationWorkContract.acceptedDecisionRef"),
    owningDomain:requireText(raw.owningDomain,"OrganizationWorkContract.owningDomain"),
    workloadType:requireText(raw.workloadType,"OrganizationWorkContract.workloadType"),
    inputRefs:textArray(raw.inputRefs??[],"OrganizationWorkContract.inputRefs"),
    expectedOutputRefs:textArray(raw.expectedOutputRefs??[],"OrganizationWorkContract.expectedOutputRefs"),
    acceptanceRefs:textArray(raw.acceptanceRefs??[],"OrganizationWorkContract.acceptanceRefs",{min:1})
  };
  const contractRef="organization-work-contract:sha256:"+digest(contract);
  return freeze({...contract,contractRef});
}

export function materializationSubjectKey({projectId,obligationKey,acceptedDecisionRef,authorizationRef}){
  return digest({
    projectId:requireText(projectId,"projectId"),
    obligationKey:requireText(obligationKey,"obligationKey"),
    acceptedDecisionRef:requireText(acceptedDecisionRef,"acceptedDecisionRef"),
    authorizationRef:requireText(authorizationRef,"authorizationRef")
  });
}

function sameObservation(left,right){
  return left.revision===right.revision&&left.generation===right.generation&&left.artifactRef===right.artifactRef;
}

async function resolveAuthorization(head,{artifactRegistry,authorizationId,projectId,decisionRef,obligationKey,owningDomain,workloadType}){
  invariant(head?.value,"materialization authorization is unavailable");
  invariant(head.value.status===AuthorityHeadStatus.ACTIVE,"materialization authorization is not active");
  const ref=requireText(head.value.artifactRef,"materialization authorization artifactRef");
  const value=await artifactRegistry.resolveMaterializationAuthorization(ref);
  invariant(value,"materialization authorization artifact is unavailable");
  invariant(value.authorizationId===authorizationId&&value.generation===head.value.generation&&value.status===head.value.status,"materialization authorization artifact/head mismatch");
  invariant(value.projectId===projectId,"materialization authorization project mismatch");
  invariant(value.acceptedDecisionRef===decisionRef,"materialization authorization decision mismatch");
  invariant(Array.isArray(value.obligationKeys)&&value.obligationKeys.includes(obligationKey),"obligation is outside materialization authorization scope");
  if(value.owningDomain!=null) invariant(value.owningDomain===owningDomain,"materialization authorization domain mismatch");
  if(value.workloadType!=null) invariant(value.workloadType===workloadType,"materialization authorization workload mismatch");
  return {value,artifactRef:ref,observation:freeze({revision:head.revision,generation:head.value.generation,artifactRef:ref})};
}

export function createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry}){
  invariant(orchestrator&&typeof orchestrator.materializeAcceptedWork==="function","materializer requires orchestrator.materializeAcceptedWork");
  invariant(orchestrator&&typeof orchestrator.blockOrganizationMaterialization==="function","materializer requires orchestrator.blockOrganizationMaterialization");
  invariant(orchestrator&&typeof orchestrator.readBlackboard==="function","materializer requires orchestrator.readBlackboard");
  invariant(materializationAuthorizationStore&&typeof materializationAuthorizationStore.current==="function","materializer requires materialization authorization store");
  invariant(artifactRegistry&&typeof artifactRegistry.putWorkContract==="function","materializer requires artifact registry");

  return Object.freeze({
    async materialize({authorizationId,decision,obligation}){
      requireText(authorizationId,"authorizationId");
      invariant(decision&&typeof decision==="object","accepted decision is required");
      invariant(Array.isArray(decision.obligationKeys),"accepted decision obligationKeys are required");
      const obligationKey=requireText(obligation?.key,"obligation.key");
      invariant(decision.obligationKeys.includes(obligationKey),"obligation outside accepted decision scope: "+obligationKey);
      const acceptedDecisionRef=requireText(decision.ref,"accepted decision ref");
      const owningDomain=requireText(obligation.owningDomain,"obligation.owningDomain");
      const workloadType=requireText(obligation.workloadType,"obligation.workloadType");
      const project=organizationProjectBindingFromBoard(await orchestrator.readBlackboard());

      const authHead=await materializationAuthorizationStore.current(authorizationId);
      const resolvedAuthorization=await resolveAuthorization(authHead,{
        artifactRegistry,authorizationId,projectId:project.projectId,
        decisionRef:acceptedDecisionRef,obligationKey,owningDomain,workloadType
      });
      const observed=resolvedAuthorization.observation;

      const contract=defineOrganizationWorkContract({
        ...project,
        obligationKey,
        acceptedDecisionRef,
        owningDomain,
        workloadType,
        inputRefs:obligation.inputRefs??[],
        expectedOutputRefs:obligation.expectedOutputRefs??[],
        acceptanceRefs:obligation.acceptanceRefs
      });
      const persistedContractRef=await artifactRegistry.putWorkContract(contract);
      invariant(persistedContractRef===contract.contractRef,"persisted work contract ref mismatch");
      const key=materializationSubjectKey({
        projectId:project.projectId,
        obligationKey,
        acceptedDecisionRef,
        authorizationRef:resolvedAuthorization.artifactRef
      });
      const itemId="ORG-"+key.slice(0,24);

      const revalidateAuthorization=async()=>{
        const current=await materializationAuthorizationStore.current(authorizationId);
        const resolved=await resolveAuthorization(current,{
          artifactRegistry,authorizationId,projectId:project.projectId,
          decisionRef:acceptedDecisionRef,obligationKey,owningDomain,workloadType
        });
        invariant(sameObservation(observed,resolved.observation),"materialization authorization changed across publication");
        return true;
      };

      const materialized=await orchestrator.materializeAcceptedWork({
        itemId,
        work:requireText(obligation.summary??obligationKey,"obligation.summary"),
        owningDomain,
        workloadType,
        materializationKey:key,
        workContractRef:contract.contractRef,
        authorizationRef:resolvedAuthorization.artifactRef,
        authorizationGeneration:observed.generation,
        authorizationRevision:observed.revision,
        projectId:project.projectId,
        rootItemId:project.rootItemId,
        rootIntentId:project.rootIntentId,
        revalidateAuthorization
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

      return freeze({
        item:materialized.result,
        contract,
        materializationKey:key,
        authorizationGeneration:observed.generation
      });
    }
  });
}
