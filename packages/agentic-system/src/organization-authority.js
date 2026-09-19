import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function freeze(value){return Object.freeze(structuredClone(value));}
function canonicalArtifact(value,subjectField){
  const artifact=structuredClone(value); delete artifact.authorizationRef; delete artifact.policyRef; delete artifact.artifactRef;
  requireText(artifact[subjectField],subjectField);
  invariant(Number.isInteger(artifact.generation)&&artifact.generation>0,"authority generation must be positive");
  invariant(artifact.status===AuthorityHeadStatus.ACTIVE||artifact.status===AuthorityHeadStatus.REVOKED,"authority status is invalid");
  return freeze(artifact);
}
export function createOrganizationAuthorityPublisher({organizationAuthority,artifactRegistry,materializationAuthorizationStore,executionAuthorityPolicyStore}){
  invariant(organizationAuthority&&typeof organizationAuthority.verifyMaterializationAuthorizationIssuer==="function","organizationAuthority.verifyMaterializationAuthorizationIssuer is required");
  invariant(organizationAuthority&&typeof organizationAuthority.verifyExecutionAuthorityPolicyPublisher==="function","organizationAuthority.verifyExecutionAuthorityPolicyPublisher is required");
  invariant(artifactRegistry&&typeof artifactRegistry.putMaterializationAuthorization==="function","artifactRegistry is required");
  async function publish({store,key,value,verify,publisher,putArtifact,subjectField}){
    requireText(publisher?.identity,"publisher.identity");
    const artifact=canonicalArtifact(value,subjectField);
    invariant(artifact[subjectField]===key,"authority subject mismatch");
    invariant(await verify({publisher:freeze(publisher),value:artifact})===true,`authority publisher is not trusted: ${publisher.identity}`);
    const artifactRef=await putArtifact(artifact);
    const current=await store.current(key);
    const next=freeze({generation:artifact.generation,status:artifact.status,artifactRef});
    invariant(await store.compareAndSwap(key,current?.revision??null,next),`authority head CAS conflict: ${key}`);
    return freeze(await store.current(key));
  }
  return Object.freeze({
    publishMaterializationAuthorization({publisher,authorization}){return publish({store:materializationAuthorizationStore,key:requireText(authorization?.authorizationId,"authorization.authorizationId"),value:authorization,verify:(x)=>organizationAuthority.verifyMaterializationAuthorizationIssuer(x),publisher,putArtifact:(x)=>artifactRegistry.putMaterializationAuthorization(x),subjectField:"authorizationId"});},
    publishExecutionAuthorityPolicy({publisher,policy}){return publish({store:executionAuthorityPolicyStore,key:requireText(policy?.policyId,"policy.policyId"),value:policy,verify:(x)=>organizationAuthority.verifyExecutionAuthorityPolicyPublisher(x),publisher,putArtifact:(x)=>artifactRegistry.putExecutionAuthorityPolicy(x),subjectField:"policyId"});}
  });
}
