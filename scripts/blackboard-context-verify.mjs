import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readJson, assertWorkContext, assertGeneration } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "./blackboard-context-board.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";

function git(root,args){return execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();}
function assertReviewTarget(review,{root="."}={}) {
  const target=review.reviewTarget.candidateHeadSha;
  const head=git(root,["rev-parse","HEAD"]);
  // PR CI commonly checks out a synthetic merge commit and may not fetch every
  // intermediate branch object. The immutable target is still verifiable when
  // HEAD is that target or HEAD's first parent is that target.
  let available=true;
  try { git(root,["cat-file","-e",`${target}^{commit}`]); } catch { available=false; }
  if(!available) {
    let firstParent="";
    try { firstParent=git(root,["rev-parse","HEAD^1"]); } catch {}
    if(head!==target && firstParent!==target)
      throw new Error(`REVIEW_TARGET_UNAVAILABLE: ${target}`);
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

export function verifyCurrentContext({boardPath="docs/living/blackboard.md",root="."}={}) {
  const board=fs.readFileSync(`${root}/${boardPath}`,"utf8");
  const activeSection=board.split("## Active work")[1]?.split("## Integration entry rule")[0] ?? "";
  const activeItems=[...activeSection.matchAll(/^BB-\d+$/gm)].map(match=>match[0]);
  const itemId=process.env.BLACKBOARD_CONTEXT_ITEM || activeSection.match(/^BB-\d+\n[\s\S]*?current-context:/m)?.[0]?.match(/^BB-\d+/)?.[0];
  if(!itemId) {
    if(activeItems.length) throw new Error(`BOARD_BINDING_INVALID: active item(s) missing current-context: ${activeItems.join(",")}`);
    return {binding:null,pack:{itemId:null,generation:null,action:"NONE",resolved:[],auditRefs:[]}};
  }
  const binding=parseCurrentContext(board,itemId);
  const spec=readJson(`${root}/${binding.ref}`);
  assertWorkContext(spec);
  assertBoardBinding(binding,spec,binding.ref);
  if(spec.action.kind==="REVIEW") assertReviewTarget(spec,{root});
  if(spec.action.kind==="IMPLEMENT"){
    const parent=readJson(`${root}/${spec.parentContextRef}`);
    assertWorkContext(parent);
    assertGeneration(parent,spec);
    const decision=parseDecision(`${root}/${spec.authority.implementationDecisionRef}`);
    if(decision.verdict!=="ACCEPT"||decision.subjectContextRef!==spec.authority.subjectContextRef||decision.subjectCandidateHeadSha!==spec.authority.subjectCandidateHeadSha)
      throw new Error("IMPLEMENT_AUTHORITY_INVALID: decision subject/verdict mismatch");
    if(parent.reviewTarget?.candidateHeadSha!==spec.authority.subjectCandidateHeadSha)
      throw new Error("IMPLEMENT_AUTHORITY_INVALID: candidate mismatch");
  }
  const pack=resolveContext(spec,{root});
  return {binding,pack};
}

if (process.argv[1]?.endsWith("blackboard-context-verify.mjs")) {
  const out=verifyCurrentContext();
  console.log(JSON.stringify({ok:true,itemId:out.pack.itemId,generation:out.pack.generation,resolved:out.pack.resolved.length}));
}
