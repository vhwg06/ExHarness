import { AuthorityHeadStatus } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),name+" must be a non-empty string");return value;}
function freeze(value){return Object.freeze(structuredClone(value));}

function canonicalArtifact(value,subjectField){
  const artifact=structuredClone(value);
  delete artifact.authorizationRef;
  delete artifact.policyRef;
  delete artifact.artifactRef;
  delete artifact.issuedByAuthorityRef;
  delete artifact.publishedByAuthorityRef;
  requireText(artifact[subjectField],subjectField);
  invariant(Number.isInteger(artifact.generation)&&artifact.generation>0,"authority generation must be positive");
  invariant(
    artifact.status===AuthorityHeadStatus.ACTIVE||artifact.status===AuthorityHeadStatus.REVOKED,
    "authority status is invalid"
  );
  return artifact;
}

function verifiedAuthorityRef(verification,publisherIdentity){
  invariant(
    verification&&typeof verification==="object"&&!Array.isArray(verification),
    "authority publisher is not trusted: "+publisherIdentity
  );
  return requireText(verification.authorityRef,"verified authorityRef");
}

export function createOrganizationAuthorityPublisher({
  organizationAuthority,
  artifactRegistry,
  materializationAuthorizationStore,
  executionAuthorityPolicyStore
}){
  invariant(
    organizationAuthority&&typeof organizationAuthority.verifyMaterializationAuthorizationIssuer==="function",
    "organizationAuthority.verifyMaterializationAuthorizationIssuer is required"
  );
  invariant(
    organizationAuthority&&typeof organizationAuthority.verifyExecutionAuthorityPolicyPublisher==="function",
    "organizationAuthority.verifyExecutionAuthorityPolicyPublisher is required"
  );
  invariant(artifactRegistry&&typeof artifactRegistry.putMaterializationAuthorization==="function","artifactRegistry is required");

  async function publish({
    store,key,value,verify,publisher,putArtifact,subjectField,provenanceField
  }){
    const publisherIdentity=requireText(publisher?.identity,"publisher.identity");
    const unsigned=canonicalArtifact(value,subjectField);
    invariant(unsigned[subjectField]===key,"authority subject mismatch");
    const verification=await verify({publisher:freeze(publisher),value:freeze(unsigned)});
    const authorityRef=verifiedAuthorityRef(verification,publisherIdentity);
    const artifact=freeze({...unsigned,[provenanceField]:authorityRef});
    const artifactRef=await putArtifact(artifact);
    const current=await store.current(key);
    const next=freeze({generation:artifact.generation,status:artifact.status,artifactRef});
    invariant(await store.compareAndSwap(key,current?.revision??null,next),"authority head CAS conflict: "+key);
    return freeze(await store.current(key));
  }

  return Object.freeze({
    publishMaterializationAuthorization({publisher,authorization}){
      return publish({
        store:materializationAuthorizationStore,
        key:requireText(authorization?.authorizationId,"authorization.authorizationId"),
        value:authorization,
        verify:(subject)=>organizationAuthority.verifyMaterializationAuthorizationIssuer(subject),
        publisher,
        putArtifact:(artifact)=>artifactRegistry.putMaterializationAuthorization(artifact),
        subjectField:"authorizationId",
        provenanceField:"issuedByAuthorityRef"
      });
    },
    publishExecutionAuthorityPolicy({publisher,policy}){
      return publish({
        store:executionAuthorityPolicyStore,
        key:requireText(policy?.policyId,"policy.policyId"),
        value:policy,
        verify:(subject)=>organizationAuthority.verifyExecutionAuthorityPolicyPublisher(subject),
        publisher,
        putArtifact:(artifact)=>artifactRegistry.putExecutionAuthorityPolicy(artifact),
        subjectField:"policyId",
        provenanceField:"publishedByAuthorityRef"
      });
    }
  });
}
