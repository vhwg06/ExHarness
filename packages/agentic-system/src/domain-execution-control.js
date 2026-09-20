import {createHash} from "node:crypto";
import {ClaimReleaseStatus} from "./organization-authority-store.js";
import {claimReleaseSubjectKey} from "./organization-claim.js";
import {defineOrganizationWorkContract} from "./organization-work.js";
import {ExecutionAttemptStatus,ExecutionPolicyStatus} from "./domain-execution-store.js";

const inv=(c,m)=>{if(!c)throw new TypeError(m);};
const txt=(v,n)=>{inv(typeof v==="string"&&v.trim(),n+" must be non-empty");return v;};
const fr=v=>Object.freeze(structuredClone(v));
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const arr=(v,n)=>{inv(Array.isArray(v),n+" must be an array");return v;};
const strs=(v,n)=>arr(v,n).map((x,i)=>txt(x,n+"["+i+"]"));
const pin=ref=>{const r=txt(ref,"artifact ref"),m=r.match(/:sha256:([a-f0-9]{64})$/);inv(m,"artifact ref must be content addressed: "+r);return fr({ref:r,digest:m[1]});};
const checkedPin=(value,label)=>{
  inv(value&&typeof value==="object",label+" pin required");
  const r=txt(value.ref,label+" ref"),d=txt(value.digest,label+" digest");
  const m=r.match(/:sha256:([a-f0-9]{64})$/);
  inv(m&&m[1]===d,label+" pin digest mismatch");
  return value;
};
const stableRuntime=ref=>{const r=txt(ref,"runtime ref");inv(!/(^|[:/@-])latest$/i.test(r),"runtime ref must not be latest");return r;};
const STRATEGY_KINDS=new Set(["restate-handler","restate-workflow","application-core-loop","human-assisted"]);

export function executionPolicySubjectKey(domain,workloadType){return "domain-execution-policy:"+hash({domain:txt(domain,"domain"),workloadType:txt(workloadType,"workloadType")});}
export function executionAttemptSubjectKey({projectId,itemId,workContractRef}){return "execution-attempt:"+hash({projectId:txt(projectId,"projectId"),itemId:txt(itemId,"itemId"),workContractRef:txt(workContractRef,"workContractRef")});}

export function defineExecutionStrategyDescriptor(raw){
  inv(raw&&typeof raw==="object","strategy descriptor required");
  const d={kind:"EXECUTION_STRATEGY_DESCRIPTOR",version:1,strategyId:txt(raw.strategyId,"strategyId"),strategyVersion:txt(raw.strategyVersion,"strategyVersion"),strategyKind:txt(raw.strategyKind,"strategyKind"),compatibleWorkloadTypes:strs(raw.compatibleWorkloadTypes,"compatibleWorkloadTypes"),compatibleWorkContractVersions:arr(raw.compatibleWorkContractVersions,"compatibleWorkContractVersions"),adapterRef:txt(raw.adapterRef,"adapterRef"),runtimeBindingMode:txt(raw.runtimeBindingMode,"runtimeBindingMode"),expectedRuntimeCodeRef:stableRuntime(raw.expectedRuntimeCodeRef),contextRefs:strs(raw.contextRefs??[],"contextRefs"),toolsetRef:raw.toolsetRef??null,modelProfileRef:raw.modelProfileRef??null,harnessRef:raw.harnessRef??null};
  inv(STRATEGY_KINDS.has(d.strategyKind),"unsupported strategy kind");
  inv(d.compatibleWorkloadTypes.length>0,"compatible workload types required");
  inv(d.compatibleWorkContractVersions.length>0&&d.compatibleWorkContractVersions.every(x=>Number.isInteger(x)&&x>0),"compatible WorkContract versions invalid");return fr(d);
}
function policy(raw,withAuthority=true){
  inv(raw&&typeof raw==="object","execution policy required");const p={kind:"EXECUTION_POLICY",version:1,policyId:txt(raw.policyId,"policyId"),generation:Number(raw.generation),status:raw.status??ExecutionPolicyStatus.ACTIVE,domain:txt(raw.domain,"domain"),workloadType:txt(raw.workloadType,"workloadType"),compatibleWorkContractVersions:arr(raw.compatibleWorkContractVersions,"compatibleWorkContractVersions"),strategyRef:txt(raw.strategyRef,"strategyRef")};
  inv(Number.isInteger(p.generation)&&p.generation>0,"policy generation invalid");inv(Object.values(ExecutionPolicyStatus).includes(p.status),"policy status invalid");inv(p.compatibleWorkContractVersions.every(x=>Number.isInteger(x)&&x>0),"policy compatibility invalid");return fr(withAuthority?{...p,publishedByAuthorityRef:txt(raw.publishedByAuthorityRef,"publishedByAuthorityRef")}:p);
}
export const defineExecutionPolicy=raw=>policy(raw,true);

