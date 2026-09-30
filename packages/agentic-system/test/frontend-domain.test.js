import test from "node:test";
import assert from "node:assert/strict";
import {
  ExecutionAttemptStatus,FrontendCompletionAction,FrontendCompletionReason,FrontendRecoveryAction,FrontendRunAction,FrontendWorkStatus,
  assessFrontendCompletion,createDomainExecutionInput,createFrontendWorker,defineFrontendCompletionPolicy,
  defineFrontendObjective,executionAttemptSubjectKey,makeFrontendWorkOrder,prepareFrontendObjective,recoverPreparedFrontendObjective,
  resolveContractExecutionInput,runPreparedFrontendObjective
} from "../src/index.js";
import {appliedResult,domainFixture,frontendAdapter,objectiveFor,repositoryReader} from "./domain-activation.test.js";

const objective=()=>defineFrontendObjective({id:"fe-page",...objectiveFor("FRONTEND","fe-page"),components:["Page"]});

test("Frontend completion requires frontend.mutation, frontend.typecheck and frontend.tests evidence",()=>{
  assert.equal(assessFrontendCompletion(appliedResult("FRONTEND")).action,FrontendCompletionAction.ACCEPT);
  const missing=assessFrontendCompletion(appliedResult("FRONTEND",{claims:["frontend.mutation","frontend.tests"]}));
  assert.equal(missing.action,FrontendCompletionAction.CONTINUE);assert.deepEqual(missing.missingEvidenceClaims,["frontend.typecheck"]);
  const backendEvidence=assessFrontendCompletion({...appliedResult("FRONTEND"),evidence:appliedResult("BACKEND").evidence});
  assert.equal(backendEvidence.action,FrontendCompletionAction.CONTINUE,"Backend evidence cannot satisfy Frontend completion");
  const failed={...appliedResult("FRONTEND"),evidence:[...appliedResult("FRONTEND",{claims:["frontend.mutation","frontend.typecheck"]}).evidence,appliedResult("FRONTEND",{claims:["frontend.tests"]}).evidence[0]]};
  failed.evidence[2]={...failed.evidence[2],metadata:{claim:"frontend.tests",verificationStatus:"FAIL"}};
  assert.equal(assessFrontendCompletion(failed).reasons[0],FrontendCompletionReason.INVALID_EVIDENCE,"tampered evidence is rejected");
  assert.equal(assessFrontendCompletion({...appliedResult("FRONTEND"),status:FrontendWorkStatus.BLOCKED,blockers:["waiting"]}).action,FrontendCompletionAction.BLOCK);
  assert.throws(()=>defineFrontendCompletionPolicy({requiredEvidenceClaims:["frontend.mutation"]}),/frontend.typecheck/);
});

test("Frontend application prepares, runs and recovers on its own worker and session store",async()=>{
  const prepared=await prepareFrontendObjective(objective(),{repositoryReader});
  assert.deepEqual(prepared.order,makeFrontendWorkOrder(objective()));
  assert.equal(prepared.context.files[0].sourceRef,"repo://frontend@rev-1:src/fe-page.js");
  let calls=0;
  const frontendWorker=createFrontendWorker({executor:{async execute(order,context){calls+=1;assert.equal(order.id,"fe-page:frontend");assert.equal(context.files.length,1);return appliedResult("FRONTEND");}}});
  const fresh=await recoverPreparedFrontendObjective(prepared,{frontendWorker});
  assert.equal(fresh.recovery.action,FrontendRecoveryAction.RETRY_EXECUTION);assert.equal(calls,1);
  const run=await runPreparedFrontendObjective(prepared,{frontendWorker});
  assert.equal(run.decision.action,FrontendRunAction.RETURN);assert.equal(calls,2);
  const recovered=await recoverPreparedFrontendObjective(prepared,{frontendWorker});
  assert.equal(recovered.recovery.action,FrontendRecoveryAction.COMPLETED);assert.equal(calls,2);
  assert.equal(recovered.decision.action,FrontendRunAction.RETURN);
  await assert.rejects(runPreparedFrontendObjective({...prepared,order:{...prepared.order,task:"other"}},{frontendWorker}),/must match/);
});

