import fs from "node:fs";

const IMPLEMENTATION_INPUT_KEYS=new Set([
  "kind","version","artifactType","artifactId","status","subject","semantics","provenance"
]);
const SEMANTIC_KEYS=new Set([
  "desiredOutcome","currentState","requiredBehaviors","invariants","acceptanceCriteria",
  "outOfScope","affectedCapabilities","affectedContracts"
]);
const FORBIDDEN_KEYS=new Set([
  "file","files","path","paths","commands","command","steps","sourceScope","writeScope",
  "testScope","implementationPlan","executor","executorProfile","model","prompt","toolCalls"
]);

function fail(message){throw new Error(`BLACKBOARD_ARTIFACT_INVALID: ${message}`);}
function nonEmptyString(value,label){if(typeof value!=="string"||!value.trim())fail(label);}
function stringArray(value,label,{allowEmpty=true}={}){
  if(!Array.isArray(value)||(!allowEmpty&&!value.length)||value.some(x=>typeof x!=="string"||!x.trim()))fail(label);
}
function claims(value,label,{allowEmpty=false}={}){
  if(!Array.isArray(value)||(!allowEmpty&&!value.length))fail(label);
  const ids=new Set();
  for(const claim of value){
    if(!claim||typeof claim!=="object"||Array.isArray(claim))fail(`${label} claim`);
    nonEmptyString(claim.id,`${label}.id`);
    nonEmptyString(claim.statement,`${label}.statement`);
    if(ids.has(claim.id))fail(`${label} duplicate id: ${claim.id}`);
    ids.add(claim.id);
    const keys=Object.keys(claim);
    if(keys.some(k=>!["id","statement"].includes(k)))fail(`${label} claim contains non-semantic fields`);
  }
}
function rejectProceduralKeys(value,path="artifact"){
  if(Array.isArray(value)){value.forEach((x,i)=>rejectProceduralKeys(x,`${path}[${i}]`));return;}
  if(!value||typeof value!=="object")return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEYS.has(key))fail(`procedural field ${path}.${key}`);
    rejectProceduralKeys(child,`${path}.${key}`);
  }
}

export function readSemanticArtifact(path){
  return JSON.parse(fs.readFileSync(path,"utf8"));
}

export function assertSemanticArtifact(artifact){
  if(artifact?.kind!=="BLACKBOARD_ARTIFACT"||artifact?.version!==1)fail("kind/version");
  if(artifact.artifactType!=="IMPLEMENTATION_INPUT")fail("unsupported artifactType");
  for(const key of Object.keys(artifact))if(!IMPLEMENTATION_INPUT_KEYS.has(key))fail(`unexpected top-level field: ${key}`);
  rejectProceduralKeys(artifact);

  nonEmptyString(artifact.artifactId,"artifactId");
  if(artifact.status!=="ACCEPTED")fail("IMPLEMENTATION_INPUT status must be ACCEPTED");
  if(!artifact.subject||typeof artifact.subject!=="object"||Array.isArray(artifact.subject))fail("subject");
  if(Object.keys(artifact.subject).some(k=>!["id","title"].includes(k)))fail("subject fields");
  nonEmptyString(artifact.subject.id,"subject.id");
  nonEmptyString(artifact.subject.title,"subject.title");

  if(!artifact.semantics||typeof artifact.semantics!=="object"||Array.isArray(artifact.semantics))fail("semantics");
  for(const key of Object.keys(artifact.semantics))if(!SEMANTIC_KEYS.has(key))fail(`non-semantic implementation input field: semantics.${key}`);
  nonEmptyString(artifact.semantics.desiredOutcome,"semantics.desiredOutcome");
  nonEmptyString(artifact.semantics.currentState,"semantics.currentState");
  claims(artifact.semantics.requiredBehaviors,"semantics.requiredBehaviors");
  claims(artifact.semantics.invariants,"semantics.invariants");
  claims(artifact.semantics.acceptanceCriteria,"semantics.acceptanceCriteria");
  claims(artifact.semantics.outOfScope,"semantics.outOfScope",{allowEmpty:true});
  stringArray(artifact.semantics.affectedCapabilities,"semantics.affectedCapabilities",{allowEmpty:false});
  stringArray(artifact.semantics.affectedContracts,"semantics.affectedContracts");

  const p=artifact.provenance;
  if(!p||typeof p!=="object"||Array.isArray(p))fail("provenance");
  if(Object.keys(p).some(k=>!["sourceArtifactRefs","evidenceRefs","currentSystemRefs","acceptance"].includes(k)))fail("provenance fields");
  stringArray(p.sourceArtifactRefs,"provenance.sourceArtifactRefs");
  stringArray(p.evidenceRefs,"provenance.evidenceRefs");
  stringArray(p.currentSystemRefs,"provenance.currentSystemRefs",{allowEmpty:false});
  if(!p.acceptance||typeof p.acceptance!=="object"||Array.isArray(p.acceptance))fail("provenance.acceptance");
  if(Object.keys(p.acceptance).some(k=>!["kind","ref"].includes(k)))fail("provenance.acceptance fields");
  if(!["INDEPENDENT_REVIEW","PROMOTED_DECISION","USER_DIRECTIVE","MIGRATION_ADAPTER"].includes(p.acceptance.kind))fail("provenance.acceptance.kind");
  nonEmptyString(p.acceptance.ref,"provenance.acceptance.ref");
  return artifact;
}