export function createDomainExecutionPolicyPublisher({policyAuthority,artifactRegistry,executionPolicyStore}){
  inv(typeof policyAuthority?.verifyExecutionPolicyPublisher==="function","policy publisher verifier required");
  return Object.freeze({async publish({publisher,policy:raw}){const unsigned=policy(raw,false),key=executionPolicySubjectKey(unsigned.domain,unsigned.workloadType);inv(unsigned.policyId===key,"policy subject mismatch");const cur=await executionPolicyStore.current(key);inv(unsigned.generation===(cur?.value?.generation??0)+1,"policy generation must advance by one");const checked=await policyAuthority.verifyExecutionPolicyPublisher({publisher:fr(publisher),policy:unsigned});const p=policy({...unsigned,publishedByAuthorityRef:txt(checked?.authorityRef,"verified policy authority")},true),policyRef=await artifactRegistry.putExecutionPolicy(p);inv(await executionPolicyStore.compareAndSwap(key,cur?.revision??null,{generation:p.generation,status:p.status,policyRef}),"policy CAS conflict");return fr({subjectKey:key,policyRef,policy:p,head:await executionPolicyStore.current(key)});}});
}

async function subject({claimController,claimReleaseStore,organizationArtifactRegistry,itemId,claimGeneration,receiptRef}){
  await claimController.assertExecutable({itemId,claimGeneration,receiptRef});const receipt=await organizationArtifactRegistry.resolveClaimReleaseReceipt(receiptRef);inv(receipt&&receipt.itemId===itemId&&receipt.claimGeneration===claimGeneration,"claim receipt subject mismatch");const raw=await organizationArtifactRegistry.resolveWorkContract(receipt.workContractRef);inv(raw,"work contract missing");const contract=defineOrganizationWorkContract(raw);inv(contract.contractRef===receipt.workContractRef,"work contract ref mismatch");const releaseKey=claimReleaseSubjectKey(contract.projectId,itemId,claimGeneration),releaseHead=await claimReleaseStore.current(releaseKey);inv(releaseHead?.value?.status===ClaimReleaseStatus.RELEASED&&releaseHead.value.receiptRef===receiptRef,"claim release not current");return {receipt,contract,releaseKey,releaseHead};
}
async function currentPolicy({executionPolicyStore,artifactRegistry,contract}){const key=executionPolicySubjectKey(contract.owningDomain,contract.workloadType),head=await executionPolicyStore.current(key);inv(head?.value?.status===ExecutionPolicyStatus.ACTIVE,"execution policy not active");const raw=await artifactRegistry.resolveExecutionPolicy(head.value.policyRef);inv(raw,"execution policy missing");const p=policy(raw,true);inv(p.policyId===key&&p.generation===head.value.generation&&p.status===head.value.status,"execution policy head mismatch");inv(p.domain===contract.owningDomain&&p.workloadType===contract.workloadType&&p.compatibleWorkContractVersions.includes(contract.version),"execution policy incompatible with work contract");return {key,head,p,policyRef:head.value.policyRef};}
async function strategy({artifactRegistry,p,contract,runtime}){const raw=await artifactRegistry.resolveExecutionStrategyDescriptor(p.strategyRef);inv(raw,"strategy descriptor missing");const s=defineExecutionStrategyDescriptor(raw);inv(s.compatibleWorkloadTypes.includes(contract.workloadType)&&s.compatibleWorkContractVersions.includes(contract.version),"strategy incompatible with work contract");inv(s.adapterRef===runtime.adapterRef&&s.expectedRuntimeCodeRef===runtime.runtimeDeploymentRef,"strategy/runtime binding mismatch");return s;}
async function transition(reg,{workId,id,from,to,reason,decisionRef}){return reg.putExecutionAttemptTransition(fr({kind:"EXECUTION_ATTEMPT_TRANSITION",version:1,workId,fromAttemptId:from==="ABSENT"?null:id,toAttemptId:id,fromStatus:from,toStatus:to,reasonKind:reason,decisionRef:txt(decisionRef,"transition decision ref")}));}

