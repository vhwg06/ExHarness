import fs from "node:fs";
import { readJson, assertWorkContext } from "./blackboard-context-contract.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";
import { assertSemanticArtifact, assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";
import { readWorkGraph, readComponentRegistry, assertWorkGraph } from "./blackboard-work-graph.mjs";
import { deriveTaskContext } from "./blackboard-task-context-resolver.mjs";

const fail=(m)=>{throw new Error(m);};
const containsAll=(actual,expected)=>expected.every(x=>actual.includes(x));

export function assertCandidateJudgmentBinding({spec,result,itemId}) {
  if(result.artifactType!=="IMPLEMENTATION_RESULT")
    throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: wrong artifact type");
  const baseline=typeof spec.sourceBaseline==="string"?spec.sourceBaseline:spec.sourceBaseline?.revision;
  if(result.subject.itemId!==itemId ||
     result.subject.semanticArtifactRef!==spec.semanticArtifactRef ||
     result.subject.sourceBaseline!==baseline ||
     result.subject.candidateRef!==spec.reviewTarget?.candidateHeadSha)
    throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: subject mismatch");
  return true;
}

function verifyExecutionAuthority({spec,root}){
  const authority=JSON.parse(fs.readFileSync(`${root}/${spec.authority.ref}`,"utf8"));
  assertBlackboardArtifact(authority);
  if(spec.executionMode==="INITIAL"){
    if(authority.artifactType!=="READINESS_DECISION" || authority.verdict!=="ACCEPT" ||
       authority.subject.itemId!==spec.itemId ||
       authority.subject.semanticArtifactRef!==spec.semanticArtifactRef)
      throw new Error("IMPLEMENT_AUTHORITY_INVALID: readiness decision mismatch");
  }else{
    if(authority.artifactType!=="JUDGMENT" || authority.verdict!=="FINDINGS" ||
       authority.subject.itemId!==spec.itemId ||
       authority.subject.semanticArtifactRef!==spec.semanticArtifactRef)
      throw new Error("REPAIR_AUTHORITY_INVALID: judgment subject/verdict mismatch");
    if(spec.implementationResultRef && authority.subject.implementationResultRef!==spec.implementationResultRef)
      throw new Error("REPAIR_AUTHORITY_INVALID: implementation result mismatch");
  }
}

function verifyTaskProjection({task,spec,root,graph,registry}){
  const seed=deriveTaskContext(task.id,{root,graph,registry});
  if(spec.itemId!==task.id||spec.taskId!==task.id)
    fail("TASK_CONTEXT_BINDING_INVALID: task identity mismatch");
  if(JSON.stringify(spec.components??[])!==JSON.stringify(task.components))
    fail("TASK_CONTEXT_BINDING_INVALID: component set mismatch");
  if(spec.semanticArtifactRef!==seed.semanticArtifactRef)
    fail("TASK_CONTEXT_BINDING_INVALID: semantic artifact mismatch");
  if((spec.implementationSpecRef??null)!==(seed.implementationSpecRef??null))
    fail("TASK_CONTEXT_BINDING_INVALID: implementation spec mismatch");
  if(!containsAll(spec.requiredCurrentSystemRefs,seed.requiredCurrentSystemRefs))
    fail("TASK_CONTEXT_BINDING_INVALID: missing graph-derived current-system refs");
  if(!containsAll(spec.requiredInputRefs,seed.requiredInputRefs))
    fail("TASK_CONTEXT_BINDING_INVALID: missing graph-derived input refs");
  if(JSON.stringify(spec.dependencyContext??[])!==JSON.stringify(seed.dependencyContext))
    fail("TASK_CONTEXT_BINDING_INVALID: direct dependency projection mismatch");
  return seed;
}

function verifyOne({root,task,graph,registry}) {
  const ref=task.currentContextRef;
  const expectedRef=`docs/blackboard/context/${task.id}/current.json`;
  if(ref!==expectedRef) throw new Error(`TASK_CONTEXT_BINDING_INVALID: expected current context ref ${expectedRef}`);
  const spec=readJson(`${root}/${ref}`);
  assertWorkContext(spec);
  if(task.contract){
    const expected=deriveTaskContext(task.id,{root,graph,registry});
    if(JSON.stringify(spec)!==JSON.stringify(expected)) fail('TASK_CONTEXT_BINDING_INVALID: current projection differs from canonical context');
    return {itemId:task.id,binding:{ref},pack:resolveContext(spec,{root}),graphRef:'docs/blackboard/work-graph.json'};
  }
  verifyTaskProjection({task,spec,root,graph,registry});

  if(spec.pipeline==="IMPLEMENTATION_WORKER"){
    const artifact=JSON.parse(fs.readFileSync(`${root}/${spec.semanticArtifactRef}`,"utf8"));
    assertSemanticArtifact(artifact);
    if(spec.lane==="EXECUTION") verifyExecutionAuthority({spec,root});
    if(spec.lane==="JUDGMENT"&&spec.judgmentKind==="CANDIDATE"){
      const result=JSON.parse(fs.readFileSync(`${root}/${spec.implementationResultRef}`,"utf8"));
      assertBlackboardArtifact(result);
      assertCandidateJudgmentBinding({spec,result,itemId:task.id});
    }
  }

  const pack=resolveContext(spec,{root});
  return {itemId:task.id,binding:{ref},pack,graphRef:"docs/blackboard/work-graph.json"};
}

function load({root,graphPath,registryPath}){
  const graph=readWorkGraph(`${root}/${graphPath}`);
  const registry=readComponentRegistry(`${root}/${registryPath}`);
  assertWorkGraph(graph,registry);
  return {graph,registry};
}

export function verifyCurrentContexts({
  root=".",
  graphPath="docs/blackboard/work-graph.json",
  registryPath="docs/blackboard/component-registry.json"
}={}) {
  const {graph,registry}=load({root,graphPath,registryPath});
  const active=graph.tasks.filter(t=>t.status==="ACTIVE");
  return active.map(task=>verifyOne({root,task,graph,registry}));
}

export function verifyCurrentContext({
  root=".",
  itemId=process.env.BLACKBOARD_CONTEXT_ITEM,
  graphPath="docs/blackboard/work-graph.json",
  registryPath="docs/blackboard/component-registry.json"
}={}) {
  const {graph,registry}=load({root,graphPath,registryPath});
  const active=graph.tasks.filter(t=>t.status==="ACTIVE");
  if(itemId){
    const task=active.find(t=>t.id===itemId);
    if(!task)throw new Error(`TASK_CONTEXT_BINDING_INVALID: ${itemId} is not ACTIVE`);
    return verifyOne({root,task,graph,registry});
  }
  if(active.length===0)return {binding:null,pack:{itemId:null,action:"NONE",resolved:[]}};
  if(active.length>1)throw new Error(`TASK_CONTEXT_BINDING_INVALID: multiple active tasks require BLACKBOARD_CONTEXT_ITEM: ${active.map(t=>t.id).join(",")}`);
  return verifyOne({root,task:active[0],graph,registry});
}

if (process.argv[1]?.endsWith("blackboard-context-verify.mjs")) {
  const selected=process.env.BLACKBOARD_CONTEXT_ITEM;
  const out=selected ? [verifyCurrentContext({itemId:selected})] : verifyCurrentContexts();
  console.log(JSON.stringify({ok:true,items:out.map(x=>({itemId:x.pack.itemId,resolved:x.pack.resolved.length}))}));
}
