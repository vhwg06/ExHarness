import fs from "node:fs";
import { readJson, assertWorkContext } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, parseItemRef, parseItemScalar, assertBoardBinding } from "./blackboard-context-board.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";
import { assertSemanticArtifact, assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";

function activeSection(board){
  const after=board.split("## Active work")[1] ?? "";
  return after.split(/\n##\s+/)[0] ?? "";
}
function activeItems(board){
  return [...activeSection(board).matchAll(/^BB-\d+\s*$/gm)].map(m=>m[0].trim());
}

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

function verifyOne({board,boardPath,root,itemId}) {
  const binding=parseCurrentContext(board,itemId);
  const spec=readJson(`${root}/${binding.ref}`);
  assertWorkContext(spec);
  assertBoardBinding(binding,spec,binding.ref);
  if(spec.itemId!==itemId) throw new Error("BOARD_BINDING_INVALID: item mismatch");

  if(spec.pipeline==="IMPLEMENTATION_WORKER"){
    const boardArtifactRef=parseItemRef(board,itemId,"implementation-input");
    if(boardArtifactRef!==spec.semanticArtifactRef)
      throw new Error("SEMANTIC_ARTIFACT_BINDING_INVALID: Board/context mismatch");
    const boardLane=parseItemScalar(board,itemId,"lane");
    if(boardLane!==spec.lane)
      throw new Error("IMPLEMENTATION_LANE_BINDING_INVALID: Board/context mismatch");
    const artifact=JSON.parse(fs.readFileSync(`${root}/${spec.semanticArtifactRef}`,"utf8"));
    assertSemanticArtifact(artifact);

    if(spec.lane==="EXECUTION") verifyExecutionAuthority({spec,root});

    if(spec.lane==="JUDGMENT"&&spec.judgmentKind==="CANDIDATE"){
      const boardResultRef=parseItemRef(board,itemId,"implementation-result");
      if(boardResultRef!==spec.implementationResultRef)
        throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: Board/context mismatch");
      const result=JSON.parse(fs.readFileSync(`${root}/${spec.implementationResultRef}`,"utf8"));
      assertBlackboardArtifact(result);
      assertCandidateJudgmentBinding({spec,result,itemId});
    }
  }

  const pack=resolveContext(spec,{root});
  return {itemId,binding,pack,boardPath};
}

export function verifyCurrentContexts({boardPath="docs/blackboard/state.md",root="."}={}) {
  const board=fs.readFileSync(`${root}/${boardPath}`,"utf8");
  const items=activeItems(board);
  if(!items.length) return [];
  const missing=[];
  for(const id of items){
    try { parseCurrentContext(board,id); }
    catch(e) { if(/expected one current-context/.test(e.message)) missing.push(id); else throw e; }
  }
  if(missing.length) throw new Error(`BOARD_BINDING_INVALID: active item(s) missing current-context: ${missing.join(",")}`);
  return items.map(itemId=>verifyOne({board,boardPath,root,itemId}));
}

export function verifyCurrentContext({boardPath="docs/blackboard/state.md",root=".",itemId=process.env.BLACKBOARD_CONTEXT_ITEM}={}) {
  const board=fs.readFileSync(`${root}/${boardPath}`,"utf8");
  const items=activeItems(board);
  if(itemId) {
    if(!items.includes(itemId)) throw new Error(`BOARD_BINDING_INVALID: ${itemId} is not active`);
    return verifyOne({board,boardPath,root,itemId});
  }
  if(items.length===0) return {binding:null,pack:{itemId:null,action:"NONE",resolved:[]}};
  if(items.length>1) throw new Error(`BOARD_BINDING_INVALID: multiple active items require BLACKBOARD_CONTEXT_ITEM: ${items.join(",")}`);
  return verifyOne({board,boardPath,root,itemId:items[0]});
}

if (process.argv[1]?.endsWith("blackboard-context-verify.mjs")) {
  const selected=process.env.BLACKBOARD_CONTEXT_ITEM;
  const out=selected ? [verifyCurrentContext({itemId:selected})] : verifyCurrentContexts();
  console.log(JSON.stringify({ok:true,items:out.map(x=>({itemId:x.pack.itemId,resolved:x.pack.resolved.length}))}));
}
