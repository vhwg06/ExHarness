import { createHash } from "node:crypto";
import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function textArray(value,name,{min=0}={}){invariant(Array.isArray(value)&&value.length>=min,`${name} must contain at least ${min} item(s)`);return value.map((x,i)=>requireText(x,`${name}[${i}]`));}
function freeze(value){return Object.freeze(structuredClone(value));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}

export function defineOrganizationWorkContract(raw){
  invariant(raw&&typeof raw==="object"&&!Array.isArray(raw),"OrganizationWorkContract must be an object");
  const contract={
    kind:"ORGANIZATION_WORK_CONTRACT",
    version:1,
    obligationKey:requireText(raw.obligationKey,"OrganizationWorkContract.obligationKey"),
    acceptedDecisionRef:requireText(raw.acceptedDecisionRef,"OrganizationWorkContract.acceptedDecisionRef"),
    owningDomain:requireText(raw.owningDomain,"OrganizationWorkContract.owningDomain"),
    workloadType:requireText(raw.workloadType,"OrganizationWorkContract.workloadType"),
    inputRefs:textArray(raw.inputRefs??[],"OrganizationWorkContract.inputRefs"),
    expectedOutputRefs:textArray(raw.expectedOutputRefs??[],"OrganizationWorkContract.expectedOutputRefs"),
    acceptanceRefs:textArray(raw.acceptanceRefs??[],"OrganizationWorkContract.acceptanceRefs",{min:1})
  };
  const contractRef=`organization-work-contract:sha256:${digest(contract)}`;
  return freeze({...contract,contractRef});
}

export function materializationSubjectKey({obligationKey,acceptedDecisionRef,authorizationRef}){
  return digest({
    obligationKey:requireText(obligationKey,"obligationKey"),
    acceptedDecisionRef:requireText(acceptedDecisionRef,"acceptedDecisionRef"),
    authorizationRef:requireText(authorizationRef,"authorizationRef")
  });
}

function assertAuthorization(head,{authorizationId,decisionRef,obligationKey,owningDomain,workloadType}){
  invariant(head?.value,"materialization authorization is unavailable");
  const value=head.value;
  invariant(value.status===AuthorityHeadStatus.ACTIVE,"materialization authorization is not active");
  invariant(value.authorizationId===authorizationId,"materialization authorization subject mismatch");
  invariant(value.acceptedDecisionRef===decisionRef,"materialization authorization decision mismatch");
  invariant(Array.isArray(value.obligationKeys)&&value.obligationKeys.includes(obligationKey),"obligation is outside materialization authorization scope");
  if(value.owningDomain!=null) invariant(value.owningDomain===owningDomain,"materialization authorization domain mismatch");
  if(value.workloadType!=null) invariant(value.workloadType===workloadType,"materialization authorization workload mismatch");
  return value;
}

export function createOrganizationWorkMaterializer({orchestrator,materializationAuthorizationStore,artifactRegistry}){
  invariant(orchestrator&&typeof orchestrator.materializeAcceptedWork==="function","materializer requires orchestrator.materializeAcceptedWork");
  invariant(materializationAuthorizationStore&&typeof materializationAuthorizationStore.current==="function","materializer requires materialization authorization store");
  invariant(artifactRegistry&&typeof artifactRegistry.putWorkContract==="function","materializer requires artifact registry");
  return Object.freeze({
    async materialize({authorizationId,decision,obligation}){
      requireText(authorizationId,"authorizationId");
      invariant(decision&&typeof decision==="object","accepted decision is required");
      invariant(Array.isArray(decision.obligationKeys),"accepted decision obligationKeys are required");
      const obligationKey=requireText(obligation?.key,"obligation.key");
      invariant(decision.obligationKeys.includes(obligationKey),`obligation outside accepted decision scope: ${obligationKey}`);
      const acceptedDecisionRef=requireText(decision.ref,"accepted decision ref");
      const owningDomain=requireText(obligation.owningDomain,"obligation.owningDomain");
      const workloadType=requireText(obligation.workloadType,"obligation.workloadType");
      const authHead=await materializationAuthorizationStore.current(authorizationId);
      const authorization=assertAuthorization(authHead,{
        authorizationId,decisionRef:acceptedDecisionRef,obligationKey,owningDomain,workloadType
      });
      const contract=defineOrganizationWorkContract({
        obligationKey,
        acceptedDecisionRef,
        owningDomain,
        workloadType,
        inputRefs:obligation.inputRefs??[],
        expectedOutputRefs:obligation.expectedOutputRefs??[],
        acceptanceRefs:obligation.acceptanceRefs
      });
      const persistedContractRef=await artifactRegistry.putWorkContract({...contract,contractRef:undefined});
      invariant(persistedContractRef===contract.contractRef,"persisted work contract ref mismatch");
      const key=materializationSubjectKey({
        obligationKey,
        acceptedDecisionRef,
        authorizationRef:requireText(authorization.authorizationRef,"materialization authorization ref")
      });
      const itemId=`ORG-${key.slice(0,24)}`;
      const materialized=await orchestrator.materializeAcceptedWork({
        itemId,
        work:requireText(obligation.summary??obligationKey,"obligation.summary"),
        owningDomain,
        workloadType,
        materializationKey:key,
        workContractRef:contract.contractRef,
        authorizationRef:authorization.authorizationRef
      });
      return freeze({item:materialized.result,contract,materializationKey:key,authorizationGeneration:authorization.generation});
    }
  });
}
