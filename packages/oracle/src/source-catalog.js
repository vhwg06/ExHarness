import { defineContextRequirement } from './context-contract.js';
import { defineProviderDescriptor, defineProviderCandidate, ProviderFailure, ProviderFailureReason, ProviderOperation } from './provider-contract.js';
import { readRepositorySources } from './providers/repository-source.js';
import { readApplicationArtifacts } from './providers/application-artifact-source.js';

const fail=message=>{throw new TypeError(message);};
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())fail(`${label} must be nonempty text`);return value;};
export function createSourceCatalog({providers=[],snapshotAuthorities=[]}={}){
 const registrations=new Map(),authorities=[];
 function registerProvider({descriptor,retrieve}){
  const d=defineProviderDescriptor(descriptor);if(registrations.has(d.providerId))fail(`duplicate provider id: ${d.providerId}`);if(typeof retrieve!=='function')fail(`provider ${d.providerId} requires retrieve()`);
  registrations.set(d.providerId,Object.freeze({descriptor:d,retrieve}));return d;
 }
 function registerSnapshotAuthority({sourceKind,refPrefix='',observe}){
  text(sourceKind,'sourceKind');if(typeof refPrefix!=='string'||typeof observe!=='function')fail('snapshot authority requires refPrefix and observe()');
  if(authorities.some(a=>a.sourceKind===sourceKind&&(a.refPrefix.startsWith(refPrefix)||refPrefix.startsWith(a.refPrefix))))fail('ambiguous snapshot authority namespace');
  authorities.push(Object.freeze({sourceKind,refPrefix,observe}));
 }
 for(const provider of providers)registerProvider(provider);
 for(const authority of snapshotAuthorities)registerSnapshotAuthority(authority);
 function compatible(evidence,operation){return [...registrations.values()].filter(p=>p.descriptor.sourceKinds.includes(evidence.source.kind)&&p.descriptor.snapshotModes.includes(evidence.source.snapshot.mode)&&p.descriptor.operations.includes(operation)).sort((a,b)=>a.descriptor.providerId.localeCompare(b.descriptor.providerId));}
 function authorityFor(source){const matches=authorities.filter(a=>a.sourceKind===source.kind&&source.ref.startsWith(a.refPrefix));if(matches.length!==1)fail(`missing/ambiguous snapshot authority for ${source.kind}:${source.ref}`);return matches[0];}
 async function validateCandidate(raw,{requirement,providerId}){
  const r=defineContextRequirement(requirement),registration=registrations.get(text(providerId,'providerId'));if(!registration)fail('provider not registered');
  const candidate=defineProviderCandidate(raw,{descriptor:registration.descriptor,requirement:r});
  const evidence=r.evidence.find(e=>e.id===candidate.evidenceId);
  if(evidence.source.snapshot.mode==='CURRENT'){
   let authority;try{authority=authorityFor(candidate.source);}catch(error){throw new ProviderFailure({reason:ProviderFailureReason.CURRENTNESS_UNVERIFIABLE,providerId,evidenceId:candidate.evidenceId,detail:error.message});}
   const observed=await authority.observe({kind:candidate.source.kind,ref:candidate.source.ref});
   if(!observed||typeof observed.snapshotRef!=='string'||!observed.snapshotRef.trim())throw new ProviderFailure({reason:ProviderFailureReason.CURRENTNESS_UNVERIFIABLE,providerId,evidenceId:candidate.evidenceId,detail:'authoritative snapshot missing'});
   if(observed.snapshotRef!==candidate.source.snapshotRef)throw new ProviderFailure({reason:ProviderFailureReason.STALE,providerId,evidenceId:candidate.evidenceId,detail:'provider snapshot differs from authoritative source'});
   const authoritativeValidators=Array.isArray(observed.validators)?observed.validators:[{kind:'REVISION',value:observed.snapshotRef,strength:'STRONG'}];
   if(!candidate.validators.some(v=>v.strength==='STRONG'&&authoritativeValidators.some(a=>a.strength==='STRONG'&&a.kind===v.kind&&a.value===v.value)))throw new ProviderFailure({reason:ProviderFailureReason.CURRENTNESS_UNVERIFIABLE,providerId,evidenceId:candidate.evidenceId,detail:'strong validator does not bind authoritative snapshot'});
  }
  return candidate;
 }
 return Object.freeze({registerProvider,registerSnapshotAuthority,providers:()=>Object.freeze([...registrations.values()].map(x=>x.descriptor)),compatible,provider:providerId=>registrations.get(providerId)??null,validateCandidate,authorityFor});
}
export function createExactRepositoryProvider({repositoryReader,currentSnapshot=null,providerId='repository-exact'}={}){
 if(!repositoryReader||typeof repositoryReader.readFile!=='function')fail('repositoryReader.readFile required');
 return {descriptor:{providerId,sourceKinds:['REPOSITORY'],operations:[ProviderOperation.READ_EXACT],snapshotModes:currentSnapshot?['EXACT','CURRENT']:['EXACT'],currentnessValidators:['REVISION'],maxConcurrentCalls:1,costClass:'LOW'},async retrieve(work){
  const source=work.sourceConstraint;const path=source.itemRef;const revision=source.snapshot.mode==='CURRENT'?await currentSnapshot({kind:'REPOSITORY',ref:source.ref}):source.snapshot.ref;text(revision,'repository snapshot');const result=await readRepositorySources({repositoryRef:source.ref,revision,requiredFiles:[path]},{repositoryReader});
  return result.files.map(file=>({evidenceId:work.evidenceId,source:{kind:'REPOSITORY',ref:source.ref,snapshotRef:revision,itemRef:file.path},validators:[{kind:'REVISION',value:revision,strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:file.sourceRef}],content:file.content,providerEvidence:{providerId,operation:ProviderOperation.READ_EXACT}}));
 }};
}
export function createExactArtifactProvider({artifactReader,currentSnapshot=null,producerWorkOrderId,acceptanceDecision,providerId='artifact-exact'}={}){
 if(!artifactReader||typeof artifactReader.readArtifact!=='function')fail('artifactReader.readArtifact required');text(producerWorkOrderId,'producerWorkOrderId');if(!acceptanceDecision||!acceptanceDecision.id||!acceptanceDecision.digest)fail('acceptanceDecision required');
 return {descriptor:{providerId,sourceKinds:['APPLICATION_ARTIFACT'],operations:[ProviderOperation.READ_EXACT],snapshotModes:currentSnapshot?['EXACT','CURRENT']:['EXACT'],currentnessValidators:['REVISION'],maxConcurrentCalls:1,costClass:'LOW'},async retrieve(work){
  const source=work.sourceConstraint;const revision=source.snapshot.mode==='CURRENT'?await currentSnapshot({kind:'APPLICATION_ARTIFACT',ref:source.ref}):source.snapshot.ref;text(revision,'artifact snapshot');const result=await readApplicationArtifacts({requiredArtifacts:[{ref:source.ref,...(source.itemRef?{path:source.itemRef}:{})}],producerWorkOrderId,revision,acceptanceDecision},{artifactReader});
  return result.artifacts.map(artifact=>({evidenceId:work.evidenceId,source:{kind:'APPLICATION_ARTIFACT',ref:source.ref,snapshotRef:revision,itemRef:artifact.path??null},validators:[{kind:'REVISION',value:revision,strength:'STRONG'}],provenance:[{kind:'PRODUCER_WORK_ORDER',ref:producerWorkOrderId},{kind:'ACCEPTANCE_DECISION',ref:acceptanceDecision.id,digest:acceptanceDecision.digest},{kind:'SOURCE_REF',ref:artifact.sourceRef}],content:artifact.content,providerEvidence:{providerId,operation:ProviderOperation.READ_EXACT}}));
 }};
}
