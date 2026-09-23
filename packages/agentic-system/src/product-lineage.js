import {createJsonDomainExecutionPolicyStore} from "./domain-execution-store.js";
import {canonicalProductValue,productDigest,productText,productAssert as inv,productCopy,defineCrossDomainObligation,crossDomainObligationSubjectKey} from "./cross-domain-obligation.js";

export function defineSemanticClaim(raw){
  inv(raw&&typeof raw==="object","semantic claim required");
  const claim={kind:"SEMANTIC_CLAIM",version:1};
  for(const key of ["projectId","rootIntentId","domain","semanticKind","subjectKey"])claim[key]=productText(raw[key],key);
  inv(raw.content!=null,"semantic content required");
  claim.content=canonicalProductValue(raw.content);
  return canonicalProductValue(claim);
}
export const semanticClaimRevisionRef=raw=>"semantic-claim:sha256:"+productDigest(defineSemanticClaim(raw));
export const semanticClaimSubjectKey=raw=>{
  const c=defineSemanticClaim(raw);
  return "semantic-claim:"+productDigest({projectId:c.projectId,rootIntentId:c.rootIntentId,domain:c.domain,semanticKind:c.semanticKind,subjectKey:c.subjectKey});
};
export function productRevision(raw){
  const obligation=raw?.kind==="CROSS_DOMAIN_OBLIGATION";
  const value=obligation?defineCrossDomainObligation(raw):defineSemanticClaim(raw);
  return {value,subjectKey:obligation?crossDomainObligationSubjectKey(value):semanticClaimSubjectKey(value),ref:(obligation?"cross-domain-obligation":"semantic-claim")+":sha256:"+productDigest(value)};
}

// Only current dependent revisions participate. Historical edges remain evidence.
export function reverseSemanticClosure(snapshot,subjectKeys){
  const found=new Set(subjectKeys),queue=[...found];
  while(queue.length){
    const upstream=queue.shift();
    for(const edge of snapshot.edges){
      if(edge.upstreamSubjectKey!==upstream||snapshot.heads[edge.dependentSubjectKey]?.revisionRef!==edge.dependentRevisionRef)continue;
      if(!found.has(edge.dependentSubjectKey)){found.add(edge.dependentSubjectKey);queue.push(edge.dependentSubjectKey);}
    }
  }
  return [...found].sort();
}
const empty=()=>({heads:{},edges:[],publications:{},transitions:[]});
const publicationWriters=new WeakMap();
// Internal composition seam; deliberately not exported by the application API.
export const productPublicationWriter=lineage=>{
  const writer=publicationWriters.get(lineage);inv(writer,"trusted product lineage store required");return writer;
};
function applyEvent(state,event){
  for(const transition of event.transitions){state.heads[transition.subjectKey]=transition.next;state.transitions.push(transition);}
  for(const edge of event.edges)if(!state.edges.some(e=>productDigest(e)===productDigest(edge)))state.edges.push(edge);
  if(event.publication)state.publications[event.publication.key]=event.publication;
  return state;
}

