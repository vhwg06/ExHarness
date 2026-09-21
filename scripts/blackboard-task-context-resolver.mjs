import fs from "node:fs";
import { assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";
import { assertWorkGraph, readWorkGraph, readComponentRegistry, taskReadiness } from "./blackboard-work-graph.mjs";
import { assertWorkContext } from "./blackboard-context-contract.mjs";

const uniq=(xs)=>[...new Set(xs)];
const fail=(m)=>{throw new Error(`TASK_CONTEXT_INVALID: ${m}`);};

function find(graph,collection,id){
  const value=graph[collection].find(x=>x.id===id);
  if(!value)fail(`missing ${collection}: ${id}`);
  return value;
}

function artifactType(root,ref){
  if(!ref.endsWith(".json"))return null;
  const path=`${root}/${ref}`;
  if(!fs.existsSync(path))return null;
  try{return JSON.parse(fs.readFileSync(path,"utf8")).artifactType??null;}catch{return null;}
}

function implementationRefs(task,root){
  let semanticArtifactRef=null,implementationSpecRef=null;
  for(const ref of task.artifacts.inputRefs){
    const type=artifactType(root,ref);
    if(type==="IMPLEMENTATION_INPUT")semanticArtifactRef=ref;
    if(type==="IMPLEMENTATION_SPEC")implementationSpecRef=ref;
  }
  if(task.kind==="IMPLEMENTATION"&&!semanticArtifactRef)fail(`${task.id} missing IMPLEMENTATION_INPUT`);
  return {semanticArtifactRef,implementationSpecRef};
}

function readSpec(root,ref){
  if(!ref)return null;
  const artifact=JSON.parse(fs.readFileSync(`${root}/${ref}`,"utf8"));
  assertBlackboardArtifact(artifact);
  if(artifact.artifactType!=="IMPLEMENTATION_SPEC")fail(`not IMPLEMENTATION_SPEC: ${ref}`);
  return artifact;
}

export function deriveTaskContext(taskId,{root=".",graph=readWorkGraph(`${root}/docs/blackboard/work-graph.json`),registry=readComponentRegistry(`${root}/docs/blackboard/component-registry.json`)}={}){
  assertWorkGraph(graph,registry);
  const task=find(graph,"tasks",taskId);
  const readiness=taskReadiness(graph,taskId);
  if(task.status!=="ACTIVE"&&!readiness.ready)fail(`${taskId} is not context-resolvable for execution: ${readiness.reason}`);

  const feature=task.featureId?find(graph,"features",task.featureId):null;
  const topic=feature?find(graph,"topics",feature.topicId):null;
  const profiles=task.components.map(id=>{
    const component=registry.components.find(c=>c.id===id);
    if(!component)fail(`unknown component: ${id}`);
    return component;
  });
  const {semanticArtifactRef,implementationSpecRef}=implementationRefs(task,root);
  const implSpec=readSpec(root,implementationSpecRef);

  const dependencyContext=[];
  for(const dep of task.dependencies){
    const producer=find(graph,"tasks",dep.taskId);
    if(producer.status!=="DONE")fail(`dependency not DONE: ${task.id} -> ${producer.id}`);
    dependencyContext.push({
      taskId:producer.id,
      source:"LIVING_CONSOLIDATED",
      refs:[...producer.artifacts.consolidatedRefs]
    });
  }

  const componentCurrentRefs=profiles.flatMap(c=>c.contextProfile.currentSystemRefs);
  const dependencyLivingRefs=dependencyContext.flatMap(d=>d.refs);
  const taskInputRefs=[...task.artifacts.inputRefs];
  const planningRefs=[...(topic?.artifactRefs??[]),...(feature?.artifactRefs??[])];
  const requiredCurrentSystemRefs=uniq([...componentCurrentRefs,...dependencyLivingRefs]);
  const requiredInputRefs=uniq([...taskInputRefs,...planningRefs]);

  const exactExistingSourceRoots=profiles.flatMap(c=>c.contextProfile.sourceRoots);
  const testRoots=profiles.flatMap(c=>c.contextProfile.testRoots);
  const expectedNew=implSpec?.sourceSeams?.expectedNew??[];
  const expectedTests=implSpec?.sourceSeams?.expectedTests??[];
  const sourceRead=uniq([...exactExistingSourceRoots,...testRoots,...expectedNew,...expectedTests]);
  const sourceWrite=uniq([...exactExistingSourceRoots,...expectedNew,...expectedTests]);
  const progressiveSearchRoots=uniq(profiles.flatMap(c=>c.contextProfile.progressiveSearchRoots));
  const contractRefs=uniq(profiles.flatMap(c=>c.contextProfile.contractRefs));

  const context={
    kind:"WORK_CONTEXT_SPEC",
    version:1,
    itemId:task.id,
    taskId:task.id,
    topicId:topic?.id??null,
    featureId:feature?.id??null,
    pipeline:"IMPLEMENTATION_WORKER",
    stage:"READINESS",
    lane:"JUDGMENT",
    judgmentKind:"READINESS",
    action:{
      kind:"REVIEW",
      summary:"Independently judge task readiness from the typed work graph and derived component context.",
      allowedMutations:[],
      forbiddenActions:["mutate product source","claim task execution","expand beyond direct task dependencies without unresolved-context evidence"]
    },
    components:[...task.components],
    dependencyContext,
    semanticArtifactRef,
    ...(implementationSpecRef?{implementationSpecRef}:{}),
    requiredCurrentSystemRefs,
    requiredInputRefs,
    hardInvariants:implSpec?.hardInvariants??[],
    expectedOutputs:[...task.expectedOutputs],
    sourceBaseline:null,
    sourceScope:{read:sourceRead,write:[],forbiddenWrite:["**"]},
    verification:[],
    progressiveDiscovery:{
      mode:"ON_DEMAND_ONLY",
      searchRoots:progressiveSearchRoots,
      contractRefs,
      rule:"Use bounded search only for unresolved context after deterministic refs are loaded."
    }
  };
  return assertWorkContext(context);
}

export function deriveTaskContextSummary(taskId,opts={}){
  const spec=deriveTaskContext(taskId,opts);
  return {
    taskId:spec.taskId,
    topicId:spec.topicId,
    featureId:spec.featureId,
    components:spec.components,
    directDependencies:spec.dependencyContext.map(d=>d.taskId),
    requiredCurrentSystemRefs:spec.requiredCurrentSystemRefs,
    requiredInputRefs:spec.requiredInputRefs,
    progressiveSearchRoots:spec.progressiveDiscovery.searchRoots
  };
}

if(process.argv[1]?.endsWith("blackboard-task-context-resolver.mjs")){
  const taskId=process.argv[2];
  if(!taskId)throw new Error("usage: node scripts/blackboard-task-context-resolver.mjs <TASK_ID>");
  console.log(JSON.stringify(deriveTaskContext(taskId),null,2));
}
