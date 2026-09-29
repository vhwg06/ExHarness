import { defineContextRequirement } from './context-contract.js';

const has=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fail=message=>{throw new TypeError(message);};
function record(value,fields,label,required=fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(`${label} must be a plain object`);
 for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!fields.includes(key))fail(`${label} has unknown field ${String(key)}`);
 for(const key of required)if(!has(value,key))fail(`${label}.${key} is required`);
 return value;
}
function text(value,label){if(typeof value!=='string'||!value.trim())fail(`${label} must be nonempty text`);return value;}
function one(value,choices,label){if(!choices.includes(value))fail(`${label} is invalid`);return value;}
function list(value,label,nonempty=true){if(!Array.isArray(value)||(nonempty&&!value.length))fail(`${label} must be ${nonempty?'nonempty ':''}array`);return value;}
function json(value,label,seen=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object'||seen.has(value))fail(`${label} must be JSON-safe`);
 seen.add(value);let out;
 if(Array.isArray(value))out=value.map((v,i)=>json(v,`${label}[${i}]`,seen));
 else{if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)fail(`${label} must be JSON-safe`);out={};for(const key of Reflect.ownKeys(value)){if(typeof key!=='string'||value[key]===undefined)fail(`${label} must be JSON-safe`);out[key]=json(value[key],`${label}.${key}`,seen);}}
 seen.delete(value);return out;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const ProviderOperation=Object.freeze({READ_EXACT:'READ_EXACT',SEARCH_LEXICAL:'SEARCH_LEXICAL',LOOKUP_SYMBOL:'LOOKUP_SYMBOL',FIND_REFERENCES:'FIND_REFERENCES',STRUCTURAL_MAP:'STRUCTURAL_MAP',TRAVERSE_GRAPH:'TRAVERSE_GRAPH',FETCH_EXTERNAL:'FETCH_EXTERNAL'});
export const ProviderFailureReason=Object.freeze({MISSING:'MISSING',STALE:'STALE',AMBIGUOUS:'AMBIGUOUS',BUDGET_EXHAUSTED:'BUDGET_EXHAUSTED',SOURCE_FAILURE:'SOURCE_FAILURE',UNSUPPORTED:'UNSUPPORTED',CURRENTNESS_UNVERIFIABLE:'CURRENTNESS_UNVERIFIABLE'});
export class ProviderFailure extends Error{
 constructor({reason,providerId,evidenceId,detail}){one(reason,Object.values(ProviderFailureReason),'provider failure reason');super(text(detail,'provider failure detail'));this.name='ProviderFailure';this.reason=reason;this.providerId=text(providerId,'providerId');this.evidenceId=text(evidenceId,'evidenceId');}
}
export function defineProviderDescriptor(raw){
 const d=record(raw,['providerId','sourceKinds','operations','snapshotModes','currentnessValidators','maxConcurrentCalls','costClass'],'provider descriptor');
 const unique=(values,label)=>{const result=list(values,label).map(v=>text(v,label));if(new Set(result).size!==result.length)fail(`${label} duplicates`);return result;};
 const sourceKinds=unique(d.sourceKinds,'sourceKinds');
 const operations=unique(d.operations,'operations').map(v=>one(v,Object.values(ProviderOperation),'operation'));
 const snapshotModes=unique(d.snapshotModes,'snapshotModes').map(v=>one(v,['EXACT','CURRENT'],'snapshot mode'));
 const currentnessValidators=unique(d.currentnessValidators,'currentnessValidators').map(v=>one(v,['REVISION','CONTENT_DIGEST','OPAQUE'],'validator kind'));
 if(!Number.isSafeInteger(d.maxConcurrentCalls)||d.maxConcurrentCalls<1)fail('maxConcurrentCalls must be positive integer');
 return freeze({providerId:text(d.providerId,'providerId'),sourceKinds,operations,snapshotModes,currentnessValidators,maxConcurrentCalls:d.maxConcurrentCalls,costClass:one(d.costClass,['LOW','MEDIUM','HIGH'],'costClass')});
}
export function defineProviderCandidate(raw,{descriptor,requirement}={}){
 const d=defineProviderDescriptor(descriptor),r=defineContextRequirement(requirement);
 const c=record(raw,['evidenceId','source','validators','provenance','content','providerEvidence'],'provider candidate');
 const evidence=r.evidence.find(e=>e.id===c.evidenceId);if(!evidence)fail('unknown evidenceId');
 const s=record(c.source,['kind','ref','snapshotRef','itemRef'],'candidate.source');
 const source={kind:text(s.kind,'source.kind'),ref:text(s.ref,'source.ref'),snapshotRef:text(s.snapshotRef,'source.snapshotRef'),itemRef:s.itemRef===null?null:text(s.itemRef,'source.itemRef')};
 if(source.kind!==evidence.source.kind||source.ref!==evidence.source.ref||!d.sourceKinds.includes(source.kind))fail('candidate source identity mismatch');
 if(!d.snapshotModes.includes(evidence.source.snapshot.mode))fail('provider snapshot mode unsupported');
 if(evidence.source.snapshot.mode==='EXACT'&&source.snapshotRef!==evidence.source.snapshot.ref)fail('EXACT snapshot mismatch');
 if(evidence.source.itemRefs?.length&&!evidence.source.itemRefs.includes(source.itemRef))fail('candidate itemRef outside requirement');
 const validators=list(c.validators,'validators').map(v=>{const x=record(v,['kind','value','strength'],'validator');const kind=one(x.kind,['REVISION','CONTENT_DIGEST','OPAQUE'],'validator.kind');if(!d.currentnessValidators.includes(kind))fail('provider validator kind unsupported');return {kind,value:text(x.value,'validator.value'),strength:one(x.strength,['STRONG','WEAK'],'validator.strength')};});
 if(evidence.source.snapshot.mode==='CURRENT'&&evidence.necessity==='REQUIRED'&&!validators.some(v=>v.strength==='STRONG'))fail('required CURRENT needs strong validator');
 const provenance=list(c.provenance,'provenance').map(v=>{const x=record(v,['kind','ref','digest'],'provenance',['kind','ref']);return {kind:text(x.kind,'provenance.kind'),ref:text(x.ref,'provenance.ref'),...(has(x,'digest')?{digest:text(x.digest,'provenance.digest')}:{})};});
 for(const required of evidence.requiredProvenance??[])if(!provenance.some(v=>v.kind===required.kind&&v.ref===required.ref&&(required.digest===undefined||v.digest===required.digest)))fail('required provenance missing');
 const p=record(c.providerEvidence,['providerId','operation','score','rank','elapsedMs'],'providerEvidence',['providerId','operation']);
 if(p.providerId!==d.providerId||!d.operations.includes(p.operation))fail('provider evidence mismatch');
 for(const field of ['score','elapsedMs'])if(has(p,field)&&(!Number.isFinite(p[field])||p[field]<0))fail(`providerEvidence.${field} invalid`);
 if(has(p,'rank')&&(!Number.isSafeInteger(p.rank)||p.rank<0))fail('providerEvidence.rank invalid');
 return freeze({evidenceId:c.evidenceId,source,validators,provenance,content:json(c.content,'candidate.content'),providerEvidence:{providerId:p.providerId,operation:p.operation,...(has(p,'score')?{score:p.score}:{}),...(has(p,'rank')?{rank:p.rank}:{}),...(has(p,'elapsedMs')?{elapsedMs:p.elapsedMs}:{})}});
}
