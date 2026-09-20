import fs from "node:fs";
import { verifyCurrentContext } from "./blackboard-context-verify.mjs";
import { parseItemScalar } from "./blackboard-context-board.mjs";
import { materializeContext, CONTEXT_PROFILES } from "./blackboard-context-materialize.mjs";

function activeSection(board){
  const after=board.split("## Active work")[1]??"";
  return after.split(/\n##\s+/)[0]??"";
}
function activeItems(board){
  return [...activeSection(board).matchAll(/^BB-\d+\s*$/gm)].map(m=>m[0].trim());
}

export function bootstrapImplementationSession({
  boardPath="docs/blackboard/state.md",
  root=".",
  itemId,
  profile=CONTEXT_PROFILES.GENERIC_INTERACTIVE
}={}){
  const board=fs.readFileSync(`${root}/${boardPath}`,"utf8");
  const implementationItems=activeItems(board).filter(id=>{
    try{return parseItemScalar(board,id,"pipeline")==="IMPLEMENTATION_WORKER";}
    catch{return false;}
  });
  if(!implementationItems.length)throw new Error("BLACKBOARD_BOOTSTRAP_INVALID: no active IMPLEMENTATION_WORKER item");
  const selected=itemId??(implementationItems.length===1?implementationItems[0]:null);
  if(!selected)throw new Error(`BLACKBOARD_BOOTSTRAP_INVALID: multiple implementation items require work id: ${implementationItems.join(",")}`);
  if(!implementationItems.includes(selected))throw new Error(`BLACKBOARD_BOOTSTRAP_INVALID: ${selected} is not an active implementation item`);

  const verified=verifyCurrentContext({boardPath,root,itemId:selected});
  const spec=JSON.parse(fs.readFileSync(`${root}/${verified.binding.ref}`,"utf8"));
  const context=materializeContext(spec,{root,profile});
  const lane=parseItemScalar(board,selected,"lane");
  if(lane!==spec.lane)throw new Error("BLACKBOARD_BOOTSTRAP_INVALID: Board/context lane mismatch");

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
      "bind any decision to this exact context and candidate"
    ];
  }
  return {workId:selected,pipeline:"IMPLEMENTATION_WORKER",lane,mode:spec.executionMode??spec.judgmentKind,intent,rules,context};
}

if(process.argv[1]?.endsWith("blackboard-implementation-bootstrap.mjs")){
  const profile=process.argv[2]??CONTEXT_PROFILES.GENERIC_INTERACTIVE;
  const itemId=process.argv[3];
  console.log(JSON.stringify(bootstrapImplementationSession({profile,itemId}),null,2));
}
