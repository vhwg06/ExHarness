import { ProviderOperation, ProviderFailure } from '../provider-contract.js';
export function createSemanticCodeProvider({symbolClient,providerId='semantic-code'}={}){
 if(!symbolClient||typeof symbolClient.lookupSymbol!=='function'||typeof symbolClient.findReferences!=='function'||typeof symbolClient.workspaceSymbols!=='function')throw new TypeError('symbolClient requires workspaceSymbols(), lookupSymbol() and findReferences()');
 return {descriptor:{providerId,sourceKinds:['REPOSITORY'],operations:[ProviderOperation.LOOKUP_SYMBOL,ProviderOperation.FIND_REFERENCES],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION','CONTENT_DIGEST'],maxConcurrentCalls:2,costClass:'MEDIUM'},async retrieve(work){
  const source=work.sourceConstraint;
  let response;
  try{
   const request={repositoryRef:source.ref,snapshotRef:source.snapshot.mode==='EXACT'?source.snapshot.ref:null,query:work.semanticNeed,maxItems:work.reservedBudget.items};
   response=work.operation===ProviderOperation.FIND_REFERENCES?await symbolClient.findReferences(request):await symbolClient.lookupSymbol(request);
  }catch(error){if(error?.code==='UNSUPPORTED_LANGUAGE')throw new ProviderFailure({reason:'UNSUPPORTED',providerId,evidenceId:work.evidenceId,detail:error.message??'unsupported language'});throw error;}
  if(!response||!Array.isArray(response.symbols)||!response.snapshotRef)throw new ProviderFailure({reason:'SOURCE_FAILURE',providerId,evidenceId:work.evidenceId,detail:'malformed symbol response'});
  const keys=new Set();for(const symbol of response.symbols){const key=`${symbol.name}:${symbol.path}`;if(keys.has(key))throw new ProviderFailure({reason:'AMBIGUOUS',providerId,evidenceId:work.evidenceId,detail:'ambiguous symbol identity'});keys.add(key);}
  return response.symbols.map((symbol,i)=>({evidenceId:work.evidenceId,source:{kind:'REPOSITORY',ref:source.ref,snapshotRef:response.snapshotRef,itemRef:symbol.path},validators:response.validators??[{kind:'REVISION',value:response.snapshotRef,strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:symbol.sourceRef},{kind:'SYMBOL',ref:symbol.name}],content:symbol.content,providerEvidence:{providerId,operation:work.operation,score:symbol.score??0,rank:i}}));
 }};
}
