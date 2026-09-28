import { ProviderOperation, ProviderFailure } from '../provider-contract.js';
export function createExternalSourceProvider({transport,sourceKinds=['EXTERNAL','MCP_RESOURCE'],providerId='external-source'}={}){
 if(!transport||typeof transport.fetch!=='function')throw new TypeError('transport.fetch() required');
 return {descriptor:{providerId,sourceKinds,operations:[ProviderOperation.FETCH_EXTERNAL],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION','CONTENT_DIGEST','OPAQUE'],maxConcurrentCalls:2,costClass:'HIGH'},async retrieve(work){
  const response=await transport.fetch({source:work.sourceConstraint,need:work.semanticNeed,maxBytes:work.reservedBudget.materializedBytes});
  if(!response||!response.snapshotRef||!Array.isArray(response.validators)||!Array.isArray(response.provenance))throw new ProviderFailure({reason:'CURRENTNESS_UNVERIFIABLE',providerId,evidenceId:work.evidenceId,detail:'external response lacks source validator/provenance'});
  if(work.sourceConstraint.snapshot.mode==='CURRENT'&&!response.validators.some(v=>v.strength==='STRONG'))throw new ProviderFailure({reason:'CURRENTNESS_UNVERIFIABLE',providerId,evidenceId:work.evidenceId,detail:'external CURRENT response lacks strong validator'});
  return [{evidenceId:work.evidenceId,source:{kind:work.sourceConstraint.kind,ref:work.sourceConstraint.ref,snapshotRef:response.snapshotRef,itemRef:response.itemRef??null},validators:response.validators,provenance:response.provenance,content:response.content,providerEvidence:{providerId,operation:ProviderOperation.FETCH_EXTERNAL}}];
 }};
}
