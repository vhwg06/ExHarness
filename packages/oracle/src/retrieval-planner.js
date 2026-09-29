import { defineContextRequirement, contextItemDigest } from './context-contract.js';
import { ProviderFailure, ProviderFailureReason, ProviderOperation } from './provider-contract.js';

const fail=message=>{throw new TypeError(message);};
function budgetFor(requirement,remaining){
 const result={...requirement.budget,...(remaining??{})};
 for(const [key,value] of Object.entries(result))if(!Number.isSafeInteger(value)||value<0||value>requirement.budget[key])fail(`remaining ${key} invalid`);
 return result;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function createRetrievalPlanner({catalog}={}){
 if(!catalog||typeof catalog.compatible!=='function'||typeof catalog.validateCandidate!=='function')fail('RetrievalPlanner requires SourceCatalog');
 function plan(requirement,{remainingBudget=null,unavailableProviders=[],existingEdges=[]}={}){
  const r=defineContextRequirement(requirement),remaining=budgetFor(r,remainingBudget);
  if(!Array.isArray(unavailableProviders)||!Array.isArray(existingEdges))fail('planner options invalid');
  const unavailable=new Set(unavailableProviders),work=[],unresolved=[],reserved={providerCalls:0,items:0,materializedBytes:0,resolutionSteps:1};
  if(remaining.maxResolutionSteps<1){return freeze({requirementId:r.requirementId,work,unresolved:r.evidence.map(e=>({evidenceId:e.id,reason:'BUDGET_EXHAUSTED'})),reserved:{...reserved,resolutionSteps:0}});}
  function reserve(evidence,operation,itemRef){
   const provider=catalog.compatible(evidence,operation).find(p=>!unavailable.has(p.descriptor.providerId));
   if(!provider)return 'UNSUPPORTED';
   const bytes=Math.min(8192,remaining.maxMaterializedBytes-reserved.materializedBytes);
   if(reserved.providerCalls>=remaining.maxProviderCalls||reserved.items>=remaining.maxItems||bytes<1)return 'BUDGET_EXHAUSTED';
   reserved.providerCalls++;reserved.items++;reserved.materializedBytes+=bytes;
   work.push({evidenceId:evidence.id,providerId:provider.descriptor.providerId,operation,sourceConstraint:{kind:evidence.source.kind,ref:evidence.source.ref,snapshot:structuredClone(evidence.source.snapshot),itemRef},semanticNeed:evidence.need,reservedBudget:{providerCalls:1,items:1,materializedBytes:bytes}});
   return null;
  }
  for(const evidence of r.evidence){
   const before=work.length;let reason=null;
   if(evidence.source.itemRefs?.length){for(const ref of evidence.source.itemRefs){reason=reserve(evidence,ProviderOperation.READ_EXACT,ref);if(reason)break;}}
   else if(evidence.source.kind==='REPOSITORY'){
    for(const operation of [ProviderOperation.LOOKUP_SYMBOL,ProviderOperation.SEARCH_LEXICAL]){
     const failure=reserve(evidence,operation,null);if(failure==='BUDGET_EXHAUSTED'){reason=failure;break;}if(failure===null)reason=null;else if(work.length===before)reason=failure;
    }
    if(existingEdges.length&&work.length>before){const failure=reserve(evidence,ProviderOperation.STRUCTURAL_MAP,null);if(failure==='BUDGET_EXHAUSTED'&&work.length===before)reason=failure;}
   } else if(evidence.source.kind==='CONTEXT_GRAPH')reason=reserve(evidence,ProviderOperation.TRAVERSE_GRAPH,null);
   else reason=reserve(evidence,ProviderOperation.FETCH_EXTERNAL,null);
   if(evidence.source.itemRefs?.length && reason){
    for(const abandoned of work.splice(before)){reserved.providerCalls-=abandoned.reservedBudget.providerCalls;reserved.items-=abandoned.reservedBudget.items;reserved.materializedBytes-=abandoned.reservedBudget.materializedBytes;}
   }
   if(work.length===before)unresolved.push({evidenceId:evidence.id,reason:reason??'UNSUPPORTED'});
  }
  return freeze({requirementId:r.requirementId,work,unresolved,reserved});
 }
 async function execute(requirement,options={}){
  const r=defineContextRequirement(requirement),planned=plan(r,options),candidates=[],unresolved=[...planned.unresolved],failures=[];
  const grouped=new Map();for(const work of planned.work){if(!grouped.has(work.evidenceId))grouped.set(work.evidenceId,[]);grouped.get(work.evidenceId).push(work);}
  for(const evidence of r.evidence){
   if(unresolved.some(x=>x.evidenceId===evidence.id))continue;
   let success=false,lastReason='MISSING',successfulRefs=new Set(),evidenceCandidates=[];
   for(const work of grouped.get(evidence.id)??[]){
    const registration=catalog.provider(work.providerId);
    try{
     const raw=await registration.retrieve(work);
     if(!Array.isArray(raw))fail('provider must return candidate array');
     if(raw.length>work.reservedBudget.items)throw new ProviderFailure({reason:'BUDGET_EXHAUSTED',providerId:work.providerId,evidenceId:evidence.id,detail:'provider item reservation exceeded'});
     let bytes=0;const accepted=[];
     for(const candidate of raw){
      const normalized=await catalog.validateCandidate(candidate,{requirement:r,providerId:work.providerId});
      if(normalized.providerEvidence.operation!==work.operation)fail('provider operation differs from reserved work');
      const item={evidenceId:normalized.evidenceId,rank:0,source:normalized.source,currentness:{validators:normalized.validators},provenance:normalized.provenance,content:normalized.content};
      bytes+=Buffer.byteLength(JSON.stringify({...item,itemDigest:contextItemDigest(item)}),'utf8')+2;
      accepted.push(normalized);
     }
     if(bytes>work.reservedBudget.materializedBytes)throw new ProviderFailure({reason:'BUDGET_EXHAUSTED',providerId:work.providerId,evidenceId:evidence.id,detail:'provider byte reservation exceeded'});
     if(accepted.length){evidenceCandidates.push(...accepted);success=true;if(work.operation===ProviderOperation.READ_EXACT){successfulRefs.add(work.sourceConstraint.itemRef);continue;}break;}
    }catch(error){const reason=error instanceof ProviderFailure?error.reason:'SOURCE_FAILURE';failures.push({evidenceId:evidence.id,providerId:work.providerId,reason,detail:error.message});lastReason=reason;}
   }
   if(evidence.source.itemRefs?.length && successfulRefs.size!==evidence.source.itemRefs.length)success=false;
   if(!success)unresolved.push({evidenceId:evidence.id,reason:lastReason});
   else candidates.push(...evidenceCandidates);
  }
  return freeze({requirementId:r.requirementId,planned,candidates,unresolved,failures});
 }
 return Object.freeze({plan,execute});
}
