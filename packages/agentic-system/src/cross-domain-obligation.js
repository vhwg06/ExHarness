import {createHash} from "node:crypto";

export function canonicalProductValue(value){
  if(Array.isArray(value))return value.map(canonicalProductValue);
  if(value && typeof value === "object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalProductValue(value[key])]));
  return value;
}
export const productDigest=value=>createHash("sha256").update(JSON.stringify(canonicalProductValue(value))).digest("hex");
export function productText(value,label){
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} must be non-empty`);
  return value.trim();
}
export function productAssert(condition,message){if(!condition)throw new TypeError(message);}
export const productCopy=value=>structuredClone(value);
export function defineCrossDomainObligation(raw){
  productAssert(raw&&typeof raw==="object","obligation required");
  const fields=new Set(["kind","version","projectId","rootIntentId","issuingSubjectKey","issuingRevisionRef","targetDomain","workloadType","obligationKind","obligationKey","requiredOutcome","requiredArtifactRefs","acceptanceRefs","expectedArtifactKind"]);
  for(const key of Object.keys(raw))productAssert(fields.has(key),`obligation field ${key} is not a WHAT contract field`);
  const value={kind:"CROSS_DOMAIN_OBLIGATION",version:1};
  for(const key of ["projectId","rootIntentId","issuingSubjectKey","issuingRevisionRef","targetDomain","workloadType","obligationKind","obligationKey","requiredOutcome","expectedArtifactKind"])value[key]=productText(raw[key],key);
  for(const key of ["requiredArtifactRefs","acceptanceRefs"]){
    productAssert(Array.isArray(raw[key]),`${key} must be an array`);
    value[key]=[...new Set(raw[key].map(x=>productText(x,key)))].sort();
  }
  productAssert(value.acceptanceRefs.length>0,"obligation acceptance refs required");
  return canonicalProductValue(value);
}
export function crossDomainObligationSubjectKey(raw){
  const o=defineCrossDomainObligation(raw);
  return "cross-domain-obligation:"+productDigest(Object.fromEntries(["projectId","rootIntentId","issuingSubjectKey","targetDomain","workloadType","obligationKind","obligationKey"].map(k=>[k,o[k]])));
}
export const crossDomainObligationRevisionRef=raw=>"cross-domain-obligation:sha256:"+productDigest(defineCrossDomainObligation(raw));
