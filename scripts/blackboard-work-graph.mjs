import fs from "node:fs";

const fail=(m)=>{throw new Error(`BLACKBOARD_WORK_GRAPH_INVALID: ${m}`);};
const text=(v,l)=>{if(typeof v!=="string"||!v.trim())fail(l);};
const strings=(v,l,{allowEmpty=true}={})=>{if(!Array.isArray(v)||(!allowEmpty&&!v.length)||v.some(x=>typeof x!=="string"||!x.trim()))fail(l);};

export function readWorkGraph(path="docs/blackboard/work-graph.json"){
  return JSON.parse(fs.readFileSync(path,"utf8"));
}
export function readComponentRegistry(path="docs/blackboard/component-registry.json"){
  return JSON.parse(fs.readFileSync(path,"utf8"));
}

export function assertComponentRegistry(registry){
  if(registry?.kind!=="OUTER_BLACKBOARD_COMPONENT_REGISTRY"||registry?.version!==1)fail("component registry kind/version");
  if(!Array.isArray(registry.components)||!registry.components.length)fail("components");
  const ids=new Set(), owners=new Set();
  for(const component of registry.components){
    text(component.id,"component.id");
    text(component.contextOwner,"component.contextOwner");
    if(ids.has(component.id))fail(`duplicate component: ${component.id}`);
    if(owners.has(component.contextOwner))fail(`duplicate context owner: ${component.contextOwner}`);
    ids.add(component.id); owners.add(component.contextOwner);
    const p=component.contextProfile;
    if(!p||typeof p!=="object"||Array.isArray(p))fail(`contextProfile: ${component.id}`);
    for(const key of ["currentSystemRefs","sourceRoots","testRoots","contractRefs","progressiveSearchRoots"]) strings(p[key],`${component.id}.${key}`);
  }
  return registry;
}

function assertAcyclic(tasks){
  const byId=new Map(tasks.map(t=>[t.id,t]));
  const visiting=new Set(), done=new Set();
  const visit=(id)=>{
    if(done.has(id))return;
    if(visiting.has(id))fail(`task dependency cycle at ${id}`);
    visiting.add(id);
    for(const dep of byId.get(id).dependencies)visit(dep.taskId);
    visiting.delete(id); done.add(id);
  };
  for(const task of tasks)visit(task.id);
}