// The immutable journal is authoritative; no reverse-impact cache is required.
// A single CAS root commits a whole publication/invalidation atomically.
export function createProductLineageStore({path,artifactStore}){
  const roots=createJsonDomainExecutionPolicyStore({path});
  const key="product-lineage-journal";
  async function resolve(ref){
    const value=await artifactStore.resolve(ref);
    inv(value,"product artifact missing: "+ref);
    inv(ref.endsWith(":sha256:"+productDigest(value)),"product artifact digest mismatch");
    return value;
  }
  async function snapshotAt(journalRef){
    const events=[],seen=new Set();
    for(let ref=journalRef;ref;){
      inv(!seen.has(ref),"product journal cycle");seen.add(ref);
      const event=await resolve(ref);inv(event.kind==="PRODUCT_LINEAGE_EVENT","product journal kind mismatch");events.unshift(event);ref=event.previousRef;
    }
    return events.reduce(applyEvent,empty());
  }
  async function snapshot(){const root=await roots.current(key);return snapshotAt(root?.value?.journalRef??null);}
  async function put(prefix,value){return artifactStore.put(prefix,canonicalProductValue(value));}
  async function mutate(build){
    for(let attempt=0;attempt<20;attempt++){
      const root=await roots.current(key),state=await snapshotAt(root?.value?.journalRef??null);
      const update=await build(state);
      if(!update.event)return update.result;
      const event={kind:"PRODUCT_LINEAGE_EVENT",version:1,previousRef:root?.value?.journalRef??null,...update.event};
      const journalRef=await put("product-lineage-event",event);
      if(await roots.compareAndSwap(key,root?.revision??null,{journalRef}))return update.result;
    }
    throw new TypeError("product lineage CAS contention");
  }
  function transition(state,subjectKey,next,reasonRef){return {subjectKey,previous:state.heads[subjectKey]??null,next,reasonRef};}
  async function assertCurrent(ref){
    const artifact=await resolve(ref),record=productRevision(artifact),state=await snapshot(),head=state.heads[record.subjectKey];
    inv(head?.status==="ACTIVE"&&head.revisionRef===ref,"product revision is not ACTIVE");
    return {subjectKey:record.subjectKey,revisionRef:ref,head,artifact};
  }
  async function capture(refs){return Promise.all([...new Set(refs)].map(assertCurrent));}
  async function observationsCurrent(observations){
    const state=await snapshot();
    return observations.every(o=>productDigest(state.heads[o.subjectKey]??null)===productDigest(o.head));
  }
  async function invalidate(subjectKeys,{status="STALE",reasonRef,expectedRefs=null}={}){
    inv(["STALE","REVOKED"].includes(status),"invalid currentness transition");productText(reasonRef,"invalidation reason");
    return mutate(async state=>{
      const roots=subjectKeys.filter(k=>!expectedRefs||expectedRefs.includes(state.heads[k]?.revisionRef));
      const impacted=reverseSemanticClosure(state,roots),transitions=[];
      for(const subjectKey of impacted){const head=state.heads[subjectKey];if(head?.status==="ACTIVE")transitions.push(transition(state,subjectKey,{...head,status:roots.includes(subjectKey)?status:"STALE"},reasonRef));}
      return {event:transitions.length?{transitions,edges:[],publication:null}:null,result:impacted};
    });
  }
  // Kept off the application API: only the trusted publication adapter calls this
  // after verifying acceptance, write authority, outputs, and consumed heads.
  async function commitAcceptedPublication({receiptRef,publicationKey,records,edges,observations}){
    const receipt=await artifactStore.resolve(receiptRef);
    inv(receipt.kind==="DOMAIN_PUBLICATION_RECEIPT"&&receipt.publicationKey===publicationKey,"accepted publication receipt mismatch");
    for(const record of records){inv(receipt.publishedClaimRefs.includes(record.ref),"receipt does not authorize product revision");await put(record.value.kind==="SEMANTIC_CLAIM"?"semantic-claim":"cross-domain-obligation",record.value);}
    return mutate(async state=>{
      const replay=state.publications[publicationKey];
      if(replay){inv(replay.receiptRef===receiptRef,"publication key reused with different content");return {result:replay};}
      for(const record of records){
        const historical=Object.values(state.publications).some(p=>p.recordRefs.includes(record.ref));
        inv(!historical||state.heads[record.subjectKey]?.revisionRef===record.ref,"superseded historical revision cannot authorize new mutation");
      }
      const transitions=[],changed=records.filter(r=>state.heads[r.subjectKey]&&state.heads[r.subjectKey].revisionRef!==r.ref).map(r=>r.subjectKey);
      const affected=reverseSemanticClosure(state,changed);
      for(const subjectKey of affected){const head=state.heads[subjectKey];if(head?.status==="ACTIVE")transitions.push(transition(state,subjectKey,{...head,status:changed.includes(subjectKey)?"SUPERSEDED":"STALE"},receiptRef));}
      const current=observations.every(o=>productDigest(state.heads[o.subjectKey]??null)===productDigest(o.head));
      for(const record of records){
        const old=state.heads[record.subjectKey];
        // Identical historical bytes never reactivate a stale or revoked revision.
        if(old?.revisionRef===record.ref)continue;
        transitions.push(transition(state,record.subjectKey,{revisionRef:record.ref,status:current?"ACTIVE":"STALE",publicationReceiptRef:receiptRef},receiptRef));
      }
      const publication={key:publicationKey,receiptRef,recordRefs:records.map(r=>r.ref)};
      return {event:{transitions,edges:edges.map(e=>({...e,publicationReceiptRef:receiptRef})),publication},result:publication};
    });
  }
  async function journalRef(){return (await roots.current(key))?.value?.journalRef??null;}
  const surface=Object.freeze({resolve,snapshot,snapshotAt,journalRef,assertCurrent,capture,observationsCurrent,invalidate});
  publicationWriters.set(surface,commitAcceptedPublication);
  return surface;
}
