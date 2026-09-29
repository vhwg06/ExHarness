import assert from 'node:assert/strict';
import test from 'node:test';
import {defineContextRequirement as requirement, defineContextResolution as resolution, assertConsumableContextResolution as consumable, contextRequirementId, contextItemDigest, contextMaterializationId, contextResolutionId} from '../src/context-contract.js';

const budget={maxItems:4,maxMaterializedBytes:4096,maxProviderCalls:4,maxResolutionSteps:3};
function req(evidence=[{id:'code',necessity:'REQUIRED',need:'Find symbol behavior',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'CURRENT'},itemRefs:['src/a.js']}}]) {return requirement({consumerRef:'worker',semanticNeed:'Understand code',evidence,budget});}
function item(evidenceId='code',overrides={}) {return {evidenceId,rank:0,source:{kind:'REPOSITORY',ref:'repo',snapshotRef:'rev-1',itemRef:'src/a.js'},currentness:{validators:[{kind:'REVISION',value:'rev-1',strength:'STRONG'}]},provenance:[],content:'hello',...overrides};}
function result(r,items=[item()],unresolved=[],previous=null,extra={}) {return resolution({requirementId:r.requirementId,step:{index:previous?previous.step.index+1:0,previousResolutionId:previous?.resolutionId??null},status:unresolved.some(u=>r.evidence.find(e=>e.id===u.evidenceId).necessity==='REQUIRED')?'UNSATISFIED':unresolved.length?'PARTIAL':'COMPLETE',items,unresolved,consumed:{items:items.length,materializedBytes:4096,providerCalls:1,resolutionSteps:previous?previous.consumed.resolutionSteps+1:1},...extra},r,previous);}
test('requirement semantic identity and strict provider-neutral parser',()=>{
 const r=req(); assert.equal(r.requirementId,contextRequirementId(r)); assert.equal(req().requirementId,r.requirementId);
 for(const mutation of [x=>x.consumerRef='other',x=>x.semanticNeed='other',x=>x.evidence[0].need='other',x=>x.evidence[0].necessity='OPTIONAL',x=>x.evidence[0].source.ref='other',x=>x.evidence[0].source.snapshot={mode:'EXACT',ref:'rev'},x=>x.budget.maxItems=5]) {const raw=structuredClone(r);delete raw.requirementId;mutation(raw);assert.notEqual(requirement(raw).requirementId,r.requirementId);}
 for(const field of ['providerId','tool','operation','queryDsl','mcpMethod','acceptance','publish','recovery']) assert.throws(()=>requirement({...r,[field]:'x'}),/unknown field/);
 for(const field of ['providerId','tool','operation','queryDsl','mcpMethod']) {
   const evidence=structuredClone(r);delete evidence.requirementId;evidence.evidence[0][field]='x';assert.throws(()=>requirement(evidence),/unknown field/);
   const source=structuredClone(r);delete source.requirementId;source.evidence[0].source[field]='x';assert.throws(()=>requirement(source),/unknown field/);
 }
 assert.throws(()=>requirement({...r,requirementId:'fake'}),/mismatch/);
 assert.throws(()=>requirement({...r,evidence:[r.evidence[0],r.evidence[0]]}),/duplicate/);
});
test('provider-neutral evidence fixtures share one schema',()=>{
 const fixtures=[['semantic-code','REPOSITORY'],['lexical-search','REPOSITORY'],['relationship','CONTEXT_GRAPH'],['accepted artifact','APPLICATION_ARTIFACT']];
 for(const [need,kind] of fixtures) {const r=req([{id:'e',necessity:'REQUIRED',need,source:{kind,ref:'source',snapshot:{mode:'EXACT',ref:'revision'}}}]);assert.equal(r.evidence[0].source.kind,kind);assert.ok(!('providerId' in r));}
});
test('resolution binds source currentness provenance content and status',t=>{
 const r=req();const a=result(r); assert.equal(consumable(a,r).resolutionId,a.resolutionId);assert.equal(a.items[0].itemDigest,contextItemDigest(a.items[0]));assert.equal(a.materialization.id,contextMaterializationId(a.items));assert.equal(a.resolutionId,contextResolutionId(a));
 const b=result(r,[item('code',{provenance:[{kind:'ORIGIN',ref:'manifest'}]})]);assert.notEqual(a.resolutionId,b.resolutionId);
 const c=result(r,[item('code',{content:'changed'})]);assert.notEqual(a.materialization.id,c.materialization.id);
 const raw=structuredClone(a);raw.consumed.providerCalls=2;assert.equal(resolution(raw,r).resolutionId,a.resolutionId);
 assert.throws(()=>result(r,[item('code',{currentness:{validators:[{kind:'OPAQUE',value:'mtime',strength:'WEAK'}]}})]),/strong validator/);t.diagnostic('REQUIRED CURRENT rejects weak timestamp-only validator');
 assert.throws(()=>result(r,[item('code',{source:{...item().source,ref:'wrong'}})]),/source identity/);
 assert.throws(()=>result(r,[],[{evidenceId:'code',reason:'MISSING'}],null,{status:'COMPLETE'}),/status/);
 for(const reason of ['MISSING','STALE','AMBIGUOUS','BUDGET_EXHAUSTED','CURRENTNESS_UNVERIFIABLE']) {const missing=result(r,[],[{evidenceId:'code',reason}]);assert.equal(missing.status,'UNSATISFIED');assert.throws(()=>consumable(missing,r),/unresolved/);t.diagnostic(`REQUIRED ${reason} -> UNSATISFIED, non-consumable`);}
});
test('optional partial, required provenance and progression budgets',()=>{
 const r=req([req().evidence[0],{id:'optional',necessity:'OPTIONAL',need:'extra',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'EXACT',ref:'rev-1'}}}]);
 const a=result(r,[item()],[{evidenceId:'optional',reason:'DEFERRED'}]);assert.equal(a.status,'PARTIAL');consumable(a,r);
 const b=result(r,[item(),item('optional',{source:{kind:'REPOSITORY',ref:'repo',snapshotRef:'rev-1',itemRef:null}})],[],a,{consumed:{items:2,materializedBytes:4096,providerCalls:2,resolutionSteps:2}});assert.equal(b.step.previousResolutionId,a.resolutionId);
 assert.throws(()=>result(r,[item()],[{evidenceId:'optional',reason:'DEFERRED'}],a,{consumed:{items:1,materializedBytes:4096,providerCalls:0,resolutionSteps:2}}),/decreased/);
 assert.throws(()=>result(r,[item()],[{evidenceId:'optional',reason:'DEFERRED'}],a,{step:{index:2,previousResolutionId:a.resolutionId}}),/parent\/index/);
 assert.throws(()=>result(r,[item()],[{evidenceId:'optional',reason:'DEFERRED'}],null,{consumed:{items:5,materializedBytes:4096,providerCalls:1,resolutionSteps:1}}),/budget/);
 const p=req([{...req().evidence[0],requiredProvenance:[{kind:'PRODUCER_WORK_ORDER',ref:'wo'}]}]);assert.throws(()=>result(p),/provenance/);
});
test('exact snapshot, itemRef coverage, status and digest are fail closed',()=>{
 const exact=req([{id:'code',necessity:'REQUIRED',need:'Read exact files',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'EXACT',ref:'rev-1'},itemRefs:['src/a.js']}}]);
 assert.throws(()=>result(exact,[item('code',{source:{...item().source,snapshotRef:'rev-2'}})]),/EXACT snapshot/);
 assert.throws(()=>result(exact,[item('code',{source:{...item().source,itemRef:'other.js'}})]),/itemRef/);
 const good=result(exact);const tampered=structuredClone(good);tampered.items[0].content='drift';assert.throws(()=>resolution(tampered,exact),/itemDigest mismatch/);
 const noItems=structuredClone(good);noItems.items=[];assert.throws(()=>resolution(noItems,exact),/missing evidence/);
 const wrong=structuredClone(good);wrong.requirementId='bad';assert.throws(()=>resolution(wrong,exact),/wrong requirementId/);
 const unknown=structuredClone(good);unknown.items[0].source.providerId='x';assert.throws(()=>resolution(unknown,exact),/unknown field/);
});
test('budget/currentness evidence: every counter and immutable step ceiling',t=>{
 const r=req();const first=result(r);const second=result(r,[item()],[],first,{consumed:{items:2,materializedBytes:4096,providerCalls:2,resolutionSteps:2}});const third=result(r,[item()],[],second,{consumed:{items:3,materializedBytes:4096,providerCalls:3,resolutionSteps:3}});
 assert.throws(()=>result(r,[item()],[],third,{consumed:{items:4,materializedBytes:4096,providerCalls:4,resolutionSteps:4}}),/resolutionSteps budget/);
 for(const [counter,value] of [['items',5],['materializedBytes',4097],['providerCalls',5],['resolutionSteps',4]]) {
  const consumed={items:1,materializedBytes:4096,providerCalls:1,resolutionSteps:1,[counter]:value};
  assert.throws(()=>result(r,[item()],[],null,{consumed}),new RegExp(`${counter} budget`));
  t.diagnostic(`${counter} hard budget rejects ${value}`);
 }
 assert.equal(first.step.index,0);assert.equal(second.step.previousResolutionId,first.resolutionId);assert.equal(third.step.previousResolutionId,second.resolutionId);
 t.diagnostic('index 0 -> 1 -> 2 binds exact immutable parent; step 3 rejected');
});
for(const fixture of [
 {name:'semantic-code repository CURRENT',kind:'REPOSITORY',ref:'repo://source',need:'Find symbol callers',snapshot:{mode:'CURRENT'},itemRef:'src/symbol.js'},
 {name:'lexical-search repository CURRENT',kind:'REPOSITORY',ref:'repo://source',need:'Find exact warning text',snapshot:{mode:'CURRENT'},itemRef:'src/warning.js'},
 {name:'context-graph relationship CURRENT',kind:'CONTEXT_GRAPH',ref:'graph://dependencies',need:'Find dependency edge',snapshot:{mode:'CURRENT'},itemRef:null},
 {name:'accepted application-artifact EXACT',kind:'APPLICATION_ARTIFACT',ref:'artifact://accepted',need:'Read accepted output',snapshot:{mode:'EXACT',ref:'revision-7'},itemRef:'dist/output.js',requiredProvenance:[{kind:'PRODUCER_WORK_ORDER',ref:'work-7'},{kind:'ACCEPTANCE_DECISION',ref:'accepted-7',digest:'sha256:decision'}]}
]) {
 test(`provider-neutral fixture: ${fixture.name}`,t=>{
  const evidence={id:'source',necessity:'REQUIRED',need:fixture.need,source:{kind:fixture.kind,ref:fixture.ref,snapshot:fixture.snapshot,...(fixture.itemRef?{itemRefs:[fixture.itemRef]}:{})},...(fixture.requiredProvenance?{requiredProvenance:fixture.requiredProvenance}:{})};
  const r=req([evidence]);
  const source={kind:fixture.kind,ref:fixture.ref,snapshotRef:fixture.snapshot.mode==='EXACT'?fixture.snapshot.ref:'revision-7',itemRef:fixture.itemRef};
  const validators=[{kind:'REVISION',value:source.snapshotRef,strength:'STRONG'}];
  const resolved=result(r,[{evidenceId:'source',rank:0,source,currentness:{validators},provenance:fixture.requiredProvenance??[],content:{text:fixture.need}}]);
  assert.equal(consumable(resolved,r).status,'COMPLETE');assert.equal(resolved.items[0].source.kind,fixture.kind);
  assert.deepEqual(resolved.items[0].provenance,fixture.requiredProvenance??[]);
  t.diagnostic(JSON.stringify({kind:fixture.kind,mode:fixture.snapshot.mode,requirementId:r.requirementId,resolutionId:resolved.resolutionId,provenance:resolved.items[0].provenance}));
 });
}
