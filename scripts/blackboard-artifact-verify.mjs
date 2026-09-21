import fs from "node:fs";
import path from "node:path";
import { assertBlackboardArtifact } from "./blackboard-artifact-contract.mjs";

function walk(dir){
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const p=path.join(dir,entry.name);
    return entry.isDirectory()?walk(p):[p];
  });
}

export function verifySemanticArtifacts({root="."}={}){
  const dir=path.join(root,"docs/blackboard/artifacts");
  const allowed=new Set(["objective","ready-implement-plan"]);
  if(fs.existsSync(dir)) for(const entry of fs.readdirSync(dir,{withFileTypes:true}))
    if(entry.isDirectory()&&!allowed.has(entry.name)) throw new Error(`BLACKBOARD_ARTIFACT_LAYOUT_INVALID: legacy directory ${entry.name}`);
  const files=walk(dir).filter(p=>p.endsWith(".json"));
  for(const file of files){
    const artifact=JSON.parse(fs.readFileSync(file,"utf8"));
    assertBlackboardArtifact(artifact);
  }
  return files.map(p=>path.relative(root,p).replaceAll("\\","/"));
}

if(process.argv[1]?.endsWith("blackboard-artifact-verify.mjs")){
  const files=verifySemanticArtifacts();
  console.log(JSON.stringify({ok:true,blackboardArtifacts:files.length,files}));
}
