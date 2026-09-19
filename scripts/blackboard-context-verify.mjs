import fs from "node:fs";
import { readJson, assertWorkContext } from "./blackboard-context-contract.mjs";
import { parseCurrentContext, assertBoardBinding } from "./blackboard-context-board.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";

export function verifyCurrentContext({boardPath="docs/living/blackboard.md",root="."}={}) {
  const board=fs.readFileSync(`${root}/${boardPath}`,"utf8");
  const binding=parseCurrentContext(board,"BB-046");
  const spec=readJson(`${root}/${binding.ref}`);
  assertWorkContext(spec);
  assertBoardBinding(binding,spec,binding.ref);
  const pack=resolveContext(spec,{root});
  return {binding,pack};
}

if (process.argv[1]?.endsWith("blackboard-context-verify.mjs")) {
  const out=verifyCurrentContext();
  console.log(JSON.stringify({ok:true,itemId:out.pack.itemId,generation:out.pack.generation,resolved:out.pack.resolved.length}));
}
