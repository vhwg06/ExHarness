import fs from "node:fs";
import path from "node:path";

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

console.log(JSON.stringify({
  ok:true,
  blackboardFiles:blackboardFiles.length,
  livingFiles:livingFiles.length,
  currentKnowledge:[...allowedKnowledge]
}));
