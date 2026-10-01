import {createJsonDomainExecutionPolicyStore} from "./domain-execution-store.js";
import {productAssert as inv,productText,productDigest,canonicalProductValue} from "./cross-domain-obligation.js";
import {productRevision,productPublicationWriter} from "./product-lineage.js";

export const domainWriteAuthoritySubjectKey=domain=>"domain-write-authority:"+productDigest(productText(domain,"domain"));
export function defineDomainWriteAuthorityPolicy(raw){
  inv(raw?.kind==null||raw.kind==="DOMAIN_WRITE_AUTHORITY_POLICY","domain write authority kind mismatch");
  const value={kind:"DOMAIN_WRITE_AUTHORITY_POLICY",version:1,domain:productText(raw.domain,"domain"),generation:raw.generation,status:raw.status??"ACTIVE"};
  inv(Number.isInteger(value.generation)&&value.generation>0,"write authority generation invalid");
  inv(["ACTIVE","REVOKED"].includes(value.status),"write authority status invalid");
  for(const key of ["principalRefs","semanticKinds"]){inv(Array.isArray(raw[key]),key+" required");value[key]=[...new Set(raw[key].map(v=>productText(v,key)))].sort();inv(!value[key].includes("*"),"wildcard write authority forbidden");}
  inv(Array.isArray(raw.obligations),"obligation permissions required");
  value.obligations=raw.obligations.map(o=>({obligationKind:productText(o.obligationKind,"obligationKind"),targetDomain:productText(o.targetDomain,"targetDomain")}));
  inv(value.obligations.every(o=>o.obligationKind!=="*"&&o.targetDomain!=="*"),"wildcard obligation authority forbidden");
  return canonicalProductValue(value);
}
export function createDomainWriteAuthority({path,artifactStore,policyAuthority}){
  inv(typeof policyAuthority?.verifyDomainWriteAuthorityPublisher==="function","write authority publisher verifier required");
  const storeFor=domain=>createJsonDomainExecutionPolicyStore({path:path+"."+productDigest(domain)});
  async function publish({publisher,policy}){
    const value=defineDomainWriteAuthorityPolicy(policy),heads=storeFor(value.domain),key=domainWriteAuthoritySubjectKey(value.domain),head=await heads.current(key);
    inv(value.generation===(head?.value.generation??0)+1,"write authority generation must advance");
    const verified=await policyAuthority.verifyDomainWriteAuthorityPublisher({publisher,policy:value});
    const authorityRef=productText(verified?.authorityRef,"verified write-policy publisher authority");
    const ref=await artifactStore.put("domain-write-authority-policy",canonicalProductValue({...value,publishedByAuthorityRef:authorityRef}));
    inv(await heads.compareAndSwap(key,head?.revision??null,{generation:value.generation,status:value.status,policyRef:ref}),"write authority CAS conflict");
    return {policyRef:ref,head:await heads.current(key)};
  }
  async function withCurrent({domain,producerPrincipalRef},action){
    const heads=storeFor(domain),key=domainWriteAuthoritySubjectKey(domain),head=await heads.current(key);
    inv(head?.value.status==="ACTIVE","domain write authority is not active");
    const policy=await artifactStore.resolve(head.value.policyRef);
    inv(policy?.kind==="DOMAIN_WRITE_AUTHORITY_POLICY"&&policy.domain===domain&&policy.generation===head.value.generation&&policy.status==="ACTIVE","write authority head mismatch");
    inv(head.value.policyRef==="domain-write-authority-policy:sha256:"+productDigest(policy),"write policy digest mismatch");
    inv(policy.principalRefs.includes(producerPrincipalRef),"publisher principal lacks domain write authority");
    const result=await heads.withCurrentGuard(key,head.revision,()=>action({authorityRef:head.value.policyRef,revision:head.revision,policy}));
    inv(result.matched,"domain write authority changed before publication");
    return result.result;
  }
  return Object.freeze({publish,withCurrent});
}

