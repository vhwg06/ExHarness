import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readJson, assertWorkContext, assertGeneration } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "./blackboard-context-board.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";

function git(root,args){return execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();}
function assertReviewTarget(review,{root="."}={}) {
  git(root,["cat-file","-e",`${review.reviewTarget.candidateHeadSha}^{commit}`]);
  const changed=git(root,["diff","--name-only",review.reviewTarget.candidateHeadSha,"HEAD"]).split("\n").filter(Boolean);
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
  const binding=parseCurrentContext(board,"BB-046");
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
