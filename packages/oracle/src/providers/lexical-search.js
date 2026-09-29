import { ProviderOperation, ProviderFailure } from '../provider-contract.js';
export function createLexicalSearchProvider({searchClient,providerId='lexical-search'}={}){
 if(!searchClient||typeof searchClient.search!=='function')throw new TypeError('searchClient.search() required');
 return {descriptor:{providerId,sourceKinds:['REPOSITORY'],operations:[ProviderOperation.SEARCH_LEXICAL],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION','CONTENT_DIGEST'],maxConcurrentCalls:4,costClass:'LOW'},async retrieve(work){
  const source=work.sourceConstraint;
  const response=await searchClient.search({repositoryRef:source.ref,snapshotRef:source.snapshot.mode==='EXACT'?source.snapshot.ref:null,query:work.semanticNeed,maxItems:work.reservedBudget.items});
  if(!response||!Array.isArray(response.hits)||!response.snapshotRef)throw new ProviderFailure({reason:'SOURCE_FAILURE',providerId,evidenceId:work.evidenceId,detail:'malformed lexical response'});
  return response.hits.map((hit,i)=>({evidenceId:work.evidenceId,source:{kind:'REPOSITORY',ref:source.ref,snapshotRef:response.snapshotRef,itemRef:hit.path},validators:response.validators??[{kind:'REVISION',value:response.snapshotRef,strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:hit.sourceRef}],content:hit.snippet,providerEvidence:{providerId,operation:ProviderOperation.SEARCH_LEXICAL,score:hit.score??0,rank:i}}));
 }};
}
