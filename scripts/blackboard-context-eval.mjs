import fs from "node:fs";
import { assertWorkContext, requiredRefs } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "./blackboard-context-board.mjs";

const review={
  kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-EVAL",
  action:{kind:"REVIEW"},
  sourceScope:{read:["required-a","required-b"],write:[],forbiddenWrite:["packages/**"]},
  requiredCurrentSystemRefs:["required-a"],
  requiredInputRefs:["required-b"]
};
const board="BB-EVAL\nstatus: PENDING_REVIEW\ncurrent-context:\n  ref: docs/blackboard/context/BB-EVAL/current.json\nremaining-work:\n";
const scenarios=[];
function run(name,fn){try{fn();scenarios.push({name,pass:true});}catch(e){scenarios.push({name,pass:false,error:e.message});}}
run("fresh-session-exact-ref",()=>assertBoardBinding(parseCurrentContext(board,"BB-EVAL"),review,"docs/blackboard/context/BB-EVAL/current.json"));
run("generation-is-rejected",()=>{let ok=false;try{parseCurrentContext(board.replace("  ref:","  generation: 2\n  ref:"),"BB-EVAL")}catch{ok=true}if(!ok)throw Error("generation escaped")});
run("review-write-rejected",()=>{let ok=false;try{assertWorkContext({...review,sourceScope:{...review.sourceScope,write:["x"]}})}catch{ok=true}if(!ok)throw Error("write escaped")});
run("only-explicit-refs-load",()=>{const r=requiredRefs(review);if(r.length!==2||r.includes("unrelated"))throw Error("unexpected context read")});
run("context-history-fields-rejected",()=>{let ok=false;try{assertWorkContext({...review,staleWhen:["x"]})}catch{ok=true}if(!ok)throw Error("stale/history field escaped")});

const baseline={mode:"repository-scan",loadedRefs:["required-a","required-b","unrelated-history-a","unrelated-history-b"]};
const explicit={mode:"explicit-context",loadedRefs:requiredRefs(review)};
const artifact={
  kind:"BB046_BLACKBOARD_CONTEXT_EVAL",version:2,evidenceClass:"DETERMINISTIC_REPOSITORY_FIXTURE",productionEvidence:false,
  budget:{authorityEscapes:0,contextHistoryEscapes:0,requiredRefOmissions:0,explicitIrrelevantReadsMax:0,explicitLoadedRefsMustBeLessThanRaw:true},
  baseline:{...baseline,loadedRefCount:baseline.loadedRefs.length},
  explicit:{...explicit,loadedRefCount:explicit.loadedRefs.length,irrelevantReadCount:0},
  scenarios,
  result:{
    authorityEscapes:scenarios.filter(x=>!x.pass&&/authority|write/.test(x.name)).length,
    contextHistoryEscapes:scenarios.filter(x=>!x.pass&&/generation|history/.test(x.name)).length,
    allDeterministicControlsPass:scenarios.every(x=>x.pass),
    fewerLoadedRefs:explicit.loadedRefs.length<baseline.loadedRefs.length
  }
};
artifact.result.valueGatePass=artifact.result.allDeterministicControlsPass&&artifact.result.fewerLoadedRefs;
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/bb046-blackboard-context-eval.json",JSON.stringify(artifact,null,2)+"\n");
console.log(JSON.stringify(artifact.result));
if(!artifact.result.valueGatePass) process.exitCode=1;
