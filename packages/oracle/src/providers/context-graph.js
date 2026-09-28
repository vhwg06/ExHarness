import { ProviderOperation, ProviderFailure } from '../provider-contract.js';
export function createContextGraphProvider({graphClient,providerId='context-graph'}={}){
 if(!graphClient||typeof graphClient.traverse!=='function')throw new TypeError('graphClient.traverse() required');
 return {descriptor:{providerId,sourceKinds:['CONTEXT_GRAPH'],operations:[ProviderOperation.TRAVERSE_GRAPH],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION','CONTENT_DIGEST'],maxConcurrentCalls:2,costClass:'MEDIUM'},async retrieve(work){
  const response=await graphClient.traverse({source:work.sourceConstraint,need:work.semanticNeed,maxItems:work.reservedBudget.items});
  if(!response||!Array.isArray(response.paths)||!response.snapshotRef)throw new ProviderFailure({reason:'SOURCE_FAILURE',providerId,evidenceId:work.evidenceId,detail:'malformed graph response'});
  return response.paths.map((path,i)=>{
   if(!Array.isArray(path.provenance)||!path.provenance.some(p=>p.kind==='AUTHORITATIVE_SOURCE'))throw new ProviderFailure({reason:'CURRENTNESS_UNVERIFIABLE',providerId,evidenceId:work.evidenceId,detail:'graph path lacks authoritative source provenance'});
   return {evidenceId:work.evidenceId,source:{kind:'CONTEXT_GRAPH',ref:work.sourceConstraint.ref,snapshotRef:response.snapshotRef,itemRef:path.ref??null},validators:response.validators??[{kind:'REVISION',value:response.snapshotRef,strength:'STRONG'}],provenance:path.provenance,content:path.content,providerEvidence:{providerId,operation:ProviderOperation.TRAVERSE_GRAPH,rank:i}};
  });
 }};
}
