import assert from 'node:assert/strict';
import test from 'node:test';
import {defineContextRequirement} from '../src/context-contract.js';
import {defineProviderDescriptor,defineProviderCandidate,ProviderFailure} from '../src/provider-contract.js';
import {createSourceCatalog,createExactRepositoryProvider,createExactArtifactProvider} from '../src/source-catalog.js';
const budget={maxItems:3,maxMaterializedBytes:20000,maxProviderCalls:3,maxResolutionSteps:1};
const req=(snapshot={mode:'CURRENT'})=>defineContextRequirement({consumerRef:'worker',semanticNeed:'Find source',evidence:[{id:'e',necessity:'REQUIRED',need:'Find source',source:{kind:'REPOSITORY',ref:'repo',snapshot}}],budget});
const descriptor={providerId:'lex',sourceKinds:['REPOSITORY'],operations:['SEARCH_LEXICAL'],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION'],maxConcurrentCalls:1,costClass:'LOW'};
const candidate=(snapshotRef='head')=>({evidenceId:'e',source:{kind:'REPOSITORY',ref:'repo',snapshotRef,itemRef:'a.js'},validators:[{kind:'REVISION',value:snapshotRef,strength:'STRONG'}],provenance:[{kind:'SOURCE_REF',ref:'repo/a.js'}],content:'hello',providerEvidence:{providerId:'lex',operation:'SEARCH_LEXICAL'}});
test('strict provider descriptor and candidate reject authority and missing semantic evidence',()=>{
 assert.deepEqual(defineProviderDescriptor(descriptor).operations,['SEARCH_LEXICAL']);
 for(const field of ['claimWork','acceptWork','publishDelivery','recoverWork','scheduleWork','tool'])assert.throws(()=>defineProviderDescriptor({...descriptor,[field]:true}),/unknown field/);
 const r=req();assert.equal(defineProviderCandidate(candidate(),{descriptor,requirement:r}).source.snapshotRef,'head');
 assert.throws(()=>defineProviderCandidate({...candidate(),source:{...candidate().source,snapshotRef:''}},{descriptor,requirement:r}),/snapshotRef/);
 assert.throws(()=>defineProviderCandidate({...candidate(),validators:[]},{descriptor,requirement:r}),/validators|strong validator/);
 assert.throws(()=>defineProviderCandidate({...candidate(),provenance:[],tool:'model'},{descriptor,requirement:r}),/unknown field/);
 assert.throws(()=>defineProviderCandidate(candidate('wrong'),{descriptor,requirement:req({mode:'EXACT',ref:'head'})}),/EXACT snapshot/);
 assert.ok(new ProviderFailure({reason:'STALE',providerId:'lex',evidenceId:'e',detail:'stale'}) instanceof Error);
});
test('SourceCatalog requires one authoritative current snapshot and rejects stale index',async t=>{
 const catalog=createSourceCatalog({providers:[{descriptor,retrieve:async()=>[candidate()]}],snapshotAuthorities:[{sourceKind:'REPOSITORY',refPrefix:'repo',observe:async()=>({snapshotRef:'head'})}]});
 assert.equal((await catalog.validateCandidate(candidate(),{requirement:req(),providerId:'lex'})).source.snapshotRef,'head');
 await assert.rejects(catalog.validateCandidate(candidate('old'),{requirement:req(),providerId:'lex'}),e=>e.reason==='STALE');t.diagnostic('indexed old snapshot rejected against authoritative head');
 assert.throws(()=>catalog.registerProvider({descriptor,retrieve(){}}),/duplicate provider/);
 assert.throws(()=>catalog.registerSnapshotAuthority({sourceKind:'REPOSITORY',refPrefix:'repo/sub',observe(){}}),/ambiguous/);
 const absent=createSourceCatalog({providers:[{descriptor,retrieve(){}}]});await assert.rejects(absent.validateCandidate(candidate(),{requirement:req(),providerId:'lex'}),/snapshot authority/);
});
test('exact repository/artifact wrappers retain source refs and lineage',async()=>{
 const repo=createExactRepositoryProvider({repositoryReader:{readFile:async()=>({content:'code',sourceRef:'repo/a.js@rev'})}});
 const output=await repo.retrieve({evidenceId:'e',sourceConstraint:{ref:'repo',snapshot:{mode:'EXACT',ref:'rev'},itemRef:'a.js'}});
 assert.equal(output[0].provenance[0].ref,'repo/a.js@rev');
 const artifact=createExactArtifactProvider({artifactReader:{readArtifact:async()=>({content:'artifact',sourceRef:'manifest/ref'})},producerWorkOrderId:'wo',acceptanceDecision:{id:'accepted',digest:'digest'}});
 const artifacts=await artifact.retrieve({evidenceId:'e',sourceConstraint:{ref:'artifact',snapshot:{mode:'EXACT',ref:'rev'},itemRef:'dist/a.js'}});
 assert.deepEqual(artifacts[0].provenance.slice(0,2),[{kind:'PRODUCER_WORK_ORDER',ref:'wo'},{kind:'ACCEPTANCE_DECISION',ref:'accepted',digest:'digest'}]);
});
test('authoritative content digest can validate CURRENT without conflating digest and revision',async()=>{
 const digestDescriptor={...descriptor,currentnessValidators:['CONTENT_DIGEST']};
 const c=createSourceCatalog({providers:[{descriptor:digestDescriptor,retrieve:async()=>[]}],snapshotAuthorities:[{sourceKind:'REPOSITORY',refPrefix:'repo',observe:async()=>({snapshotRef:'head',validators:[{kind:'CONTENT_DIGEST',value:'sha256:content',strength:'STRONG'}]})}]});
 const raw={...candidate(),validators:[{kind:'CONTENT_DIGEST',value:'sha256:content',strength:'STRONG'}]};
 assert.equal((await c.validateCandidate(raw,{requirement:req(),providerId:'lex'})).source.snapshotRef,'head');
 await assert.rejects(c.validateCandidate({...raw,validators:[{kind:'CONTENT_DIGEST',value:'sha256:other',strength:'STRONG'}]},{requirement:req(),providerId:'lex'}),e=>e.reason==='CURRENTNESS_UNVERIFIABLE');
});
test('exact provider may read CURRENT only with injected head lookup and independent catalog authority',async()=>{
 const provider=createExactRepositoryProvider({repositoryReader:{readFile:async()=>({content:'code',sourceRef:'repo/a.js@head'})},currentSnapshot:async()=> 'head'});
 assert.deepEqual(provider.descriptor.snapshotModes,['EXACT','CURRENT']);
 const raw=(await provider.retrieve({evidenceId:'e',sourceConstraint:{ref:'repo',snapshot:{mode:'CURRENT'},itemRef:'a.js'}}))[0];
 const r=defineContextRequirement({consumerRef:'worker',semanticNeed:'Read file',evidence:[{id:'e',necessity:'REQUIRED',need:'Read file',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'CURRENT'},itemRefs:['a.js']}}],budget});
 const c=createSourceCatalog({providers:[provider],snapshotAuthorities:[{sourceKind:'REPOSITORY',refPrefix:'repo',observe:async()=>({snapshotRef:'head'})}]});
 assert.equal((await c.validateCandidate(raw,{requirement:r,providerId:'repository-exact'})).source.snapshotRef,'head');
});
