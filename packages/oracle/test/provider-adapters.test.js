import assert from 'node:assert/strict';
import test from 'node:test';
import {defineContextRequirement} from '../src/context-contract.js';
import {createSourceCatalog} from '../src/source-catalog.js';
import {createLexicalSearchProvider} from '../src/providers/lexical-search.js';
import {createSemanticCodeProvider} from '../src/providers/semantic-code.js';
import {projectStructuralMap,createStructuralMapProvider} from '../src/providers/structural-map.js';
import {createContextGraphProvider} from '../src/providers/context-graph.js';
import {createExternalSourceProvider} from '../src/providers/external-source.js';
import {defineProviderCandidate} from '../src/provider-contract.js';
const budget={maxItems:2,maxMaterializedBytes:10000,maxProviderCalls:2,maxResolutionSteps:1};
const req=(kind,ref='repo')=>defineContextRequirement({consumerRef:'worker',semanticNeed:'Find source',evidence:[{id:'e',necessity:'REQUIRED',need:'Find source',source:{kind,ref,snapshot:{mode:'CURRENT'}}}],budget});
const work=(kind='REPOSITORY',operation='SEARCH_LEXICAL',ref='repo')=>({evidenceId:'e',sourceConstraint:{kind,ref,snapshot:{mode:'CURRENT'},itemRef:null},semanticNeed:'Find source',operation,reservedBudget:{items:1,materializedBytes:8192,providerCalls:1}});
test('lexical adapter binds indexed version and stale head fails authoritative check',async t=>{
 const provider=createLexicalSearchProvider({searchClient:{search:async()=>({snapshotRef:'old',hits:[{path:'a.js',snippet:'answer',sourceRef:'repo/a.js@old'}]})}});
 const c=createSourceCatalog({providers:[provider],snapshotAuthorities:[{sourceKind:'REPOSITORY',refPrefix:'repo',observe:async()=>({snapshotRef:'new'})}]});
 const result=(await provider.retrieve(work()))[0];assert.equal(result.source.snapshotRef,'old');
 await assert.rejects(c.validateCandidate(result,{requirement:req('REPOSITORY'),providerId:provider.descriptor.providerId}),e=>e.reason==='STALE');
 t.diagnostic('Zoekt-like indexed old revision is rejected against authoritative new head');
});
test('semantic adapter handles unsupported language, missing and ambiguous symbols',async t=>{
 let behavior='unsupported';const client={workspaceSymbols:async()=>[],findReferences:async()=>({snapshotRef:'head',symbols:[]}),lookupSymbol:async()=>{if(behavior==='unsupported'){const e=new Error('language unavailable');e.code='UNSUPPORTED_LANGUAGE';throw e;}if(behavior==='missing')return {snapshotRef:'head',symbols:[]};return {snapshotRef:'head',symbols:[{name:'X',path:'a.js',sourceRef:'a'},{name:'X',path:'a.js',sourceRef:'b'}]};}};
 const provider=createSemanticCodeProvider({symbolClient:client});const w=work('REPOSITORY','LOOKUP_SYMBOL');
 await assert.rejects(provider.retrieve(w),e=>e.reason==='UNSUPPORTED');behavior='missing';assert.deepEqual(await provider.retrieve(w),[]);behavior='ambiguous';await assert.rejects(provider.retrieve(w),e=>e.reason==='AMBIGUOUS');
 t.diagnostic('unsupported language -> UNSUPPORTED; deleted symbol -> empty; ambiguous identity -> AMBIGUOUS');
});
test('structural map consumes existing typed edges and obeys item/byte bounds',async()=>{
 const edges=[{from:'a.js',to:'b.js',kind:'IMPORTS',sourceRef:'a.js@rev'},{from:'b.js',to:'c.js',kind:'REFERENCES',sourceRef:'b.js@rev'}];
 const projection=projectStructuralMap({edges,seeds:['a.js'],maxItems:1,maxMaterializedBytes:10000});assert.equal(projection.items.length,1);assert.equal(projection.items[0].ref,'a.js');
 assert.deepEqual(projectStructuralMap({edges,seeds:['a.js'],maxItems:1,maxMaterializedBytes:1}).items,[]);
 const provider=createStructuralMapProvider({edgeSource:{edges:async()=>({snapshotRef:'rev',edges,seeds:['a.js']})}});const candidates=await provider.retrieve(work('REPOSITORY','STRUCTURAL_MAP'));
 assert.equal(candidates.length,1);assert.equal(candidates[0].provenance[0].kind,'STRUCTURAL_EDGE');
});
test('graph path needs authoritative provenance and external CURRENT needs validator',async t=>{
 const graph=createContextGraphProvider({graphClient:{traverse:async()=>({snapshotRef:'head',paths:[{ref:'node',content:'edge',provenance:[]}]})}});
 await assert.rejects(graph.retrieve(work('CONTEXT_GRAPH','TRAVERSE_GRAPH','graph')),e=>e.reason==='CURRENTNESS_UNVERIFIABLE');
 const external=createExternalSourceProvider({transport:{fetch:async()=>({snapshotRef:'head',validators:[{kind:'OPAQUE',value:'mtime',strength:'WEAK'}],provenance:[],content:'data'})}});
 await assert.rejects(external.retrieve(work('EXTERNAL','FETCH_EXTERNAL','remote')),e=>e.reason==='CURRENTNESS_UNVERIFIABLE');
 t.diagnostic('graph candidate lacks AUTHORITATIVE_SOURCE; external/MCP response weak-only validator rejected');
});
test('provider timeout is recorded as explicit source failure under reserved call',async t=>{
 const {createRetrievalPlanner}=await import('../src/retrieval-planner.js');
 const provider=createLexicalSearchProvider({searchClient:{search:async()=>{const error=new Error('index timeout');error.code='ETIMEDOUT';throw error;}}});
 const planner=createRetrievalPlanner({catalog:createSourceCatalog({providers:[provider]})});
 const outcome=await planner.execute(req('REPOSITORY'));
 assert.equal(outcome.planned.reserved.providerCalls,1);assert.deepEqual(outcome.unresolved,[{evidenceId:'e',reason:'SOURCE_FAILURE'}]);assert.match(outcome.failures[0].detail,/timeout/);
 t.diagnostic(JSON.stringify({reservedCalls:outcome.planned.reserved.providerCalls,unresolved:outcome.unresolved,failures:outcome.failures}));
});
test('renamed exact item cannot masquerade as required source path',()=>{
 const candidate={evidenceId:'e',source:{kind:'REPOSITORY',ref:'repo',snapshotRef:'rev',itemRef:'renamed.js'},validators:[{kind:'REVISION',value:'rev',strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:'repo/renamed.js'}],content:'data',providerEvidence:{providerId:'lexical-search',operation:'SEARCH_LEXICAL'}};
 const r=defineContextRequirement({consumerRef:'worker',semanticNeed:'Read a.js',evidence:[{id:'e',necessity:'REQUIRED',need:'Read a.js',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'EXACT',ref:'rev'},itemRefs:['a.js']}}],budget});
 assert.throws(()=>defineProviderCandidate(candidate,{descriptor:createLexicalSearchProvider({searchClient:{search(){}}}).descriptor,requirement:r}),/itemRef outside requirement/);
});
