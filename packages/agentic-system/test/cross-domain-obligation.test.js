import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJsonImmutableArtifactStore,createOrganizationArtifactRegistry} from "../src/organization-artifact-store.js";
import {createDomainExecutionArtifactRegistry} from "../src/domain-execution-store.js";
import {createDomainWriteAuthority,createDomainPublicationGate} from "../src/domain-write-authority.js";
import {createProductLineageStore,productRevision,semanticClaimSubjectKey} from "../src/product-lineage.js";
import {defineCrossDomainObligation} from "../src/cross-domain-obligation.js";

export const claim=(key,content="v1",domain="BA")=>({kind:"SEMANTIC_CLAIM",projectId:"p",rootIntentId:"intent",domain,semanticKind:domain==="BA"?"requirement":"architecture",subjectKey:key,content});
export function obligation(issuer,overrides={}){
  const record=productRevision(issuer);
  return defineCrossDomainObligation({projectId:"p",rootIntentId:"intent",issuingSubjectKey:record.subjectKey,issuingRevisionRef:record.ref,targetDomain:"SA",workloadType:"solution-design",obligationKind:"solution-design",obligationKey:"design",requiredOutcome:"Design the accepted requirement",requiredArtifactRefs:[record.ref],acceptanceRefs:["acceptance:design"],expectedArtifactKind:"architecture",...overrides});
}
export async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),"exharness-integration-c-"));
  t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:20}));
  const artifactStore=createJsonImmutableArtifactStore({path:join(dir,"artifacts.json")});
  const registry=createDomainExecutionArtifactRegistry({store:artifactStore});
  const org=createOrganizationArtifactRegistry({store:artifactStore});
  const lineage=createProductLineageStore({path:join(dir,"lineage.json"),artifactStore});
  const writeAuthority=createDomainWriteAuthority({path:join(dir,"writers.json"),artifactStore,policyAuthority:{async verifyDomainWriteAuthorityPublisher({publisher}){return publisher==="admin"?{authorityRef:"write-policy-admin"}:null;}}});
  const policy=domain=>({domain,generation:1,principalRefs:["principal:"+domain],semanticKinds:[domain==="BA"?"requirement":"architecture"],obligations:[{obligationKind:"solution-design",targetDomain:"SA"}]});
  await writeAuthority.publish({publisher:"admin",policy:policy("BA")});
  await writeAuthority.publish({publisher:"admin",policy:policy("SA")});
  let count=0,receiptHook=null;
  const gates=Object.fromEntries(["BA","SA"].map(domain=>[domain,createDomainPublicationGate({writeAuthority,lineage,artifactRegistry:{...registry,async putDomainPublicationReceipt(value){if(receiptHook)await receiptHook(value);return registry.putDomainPublicationReceipt(value);}},resolveProductOutput:ref=>artifactStore.resolve(ref),producerPrincipalRef:"principal:"+domain})]));
  async function prepare(values,{domain="BA",inputs=[],publicationKey="publication:"+(++count)}={}){
    const records=values.map(productRevision);
    for(const r of records)assert.equal(await artifactStore.put(r.value.kind==="SEMANTIC_CLAIM"?"semantic-claim":"cross-domain-obligation",r.value),r.ref);
    const contract={projectId:"p",rootIntentId:"intent",contractRef:"contract:"+publicationKey,owningDomain:domain};
    const outcome={outputArtifactRefs:records.map(r=>({ref:r.ref,digest:r.ref.split(":").at(-1)})),proposedDerivationEdges:records.map(r=>({outputRef:r.ref,derivedFrom:inputs}))};
    const completionDecision={kind:"DOMAIN_COMPLETION_DECISION",version:1,verdict:"ACCEPT",domain,workContractRef:contract.contractRef,executionAttemptOutcomeRef:"outcome:"+publicationKey,executionAttemptBindingRef:"binding:"+publicationKey};
    const completionDecisionRef=await registry.putDomainCompletionDecision(completionDecision);
    return {publicationKey,contract,outcome,completionDecision,completionDecisionRef,outcomeRef:completionDecision.executionAttemptOutcomeRef,bindingRef:completionDecision.executionAttemptBindingRef,lifecycleObservation:{workContractRef:contract.contractRef,claimRelease:{receiptRef:"claim-release:"+publicationKey}}};
  }
  async function publish(values,options={}){
    const args=await prepare(values,options),gate=gates[options.domain??"BA"];
    return gate.withCurrentWriteAuthority({domain:options.domain??"BA",producerPrincipalRef:gate.producerPrincipalRef},writeAuthorityObservation=>gate.publishIdempotent({...args,writeAuthorityObservation}));
  }
  return {dir,artifactStore,registry,org,lineage,writeAuthority,gates,prepare,publish,policy,setReceiptHook:hook=>{receiptHook=hook;}};
}