export function assertWorkGraph(graph,registry){
  assertComponentRegistry(registry);
  if(graph?.kind!=="OUTER_BLACKBOARD_WORK_GRAPH"||graph?.version!==1)fail("work graph kind/version");
  text(graph.phase,"phase");
  if(!Array.isArray(graph.topics)||!graph.topics.length)fail("topics");
  if(!Array.isArray(graph.features))fail("features");
  if(!Array.isArray(graph.tasks)||!graph.tasks.length)fail("tasks");

  const topicIds=new Set(), featureIds=new Set(), taskIds=new Set();
  for(const topic of graph.topics){
    text(topic.id,"topic.id"); text(topic.title,"topic.title");
    if(topicIds.has(topic.id))fail(`duplicate topic: ${topic.id}`);
    topicIds.add(topic.id); strings(topic.featureIds,"topic.featureIds"); strings(topic.artifactRefs,"topic.artifactRefs");
  }
  for(const feature of graph.features){
    text(feature.id,"feature.id"); text(feature.topicId,"feature.topicId"); text(feature.title,"feature.title");
    if(!["FEATURE","BUG"].includes(feature.kind))fail(`feature kind: ${feature.id}`);
    if(featureIds.has(feature.id))fail(`duplicate feature: ${feature.id}`);
    if(!topicIds.has(feature.topicId))fail(`unknown feature topic: ${feature.id}`);
    featureIds.add(feature.id); strings(feature.taskIds,"feature.taskIds"); strings(feature.artifactRefs,"feature.artifactRefs");
  }

  const componentIds=new Set(registry.components.map(c=>c.id));
  for(const task of graph.tasks){
    if(!/^BB-\d+$/.test(task.id||""))fail(`task id: ${task.id}`);
    if(taskIds.has(task.id))fail(`duplicate task: ${task.id}`);
    taskIds.add(task.id);
    if(task.contract){
      if(!['RESEARCH_SA','WORKER'].includes(task.lane))fail('delivery lane');
      const phases=task.lane==='RESEARCH_SA'?['RESEARCH','JUDGMENT']:['EXECUTION','REPAIR','JUDGMENT','MERGE_PENDING','DELIVERED'];
      if(!phases.includes(task.phase))fail('delivery phase');
      for(const k of ['objectiveRef','planRef'])text(task.contract[k],`contract.${k}`);
      if(!/^[a-f0-9]{40}$/.test(task.contract.researchBaselineSha??''))fail('exact research baseline required');
      if(task.status==='DONE'&&(!task.contract.deliveryRef||task.phase!=='DELIVERED'))fail('DONE requires delivery receipt');
    }else if(graph.deliveryContract==='OBJECTIVE_PLAN_DELIVERY' && (task.status!=='DONE'||!graph.retainedTerminalTaskIds?.includes(task.id)))fail('only retained terminal work may omit delivery contract');
    if(task.featureId!=null&&!featureIds.has(task.featureId))fail(`unknown task feature: ${task.id}`);
    text(task.title,"task.title");
    if(!["IMPLEMENTATION","RESEARCH","REVIEW","BUGFIX"].includes(task.kind))fail(`task kind: ${task.id}`);
    if(!["PLANNED","ACTIVE","DONE","BLOCKED"].includes(task.status))fail(`task status: ${task.id}`);
    if(!["S","M","L","XL"].includes(task.complexity))fail(`task complexity: ${task.id}`);
    strings(task.components,"task.components",{allowEmpty:false});
    for(const id of task.components)if(!componentIds.has(id))fail(`unknown component ${id} on ${task.id}`);
    if(!Array.isArray(task.dependencies))fail(`task dependencies: ${task.id}`);
    for(const dep of task.dependencies){
      text(dep.taskId,`dependency taskId: ${task.id}`);
      strings(dep.requires,`dependency requires: ${task.id}`,{allowEmpty:false});
      if(dep.taskId===task.id)fail(`self dependency: ${task.id}`);
    }
    const a=task.artifacts;
    if(!a||typeof a!=="object")fail(`task artifacts: ${task.id}`);
    for(const key of ["inputRefs","outputRefs","consolidatedRefs"])strings(a[key],`${task.id}.artifacts.${key}`);
    strings(task.expectedOutputs,`${task.id}.expectedOutputs`);
    if(task.status==="DONE"&&!a.consolidatedRefs.length)fail(`DONE task requires consolidatedRefs: ${task.id}`);
    if(task.status==="ACTIVE"){
      if(!task.currentContextRef)fail(`ACTIVE task requires currentContextRef: ${task.id}`);
      if(!task.claim?.workerId)fail(`ACTIVE task requires one worker claim: ${task.id}`);
    }else{
      if(task.currentContextRef!=null)fail(`non-ACTIVE task cannot have currentContextRef: ${task.id}`);
      if(task.claim!=null)fail(`non-ACTIVE task cannot have claim: ${task.id}`);
    }
  }

  for(const feature of graph.features){
    if(graph.deliveryContract==='OBJECTIVE_PLAN_DELIVERY' && feature.status!=='DONE'){
      if(!feature.taskIds.includes(feature.acceptanceTaskId))fail(`feature requires acceptance task: ${feature.id}`);
      const acceptance=graph.tasks.find(t=>t.id===feature.acceptanceTaskId);
      if(feature.taskIds.length>1 && feature.taskIds.filter(id=>id!==feature.acceptanceTaskId).some(id=>!acceptance?.dependencies.some(d=>d.taskId===id)))fail('feature acceptance task must depend on all implementation tasks');
    }
    for(const id of feature.taskIds){
      const task=graph.tasks.find(t=>t.id===id);
      if(!task)fail(`feature references unknown task: ${feature.id} -> ${id}`);
      if(task.featureId!==feature.id)fail(`feature/task backref mismatch: ${feature.id} -> ${id}`);
    }
  }
  for(const topic of graph.topics){
    for(const id of topic.featureIds){
      const feature=graph.features.find(f=>f.id===id);
      if(!feature)fail(`topic references unknown feature: ${topic.id} -> ${id}`);
      if(feature.topicId!==topic.id)fail(`topic/feature backref mismatch: ${topic.id} -> ${id}`);
    }
  }
  for(const task of graph.tasks)for(const dep of task.dependencies)if(!taskIds.has(dep.taskId))fail(`unknown dependency: ${task.id} -> ${dep.taskId}`);
  assertAcyclic(graph.tasks);

  if(graph.allocation?.executionUnit!=="TASK"||graph.allocation?.contextRoutingUnit!=="COMPONENT"||graph.allocation?.workerOwnership!=="ONE_TASK_PER_CLAIM")
    fail("allocation invariants");
  if(!/^BB-\d+$/.test(graph.allocation?.nextWorkId||""))fail("allocation.nextWorkId");
  const max=Math.max(...[...taskIds].map(id=>Number(id.slice(3))));
  if(Number(graph.allocation.nextWorkId.slice(3))<=max)fail("nextWorkId must be above all task ids");
  return graph;
}

export function taskReadiness(graph,taskId){
  const task=graph.tasks.find(t=>t.id===taskId);
  if(!task)fail(`unknown task: ${taskId}`);
  if(task.status!=="PLANNED")return {taskId,ready:false,reason:`STATUS_${task.status}`};
  if(task.contract){
    const schedulablePhases=task.lane==='RESEARCH_SA'?['RESEARCH']:['EXECUTION','REPAIR'];
    if(!schedulablePhases.includes(task.phase))return {taskId,ready:false,reason:`PHASE_${task.phase}`};
  }
  const byId=new Map(graph.tasks.map(t=>[t.id,t]));
  const blockedBy=task.dependencies.filter(d=>byId.get(d.taskId)?.status!=="DONE").map(d=>d.taskId);
  return blockedBy.length?{taskId,ready:false,reason:"DEPENDENCIES_NOT_DONE",blockedBy}:{taskId,ready:true,reason:"DIRECT_DEPENDENCIES_DONE",blockedBy:[]};
}

export function schedulableTasks(graph){
  return graph.tasks.filter(t=>taskReadiness(graph,t.id).ready).map(t=>t.id);
}

if(process.argv[1]?.endsWith("blackboard-work-graph.mjs")){
  const graph=readWorkGraph();
  const registry=readComponentRegistry();
  assertWorkGraph(graph,registry);
  console.log(JSON.stringify({ok:true,phase:graph.phase,schedulable:schedulableTasks(graph),tasks:graph.tasks.length,components:registry.components.length}));
}
