import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const relative=[
 'packages/core-harness/src/context.js','packages/core-harness/src/agent-runtime.js',
 'packages/agentic-system/src/oracle.js','packages/agentic-system/src/artifact-manifest.js',
 'packages/agentic-system/src/durable-backend-qa.js','packages/core-harness/src/effect-reconciliation.js',
 'scripts/blackboard-jev.mjs','scripts/blackboard-delivery-contract.mjs'
];
const questions=[
 {id:'Q1',query:'bounded prompt context before model generation',relevant:[relative[0],relative[1]]},
 {id:'Q2',query:'QA artifact provenance manifest integrity',relevant:[relative[2],relative[3],relative[4]]},
 {id:'Q3',query:'effect reconciliation non reconcilable replay',relevant:[relative[5]]},
 {id:'Q4',query:'bounded objective scoped JEV research evidence',relevant:[relative[6],relative[7]]}
];
const tokens=value=>[...new Set((value.toLowerCase().match(/[a-z][a-z0-9]+/g)??[]).filter(x=>x.length>2))];
const digest=value=>createHash('sha256').update(value).digest('hex');
const snapshotRef=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const corpus=relative.map(ref=>{const content=fs.readFileSync(path.join(root,ref),'utf8');return {ref,content,bytes:Buffer.byteLength(content),digest:digest(content),tokens:tokens(content),symbols:[...content.matchAll(/(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1])};});
const byRef=new Map(corpus.map(file=>[file.ref,file]));
const setupStart=performance.now();
const graphEdges=[];
for(const file of corpus){
 for(const match of file.content.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)){
  const target=path.normalize(path.join(path.dirname(file.ref),match[1]));
  if(byRef.has(target))graphEdges.push({from:file.ref,to:target,kind:'IMPORTS',sourceRef:`${file.ref}@${snapshotRef}`});
 }
 for(const other of corpus){if(other.ref===file.ref)continue;const shared=file.symbols.filter(symbol=>symbol.length>5&&new RegExp(`\\b${symbol}\\b`).test(other.content));if(shared.length)graphEdges.push({from:other.ref,to:file.ref,kind:'REFERENCES',symbol:shared[0],sourceRef:`${other.ref}@${snapshotRef}`});}
}
const setupMs=performance.now()-setupStart;
const docFrequency=new Map();for(const file of corpus)for(const token of file.tokens)docFrequency.set(token,(docFrequency.get(token)??0)+1);
const weighted=(query,file)=>tokens(query).reduce((sum,term)=>sum+(file.tokens.includes(term)?1+Math.log((corpus.length+1)/(docFrequency.get(term)??1)):0),0);
const symbolScore=(query,file)=>{const q=tokens(query);const names=file.symbols.flatMap(tokens);return q.reduce((sum,t)=>sum+(names.includes(t)?2:0),0)+weighted(query,file)*0.25;};
function rank(arm,query){
 const lexical=new Map(corpus.map(file=>[file.ref,weighted(query,file)]));
 const semantic=new Map(corpus.map(file=>[file.ref,symbolScore(query,file)]));
 const scores=new Map();
 for(const file of corpus){
  let value=arm==='lexical'?lexical.get(file.ref):arm==='semantic/symbol'?semantic.get(file.ref):0;
  if(arm==='structural-map'){
   const linked=graphEdges.filter(edge=>edge.from===file.ref||edge.to===file.ref);
   const neighbor=linked.reduce((sum,edge)=>sum+semantic.get(edge.from===file.ref?edge.to:edge.from)*0.12,0);
   value=semantic.get(file.ref)*0.65+neighbor;
  }
  if(arm==='typed graph/context'){
   const linked=graphEdges.filter(edge=>edge.from===file.ref||edge.to===file.ref);
   const neighbor=linked.reduce((sum,edge)=>sum+lexical.get(edge.from===file.ref?edge.to:edge.from)*0.35,0);
   const relations=linked.reduce((sum,edge)=>sum+tokens(query).filter(t=>tokens(edge.kind+' '+(edge.symbol??'')).includes(t)).length*0.25,0);
   value=lexical.get(file.ref)*0.65+semantic.get(file.ref)*0.35+neighbor+relations;
  }
  scores.set(file.ref,value);
 }
 return [...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([ref,score])=>({ref,score}));
}
const arms=['lexical','semantic/symbol','structural-map','typed graph/context'];const attempts=[];
for(const arm of arms)for(const question of questions){
 const started=performance.now();const top=rank(arm,question.query);const latencyMs=performance.now()-started;
 const hits=top.filter(x=>question.relevant.includes(x.ref));const first=top.findIndex(x=>question.relevant.includes(x.ref));
 const selected=top.map(({ref,score})=>({ref,score,sourceRef:`${ref}@${snapshotRef}`,snapshotRef,contentDigest:byRef.get(ref).digest,bytes:byRef.get(ref).bytes,currentness:{kind:'CONTENT_DIGEST',strength:'STRONG',value:byRef.get(ref).digest}}));
 attempts.push({arm,questionId:question.id,query:question.query,groundTruth:question.relevant,selected,recallAt3:hits.length/question.relevant.length,precisionAt3:hits.length/3,mrr:first<0?0:1/(first+1),materializedBytes:selected.reduce((sum,x)=>sum+x.bytes,0),latencyMs,setupMs,updateCostProxy:{indexedBytes:corpus.reduce((sum,x)=>sum+x.bytes,0),changedFileBytes:byRef.get(relative[0]).bytes},provenanceCoverage:selected.filter(x=>x.sourceRef&&x.contentDigest).length/3,currentnessCoverage:selected.filter(x=>x.currentness.strength==='STRONG'&&x.snapshotRef).length/3});
}
const aggregate=Object.fromEntries(arms.map(arm=>{const rows=attempts.filter(a=>a.arm===arm);const mean=key=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;return [arm,{recallAt3:mean('recallAt3'),precisionAt3:mean('precisionAt3'),mrr:mean('mrr'),materializedBytes:mean('materializedBytes'),latencyMs:mean('latencyMs'),provenanceCoverage:mean('provenanceCoverage'),currentnessCoverage:mean('currentnessCoverage')}];}));
const components=JSON.parse(fs.readFileSync(path.join(root,'docs/blackboard/component-registry.json'))).components;
const workGraph=JSON.parse(fs.readFileSync(path.join(root,'docs/blackboard/work-graph.json')));
const component=id=>components.find(x=>x.id===id),task=id=>workGraph.tasks.find(x=>x.id===id);
const closure=(id,seen=new Set())=>{for(const dep of task(id).dependencies)if(!seen.has(dep.taskId)){seen.add(dep.taskId);closure(dep.taskId,seen);}return [...seen].sort();};
const crossSource=[
 {id:'oracle-infrastructure',answer:{id:'oracle/infrastructure',currentSystemRefs:component('oracle/infrastructure').contextProfile.currentSystemRefs,sourceRoots:component('oracle/infrastructure').contextProfile.sourceRoots,contractRefs:component('oracle/infrastructure').contextProfile.contractRefs}},
 {id:'core-context-resolution',answer:{id:'core/context-resolution',currentSystemRefs:component('core/context-resolution').contextProfile.currentSystemRefs,sourceRoots:component('core/context-resolution').contextProfile.sourceRoots,contractRefs:component('core/context-resolution').contextProfile.contractRefs}},
 {id:'semantic-contract-routing',answer:{id:'BB-061',components:task('BB-061').components,dependencies:task('BB-061').dependencies.map(d=>d.taskId)}},
 {id:'foundation-dependency-closure',answer:{id:'BB-064',direct:task('BB-064').dependencies.map(d=>d.taskId),closure:closure('BB-064')}}
].map(row=>({...row,answerBytes:Buffer.byteLength(JSON.stringify(row.answer))}));
assert.deepEqual(crossSource[2].answer.dependencies,['BB-060']);assert.deepEqual(crossSource[3].answer.closure,['BB-060','BB-061','BB-062','BB-063']);
const rawBytes=Buffer.byteLength(JSON.stringify({components,workGraph}));const meanByteReduction=crossSource.reduce((sum,row)=>sum+1-row.answerBytes/rawBytes,0)/crossSource.length;
assert.ok(meanByteReduction>=0.95,`mean byte reduction ${meanByteReduction} below 0.95`);
assert.equal(attempts.length,16);assert.ok(attempts.every(a=>a.provenanceCoverage===1&&a.currentnessCoverage===1));
const structuralPrimary=aggregate['structural-map'].recallAt3>=aggregate.lexical.recallAt3 && aggregate['structural-map'].mrr>=aggregate.lexical.mrr;
const report={kind:'ORACLE_RETRIEVAL_BENCHMARK',version:1,snapshotRef,corpus:corpus.map(({ref,bytes,digest})=>({ref,bytes,digest})),groundTruth:questions,graphEdges:graphEdges.map(({from,to,kind,sourceRef})=>({from,to,kind,sourceRef})),referenceResearch:{lexicalRecallAt3:0.792,semanticRecallAt3:0.875,structuralRecallAt3:0.750,typedGraphRecallAt3:1},aggregate,attempts,structuralPrimary,crossSource:{rawBytes,queries:crossSource,meanByteReduction},decisions:{zoekt:'ADAPTER_TARGET',serena:'REJECT_FULL_APPLICATION_GPL',solidLsp:'INJECTED_MIT_CAPABILITY',aider:'STRUCTURAL_INSPIRATION_ONLY',graphiti:'DEFER_BACKEND',cognee:'REJECT_FOUNDATION_DEPENDENCY'}};
const compact={
 ...report,
 graphEdges:{count:report.graphEdges.length,sample:[...report.graphEdges.filter(edge=>edge.kind==='IMPORTS').slice(0,3),...report.graphEdges.filter(edge=>edge.kind==='REFERENCES').slice(0,1)]},
 measurementCosts:{setupMs,updateCostProxy:{indexedBytes:corpus.reduce((sum,x)=>sum+x.bytes,0),changedFileBytes:byRef.get(relative[0]).bytes}},
 attempts:report.attempts.map(attempt=>({
  arm:attempt.arm,questionId:attempt.questionId,
  selectedCorpusIndexes:attempt.selected.map(item=>relative.indexOf(item.ref)),
  recallAt3:attempt.recallAt3,precisionAt3:attempt.precisionAt3,mrr:attempt.mrr,
  materializedBytes:attempt.materializedBytes,latencyMs:attempt.latencyMs,
  provenanceCoverage:attempt.provenanceCoverage,currentnessCoverage:attempt.currentnessCoverage
 })),
 selectionIdentityRule:'selectedCorpusIndexes join the ordered corpus digest manifest and top-level snapshotRef; every attempt reports provenance/currentness coverage.'
};
console.log(JSON.stringify(compact));
