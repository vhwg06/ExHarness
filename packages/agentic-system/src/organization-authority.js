import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function freeze(value){return Object.freeze(structuredClone(value));}

export function createOrganizationAuthorityPublisher({
  organizationAuthority,
  artifactRegistry,
  materializationAuthorizationStore,
  executionAuthorityPolicyStore
}){
  invariant(organizationAuthority&&typeof organizationAuthority.verifyMaterializationAuthorizationIssuer==="function","organizationAuthority.verifyMaterializationAuthorizationIssuer is required");
  invariant(organizationAuthority&&typeof organizationAuthority.verifyExecutionAuthorityPolicyPublisher==="function","organizationAuthority.verifyExecutionAuthorityPolicyPublisher is required");
  invariant(artifactRegistry&&typeof artifactRegistry.putMaterializationAuthorization==="function","artifactRegistry is required");

  async function publish({store,key,value,verify,publisher,putArtifact,refField}){
    requireText(key,"authority head key");
    requireText(publisher?.identity,"publisher.identity");
    invariant(value&&typeof value==="object"&&!Array.isArray(value),"authority value must be an object");
    invariant(value.status===AuthorityHeadStatus.ACTIVE||value.status===AuthorityHeadStatus.REVOKED,"authority status is invalid");
    const verified=await verify({publisher:freeze(publisher),value:freeze(value)});
    invariant(verified===true,`authority publisher is not trusted: ${publisher.identity}`);
    const artifactValue=freeze({...value});
    const artifactRef=await putArtifact(artifactValue);
    const current=await store.current(key);
    const next=freeze({...artifactValue,[refField]:artifactRef});
    const ok=await store.compareAndSwap(key,current?.revision??null,next);
    invariant(ok,`authority head CAS conflict: ${key}`);
    return freeze((await store.current(key)).value);
  }

  return Object.freeze({
    publishMaterializationAuthorization({publisher,authorization}){
      return publish({
        store:materializationAuthorizationStore,
        key:requireText(authorization?.authorizationId,"authorization.authorizationId"),
        value:authorization,
        verify:(subject)=>organizationAuthority.verifyMaterializationAuthorizationIssuer(subject),
        publisher,
        putArtifact:(value)=>artifactRegistry.putMaterializationAuthorization(value),
        refField:"authorizationRef"
      });
    },
    publishExecutionAuthorityPolicy({publisher,policy}){
      return publish({
        store:executionAuthorityPolicyStore,
        key:requireText(policy?.policyId,"policy.policyId"),
        value:policy,
        verify:(subject)=>organizationAuthority.verifyExecutionAuthorityPolicyPublisher(subject),
        publisher,
        putArtifact:(value)=>artifactRegistry.putExecutionAuthorityPolicy(value),
        refField:"policyRef"
      });
    }
  });
}