export function createDomainExecutionController({claimController,claimReleaseStore,organizationArtifactRegistry,artifactRegistry,executionPolicyStore,executionAttemptStore,runtimeAdapter,completionEvaluator,publicationGate}){
  inv(typeof claimController?.assertExecutable==="function","claim execution gate required");inv(typeof completionEvaluator?.evaluate==="function","completion evaluator required");inv(typeof publicationGate?.publish==="function","publication gate required");
  const runtime={adapterRef:txt(runtimeAdapter?.adapterRef,"runtime adapterRef"),runtimeKind:txt(runtimeAdapter?.runtimeKind,"runtime kind"),runtimeDeploymentRef:stableRuntime(runtimeAdapter?.runtimeDeploymentRef),producerAuthorityRef:txt(runtimeAdapter?.producerAuthorityRef,"runtime producer authority")};inv(typeof runtimeAdapter.dispatch==="function"&&typeof runtimeAdapter.recover==="function","runtime dispatch/recover required");const completionAuthority=txt(completionEvaluator.authorityRef,"completion authority"),publicationAuthority=txt(publicationGate.authorityRef,"publication authority"),publicationPrincipal=txt(publicationGate.producerPrincipalRef,"publication principal");

  async function establish(s,{itemId,claimGeneration,receiptRef}){const key=executionAttemptSubjectKey({projectId:s.contract.projectId,itemId,workContractRef:s.contract.contractRef});let head=await executionAttemptStore.current(key);if(head){const binding=await artifactRegistry.resolveExecutionAttemptBinding(head.value.bindingRef);inv(binding&&binding.workContractRef===s.contract.contractRef&&binding.workId===itemId,"attempt binding subject mismatch");return {key,head,binding,bindingRef:head.value.bindingRef,created:false};}
    for(let n=0;n<4;n++){const pr=await currentPolicy({executionPolicyStore,artifactRegistry,contract:s.contract}),st=await strategy({artifactRegistry,p:pr.p,contract:s.contract,runtime});const id="execution-attempt-id:"+hash({key,ordinal:1}),binding=fr({kind:"EXECUTION_ATTEMPT_BINDING",version:1,executionAttemptId:id,workId:itemId,owningDomain:s.contract.owningDomain,workloadType:s.contract.workloadType,workContractRef:s.contract.contractRef,claimReleaseReceiptRef:receiptRef,observedClaimReleaseHead:{subjectKey:s.releaseKey,revision:s.releaseHead.revision,receiptRef},executionPolicyRef:pr.policyRef,observedExecutionPolicyHead:{subjectKey:pr.key,revision:pr.head.revision,generation:pr.head.value.generation,policyRef:pr.policyRef},executionStrategyRef:pr.p.strategyRef,runtimeBinding:{kind:st.strategyKind,adapterRef:runtime.adapterRef,expectedRuntimeCodeRef:runtime.runtimeDeploymentRef,runtimeInvocationKey:"execution-invocation:"+hash({id,adapterRef:runtime.adapterRef,runtimeDeploymentRef:runtime.runtimeDeploymentRef}),bindingMode:st.runtimeBindingMode},contextRefs:st.contextRefs,toolsetRef:st.toolsetRef,modelProfileRef:st.modelProfileRef,harnessRef:st.harnessRef}),bindingRef=await artifactRegistry.putExecutionAttemptBinding(binding),first=await transition(artifactRegistry,{workId:itemId,id,from:"ABSENT",to:ExecutionAttemptStatus.ACTIVE,reason:"FIRST_ATTEMPT",decisionRef:receiptRef}),value={status:ExecutionAttemptStatus.ACTIVE,executionAttemptId:id,bindingRef,transitionRefs:[first],outcomeRef:null,completionDecisionRef:null,publicationReceiptRef:null,judgmentBundleRef:null};
      inv(typeof executionPolicyStore.withCurrentGuard==="function","execution policy store must provide guarded currentness");
      const guarded=await executionPolicyStore.withCurrentGuard(pr.key,pr.head.revision,async()=>{
        await claimController.assertExecutable({itemId,claimGeneration,receiptRef});
        return executionAttemptStore.compareAndSwap(key,null,value);
      });
      if(!guarded.matched)continue;
      if(guarded.result)return {key,head:await executionAttemptStore.current(key),binding,bindingRef,created:true};
      head=await executionAttemptStore.current(key);const winner=await artifactRegistry.resolveExecutionAttemptBinding(head.value.bindingRef);return {key,head,binding:winner,bindingRef:head.value.bindingRef,created:false};}throw new TypeError("execution policy changed repeatedly before attempt commit");}

  async function recoverHead(x){if(x.head.value.status!==ExecutionAttemptStatus.ACTIVE)return x;const tr=await transition(artifactRegistry,{workId:x.binding.workId,id:x.binding.executionAttemptId,from:ExecutionAttemptStatus.ACTIVE,to:ExecutionAttemptStatus.RECOVERY_REQUIRED,reason:"RECOVERY_REQUIRED",decisionRef:x.bindingRef}),next={...x.head.value,status:ExecutionAttemptStatus.RECOVERY_REQUIRED,transitionRefs:[...x.head.value.transitionRefs,tr]};if(await executionAttemptStore.compareAndSwap(x.key,x.head.revision,next))x.head=await executionAttemptStore.current(x.key);return x;}
  async function terminal(head){const packet=await resolveExecutionJudgmentBundle({artifactRegistry,organizationArtifactRegistry,bundleRef:head.value.judgmentBundleRef});return fr({state:ExecutionAttemptStatus.TERMINAL,replayed:true,executionAttemptId:head.value.executionAttemptId,bindingRef:head.value.bindingRef,outcomeRef:head.value.outcomeRef,completionDecisionRef:head.value.completionDecisionRef,publicationReceiptRef:head.value.publicationReceiptRef,judgmentBundleRef:head.value.judgmentBundleRef,packet});}

  async function execute({itemId,claimGeneration,receiptRef,input={}}){const s=await subject({claimController,claimReleaseStore,organizationArtifactRegistry,itemId,claimGeneration,receiptRef});let x=await establish(s,{itemId,claimGeneration,receiptRef});if(x.head.value.status===ExecutionAttemptStatus.TERMINAL)return terminal(x.head);const recovery=!x.created;if(recovery)x=await recoverHead(x);await claimController.assertExecutable({itemId,claimGeneration,receiptRef});const bound=await artifactRegistry.resolveExecutionStrategyDescriptor(x.binding.executionStrategyRef);await strategy({artifactRegistry,p:{strategyRef:x.binding.executionStrategyRef},contract:s.contract,runtime});let result;try{result=recovery?await runtimeAdapter.recover({binding:x.binding,input:fr(input),runtimeInvocationKey:x.binding.runtimeBinding.runtimeInvocationKey}):await runtimeAdapter.dispatch({binding:x.binding,input:fr(input),runtimeInvocationKey:x.binding.runtimeBinding.runtimeInvocationKey});}catch(e){if(x.head.value.status===ExecutionAttemptStatus.ACTIVE)x=await recoverHead(x);throw e;}inv(bound&&result&&["SUCCEEDED","FAILED","BLOCKED","UNKNOWN"].includes(result.status),"runtime result invalid");
    const outputs=arr(result.outputArtifactRefs??[],"outputArtifactRefs").map(o=>fr({ref:txt(o.ref,"output ref"),digest:txt(o.digest,"output digest")})),edges=arr(result.proposedDerivationEdges??[],"derivation edges").map(e=>fr({outputRef:txt(e.outputRef,"edge output"),derivedFrom:strs(e.derivedFrom,"edge inputs")}));inv(edges.every(e=>outputs.some(o=>o.ref===e.outputRef)),"derivation output not produced");const att=fr({kind:"RUNTIME_EXECUTION_ATTESTATION",version:1,executionAttemptId:x.binding.executionAttemptId,bindingRef:x.bindingRef,runtimeInvocationId:txt(result.runtimeInvocationId,"runtime invocation"),runtimeKind:runtime.runtimeKind,runtimeDeploymentRef:runtime.runtimeDeploymentRef,adapterRef:runtime.adapterRef,startedAt:txt(result.startedAt,"startedAt"),finishedAt:result.finishedAt??null,effectRefs:strs(result.effectRefs??[],"effectRefs"),traceRefs:strs(result.traceRefs??[],"traceRefs"),dispatchAuthoritySnapshot:{claimReleaseHead:{subjectKey:s.releaseKey,revision:s.releaseHead.revision,receiptRef},executionPolicyHead:x.binding.observedExecutionPolicyHead},producerAuthorityRef:runtime.producerAuthorityRef}),attRef=await artifactRegistry.putRuntimeExecutionAttestation(att),outcome=fr({kind:"EXECUTION_ATTEMPT_OUTCOME",version:1,executionAttemptId:x.binding.executionAttemptId,bindingRef:x.bindingRef,status:result.status,runtimeAttestationRefs:[attRef],outputArtifactRefs:outputs,effectRefs:att.effectRefs,verificationCandidateRefs:strs(result.verificationCandidateRefs??[],"verificationCandidateRefs"),counterevidenceRefs:strs(result.counterevidenceRefs??[],"counterevidenceRefs"),startedAt:att.startedAt,finishedAt:att.finishedAt,proposedDerivationEdges:edges}),outcomeRef=await artifactRegistry.putExecutionAttemptOutcome(outcome);
    const a=await completionEvaluator.evaluate({contract:s.contract,binding:x.binding,bindingRef:x.bindingRef,outcome,outcomeRef,runtimeAttestationRefs:[attRef]});inv(a&&["ACCEPT","REMEDIATION_REQUIRED","BLOCKED","INCONCLUSIVE"].includes(a.verdict),"completion verdict invalid");const criteria=arr(a.criterionResults,"criterionResults").map(c=>fr({criterionId:txt(c.criterionId,"criterionId"),verdict:txt(c.verdict,"criterion verdict"),evidenceRefs:strs(c.evidenceRefs??[],"criterion evidence")}));inv(criteria.length&&criteria.every(c=>["PASS","FAIL","INCONCLUSIVE"].includes(c.verdict)),"criterion result invalid");const decision=fr({kind:"DOMAIN_COMPLETION_DECISION",version:1,domain:s.contract.owningDomain,workContractRef:s.contract.contractRef,executionAttemptBindingRef:x.bindingRef,executionAttemptOutcomeRef:outcomeRef,criterionResults:criteria,runtimeEvidenceRefs:[attRef],effectEvidenceRefs:outcome.effectRefs,counterevidenceRefs:[...new Set([...outcome.counterevidenceRefs,...strs(a.counterevidenceRefs??[],"completion counterevidence")])],verdict:a.verdict,decisionAuthorityRef:completionAuthority}),decisionRef=await artifactRegistry.putDomainCompletionDecision(decision);let publicationRef=null;
    if(a.verdict==="ACCEPT"){await claimController.assertExecutable({itemId,claimGeneration,receiptRef});const p=await publicationGate.publish({contract:s.contract,binding:x.binding,bindingRef:x.bindingRef,outcome,outcomeRef,completionDecision:decision,completionDecisionRef:decisionRef}),published=arr(p.publishedArtifactRefs??[],"published artifacts").map(o=>fr({ref:txt(o.ref,"published ref"),digest:txt(o.digest,"published digest")}));inv(published.every(y=>outputs.some(o=>o.ref===y.ref&&o.digest===y.digest)),"publication invented output");const accepted=arr(p.acceptedDerivationEdges??[],"accepted edges").map(e=>fr({outputRef:txt(e.outputRef,"accepted output"),derivedFrom:strs(e.derivedFrom,"accepted inputs")}));inv(accepted.every(e=>edges.some(c=>c.outputRef===e.outputRef&&e.derivedFrom.every(r=>c.derivedFrom.includes(r)))),"publication invented lineage");publicationRef=await artifactRegistry.putDomainPublicationReceipt(fr({kind:"DOMAIN_PUBLICATION_RECEIPT",version:1,domain:s.contract.owningDomain,producerPrincipalRef:publicationPrincipal,writeAuthorityRef:publicationAuthority,completionDecisionRef:decisionRef,publishedArtifactRefs:published,publishedClaimRefs:arr(p.publishedClaimRefs??[],"published claims"),acceptedDerivationEdges:accepted,publicationStoreRevision:txt(p.publicationStoreRevision,"publication revision")}));}
    const cur=await executionAttemptStore.current(x.key);inv(cur?.value?.executionAttemptId===x.binding.executionAttemptId,"attempt changed before terminal commit");const tr=await transition(artifactRegistry,{workId:itemId,id:x.binding.executionAttemptId,from:cur.value.status,to:ExecutionAttemptStatus.TERMINAL,reason:a.verdict==="ACCEPT"?(recovery?"RECOVERY_RESOLVED":"TERMINAL_SUCCESS"):"TERMINAL_FAILURE",decisionRef}),trs=[...cur.value.transitionRefs,tr],bundle=fr({kind:"EXECUTION_JUDGMENT_BUNDLE",version:1,subject:{workId:itemId,executionAttemptId:x.binding.executionAttemptId},pins:{workContract:pin(s.contract.contractRef),claimReleaseReceipt:pin(x.binding.claimReleaseReceiptRef),executionPolicy:pin(x.binding.executionPolicyRef),executionStrategy:pin(x.binding.executionStrategyRef),binding:pin(x.bindingRef),runtimeAttestations:[pin(attRef)],outcome:pin(outcomeRef),completionDecision:pin(decisionRef),publicationReceipt:publicationRef?pin(publicationRef):null,transitionHistory:trs.map(pin)},evidenceRefs:[...new Set([...outcome.verificationCandidateRefs,...criteria.flatMap(c=>c.evidenceRefs),attRef,...outcome.effectRefs,...decision.counterevidenceRefs])],telemetryLinks:{traceRefs:att.traceRefs},counterevidenceRefs:decision.counterevidenceRefs,currentnessModes:{claimReleaseReceipt:"EXECUTION_TIME_PIN",executionPolicy:"EXECUTION_TIME_PIN",binding:"REVIEW_INTEGRITY_PIN",runtimeAttestations:"REVIEW_INTEGRITY_PIN",outcome:"REVIEW_INTEGRITY_PIN",completionDecision:"REVIEW_INTEGRITY_PIN",publicationReceipt:"REVIEW_INTEGRITY_PIN",transitionHistory:"REVIEW_INTEGRITY_PIN"}}),bundleRef=await artifactRegistry.putExecutionJudgmentBundle(bundle),terminalHead={...cur.value,status:ExecutionAttemptStatus.TERMINAL,transitionRefs:trs,outcomeRef,completionDecisionRef:decisionRef,publicationReceiptRef:publicationRef,judgmentBundleRef:bundleRef};inv(await executionAttemptStore.compareAndSwap(x.key,cur.revision,terminalHead),"terminal attempt CAS conflict");return fr({state:ExecutionAttemptStatus.TERMINAL,replayed:false,recovered:recovery,executionAttemptId:x.binding.executionAttemptId,bindingRef:x.bindingRef,outcomeRef,completionDecisionRef:decisionRef,publicationReceiptRef:publicationRef,judgmentBundleRef:bundleRef});}
  return Object.freeze({execute});
}