// resolveProductOutput is trusted composition: it resolves exact content-addressed
// runtime output refs into proposed semantic records, never accepted truth.
export function createDomainPublicationGate({writeAuthority,lineage,artifactRegistry,resolveProductOutput,producerPrincipalRef,authorityRef="authority:domain-publication",reconcileWork=async()=>{}}){
  productText(producerPrincipalRef,"publisher principal");
  inv(typeof resolveProductOutput==="function","product output resolver required");
  const commitAcceptedPublication=productPublicationWriter(lineage);
  const active=new Set();
  async function withCurrentWriteAuthority(subject,action){
    inv(subject.producerPrincipalRef===producerPrincipalRef,"publication principal mismatch");
    return writeAuthority.withCurrent(subject,async observation=>{
      active.add(observation);
      try{return await action(observation);}finally{active.delete(observation);}
    });
  }
  async function publishIdempotent(args){
    const {writeAuthorityObservation:observation,completionDecision:decision,contract,outcome}=args;
    inv(active.has(observation),"publication requires guarded write authority capability");
    inv(decision?.verdict==="ACCEPT"&&decision.domain===observation.policy.domain&&contract.owningDomain===decision.domain,"accepted domain completion required");
    inv(decision.workContractRef===contract.contractRef&&decision.executionAttemptOutcomeRef===args.outcomeRef&&decision.executionAttemptBindingRef===args.bindingRef,"completion subject mismatch");
    inv(args.lifecycleObservation?.workContractRef===contract.contractRef&&args.lifecycleObservation?.claimRelease?.receiptRef,"publication lifecycle guard required");
    const persisted=await artifactRegistry.resolveDomainCompletionDecision(args.completionDecisionRef);
    inv(productDigest(persisted)===productDigest(decision),"completion decision evidence mismatch");
    const records=[];
    for(const output of outcome.outputArtifactRefs){
      const raw=await resolveProductOutput(output.ref);
      inv(raw,"product output missing");
      const record=productRevision(raw);
      inv(record.ref===output.ref&&output.digest===productDigest(record.value),"product output digest mismatch");
      inv(record.value.projectId===contract.projectId&&record.value.rootIntentId===contract.rootIntentId,"product output project mismatch");
      if(record.value.kind==="SEMANTIC_CLAIM")inv(record.value.domain===decision.domain&&observation.policy.semanticKinds.includes(record.value.semanticKind),"semantic kind not authorized");
      else inv(observation.policy.obligations.some(p=>p.obligationKind===record.value.obligationKind&&p.targetDomain===record.value.targetDomain),"obligation kind/target domain not authorized");
      records.push(record);
    }
    inv(new Set(records.map(r=>r.subjectKey)).size===records.length,"publication has conflicting revisions of one subject");
    if(contract.crossDomainObligationRef){
      await lineage.assertCurrent(contract.crossDomainObligationRef);
      inv(records.every(r=>outcome.proposedDerivationEdges.some(e=>e.outputRef===r.ref&&e.derivedFrom.includes(contract.crossDomainObligationRef))),"publication must preserve consumed work obligation lineage");
    }
    const consumed=new Set(),edges=[];
    for(const proposed of outcome.proposedDerivationEdges){
      const dependent=records.find(r=>r.ref===proposed.outputRef);inv(dependent,"lineage output is not published");
      for(const ref of proposed.derivedFrom){
        const upstream=await lineage.assertCurrent(ref);
        inv(upstream.artifact.projectId===contract.projectId&&upstream.artifact.rootIntentId===contract.rootIntentId,"cross-project semantic lineage forbidden");
        inv(upstream.subjectKey!==dependent.subjectKey,"self derivation forbidden");
        consumed.add(ref);edges.push({kind:"PRODUCT_DERIVATION_EDGE",version:1,upstreamSubjectKey:upstream.subjectKey,upstreamRevisionRef:ref,dependentSubjectKey:dependent.subjectKey,dependentRevisionRef:dependent.ref});
      }
    }
    for(const r of records.filter(r=>r.value.kind==="CROSS_DOMAIN_OBLIGATION")){
      const issuer=await lineage.assertCurrent(r.value.issuingRevisionRef);
      inv(issuer.artifact.kind==="SEMANTIC_CLAIM"&&issuer.subjectKey===r.value.issuingSubjectKey&&issuer.artifact.domain===decision.domain,"obligation issuer authority mismatch");
      inv(edges.some(e=>e.dependentRevisionRef===r.ref&&e.upstreamRevisionRef===issuer.revisionRef),"obligation requires accepted issuer derivation");
    }
    // Capture before receipt persistence, then compare after authoritative commit.
    const observations=await lineage.capture([...consumed]);
    const publishedArtifactRefs=outcome.outputArtifactRefs;
    const acceptedDerivationEdges=outcome.proposedDerivationEdges;
    const publishedClaimRefs=records.map(r=>r.ref);
    const publicationStoreRevision=productDigest({publicationKey:args.publicationKey,publishedClaimRefs,acceptedDerivationEdges});
    const receipt={kind:"DOMAIN_PUBLICATION_RECEIPT",version:1,domain:decision.domain,producerPrincipalRef,writeAuthorityRef:observation.authorityRef,writeAuthorityRevision:observation.revision,lifecycleObservation:args.lifecycleObservation,publicationKey:args.publicationKey,completionDecisionRef:args.completionDecisionRef,publishedArtifactRefs,publishedClaimRefs,acceptedDerivationEdges,publicationStoreRevision};
    const publicationReceiptRef=await artifactRegistry.putDomainPublicationReceipt(receipt);
    await commitAcceptedPublication({receiptRef:publicationReceiptRef,publicationKey:args.publicationKey,records,edges,observations});
    if(!await lineage.observationsCurrent(observations))await lineage.invalidate(records.map(r=>r.subjectKey),{reasonRef:publicationReceiptRef,expectedRefs:publishedClaimRefs});
    return {publicationKey:args.publicationKey,publishedArtifactRefs,publishedClaimRefs,acceptedDerivationEdges,publicationStoreRevision,publicationReceiptRef};
  }
  return Object.freeze({authorityRef,producerPrincipalRef,withCurrentWriteAuthority,publishIdempotent,reconcileWork});
}
