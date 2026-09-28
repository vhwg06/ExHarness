import { createHash } from 'node:crypto';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fail(message) { throw new TypeError(message); }
function record(value, fields, label, required = fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key)) fail(`${label} has unknown field ${String(key)}`);
  }
  for (const key of required) if (!own(value, key)) fail(`${label}.${key} is required`);
  return value;
}
function str(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be nonempty text`); return value; }
function nat(value, label, positive = false) { if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail(`${label} must be ${positive ? 'positive' : 'nonnegative'} integer`); return value; }
function one(value, choices, label) { if (!choices.includes(value)) fail(`${label} is invalid`); return value; }
function arr(value, label, nonempty = false) { if (!Array.isArray(value) || (nonempty && !value.length)) fail(`${label} must be ${nonempty ? 'nonempty ' : ''}array`); return value; }
function json(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) fail(`${label} must be JSON-safe`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((v, i) => json(v, `${label}[${i}]`, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(`${label} must be JSON-safe`);
    result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || value[key] === undefined) fail(`${label} must be JSON-safe`);
      result[key] = json(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function digest(value, label) { return str(value, label); }
function provenance(value, label) {
  const entries = arr(value, label).map((entry, i) => {
    const x = record(entry, ['kind','ref','digest'], `${label}[${i}]`, ['kind','ref']);
    return { kind:str(x.kind, `${label}.kind`), ref:str(x.ref, `${label}.ref`), ...(own(x,'digest') ? {digest:digest(x.digest, `${label}.digest`)} : {}) };
  });
  if (new Set(entries.map(entry => canonical(entry))).size !== entries.length) fail(`${label} contains duplicate provenance`);
  return entries;
}
function requirementBody(raw) {
  const r = record(raw, ['kind','version','requirementId','consumerRef','semanticNeed','evidence','budget'], 'ContextRequirement', ['consumerRef','semanticNeed','evidence','budget']);
  if (own(r,'kind')) one(r.kind, ['CONTEXT_REQUIREMENT'], 'ContextRequirement.kind');
  if (own(r,'version')) one(r.version, [1], 'ContextRequirement.version');
  const evidence = arr(r.evidence, 'ContextRequirement.evidence', true).map((rawEvidence, i) => {
    const e = record(rawEvidence, ['id','necessity','need','source','requiredProvenance'], `evidence[${i}]`, ['id','necessity','need','source']);
    const s = record(e.source, ['kind','ref','snapshot','itemRefs'], `evidence[${i}].source`, ['kind','ref','snapshot']);
    const snap = record(s.snapshot, ['mode','ref'], `evidence[${i}].source.snapshot`, ['mode']);
    one(snap.mode, ['EXACT','CURRENT'], 'snapshot.mode');
    if (snap.mode === 'EXACT') str(snap.ref, 'snapshot.ref');
    else if (own(snap,'ref')) fail('CURRENT snapshot cannot name ref');
    const itemRefs = own(s,'itemRefs') ? arr(s.itemRefs, 'source.itemRefs').map((v) => str(v,'source.itemRef')) : undefined;
    if (itemRefs && new Set(itemRefs).size !== itemRefs.length) fail('duplicate itemRefs');
    return { id:str(e.id,'evidence.id'), necessity:one(e.necessity,['REQUIRED','OPTIONAL'],'evidence.necessity'), need:str(e.need,'evidence.need'),
      source:{kind:str(s.kind,'source.kind'),ref:str(s.ref,'source.ref'),snapshot:snap.mode === 'EXACT' ? {mode:'EXACT',ref:snap.ref} : {mode:'CURRENT'},...(itemRefs ? {itemRefs} : {})},
      ...(own(e,'requiredProvenance') ? {requiredProvenance:provenance(e.requiredProvenance,'evidence.requiredProvenance')} : {}) };
  });
  if (new Set(evidence.map(e=>e.id)).size !== evidence.length) fail('duplicate evidence id');
  const b = record(r.budget, ['maxItems','maxMaterializedBytes','maxProviderCalls','maxResolutionSteps'], 'budget');
  return {kind:'CONTEXT_REQUIREMENT',version:1,consumerRef:str(r.consumerRef,'consumerRef'),semanticNeed:str(r.semanticNeed,'semanticNeed'),evidence,
    budget:Object.fromEntries(Object.keys(b).map(k=>[k,nat(b[k],`budget.${k}`,true)]))};
}
export function contextRequirementId(requirement) { return hash(requirementBody(requirement)); }
export function defineContextRequirement(raw) {
  const body = requirementBody(raw); const requirementId = hash(body);
  if (own(raw,'requirementId') && raw.requirementId !== requirementId) fail('requirementId mismatch');
  return freeze({...body, requirementId});
}
function itemBody(raw) {
  const x = record(raw,['evidenceId','rank','source','currentness','provenance','content','itemDigest'],'resolution item',['evidenceId','rank','source','currentness','provenance','content']);
  const s = record(x.source,['kind','ref','snapshotRef','itemRef'],'item.source');
  const c = record(x.currentness,['validators'],'item.currentness');
  const validators = arr(c.validators,'currentness.validators').map(v=>{const a=record(v,['kind','value','strength'],'validator');return {kind:one(a.kind,['REVISION','CONTENT_DIGEST','OPAQUE'],'validator.kind'),value:str(a.value,'validator.value'),strength:one(a.strength,['STRONG','WEAK'],'validator.strength')};});
  const source = {kind:str(s.kind,'item.source.kind'),ref:str(s.ref,'item.source.ref'),snapshotRef:str(s.snapshotRef,'item.source.snapshotRef'),itemRef:s.itemRef === null ? null : str(s.itemRef,'item.source.itemRef')};
  return {evidenceId:str(x.evidenceId,'item.evidenceId'),rank:nat(x.rank,'item.rank'),source,currentness:{validators},provenance:provenance(x.provenance,'item.provenance'),content:json(x.content,'item.content')};
}
export function contextItemDigest(item) {
  const body=itemBody(item); return hash({source:body.source,currentness:body.currentness,provenance:body.provenance,content:body.content});
}
export function contextMaterializationId(items) { return hash(arr(items,'items').map(item=>({...itemBody(item),itemDigest:contextItemDigest(item)}))); }
function resolutionIdentity(body) { return {requirementId:body.requirementId,step:body.step,status:body.status,materializationId:body.materialization.id,unresolved:body.unresolved}; }
export function contextResolutionId(resolution) { return hash(resolutionIdentity(resolution)); }
export function defineContextResolution(raw, requirement, previous = null) {
  const req = defineContextRequirement(requirement);
  const r = record(raw,['kind','version','resolutionId','requirementId','step','status','items','unresolved','materialization','consumed'],'ContextResolution',['requirementId','step','status','items','unresolved','consumed']);
  if (own(r,'kind')) one(r.kind,['CONTEXT_RESOLUTION'],'resolution.kind');
  if (own(r,'version')) one(r.version,[1],'resolution.version');
  if (r.requirementId !== req.requirementId) fail('wrong requirementId');
  const step=record(r.step,['index','previousResolutionId'],'resolution.step');
  const index=nat(step.index,'step.index');
  const prior=step.previousResolutionId === null ? null : str(step.previousResolutionId,'step.previousResolutionId');
  if (previous === null) {if (index !== 0 || prior !== null) fail('first resolution must start at index 0 without parent');}
  else { if (previous.requirementId !== req.requirementId || index !== previous.step.index+1 || prior !== previous.resolutionId) fail('invalid progression parent/index'); }
  const items=arr(r.items,'resolution.items').map((item)=>{const body=itemBody(item);const itemDigest=contextItemDigest(body);if (own(item,'itemDigest') && item.itemDigest !== itemDigest) fail('itemDigest mismatch');return {...body,itemDigest};});
  const unresolved=arr(r.unresolved,'resolution.unresolved').map(u=>{const x=record(u,['evidenceId','reason'],'unresolved');return {evidenceId:str(x.evidenceId,'unresolved.evidenceId'),reason:one(x.reason,['MISSING','STALE','AMBIGUOUS','BUDGET_EXHAUSTED','SOURCE_FAILURE','UNSUPPORTED','CURRENTNESS_UNVERIFIABLE','DEFERRED'],'unresolved.reason')};});
  const evidence=new Map(req.evidence.map(e=>[e.id,e]));
  const represented=new Set(), unresolvedIds=new Set();
  for (const u of unresolved) {if (!evidence.has(u.evidenceId) || unresolvedIds.has(u.evidenceId)) fail('unknown/duplicate unresolved evidence');unresolvedIds.add(u.evidenceId);}
  const ranks=new Map();
  for (const item of items) {
    const e=evidence.get(item.evidenceId); if (!e || unresolvedIds.has(item.evidenceId)) fail('unknown/contradictory evidence item');
    represented.add(item.evidenceId);
    if (item.source.kind!==e.source.kind || item.source.ref!==e.source.ref) fail('source identity mismatch');
    if (e.source.snapshot.mode==='EXACT' && item.source.snapshotRef!==e.source.snapshot.ref) fail('EXACT snapshot mismatch');
    if (e.source.itemRefs && !e.source.itemRefs.includes(item.source.itemRef)) fail('itemRef outside requirement');
    if (e.necessity==='REQUIRED' && e.source.snapshot.mode==='CURRENT' && !item.currentness.validators.some(v=>v.strength==='STRONG')) fail('required CURRENT needs strong validator');
    for (const p of e.requiredProvenance ?? []) if (!item.provenance.some(v=>v.kind===p.kind && v.ref===p.ref && (p.digest===undefined || v.digest===p.digest))) fail('required provenance missing');
    if (!ranks.has(e.id)) ranks.set(e.id,[]); ranks.get(e.id).push(item.rank);
  }
  for (const [id, list] of ranks) {list.sort((a,b)=>a-b);if (list.some((n,i)=>n!==i)) fail(`noncontiguous ranks for ${id}`);}
  for (const id of evidence.keys()) if (!represented.has(id) && !unresolvedIds.has(id)) fail(`missing evidence coverage: ${id}`);
  const evidenceOrder = new Map(req.evidence.map((entry, i) => [entry.id, i]));
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1], after = items[i];
    if (evidenceOrder.get(before.evidenceId) > evidenceOrder.get(after.evidenceId) ||
        (before.evidenceId === after.evidenceId && before.rank >= after.rank)) fail('items must follow evidence order and contiguous ranks');
  }
  for (const entry of req.evidence) {
    if (unresolvedIds.has(entry.id) || !entry.source.itemRefs?.length) continue;
    const seen = new Set(items.filter(item => item.evidenceId === entry.id).map(item => item.source.itemRef));
    if (entry.source.itemRefs.some(ref => !seen.has(ref))) fail(`missing itemRef coverage: ${entry.id}`);
  }
  const requiredMissing=[...unresolvedIds].some(id=>evidence.get(id).necessity==='REQUIRED');
  const status=requiredMissing?'UNSATISFIED':unresolved.length?'PARTIAL':'COMPLETE';
  if (r.status!==status) fail(`resolution status must be ${status}`);
  const materialization={id:hash(items),bytes:Buffer.byteLength(canonical(items),'utf8')};
  if (own(r,'materialization')) {const m=record(r.materialization,['id','bytes'],'materialization');if (m.id!==materialization.id || m.bytes!==materialization.bytes) fail('materialization mismatch');}
  const c=record(r.consumed,['items','materializedBytes','providerCalls','resolutionSteps'],'consumed');
  const consumed=Object.fromEntries(Object.keys(c).map(k=>[k,nat(c[k],`consumed.${k}`)]));
  if (consumed.items<items.length || consumed.materializedBytes<materialization.bytes || consumed.resolutionSteps<index+1) fail('consumed below materialization/step');
  for (const [key,limit] of Object.entries(req.budget)) {const counter=key.slice(3,4).toLowerCase()+key.slice(4);if (consumed[counter]>limit) fail(`${counter} budget exceeded`);}
  if (previous) for (const key of Object.keys(consumed)) if (consumed[key]<previous.consumed[key]) fail(`${key} consumption decreased`);
  const body={kind:'CONTEXT_RESOLUTION',version:1,requirementId:req.requirementId,step:{index,previousResolutionId:prior},status,items,unresolved,materialization,consumed};
  const resolutionId=hash(resolutionIdentity(body));
  if (own(r,'resolutionId') && r.resolutionId!==resolutionId) fail('resolutionId mismatch');
  return freeze({...body,resolutionId});
}
export function assertConsumableContextResolution(resolution, requirement, previous = null) {
  const parsed=defineContextResolution(resolution,requirement,previous);
  if (parsed.status==='UNSATISFIED') fail('required context evidence is unresolved');
  return parsed;
}