test("WHAT obligation rejects all dispatch fields and normalizes stable identity",()=>{
  const raw=obligation(claim("detail"));
  for(const key of ["worker","workerId","runtime","strategy","executionStrategy","priority"])assert.throws(()=>defineCrossDomainObligation({...raw,[key]:"injected"}),/WHAT/);
  assert.equal(productRevision(raw).ref,productRevision({...raw,requiredArtifactRefs:[...raw.requiredArtifactRefs,...raw.requiredArtifactRefs]}).ref);
});

test("accepted publication enforces semantic kind, target domain, issuer and principal authority",async t=>{
  const f=await fixture(t),detail=claim("detail");
  await f.publish([detail]);
  const o=obligation(detail),inputs=[productRevision(detail).ref];
  await f.publish([o],{inputs});
  assert.equal((await f.lineage.assertCurrent(productRevision(o).ref)).artifact.targetDomain,"SA");
  await assert.rejects(f.publish([obligation(detail,{targetDomain:"BE"})],{inputs}),/not authorized/);
  await assert.rejects(f.publish([obligation(detail,{obligationKind:"dispatch"})],{inputs}),/not authorized/);
  await assert.rejects(f.publish([claim("wrong","x","SA")]),/not authorized/);
  await assert.rejects(f.gates.BA.withCurrentWriteAuthority({domain:"BA",producerPrincipalRef:"principal:SA"},()=>{}),/principal mismatch/);
  await assert.rejects(f.writeAuthority.publish({publisher:"worker",policy:{...f.policy("BA"),generation:2}}),/verified/);
  await assert.rejects(f.gates.BA.publishIdempotent(await f.prepare([detail])),/guarded/);
  await assert.rejects(f.writeAuthority.publish({publisher:"admin",policy:{...f.policy("BA"),kind:"EXECUTION_POLICY",generation:2}}),/kind mismatch/);
  const architecture=claim("architecture","design","SA");
  await f.publish([architecture],{domain:"SA",inputs});
  assert.equal((await f.lineage.assertCurrent(productRevision(architecture).ref)).artifact.domain,"SA");
});

test("identical obligation replay converges and semantic change preserves immutable historical bytes",async t=>{
  const f=await fixture(t),detail=claim("detail");await f.publish([detail]);
  const o=obligation(detail),ref=productRevision(o).ref,inputs=[productRevision(detail).ref];
  await f.publish([o],{inputs});const before=await f.lineage.resolve(ref);
  await f.publish([o],{inputs});assert.equal((await f.lineage.assertCurrent(ref)).revisionRef,ref);
  const changed=obligation(detail,{requiredOutcome:"Revised design"});await f.publish([changed],{inputs});
  assert.deepEqual(await f.lineage.resolve(ref),before);
  await assert.rejects(f.lineage.assertCurrent(ref),/not ACTIVE/);
  assert.equal((await f.lineage.assertCurrent(productRevision(changed).ref)).head.status,"ACTIVE");
  const fresh=createProductLineageStore({path:join(f.dir,"fresh-heads.json"),artifactStore:f.artifactStore});
  assert.deepEqual(await fresh.snapshotAt(await f.lineage.journalRef()),await f.lineage.snapshot());
});

test("raw runtime proposals do not publish authoritative revisions or edges",async t=>{
  const f=await fixture(t),raw=claim("unaccepted"),args=await f.prepare([raw]);
  assert.deepEqual((await f.lineage.snapshot()).edges,[]);
  await assert.rejects(f.lineage.assertCurrent(productRevision(raw).ref),/not ACTIVE/);
  await assert.rejects(f.gates.BA.publishIdempotent({...args,writeAuthorityObservation:{authorityRef:"forged",revision:"forged"}}),/guarded/);
  assert.deepEqual((await f.lineage.snapshot()).heads,{});
});
