import fs from "node:fs";
import { deliveryTypes, assertDeliveryArtifact } from './blackboard-delivery-contract.mjs';

const IMPLEMENTATION_INPUT_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","semantics","provenance"
]);
const SEMANTIC_KEYS=new Set([
  "desiredOutcome","currentState","requiredBehaviors","invariants","acceptanceCriteria",
  "outOfScope","affectedCapabilities","affectedContracts"
]);
const SEMANTIC_FORBIDDEN_KEYS=new Set([
  "file","files","path","paths","commands","command","steps","sourceScope","writeScope",
  "testScope","implementationPlan","executor","executorProfile","model","prompt","toolCalls"
]);
const READINESS_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","verdict","provenance"
]);
const RESULT_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","observations","provenance"
]);
const RESULT_JUDGMENT_FORBIDDEN_KEYS=new Set([
  "verdict","accepted","accept","correct","done","complete","requirementSatisfied",
  "architectureCorrect","safeToMerge","judgment","approval","approved"
]);
const JUDGMENT_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","assessments","findings","verdict","provenance"
]);
const IMPLEMENTATION_SPEC_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","semanticInputRef","objective",
  "architectureDecisions","sourceSeams","implementationSlices","hardInvariants","acceptanceCriteria",
  "mandatoryNegativeTests","forbidden","activation","provenance"
]);

