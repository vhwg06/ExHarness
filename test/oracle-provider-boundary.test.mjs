import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineContextRequirement,createSourceCatalog} from '../packages/oracle/src/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=ref=>fs.readFileSync(path.join(root,ref),'utf8');
const sources=fs.readdirSync(path.join(root,'packages/oracle/src'),{recursive:true}).filter(x=>x.endsWith('.js')).map(x=>read(`packages/oracle/src/${x}`)).join('\n');
test('provider-neutral caller contract rejects provider commands at every level',()=>{
 const base={consumerRef:'worker',semanticNeed:'Find source',evidence:[{id:'e',necessity:'REQUIRED',need:'Find behavior',source:{kind:'REPOSITORY',ref:'repo',snapshot:{mode:'CURRENT'}}}],budget:{maxItems:1,maxMaterializedBytes:1000,maxProviderCalls:1,maxResolutionSteps:1}};
 for(const field of ['providerId','tool','operation','queryDsl','mcpMethod','claimWork','acceptWork','publishDelivery']){
  assert.throws(()=>defineContextRequirement({...base,[field]:'x'}),/unknown field/);
  assert.throws(()=>defineContextRequirement({...base,evidence:[{...base.evidence[0],[field]:'x'}]}),/unknown field/);
  assert.throws(()=>defineContextRequirement({...base,evidence:[{...base.evidence[0],source:{...base.evidence[0].source,[field]:'x'}}]}),/unknown field/);
 }
 assert.ok(createSourceCatalog().providers().length===0);
});
test('dependency and lifecycle authority remain below Oracle boundary',()=>{
 assert.doesNotMatch(sources,/from\s*['"][^'"]*(?:core-harness|agentic-system)|import\s*\(['"][^'"]*(?:core-harness|agentic-system)/);
 assert.doesNotMatch(sources,/\b(?:claimWork|publishDelivery|acceptWork|recoverWork|scheduleWork)\s*\(/);
 const pkg=JSON.parse(read('packages/oracle/package.json'));
 for(const name of ['zoekt','serena','solid-lsp','graphiti','cognee'])assert.equal(pkg.dependencies?.[name],undefined);
 assert.doesNotMatch(read('packages/core-harness/src/agent-runtime.js'),/@exharness\/oracle|packages\/oracle/);
});
test('evidence license and pinned reuse decisions remain explicit',()=>{
 const research=read('docs/blackboard/process/oracle-context-intelligence-research/BB-062.md');
 for(const [name,license] of [['Zoekt','Apache-2.0'],['Serena','GPL-3.0-or-later'],['SolidLSP','MIT'],['Aider','Apache-2.0'],['Graphiti','Apache-2.0'],['Cognee','Apache-2.0']]){assert.match(research,new RegExp(name));assert.match(research,new RegExp(license));}
 for(const pin of ['sourcegraph/zoekt@','oraios/serena@','Aider-AI/aider@','getzep/graphiti@','topoteretes/cognee@'])assert.match(research,new RegExp(pin));
 assert.match(research,/>=1,000-star/);
 const benchmark=read('scripts/oracle-context-intelligence/bb062-retrieval-benchmark.mjs');
 for(const id of ['Q1','Q2','Q3','Q4'])assert.match(benchmark,new RegExp(`id:'${id}'`));
 assert.match(benchmark,/graphEdges\.push/);assert.match(benchmark,/matchAll/);
});
test('Living Oracle truth limits delivered adapters and planner',()=>{
 const docs=['architecture','state','semantics','workflow'].map(x=>read(`docs/living/system/oracle/${x}.md`)).join('\n');
 assert.match(docs,/SourceCatalog/);assert.match(docs,/RetrievalPlanner/);assert.match(docs,/Zoekt/);assert.match(docs,/Graphiti/);
 for(const pattern of [/not bundled/,/durable resolution cache|durable storage/,/model-assisted planner|Model-assisted planning/,/automatic progressive/])assert.match(docs,pattern);
 assert.doesNotMatch(docs,/BB-\d+/);
});