export async function resolveExecutionJudgmentBundle({artifactRegistry,organizationArtifactRegistry,bundleRef}){
  const b=await artifactRegistry.resolveExecutionJudgmentBundle(bundleRef);
  inv(b,"judgment bundle missing");
  const p=b.pins;
  checkedPin(p.workContract,"work contract");
  checkedPin(p.claimReleaseReceipt,"claim release receipt");
  checkedPin(p.executionPolicy,"execution policy");
  checkedPin(p.executionStrategy,"execution strategy");
  checkedPin(p.binding,"execution binding");
  for(const [index,value] of p.runtimeAttestations.entries())checkedPin(value,`runtime attestation[${index}]`);
  checkedPin(p.outcome,"execution outcome");
  checkedPin(p.completionDecision,"completion decision");
  if(p.publicationReceipt)checkedPin(p.publicationReceipt,"publication receipt");
  for(const [index,value] of p.transitionHistory.entries())checkedPin(value,`transition[${index}]`);
  const rawContract=await organizationArtifactRegistry.resolveWorkContract(p.workContract.ref);
  inv(rawContract,"judgment work contract missing");
  const contract=defineOrganizationWorkContract(rawContract);
  const receipt=await organizationArtifactRegistry.resolveClaimReleaseReceipt(p.claimReleaseReceipt.ref);
  const policyArtifact=await artifactRegistry.resolveExecutionPolicy(p.executionPolicy.ref);
  const strategyArtifact=await artifactRegistry.resolveExecutionStrategyDescriptor(p.executionStrategy.ref);
  const binding=await artifactRegistry.resolveExecutionAttemptBinding(p.binding.ref);
  const outcome=await artifactRegistry.resolveExecutionAttemptOutcome(p.outcome.ref);
  const decision=await artifactRegistry.resolveDomainCompletionDecision(p.completionDecision.ref);
  const atts=await Promise.all(p.runtimeAttestations.map(x=>artifactRegistry.resolveRuntimeExecutionAttestation(x.ref)));
  const transitions=await Promise.all(p.transitionHistory.map(x=>artifactRegistry.resolveExecutionAttemptTransition(x.ref)));
  const publication=p.publicationReceipt?await artifactRegistry.resolveDomainPublicationReceipt(p.publicationReceipt.ref):null;
  inv(receipt&&policyArtifact&&strategyArtifact&&binding&&outcome&&decision&&atts.every(Boolean)&&transitions.every(Boolean),"judgment source artifact missing");

  const policy=defineExecutionPolicy(policyArtifact);
  const strategyDescriptor=defineExecutionStrategyDescriptor(strategyArtifact);
  inv(contract.contractRef===p.workContract.ref,"judgment work-contract pin mismatch");
  inv(receipt.workContractRef===contract.contractRef&&receipt.itemId===binding.workId&&receipt.projectId===contract.projectId,"judgment release/work relation mismatch");
  inv(binding.workContractRef===contract.contractRef&&binding.claimReleaseReceiptRef===p.claimReleaseReceipt.ref,"judgment binding authority relation mismatch");
  inv(binding.executionPolicyRef===p.executionPolicy.ref&&binding.executionStrategyRef===p.executionStrategy.ref,"judgment binding policy/strategy relation mismatch");
  inv(policy.strategyRef===p.executionStrategy.ref&&policy.domain===contract.owningDomain&&policy.workloadType===contract.workloadType,"judgment policy relation mismatch");
  inv(strategyDescriptor.compatibleWorkloadTypes.includes(contract.workloadType)&&strategyDescriptor.compatibleWorkContractVersions.includes(contract.version),"judgment strategy compatibility mismatch");
  inv(binding.runtimeBinding.adapterRef===strategyDescriptor.adapterRef&&binding.runtimeBinding.expectedRuntimeCodeRef===strategyDescriptor.expectedRuntimeCodeRef,"judgment runtime binding mismatch");

  inv(binding.executionAttemptId===b.subject.executionAttemptId&&binding.workId===b.subject.workId,"judgment subject relation mismatch");
  inv(outcome.bindingRef===p.binding.ref&&outcome.executionAttemptId===binding.executionAttemptId,"judgment outcome relation mismatch");
  inv(decision.executionAttemptBindingRef===p.binding.ref&&decision.executionAttemptOutcomeRef===p.outcome.ref&&decision.workContractRef===contract.contractRef&&decision.domain===contract.owningDomain,"judgment completion relation mismatch");

  const attestationRefs=p.runtimeAttestations.map(x=>x.ref);
  inv(Array.isArray(outcome.runtimeAttestationRefs)&&outcome.runtimeAttestationRefs.length===attestationRefs.length&&outcome.runtimeAttestationRefs.every((ref,index)=>ref===attestationRefs[index]),"judgment runtime-attestation set mismatch");
  inv(atts.every(a=>a.bindingRef===p.binding.ref&&a.executionAttemptId===binding.executionAttemptId&&a.adapterRef===strategyDescriptor.adapterRef&&a.runtimeDeploymentRef===strategyDescriptor.expectedRuntimeCodeRef),"runtime attestation relation mismatch");
  inv(atts.every(a=>a.dispatchAuthoritySnapshot?.executionPolicyHead?.revision===binding.observedExecutionPolicyHead.revision&&a.dispatchAuthoritySnapshot?.executionPolicyHead?.policyRef===binding.executionPolicyRef),"runtime policy authority snapshot mismatch");

  const runtimeClaimReceipts=await Promise.all(atts.map(a=>organizationArtifactRegistry.resolveClaimReleaseReceipt(a.dispatchAuthoritySnapshot?.claimReleaseHead?.receiptRef)));
  inv(runtimeClaimReceipts.every(Boolean),"runtime claim receipt missing");
  inv(runtimeClaimReceipts.every((r,index)=>r.workContractRef===contract.contractRef&&r.itemId===binding.workId&&r.projectId===contract.projectId&&atts[index].dispatchAuthoritySnapshot.claimReleaseHead.subjectKey===claimReleaseSubjectKey(contract.projectId,binding.workId,r.claimGeneration)),"runtime claim authority relation mismatch");

  let transitionStatus="ABSENT";
  for(const t of transitions){
    inv(t.workId===binding.workId&&t.toAttemptId===binding.executionAttemptId,"attempt transition subject mismatch");
    inv(t.fromStatus===transitionStatus,"attempt transition history is discontinuous");
    inv(t.fromAttemptId===(transitionStatus==="ABSENT"?null:binding.executionAttemptId),"attempt transition predecessor mismatch");
    transitionStatus=t.toStatus;
  }
  inv(transitionStatus===ExecutionAttemptStatus.TERMINAL,"attempt transition history is not terminal");

  if(publication){
    inv(decision.verdict==="ACCEPT","publication requires ACCEPT completion");
    inv(publication.completionDecisionRef===p.completionDecision.ref&&publication.domain===contract.owningDomain,"publication relation mismatch");
    inv(publication.publishedArtifactRefs.every(y=>outcome.outputArtifactRefs.some(o=>o.ref===y.ref&&o.digest===y.digest)),"publication contains unproduced output");
    inv(publication.acceptedDerivationEdges.every(e=>outcome.proposedDerivationEdges.some(c=>c.outputRef===e.outputRef&&e.derivedFrom.every(ref=>c.derivedFrom.includes(ref)))),"publication contains unproposed lineage");
  }
  return fr({bundle:b,contract,receipt,policy,strategy:strategyDescriptor,binding,runtimeAttestations:atts,runtimeClaimReceipts,outcome,completionDecision:decision,publicationReceipt:publication,transitions});
}
