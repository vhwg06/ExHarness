import fs from "node:fs";
import path from "node:path";
import { readWorkGraph, readComponentRegistry, assertWorkGraph } from "./blackboard-work-graph.mjs";
import { verifyStateProjection } from "./blackboard-state-project.mjs";

const root=process.cwd();
const fail=(message)=>{throw new Error(`CURRENT_DOCS_INVALID: ${message}`);};

function walk(rel){
  const abs=path.join(root,rel);
  if(!fs.existsSync(abs))return [];
  return fs.readdirSync(abs,{withFileTypes:true}).flatMap(entry=>{
    const child=path.join(rel,entry.name).replaceAll("\\","/");
    return entry.isDirectory()?walk(child):[child];
  });
}

const blackboardFiles=walk("docs/blackboard");
const livingFiles=walk("docs/living");
const docsFiles=[...blackboardFiles,...livingFiles];

for(const required of [
  "docs/blackboard/work-graph.json",
  "docs/blackboard/component-registry.json",
  "docs/blackboard/state.md"
]){
  if(!blackboardFiles.includes(required))fail(`missing canonical outer Blackboard file: ${required}`);
}
assertWorkGraph(readWorkGraph("docs/blackboard/work-graph.json"),readComponentRegistry("docs/blackboard/component-registry.json"));
verifyStateProjection("docs/blackboard/state.md");

const requiredTaskArtifacts=[
  "docs/blackboard/artifacts/objective/BB-048.json",
  "docs/blackboard/artifacts/objective/BB-052.json",
  "docs/blackboard/artifacts/objective/BB-053.json",
  "docs/blackboard/artifacts/objective/BB-054.json",
  "docs/blackboard/artifacts/objective/BB-055.json",
  "docs/blackboard/artifacts/objective/BB-056.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-048.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-052.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-053.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-054.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-055.json",
  "docs/blackboard/artifacts/ready-implement-plan/BB-056.json"
];
for(const file of requiredTaskArtifacts){
  if(!blackboardFiles.includes(file))fail(`missing canonical implementation spec: ${file}`);
}

for(const file of docsFiles){
  const base=path.basename(file);
  if(/(?:^|[-_])g\d{4}(?:[-_.]|$)/i.test(base))
    fail(`generation-versioned current doc: ${file}`);
  if(/-v\d+(?=\.(?:md|json)$)/i.test(base))
    fail(`version-sibling current doc: ${file}`);
}

if(blackboardFiles.some(file=>file.startsWith("docs/blackboard/history/")))
  fail("docs/blackboard/history is not part of current tree");

const contextFiles=blackboardFiles.filter(file=>file.startsWith("docs/blackboard/context/"));
for(const file of contextFiles){
  if(file==="docs/blackboard/context/README.md")continue;
  if(!/^docs\/blackboard\/context\/BB-\d+\/current\.json$/.test(file))
    fail(`non-canonical Blackboard context file: ${file}`);
}

const knowledgeFiles=livingFiles.filter(file=>file.startsWith("docs/living/knowledge/"));
const allowedKnowledge=new Set([
  "docs/living/knowledge/integration-phase-research-to-implementation-readiness.md"
]);
for(const file of knowledgeFiles){
  if(!allowedKnowledge.has(file))
    fail(`non-current Living knowledge file: ${file}`);
}
for(const file of allowedKnowledge){
  if(!livingFiles.includes(file))fail(`missing canonical Living knowledge: ${file}`);
}
const roadmapPath="docs/living/knowledge/integration-phase-research-to-implementation-readiness.md";
const roadmap=fs.readFileSync(path.join(root,roadmapPath),"utf8");
for(const staleMarker of [
  "PROPOSED / AWAITING INDEPENDENT REVIEW",
  "After A.1 code exists",
  "first derived implementation seam",
  "Điểm làm đầu tiên"
]){
  if(roadmap.includes(staleMarker))
    fail(`historical roadmap transcript leaked into current roadmap: ${staleMarker}`);
}

const decisionFiles=livingFiles.filter(file=>file.startsWith("docs/living/decisions/"));
const allowedDecisions=new Set([
  "docs/living/decisions/README.md"
]);
for(const file of decisionFiles){
  if(!allowedDecisions.has(file))
    fail(`non-current Living decision file: ${file}`);
}
for(const file of allowedDecisions){
  if(!livingFiles.includes(file))fail(`missing Living decisions policy: ${file}`);
}

for(const file of livingFiles.filter(file=>file.endsWith(".md"))){
  const body=fs.readFileSync(path.join(root,file),"utf8");
  if(/\bBB-\d+\b/.test(body))
    fail(`delivery-work id leaked into current Living Docs: ${file}`);
  if(/\bD0\d+\b/.test(body))
    fail(`delivery-decision id leaked into current Living Docs: ${file}`);
  for(const legacy of [
    "docs/living/work-context/",
    "docs/blackboard/history/",
    "parentContextRef",
    "staleWhen",
    "auditRefs"
  ]){
    if(body.includes(legacy))
      fail(`legacy delivery/context history leaked into current Living Docs: ${file} -> ${legacy}`);
  }
  if(/WORK_CONTEXT_SPEC[^\n]{0,80}\bgeneration\b/i.test(body))
    fail(`legacy versioned helper-context semantics leaked into current Living Docs: ${file}`);
}

console.log(JSON.stringify({
  ok:true,
  blackboardFiles:blackboardFiles.length,
  livingFiles:livingFiles.length,
  currentKnowledge:[...allowedKnowledge],
  currentDecisionPolicy:[...allowedDecisions]
}));
