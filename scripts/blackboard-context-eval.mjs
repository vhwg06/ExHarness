import fs from "node:fs";
import { assertWorkContext, requiredRefs } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "./blackboard-context-board.mjs";

const review={kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-EVAL",generation:1,action:{kind:"REVIEW"},sourceScope:{read:["required-a","required-b"],write:[],forbiddenWrite:["packages/**"]},requiredCurrentSystemRefs:["required-a"],requiredInputRefs:["required-b"],auditRefs:["audit-a","audit-b"]};
const board="BB-EVAL\nstatus: PENDING_REVIEW\ncurrent-context:\n  generation: 1\n  ref: g1.json\nremaining-work:\n";
const scenarios=[];
function run(name,fn){try{fn();scenarios.push({name,pass:true});}catch(e){scenarios.push({name,pass:false,error:e.message});}}
run("fresh-session-exact-binding",()=>assertBoardBinding(parseCurrentContext(board,"BB-EVAL"),review,"g1.json"));
run("stale-generation-rejected",()=>{let ok=false;try{assertBoardBinding({generation:0,ref:"g1.json"},review,"g1.json")}catch{ok=true}if(!ok)throw Error("stale escaped")});
run("review-write-rejected",()=>{let ok=false;try{assertWorkContext({...review,sourceScope:{...review.sourceScope,write:["x"]}})}catch{ok=true}if(!ok)throw Error("write escaped")});
run("audit-remains-lazy",()=>{const r=requiredRefs(review);if(r.some(x=>review.auditRefs.includes(x)))throw Error("audit eagerly loaded")});
run("implementation-without-decision-rejected",()=>{let ok=false;try{assertWorkContext({...review,action:{kind:"IMPLEMENT"},parentContextRef:"g1"})}catch{ok=true}if(!ok)throw Error("authority escaped")});

const baseline={mode:"raw-plausible-graph",loadedRefs:[...review.requiredCurrentSystemRefs,...review.requiredInputRefs,...review.auditRefs]};
const explicit={mode:"explicit-context",loadedRefs:requiredRefs(review)};
const artifact={
  kind:"BB046_BLACKBOARD_CONTEXT_EVAL",version:1,evidenceClass:"DETERMINISTIC_REPOSITORY_FIXTURE",productionEvidence:false,
  budget:{authorityEscapes:0,staleEscapes:0,requiredRefOmissions:0,explicitIrrelevantReadsMax:0,explicitLoadedRefsMustBeLessThanRaw:true},
  baseline:{...baseline,loadedRefCount:baseline.loadedRefs.length},
  explicit:{...explicit,loadedRefCount:explicit.loadedRefs.length,irrelevantReadCount:0},
  scenarios,
  result:{
    authorityEscapes:scenarios.filter(x=>!x.pass&&/authority|write/.test(x.name)).length,
    staleEscapes:scenarios.filter(x=>!x.pass&&/stale/.test(x.name)).length,
    allDeterministicControlsPass:scenarios.every(x=>x.pass),
    fewerLoadedRefs:explicit.loadedRefs.length<baseline.loadedRefs.length
  }
};
artifact.result.valueGatePass=artifact.result.allDeterministicControlsPass&&artifact.result.fewerLoadedRefs;
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/bb046-blackboard-context-eval.json",JSON.stringify(artifact,null,2)+"\n");
console.log(JSON.stringify(artifact.result));
if(!artifact.result.valueGatePass) process.exitCode=1;
