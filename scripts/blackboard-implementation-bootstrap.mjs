import fs from "node:fs";
import { verifyCurrentContext } from "./blackboard-context-verify.mjs";
import { materializeContext, CONTEXT_PROFILES } from "./blackboard-context-materialize.mjs";
import { readWorkGraph, readComponentRegistry, assertWorkGraph } from "./blackboard-work-graph.mjs";

export function bootstrapImplementationSession({
  root=".",
  itemId,
  profile=CONTEXT_PROFILES.GENERIC_INTERACTIVE,
  graphPath="docs/blackboard/work-graph.json",
  registryPath="docs/blackboard/component-registry.json"
}={}){
  const graph=readWorkGraph(`${root}/${graphPath}`);
  const registry=readComponentRegistry(`${root}/${registryPath}`);
  assertWorkGraph(graph,registry);
  const implementationItems=graph.tasks.filter(t=>t.status==="ACTIVE"&&(t.contract ? ['RESEARCH_SA','WORKER'].includes(t.lane) : ["IMPLEMENTATION","BUGFIX"].includes(t.kind)));
  if(!implementationItems.length)throw new Error("BLACKBOARD_BOOTSTRAP_INVALID: no active implementation task");
  const selected=itemId??(implementationItems.length===1?implementationItems[0].id:null);
  if(!selected)throw new Error(`BLACKBOARD_BOOTSTRAP_INVALID: multiple implementation tasks require task id: ${implementationItems.map(t=>t.id).join(",")}`);
  const task=implementationItems.find(t=>t.id===selected);
  if(!task)throw new Error(`BLACKBOARD_BOOTSTRAP_INVALID: ${selected} is not an active implementation task`);

  const verified=verifyCurrentContext({root,itemId:selected,graphPath,registryPath});
  const spec=JSON.parse(fs.readFileSync(`${root}/${verified.binding.ref}`,"utf8"));
  const context=materializeContext(spec,{root,profile});
  const lane=spec.lane;
  if(task.contract) return {workId:selected,taskId:selected,pipeline:"IMPLEMENTATION_WORKER",lane,phase:spec.phase,intent:lane==='RESEARCH_SA'?'BUILD_READY_IMPLEMENT_PLAN':'IMPLEMENT_EXACT_READY_PLAN',rules:['Jev is the semantic judge','Do not redefine upstream input','Do not claim delivery before exact candidate exists in main'],context};

  let intent;
  let rules;
  if(lane==="EXECUTION"){
    intent=spec.executionMode==="REPAIR"
      ?"REPAIR_GROUNDED_FINDINGS_AND_PUBLISH_IMPLEMENTATION_RESULT"
      :"EXECUTE_AND_PUBLISH_IMPLEMENTATION_RESULT";
    rules=[
      "produce candidate and observed facts only",
      "do not claim ACCEPT, DONE, correctness or safe-to-merge",
      "do not mutate the semantic implementation input"
    ];
  }else if(spec.judgmentKind==="CANDIDATE"){
    intent="INDEPENDENTLY_JUDGE_EXACT_CANDIDATE";
    rules=[
      "reconstruct judgment from semantic input, exact candidate and evidence",
      "do not mutate product source",
      "do not treat producer reasoning as acceptance authority"
    ];
  }else{
    intent="INDEPENDENTLY_JUDGE_IMPLEMENTATION_READINESS";
    rules=[
      "judge readiness without product-source mutation",
      "do not bypass readiness authority into execution",
      "bind any decision to the exact semantic input being judged"
    ];
  }
  return {workId:selected,taskId:selected,pipeline:"IMPLEMENTATION_WORKER",lane,mode:spec.executionMode??spec.judgmentKind,intent,rules,context};
}

if(process.argv[1]?.endsWith("blackboard-implementation-bootstrap.mjs")){
  const profile=process.argv[2]??CONTEXT_PROFILES.GENERIC_INTERACTIVE;
  const itemId=process.argv[3];
  console.log(JSON.stringify(bootstrapImplementationSession({profile,itemId}),null,2));
}
