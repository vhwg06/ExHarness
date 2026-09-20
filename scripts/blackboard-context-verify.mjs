import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readJson, assertWorkContext, assertGeneration } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, parseItemRef, parseItemScalar, assertBoardBinding } from "./blackboard-context-board.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";
import { assertSemanticArtifact, assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";

function git(root,args){return execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();}
function activeSection(board){
  const after=board.split("## Active work")[1] ?? "";
  return after.split(/\n##\s+/)[0] ?? "";
}
function activeItems(board){
  return [...activeSection(board).matchAll(/^BB-\d+\s*$/gm)].map(m=>m[0].trim());
}
function assertReviewTarget(review,{root="."}={}) {
  const target=review.reviewTarget.candidateHeadSha;
  const head=git(root,["rev-parse","HEAD"]);
  let available=true;
  try { git(root,["cat-file","-e",`${target}^{commit}`]); } catch { available=false; }
  if(!available) {
    let firstParent="";
    try { firstParent=git(root,["rev-parse","HEAD^1"]); } catch {}
    if(head!==target && firstParent!==target) throw new Error(`REVIEW_TARGET_UNAVAILABLE: ${target}`);
    return;
  }
  const changed=git(root,["diff","--name-only",target,"HEAD"]).split("\n").filter(Boolean);
  const allowed=new Set(review.reviewTarget.allowedPostTargetEnvelopePaths);
  const bad=changed.filter(p=>!allowed.has(p));
  if(bad.length) throw new Error(`REVIEW_TARGET_STALE: ${bad.join(",")}`);
}
function parseDecision(path) {
  const text=fs.readFileSync(path,"utf8");
  const subjectContextRef=text.match(/subjectContextRef:\s*(\S+)/)?.[1];
  const subjectCandidateHeadSha=text.match(/subjectCandidateHeadSha:\s*(\S+)/)?.[1];
  const verdict=text.match(/verdict:\s*(\S+)/)?.[1];
  return {subjectContextRef,subjectCandidateHeadSha,verdict};
}
export function assertCandidateJudgmentBinding({spec,result,bindingRef,itemId}) {
  if(result.artifactType!=="IMPLEMENTATION_RESULT")
    throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: wrong artifact type");
  const baseline=typeof spec.sourceBaseline==="string"?spec.sourceBaseline:spec.sourceBaseline?.revision;
  if(result.subject.itemId!==itemId ||
     result.subject.semanticArtifactRef!==spec.semanticArtifactRef ||
     result.subject.sourceBaseline!==baseline ||
     result.subject.candidateRef!==spec.reviewTarget?.candidateHeadSha)
    throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: subject mismatch");
  if(result.subject.producerContextRef===bindingRef)
    throw new Error("JUDGMENT_INDEPENDENCE_INVALID: producer and judgment context must differ");
  return true;
}
function verifyOne({board,boardPath,root,itemId}) {
  const binding=parseCurrentContext(board,itemId);
  const spec=readJson(`${root}/${binding.ref}`);
  assertWorkContext(spec);
  assertBoardBinding(binding,spec,binding.ref);
  if(spec.pipeline==="IMPLEMENTATION_WORKER"){
    const boardArtifactRef=parseItemRef(board,itemId,"implementation-input");
    if(boardArtifactRef!==spec.semanticArtifactRef)
      throw new Error("SEMANTIC_ARTIFACT_BINDING_INVALID: Board/context mismatch");
    const boardLane=parseItemScalar(board,itemId,"lane");
    if(boardLane!==spec.lane)
      throw new Error("IMPLEMENTATION_LANE_BINDING_INVALID: Board/context mismatch");
    const artifact=JSON.parse(fs.readFileSync(`${root}/${spec.semanticArtifactRef}`,"utf8"));
    assertSemanticArtifact(artifact);

    if(spec.lane==="JUDGMENT"&&spec.judgmentKind==="CANDIDATE"){
      const boardResultRef=parseItemRef(board,itemId,"implementation-result");
      if(boardResultRef!==spec.implementationResultRef)
        throw new Error("IMPLEMENTATION_RESULT_BINDING_INVALID: Board/context mismatch");
      const result=JSON.parse(fs.readFileSync(`${root}/${spec.implementationResultRef}`,"utf8"));
      assertBlackboardArtifact(result);
      assertCandidateJudgmentBinding({spec,result,bindingRef:binding.ref,itemId});
    }
  }
  if(spec.action.kind==="REVIEW") assertReviewTarget(spec,{root});
  if(spec.action.kind==="IMPLEMENT"){
    const parent=readJson(`${root}/${spec.parentContextRef}`);
    assertWorkContext(parent);
    assertGeneration(parent,spec);
    if(spec.pipeline==="IMPLEMENTATION_WORKER"&&spec.executionMode==="REPAIR"){
      const judgment=JSON.parse(fs.readFileSync(`${root}/${spec.authority.repairJudgmentRef}`,"utf8"));
      assertBlackboardArtifact(judgment);
      if(judgment.artifactType!=="JUDGMENT"||judgment.verdict!=="FINDINGS"||
         judgment.subject.judgmentContextRef!==spec.authority.subjectContextRef||
         judgment.subject.candidateRef!==spec.authority.subjectCandidateHeadSha||
         judgment.subject.semanticArtifactRef!==spec.semanticArtifactRef)
        throw new Error("REPAIR_AUTHORITY_INVALID: judgment subject/verdict mismatch");
      if(parent.reviewTarget?.candidateHeadSha!==spec.authority.subjectCandidateHeadSha)
        throw new Error("REPAIR_AUTHORITY_INVALID: candidate mismatch");
    } else {
      const decision=parseDecision(`${root}/${spec.authority.implementationDecisionRef}`);
      if(decision.verdict!=="ACCEPT"||decision.subjectContextRef!==spec.authority.subjectContextRef||decision.subjectCandidateHeadSha!==spec.authority.subjectCandidateHeadSha)
        throw new Error("IMPLEMENT_AUTHORITY_INVALID: decision subject/verdict mismatch");
      if(parent.reviewTarget?.candidateHeadSha!==spec.authority.subjectCandidateHeadSha)
        throw new Error("IMPLEMENT_AUTHORITY_INVALID: candidate mismatch");
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
  if(items.length===0) return {binding:null,pack:{itemId:null,generation:null,action:"NONE",resolved:[],auditRefs:[]}};
  if(items.length>1) throw new Error(`BOARD_BINDING_INVALID: multiple active items require BLACKBOARD_CONTEXT_ITEM: ${items.join(",")}`);
  return verifyOne({board,boardPath,root,itemId:items[0]});
}

if (process.argv[1]?.endsWith("blackboard-context-verify.mjs")) {
  const selected=process.env.BLACKBOARD_CONTEXT_ITEM;
  const out=selected ? [verifyCurrentContext({itemId:selected})] : verifyCurrentContexts();
  console.log(JSON.stringify({ok:true,items:out.map(x=>({itemId:x.pack.itemId,generation:x.pack.generation,resolved:x.pack.resolved.length}))}));
}
