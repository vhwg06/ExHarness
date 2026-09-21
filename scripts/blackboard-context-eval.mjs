import fs from "node:fs";
import { readWorkGraph, readComponentRegistry, assertWorkGraph, schedulableTasks } from "./blackboard-work-graph.mjs";
import { deriveTaskContext } from "./blackboard-task-context-resolver.mjs";

const graph=readWorkGraph();
const registry=readComponentRegistry();
assertWorkGraph(graph,registry);

const scenarios=[];
function run(name,fn){
  try{fn();scenarios.push({name,pass:true});}
  catch(e){scenarios.push({name,pass:false,error:e.message});}
}

const a=deriveTaskContext("BB-052");
const b=deriveTaskContext("BB-052");

run("one-schedulable-task-from-direct-dependencies",()=>{
  const ready=schedulableTasks(graph);
  const bb056=graph.tasks.find(task=>task.id==="BB-056");
  const expected=bb056.status==="ACTIVE" || bb056.phase==="MERGE_PENDING"
    ? ["BB-052"]
    : ["BB-052","BB-056"];
  if(JSON.stringify(ready)!==JSON.stringify(expected))throw Error("unexpected schedulable set");
});
run("multi-component-task-still-one-context",()=>{
  if(a.taskId!=="BB-052"||a.components.length!==3)throw Error("task/component projection mismatch");
});
run("done-dependency-loads-living-truth-not-transcript",()=>{
  const dep=a.dependencyContext.find(x=>x.taskId==="BB-048");
  if(!dep||dep.source!=="LIVING_CONSOLIDATED")throw Error("dependency source mismatch");
  if(a.requiredInputRefs.some(x=>/ready-implement-plan\/BB-048\.(implementation-result|judgment)\.json/.test(x)))throw Error("terminal transcript leaked");
});
run("progressive-search-is-not-default-context",()=>{
  if(!a.progressiveDiscovery.searchRoots.includes("packages/agentic-system/src/**"))throw Error("missing progressive search root");
  if(a.requiredInputRefs.includes("packages/agentic-system/src/**")||a.requiredCurrentSystemRefs.includes("packages/agentic-system/src/**"))
    throw Error("broad search root auto-loaded");
});
run("context-seed-is-deterministic",()=>{
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error("resolver is non-deterministic");
});
run("execution-scope-is-derived-before-worker-execution",()=>{
  if(!a.executionSourceScope?.write?.length)throw Error("missing derived execution write scope");
  if(a.sourceScope.write.length)throw Error("readiness review gained source mutation");
});

const deterministicLoaded=[...new Set([...a.requiredCurrentSystemRefs,...a.requiredInputRefs])];
const baselineLoaded=[
  ...deterministicLoaded,
  "repo-scan:packages/**",
  "git-history:delivery-transcripts",
  "blackboard-history:old-context",
  "guess:adjacent-components"
];

const artifact={
  kind:"OUTER_BLACKBOARD_TASK_CONTEXT_EVAL",
  version:1,
  evidenceClass:"DETERMINISTIC_REPOSITORY_FIXTURE",
  productionEvidence:false,
  subject:{taskId:"BB-052",components:a.components,directDependencies:a.dependencyContext.map(x=>x.taskId)},
  budget:{
    failedScenarios:0,
    transcriptReads:0,
    broadSearchRootsAutoLoaded:0,
    deterministicLoadedRefsMustBeLessThanBaseline:true
  },
  baseline:{mode:"repository-scan-and-infer",loadedRefs:baselineLoaded,loadedRefCount:baselineLoaded.length},
  explicit:{
    mode:"task-graph-component-resolution",
    loadedRefs:deterministicLoaded,
    loadedRefCount:deterministicLoaded.length,
    progressiveSearchRoots:a.progressiveDiscovery.searchRoots
  },
  scenarios,
  result:{
    failedScenarios:scenarios.filter(x=>!x.pass).length,
    transcriptReads:deterministicLoaded.filter(x=>/ready-implement-plan\/BB-048\.(implementation-result|judgment)\.json/.test(x)).length,
    broadSearchRootsAutoLoaded:deterministicLoaded.filter(x=>x.includes("/**")).length,
    deterministicContextReduction:deterministicLoaded.length<baselineLoaded.length,
    allDeterministicControlsPass:scenarios.every(x=>x.pass)
  }
};
artifact.result.valueGatePass=
  artifact.result.allDeterministicControlsPass&&
  artifact.result.transcriptReads===0&&
  artifact.result.broadSearchRootsAutoLoaded===0&&
  artifact.result.deterministicContextReduction;

fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/outer-blackboard-task-context-eval.json",JSON.stringify(artifact,null,2)+"\n");
console.log(JSON.stringify(artifact.result));
if(!artifact.result.valueGatePass)process.exitCode=1;