function fail(message){throw new Error(`BLACKBOARD_ARTIFACT_INVALID: ${message}`);}
function nonEmptyString(value,label){if(typeof value!=="string"||!value.trim())fail(label);}
function stringArray(value,label,{allowEmpty=true}={}){
  if(!Array.isArray(value)||(!allowEmpty&&!value.length)||value.some(x=>typeof x!=="string"||!x.trim()))fail(label);
}
function exactKeys(value,allowed,label){
  if(!value||typeof value!=="object"||Array.isArray(value))fail(label);
  for(const key of Object.keys(value))if(!allowed.has(key))fail(`${label} unexpected field: ${key}`);
}
function claims(value,label,{allowEmpty=false}={}){
  if(!Array.isArray(value)||(!allowEmpty&&!value.length))fail(label);
  const ids=new Set();
  for(const claim of value){
    exactKeys(claim,new Set(["id","statement"]),`${label} claim`);
    nonEmptyString(claim.id,`${label}.id`);
    nonEmptyString(claim.statement,`${label}.statement`);
    if(ids.has(claim.id))fail(`${label} duplicate id: ${claim.id}`);
    ids.add(claim.id);
  }
}
function rejectKeys(value,forbidden,path="artifact"){
  if(Array.isArray(value)){value.forEach((x,i)=>rejectKeys(x,forbidden,`${path}[${i}]`));return;}
  if(!value||typeof value!=="object")return;
  for(const [key,child] of Object.entries(value)){
    if(forbidden.has(key))fail(`forbidden field ${path}.${key}`);
    rejectKeys(child,forbidden,`${path}.${key}`);
  }
}
function assertBase(artifact){
  if(artifact?.kind!=="BLACKBOARD_ARTIFACT"||artifact?.version!==1)fail("kind/version");
  nonEmptyString(artifact.artifactId,"artifactId");
}
function assertImplementationInput(artifact){
  exactKeys(artifact,IMPLEMENTATION_INPUT_KEYS,"IMPLEMENTATION_INPUT");
  rejectKeys(artifact,SEMANTIC_FORBIDDEN_KEYS);
  if(artifact.status!=="ACCEPTED")fail("IMPLEMENTATION_INPUT status must be ACCEPTED");
  exactKeys(artifact.subject,new Set(["id","title"]),"subject");
  nonEmptyString(artifact.subject.id,"subject.id");
  nonEmptyString(artifact.subject.title,"subject.title");

  exactKeys(artifact.semantics,SEMANTIC_KEYS,"semantics");
  nonEmptyString(artifact.semantics.desiredOutcome,"semantics.desiredOutcome");
  nonEmptyString(artifact.semantics.currentState,"semantics.currentState");
  claims(artifact.semantics.requiredBehaviors,"semantics.requiredBehaviors");
  claims(artifact.semantics.invariants,"semantics.invariants");
  claims(artifact.semantics.acceptanceCriteria,"semantics.acceptanceCriteria");
  claims(artifact.semantics.outOfScope,"semantics.outOfScope",{allowEmpty:true});
  stringArray(artifact.semantics.affectedCapabilities,"semantics.affectedCapabilities",{allowEmpty:false});
  stringArray(artifact.semantics.affectedContracts,"semantics.affectedContracts");

  exactKeys(artifact.provenance,new Set(["sourceArtifactRefs","evidenceRefs","currentSystemRefs","acceptance"]),"provenance");
  stringArray(artifact.provenance.sourceArtifactRefs,"provenance.sourceArtifactRefs");
  stringArray(artifact.provenance.evidenceRefs,"provenance.evidenceRefs");
  stringArray(artifact.provenance.currentSystemRefs,"provenance.currentSystemRefs",{allowEmpty:false});
  exactKeys(artifact.provenance.acceptance,new Set(["kind","ref"]),"provenance.acceptance");
  if(!["INDEPENDENT_REVIEW","PROMOTED_DECISION","USER_DIRECTIVE","MIGRATION_ADAPTER"].includes(artifact.provenance.acceptance.kind))
    fail("provenance.acceptance.kind");
  nonEmptyString(artifact.provenance.acceptance.ref,"provenance.acceptance.ref");
}
function assertImplementationSpec(artifact){
  exactKeys(artifact,IMPLEMENTATION_SPEC_KEYS,"IMPLEMENTATION_SPEC");
  if(!["ACCEPTED","DELIVERED"].includes(artifact.status))fail("IMPLEMENTATION_SPEC status");
  exactKeys(artifact.subject,new Set(["id","title"]),"subject");
  nonEmptyString(artifact.subject.id,"subject.id");
  nonEmptyString(artifact.subject.title,"subject.title");
  nonEmptyString(artifact.semanticInputRef,"semanticInputRef");
  nonEmptyString(artifact.objective,"objective");
  stringArray(artifact.architectureDecisions,"architectureDecisions",{allowEmpty:false});

  exactKeys(artifact.sourceSeams,new Set(["requiredExisting","expectedNew","expectedTests"]),"sourceSeams");
  stringArray(artifact.sourceSeams.requiredExisting,"sourceSeams.requiredExisting",{allowEmpty:false});
  stringArray(artifact.sourceSeams.expectedNew,"sourceSeams.expectedNew");
  stringArray(artifact.sourceSeams.expectedTests,"sourceSeams.expectedTests");

  if(!Array.isArray(artifact.implementationSlices)||!artifact.implementationSlices.length)fail("implementationSlices");
  for(const slice of artifact.implementationSlices){
    exactKeys(slice,new Set(["id","output","requirements"]),"implementation slice");
    nonEmptyString(slice.id,"implementationSlices.id");
    nonEmptyString(slice.output,"implementationSlices.output");
    stringArray(slice.requirements,"implementationSlices.requirements",{allowEmpty:false});
  }
  stringArray(artifact.hardInvariants,"hardInvariants",{allowEmpty:false});
  stringArray(artifact.acceptanceCriteria,"acceptanceCriteria",{allowEmpty:false});
  stringArray(artifact.mandatoryNegativeTests,"mandatoryNegativeTests",{allowEmpty:false});
  stringArray(artifact.forbidden,"forbidden");

  exactKeys(artifact.activation,new Set(["mode","prerequisiteSubjects","baselinePolicy","routingAuthority"]),"activation");
  if(!["ALLOCATE_ON_GROUNDED_TRIGGER","RETAINED_DELIVERED"].includes(artifact.activation.mode))fail("activation.mode");
  stringArray(artifact.activation.prerequisiteSubjects,"activation.prerequisiteSubjects");
  nonEmptyString(artifact.activation.baselinePolicy,"activation.baselinePolicy");
  if(artifact.activation.routingAuthority!==false)fail("IMPLEMENTATION_SPEC cannot be routing authority");

  exactKeys(artifact.provenance,new Set(["originWorkId","sourceRef","sourceBlobSha"]),"provenance");
  if(!/^BB-\d+$/.test(artifact.provenance.originWorkId||""))fail("provenance.originWorkId");
  nonEmptyString(artifact.provenance.sourceRef,"provenance.sourceRef");
  if(!/^[0-9a-f]{40}$/.test(artifact.provenance.sourceBlobSha||""))fail("provenance.sourceBlobSha");
}
function assertReadinessDecision(artifact){
  exactKeys(artifact,READINESS_KEYS,"READINESS_DECISION");
  if(artifact.status!=="RECORDED")fail("READINESS_DECISION status must be RECORDED");
  exactKeys(artifact.subject,new Set(["itemId","semanticArtifactRef"]),"subject");
  nonEmptyString(artifact.subject.itemId,"subject.itemId");
  nonEmptyString(artifact.subject.semanticArtifactRef,"subject.semanticArtifactRef");
  if(!["ACCEPT","FINDINGS"].includes(artifact.verdict))fail("READINESS_DECISION verdict");
  exactKeys(artifact.provenance,new Set(["evidenceRefs"]),"provenance");
  stringArray(artifact.provenance.evidenceRefs,"provenance.evidenceRefs");
}
function assertImplementationResult(artifact){
  exactKeys(artifact,RESULT_KEYS,"IMPLEMENTATION_RESULT");
  rejectKeys(artifact,RESULT_JUDGMENT_FORBIDDEN_KEYS);
  if(artifact.status!=="PRODUCED")fail("IMPLEMENTATION_RESULT status must be PRODUCED");
  exactKeys(artifact.subject,new Set([
    "itemId","semanticArtifactRef","sourceBaseline","candidateRef","executionAuthorityRef"
  ]),"subject");
  for(const key of ["itemId","semanticArtifactRef","sourceBaseline","candidateRef","executionAuthorityRef"])
    nonEmptyString(artifact.subject[key],`subject.${key}`);

  exactKeys(artifact.observations,new Set([
    "changedSurfaces","verificationRuns","observedFacts","evidenceRefs"
  ]),"observations");
  stringArray(artifact.observations.changedSurfaces,"observations.changedSurfaces");
  stringArray(artifact.observations.evidenceRefs,"observations.evidenceRefs");
  if(!Array.isArray(artifact.observations.verificationRuns))fail("observations.verificationRuns");
  for(const run of artifact.observations.verificationRuns){
    exactKeys(run,new Set(["id","command","status","evidenceRefs"]),"verification run");
    nonEmptyString(run.id,"verificationRuns.id");
    nonEmptyString(run.command,"verificationRuns.command");
    if(!["PASSED","FAILED","SKIPPED"].includes(run.status))fail("verificationRuns.status");
    stringArray(run.evidenceRefs,"verificationRuns.evidenceRefs");
  }
  if(!Array.isArray(artifact.observations.observedFacts))fail("observations.observedFacts");
  for(const fact of artifact.observations.observedFacts){
    exactKeys(fact,new Set(["id","statement","evidenceRefs"]),"observed fact");
    nonEmptyString(fact.id,"observedFacts.id");
    nonEmptyString(fact.statement,"observedFacts.statement");
    stringArray(fact.evidenceRefs,"observedFacts.evidenceRefs");
  }
  exactKeys(artifact.provenance,new Set(["inputRefs","evidenceRefs"]),"provenance");
  stringArray(artifact.provenance.inputRefs,"provenance.inputRefs");
  stringArray(artifact.provenance.evidenceRefs,"provenance.evidenceRefs");
}
function assessmentArray(value,label){
  if(!Array.isArray(value)||!value.length)fail(label);
  for(const assessment of value){
    exactKeys(assessment,new Set(["id","status","reason","evidenceRefs"]),label);
    nonEmptyString(assessment.id,`${label}.id`);
    if(!["SATISFIED","FINDING","INSUFFICIENT"].includes(assessment.status))fail(`${label}.status`);
    nonEmptyString(assessment.reason,`${label}.reason`);
    stringArray(assessment.evidenceRefs,`${label}.evidenceRefs`);
  }
}
function assertJudgment(artifact){
  exactKeys(artifact,JUDGMENT_KEYS,"JUDGMENT");
  if(artifact.status!=="RECORDED")fail("JUDGMENT status must be RECORDED");
  exactKeys(artifact.subject,new Set([
    "itemId","semanticArtifactRef","implementationResultRef","candidateRef","sourceBaseline"
  ]),"subject");
  for(const key of ["itemId","semanticArtifactRef","implementationResultRef","candidateRef","sourceBaseline"])
    nonEmptyString(artifact.subject[key],`subject.${key}`);

  exactKeys(artifact.assessments,new Set(["criteria","invariants"]),"assessments");
  assessmentArray(artifact.assessments.criteria,"assessments.criteria");
  assessmentArray(artifact.assessments.invariants,"assessments.invariants");

  if(!Array.isArray(artifact.findings))fail("findings");
  for(const finding of artifact.findings){
    exactKeys(finding,new Set(["id","type","severity","statement","evidenceRefs"]),"finding");
    nonEmptyString(finding.id,"finding.id");
    if(!["IMPLEMENTATION_FINDING","EVIDENCE_INSUFFICIENT","INPUT_CONTRADICTION"].includes(finding.type))
      fail("finding.type");
    if(!["P1","P2","P3"].includes(finding.severity))fail("finding.severity");
    nonEmptyString(finding.statement,"finding.statement");
    stringArray(finding.evidenceRefs,"finding.evidenceRefs");
  }
  if(!["ACCEPT","FINDINGS"].includes(artifact.verdict))fail("verdict");
  const assessments=[...artifact.assessments.criteria,...artifact.assessments.invariants];
  if(artifact.verdict==="ACCEPT"&&(artifact.findings.length||assessments.some(x=>x.status!=="SATISFIED")))
    fail("ACCEPT requires all assessments satisfied and zero findings");
  if(artifact.verdict==="FINDINGS"&&!artifact.findings.length)fail("FINDINGS requires at least one finding");

  exactKeys(artifact.provenance,new Set(["evidenceRefs"]),"provenance");
  stringArray(artifact.provenance.evidenceRefs,"provenance.evidenceRefs");
}

