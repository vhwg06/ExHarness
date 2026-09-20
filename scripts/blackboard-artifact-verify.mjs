import fs from "node:fs";
import path from "node:path";
import { assertSemanticArtifact } from "./blackboard-artifact-contract.mjs";

function walk(dir){
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const p=path.join(dir,entry.name);
    return entry.isDirectory()?walk(p):[p];
  });
}

export function verifySemanticArtifacts({root="."}={}){
  const dir=path.join(root,"docs/blackboard/artifacts");
  const files=walk(dir).filter(p=>p.endsWith(".json"));
  for(const file of files){
    const artifact=JSON.parse(fs.readFileSync(file,"utf8"));
    assertSemanticArtifact(artifact);
  }
  return files.map(p=>path.relative(root,p).replaceAll("\\","/"));
}

if(process.argv[1]?.endsWith("blackboard-artifact-verify.mjs")){
  const files=verifySemanticArtifacts();
  console.log(JSON.stringify({ok:true,semanticArtifacts:files.length,files}));
}
