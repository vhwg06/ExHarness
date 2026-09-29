import assert from 'node:assert/strict';
import test from 'node:test';
import {defineContextRequirement} from '../src/context-contract.js';
import {createSourceCatalog} from '../src/source-catalog.js';
import {createRetrievalPlanner} from '../src/retrieval-planner.js';
import {ProviderFailure} from '../src/provider-contract.js';
const budget={maxItems:4,maxMaterializedBytes:20000,maxProviderCalls:4,maxResolutionSteps:1};
const req=(kind='REPOSITORY',itemRefs=undefined,snapshot={mode:'CURRENT'})=>defineContextRequirement({consumerRef:'worker',semanticNeed:'Understand source',evidence:[{id:'e',necessity:'REQUIRED',need:'Find behavior',source:{kind,ref:'repo',snapshot,...(itemRefs?{itemRefs}:{})}}],budget});
const provider=(providerId,kind,operation,retrieve=async()=>[])=>({descriptor:{providerId,sourceKinds:[kind],operations:[operation],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION'],maxConcurrentCalls:1,costClass:'LOW'},retrieve});
function catalog(providers){return createSourceCatalog({providers,snapshotAuthorities:[{sourceKind:'REPOSITORY',refPrefix:'repo',observe:async()=>({snapshotRef:'head'})}]});}
test('deterministic plan reserves exact work in declared file order before invocation',t=>{
 let calls=0;const c=catalog([provider('exact','REPOSITORY','READ_EXACT',()=>{calls++;return[];})]);const planner=createRetrievalPlanner({catalog:c});
 const r=req('REPOSITORY',['a.js','b.js'],{mode:'EXACT',ref:'rev'});const p=planner.plan(r);
 assert.deepEqual(p.work.map(w=>w.sourceConstraint.itemRef),['a.js','b.js']);assert.deepEqual(p.work.map(w=>w.operation),['READ_EXACT','READ_EXACT']);assert.equal(p.reserved.providerCalls,2);assert.equal(calls,0);
 const tooSmall=planner.plan(r,{remainingBudget:{maxItems:1}});assert.deepEqual(tooSmall.work,[]);assert.deepEqual(tooSmall.unresolved,[{evidenceId:'e',reason:'BUDGET_EXHAUSTED'}]);
 t.diagnostic(JSON.stringify({work:p.work.map(w=>({providerId:w.providerId,operation:w.operation,reservedBudget:w.reservedBudget,itemRef:w.sourceConstraint.itemRef})),underBudget:tooSmall.unresolved}));
});
test('semantic repository composes symbol and lexical; unsupported symbol falls back',async t=>{
 let semanticCalls=0,lexicalCalls=0;
 const semantic=provider('semantic','REPOSITORY','LOOKUP_SYMBOL',async()=>{semanticCalls++;throw new ProviderFailure({reason:'UNSUPPORTED',providerId:'semantic',evidenceId:'e',detail:'language unsupported'});});
 const lexical=provider('lexical','REPOSITORY','SEARCH_LEXICAL',async work=>{lexicalCalls++;return [{evidenceId:work.evidenceId,source:{kind:'REPOSITORY',ref:'repo',snapshotRef:'head',itemRef:'a.js'},validators:[{kind:'REVISION',value:'head',strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:'repo/a.js'}],content:'answer',providerEvidence:{providerId:'lexical',operation:'SEARCH_LEXICAL'}}];});
 const planner=createRetrievalPlanner({catalog:catalog([semantic,lexical])}),r=req();const planned=planner.plan(r);
 assert.deepEqual(planned.work.map(w=>w.operation),['LOOKUP_SYMBOL','SEARCH_LEXICAL']);assert.equal(planned.reserved.providerCalls,2);
 const result=await planner.execute(r);assert.equal(semanticCalls,1);assert.equal(lexicalCalls,1);assert.equal(result.candidates.length,1);assert.deepEqual(result.unresolved,[]);assert.equal(result.failures[0].reason,'UNSUPPORTED');
 assert.deepEqual(planner.plan(r,{unavailableProviders:['semantic']}).work.map(w=>w.operation),['SEARCH_LEXICAL']);
 t.diagnostic(JSON.stringify({orderedOperations:planned.work.map(w=>w.operation),reserved:planned.reserved,failures:result.failures,finalCandidate:result.candidates[0].source}));
});
test('graph and external kinds route only to their typed providers',t=>{
 const c=createSourceCatalog({providers:[provider('graph','CONTEXT_GRAPH','TRAVERSE_GRAPH'),provider('external','EXTERNAL','FETCH_EXTERNAL'),provider('lexical','REPOSITORY','SEARCH_LEXICAL')]});const planner=createRetrievalPlanner({catalog:c});
 assert.deepEqual(planner.plan(req('CONTEXT_GRAPH')).work.map(w=>w.operation),['TRAVERSE_GRAPH']);
 assert.deepEqual(planner.plan(req('EXTERNAL')).work.map(w=>w.operation),['FETCH_EXTERNAL']);
 assert.deepEqual(planner.plan(req('REPOSITORY')).work.map(w=>w.operation),['SEARCH_LEXICAL']);
 t.diagnostic('graph/external/repository route by matching source kind without application scheduling');
});
test('budget and missing provider fail closed before source calls',()=>{
 let calls=0;const c=catalog([provider('lexical','REPOSITORY','SEARCH_LEXICAL',()=>{calls++;return[];})]);const planner=createRetrievalPlanner({catalog:c});
 const p=planner.plan(req(),{remainingBudget:{maxProviderCalls:0}});assert.deepEqual(p.work,[]);assert.equal(p.unresolved[0].reason,'BUDGET_EXHAUSTED');assert.equal(calls,0);
 assert.equal(planner.plan(req('CONTEXT_GRAPH')).unresolved[0].reason,'UNSUPPORTED');
 assert.equal(planner.plan(req(),{remainingBudget:{maxResolutionSteps:0}}).unresolved[0].reason,'BUDGET_EXHAUSTED');
});