export function readSemanticArtifact(path){
  return JSON.parse(fs.readFileSync(path,"utf8"));
}

export function assertBlackboardArtifact(artifact){
  if(deliveryTypes.has(artifact?.artifactType)||(artifact?.artifactType==='IMPLEMENTATION_RESULT'&&artifact.plan)) return assertDeliveryArtifact(artifact);
  assertBase(artifact);
  if(artifact.artifactType==="IMPLEMENTATION_INPUT")assertImplementationInput(artifact);
  else if(artifact.artifactType==="IMPLEMENTATION_SPEC")assertImplementationSpec(artifact);
  else if(artifact.artifactType==="READINESS_DECISION")assertReadinessDecision(artifact);
  else if(artifact.artifactType==="IMPLEMENTATION_RESULT")assertImplementationResult(artifact);
  else if(artifact.artifactType==="JUDGMENT")assertJudgment(artifact);
  else fail("unsupported artifactType");
  return artifact;
}

export function assertSemanticArtifact(artifact){
  if(['OBJECTIVE','READY_IMPLEMENT_PLAN'].includes(artifact?.artifactType)) return assertDeliveryArtifact(artifact);
  if(artifact?.artifactType!=="IMPLEMENTATION_INPUT")fail("expected IMPLEMENTATION_INPUT");
  return assertBlackboardArtifact(artifact);
}
