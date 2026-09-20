import { createHash } from "node:crypto";
import { createJsonCasHeadStore } from "./organization-authority-store.js";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function freeze(value){return Object.freeze(structuredClone(value));}

export const ExecutionPolicyStatus=Object.freeze({ACTIVE:"ACTIVE",REVOKED:"REVOKED"});
export const ExecutionAttemptStatus=Object.freeze({ACTIVE:"ACTIVE",RECOVERY_REQUIRED:"RECOVERY_REQUIRED",TERMINAL:"TERMINAL"});

export function createJsonDomainExecutionPolicyStore(options){return createJsonCasHeadStore(options);}
export function createJsonExecutionAttemptStore(options){return createJsonCasHeadStore(options);}

const ARTIFACTS=Object.freeze({
  ExecutionPolicy:["execution-policy","EXECUTION_POLICY"],
  ExecutionStrategyDescriptor:["execution-strategy-descriptor","EXECUTION_STRATEGY_DESCRIPTOR"],
  ExecutionAttemptBinding:["execution-attempt-binding","EXECUTION_ATTEMPT_BINDING"],
  ExecutionAttemptTransition:["execution-attempt-transition","EXECUTION_ATTEMPT_TRANSITION"],
  RuntimeExecutionAttestation:["runtime-execution-attestation","RUNTIME_EXECUTION_ATTESTATION"],
  ExecutionAttemptOutcome:["execution-attempt-outcome","EXECUTION_ATTEMPT_OUTCOME"],
  DomainCompletionDecision:["domain-completion-decision","DOMAIN_COMPLETION_DECISION"],
  DomainPublicationReceipt:["domain-publication-receipt","DOMAIN_PUBLICATION_RECEIPT"],
  ExecutionJudgmentBundle:["execution-judgment-bundle","EXECUTION_JUDGMENT_BUNDLE"]
});

export function createDomainExecutionArtifactRegistry({store}){
  invariant(store&&typeof store.put==="function"&&typeof store.resolve==="function","domain execution artifact registry requires immutable artifact store");

  async function put(name,value){
    const [prefix,kind]=ARTIFACTS[name];
    invariant(value&&typeof value==="object"&&!Array.isArray(value),`${name} must be an object`);
    invariant(value.kind===kind&&value.version===1,`${name} kind/version mismatch`);
    return store.put(prefix,value);
  }

  async function resolve(name,ref){
    const [prefix,kind]=ARTIFACTS[name];
    requireText(ref,`${name} ref`);
    invariant(ref.startsWith(`${prefix}:sha256:`),`${name} ref kind mismatch`);
    const value=await store.resolve(ref);
    if(value==null) return null;
    invariant(value.kind===kind&&value.version===1,`${name} artifact kind/version mismatch`);
    invariant(ref===`${prefix}:sha256:${digest(value)}`,`${name} artifact digest mismatch`);
    return freeze(value);
  }

  return Object.freeze({
    putExecutionPolicy:(value)=>put("ExecutionPolicy",value),
    resolveExecutionPolicy:(ref)=>resolve("ExecutionPolicy",ref),
    putExecutionStrategyDescriptor:(value)=>put("ExecutionStrategyDescriptor",value),
    resolveExecutionStrategyDescriptor:(ref)=>resolve("ExecutionStrategyDescriptor",ref),
    putExecutionAttemptBinding:(value)=>put("ExecutionAttemptBinding",value),
    resolveExecutionAttemptBinding:(ref)=>resolve("ExecutionAttemptBinding",ref),
    putExecutionAttemptTransition:(value)=>put("ExecutionAttemptTransition",value),
    resolveExecutionAttemptTransition:(ref)=>resolve("ExecutionAttemptTransition",ref),
    putRuntimeExecutionAttestation:(value)=>put("RuntimeExecutionAttestation",value),
    resolveRuntimeExecutionAttestation:(ref)=>resolve("RuntimeExecutionAttestation",ref),
    putExecutionAttemptOutcome:(value)=>put("ExecutionAttemptOutcome",value),
    resolveExecutionAttemptOutcome:(ref)=>resolve("ExecutionAttemptOutcome",ref),
    putDomainCompletionDecision:(value)=>put("DomainCompletionDecision",value),
    resolveDomainCompletionDecision:(ref)=>resolve("DomainCompletionDecision",ref),
    putDomainPublicationReceipt:(value)=>put("DomainPublicationReceipt",value),
    resolveDomainPublicationReceipt:(ref)=>resolve("DomainPublicationReceipt",ref),
    putExecutionJudgmentBundle:(value)=>put("ExecutionJudgmentBundle",value),
    resolveExecutionJudgmentBundle:(ref)=>resolve("ExecutionJudgmentBundle",ref)
  });
}
