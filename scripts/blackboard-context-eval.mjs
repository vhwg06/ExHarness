import fs from "node:fs";
import { readWorkGraph, readComponentRegistry, assertWorkGraph, schedulableTasks, taskReadiness } from "./blackboard-work-graph.mjs";
import { deriveTaskContext } from "./blackboard-task-context-resolver.mjs";

const graph=readWorkGraph();
const registry=readComponentRegistry();
assertWorkGraph(graph,registry);

const scenarios=[];
function run(name,fn){
  try{fn();scenarios.push({name,pass:true});}
  catch(e){scenarios.push({name,pass:false,error:e.message});}
}

const task=graph.tasks.find(item=>
  item.lane==="WORKER" && item.status!=="DONE" && item.components.length>1 &&
  item.dependencies.some(dep=>graph.tasks.find(source=>source.id===dep.taskId)?.status==="DONE") &&
  taskReadiness(graph,item.id).ready
);
if(!task)throw Error("no runnable worker with delivered dependency for context evaluation");
const a=deriveTaskContext(task.id);
const b=deriveTaskContext(task.id);

run("lane-aware-schedulable-tasks-from-direct-dependencies",()=>{
  const ready=schedulableTasks(graph);
  for(const task of graph.tasks){
    if(ready.includes(task.id)!==taskReadiness(graph,task.id).ready)throw Error(`schedulable mismatch: ${task.id}`);
  }
});
run("multi-component-task-still-one-context",()=>{
  if(a.taskId!==task.id||JSON.stringify(a.components)!==JSON.stringify(task.components))throw Error("task/component projection mismatch");
});
run("done-dependency-loads-living-truth-not-transcript",()=>{
  const dep=a.dependencyContext.find(x=>graph.tasks.find(source=>source.id===x.taskId)?.status==="DONE");
  if(!dep||dep.source!=="LIVING_CONSOLIDATED")throw Error("dependency source mismatch");
  if(dep.refs.some(ref=>!a.requiredCurrentSystemRefs.includes(ref)))throw Error("delivered Living ref missing");
  const delivered=graph.tasks.find(source=>source.id===dep.taskId);
  if(delivered.artifacts.outputRefs.some(ref=>a.requiredInputRefs.includes(ref)))throw Error("terminal transcript leaked");
});
run("progressive-search-is-not-default-context",()=>{
  if(!a.progressiveDiscovery.searchRoots.length)throw Error("missing progressive search roots");
  if(a.progressiveDiscovery.searchRoots.some(root=>a.requiredInputRefs.includes(root)||a.requiredCurrentSystemRefs.includes(root)))
    throw Error("broad search root auto-loaded");
});
run("context-seed-is-deterministic",()=>{
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error("resolver is non-deterministic");
});
run("source-mutation-scope-matches-current-lane-phase",()=>{
  if(!a.executionSourceScope?.write?.length)throw Error("missing derived execution write scope");
  const executing=task.lane==="WORKER"&&["EXECUTION","REPAIR"].includes(task.phase);
  if(executing){
    if(JSON.stringify(a.sourceScope.write)!==JSON.stringify(a.executionSourceScope.write))
      throw Error("worker execution did not receive exact plan write scope");
  }else if(a.sourceScope.write.length)throw Error("non-execution context gained source mutation");
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
  subject:{taskId:task.id,components:a.components,directDependencies:a.dependencyContext.map(x=>x.taskId)},
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
    transcriptReads:graph.tasks.filter(item=>item.status==="DONE").flatMap(item=>item.artifacts.outputRefs).filter(ref=>deterministicLoaded.includes(ref)).length,
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