test("DomainExecutionInput is content addressed and rejects authority/HOW fields",()=>{
  const raw={projectId:"project-1",owningDomain:"FRONTEND",workloadType:"frontend-change",objective:objectiveFor("FRONTEND","x")};
  const input=createDomainExecutionInput(raw);
  assert.match(input.inputRef,/^domain-execution-input:sha256:[a-f0-9]{64}$/);
  assert.equal(createDomainExecutionInput({...raw}).inputRef,input.inputRef);
  for(const field of ["principal","strategyRef","policyRef","runtime","nextRole","priority","crossDomainObligationRef"])assert.throws(()=>createDomainExecutionInput({...raw,[field]:"x"}),/authority\/HOW/);
  assert.throws(()=>createDomainExecutionInput({...raw,inputRef:"domain-execution-input:sha256:"+"0".repeat(64)}),/mismatch/);
});

test("AC-5 Frontend strategy executes exact FRONTEND WorkContract + input through DomainExecutionController",async t=>{
  const f=await domainFixture(t);
  const fe=await f.domainStack({domain:"FRONTEND",adapter:frontendAdapter(f)});
  const work=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  const result=await f.activationFor(fe).reconcile(work.key);
  assert.equal(result.execution.state,ExecutionAttemptStatus.TERMINAL);
  const outcome=await f.registry.resolveExecutionAttemptOutcome((await fe.attemptStore.current(executionAttemptSubjectKey({projectId:work.contract.projectId,itemId:work.item.id,workContractRef:work.contract.contractRef}))).value.outcomeRef);
  assert.equal(outcome.status,"SUCCEEDED");
  assert.deepEqual(outcome.proposedDerivationEdges.map(e=>e.derivedFrom),[[work.inputRef]]);
  assert.equal(outcome.verificationCandidateRefs.length,3);
});

test("zero, multiple or mismatched DomainExecutionInputs fail before any Frontend worker call",async t=>{
  const f=await domainFixture(t);
  let calls=0;
  const strategy=frontendAdapter(f,{executor:{async execute(){calls+=1;return appliedResult("FRONTEND");}}});
  const work=await f.addWork({key:"fe-page",owningDomain:"FRONTEND"});
  const otherInput=await f.org.putDomainExecutionInput({projectId:"project-1",owningDomain:"FRONTEND",workloadType:"frontend-change",objective:objectiveFor("FRONTEND","other")});
  const backendInput=await f.org.putDomainExecutionInput({projectId:"project-1",owningDomain:"BACKEND",workloadType:"frontend-change",objective:objectiveFor("BACKEND","other")});
  const binding=contract=>({workContractRef:contract.contractRef,owningDomain:contract.owningDomain,workloadType:contract.workloadType});
  const dispatch=refs=>{const contract={...work.contract,requiredArtifactRefs:refs};return strategy.dispatch({binding:binding(contract),contract,input:{},runtimeInvocationKey:"execution-invocation:test"});};
  await assert.rejects(dispatch(["intent://root"]),/exactly one DomainExecutionInput \(found 0\)/);
  await assert.rejects(dispatch([work.inputRef,otherInput]),/exactly one DomainExecutionInput \(found 2\)/);
  await assert.rejects(dispatch([backendInput]),/owning domain mismatch/);
  await assert.rejects(dispatch(["domain-execution-input:sha256:"+"9".repeat(64)]),/unavailable/);
  await assert.rejects(strategy.dispatch({binding:binding(work.contract),contract:{...work.contract,owningDomain:"BACKEND"},input:{},runtimeInvocationKey:"k"}),/only FRONTEND/);
  await assert.rejects(strategy.dispatch({binding:{...binding(work.contract),workContractRef:"other"},contract:work.contract,input:{},runtimeInvocationKey:"k"}),/binding does not match/);
  assert.equal(calls,0);
  const resolved=await resolveContractExecutionInput({contract:work.contract,resolveDomainExecutionInput:f.org.resolveDomainExecutionInput});
  assert.equal(resolved.ref,work.inputRef);
  // End to end: a WorkContract carrying two inputs fails pre-dispatch inside the controller.
  const fe=await f.domainStack({domain:"FRONTEND",adapter:strategy});
  const doubled=await f.addWork({key:"fe-doubled",owningDomain:"FRONTEND",extraInputs:[otherInput]});
  await assert.rejects(f.activationFor(fe).reconcile(doubled.key),/found 2/);
  assert.equal(calls,0);
});
