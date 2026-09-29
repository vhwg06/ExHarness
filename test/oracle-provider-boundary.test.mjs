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
test('dependency and lifecycle authority remain below Oracle boundary',(t)=>{
 assert.doesNotMatch(sources,/from\s*['"][^'"]*(?:core-harness|agentic-system)|import\s*\(['"][^'"]*(?:core-harness|agentic-system)/);
 assert.doesNotMatch(sources,/\b(?:claimWork|publishDelivery|acceptWork|recoverWork|scheduleWork)\s*\(/);
 const pkg=JSON.parse(read('packages/oracle/package.json'));
 for(const name of ['zoekt','serena','solid-lsp','graphiti','cognee'])assert.equal(pkg.dependencies?.[name],undefined);
 assert.doesNotMatch(read('packages/core-harness/src/agent-runtime.js'),/@exharness\/oracle|packages\/oracle/);
 t.diagnostic('runtime dependencies contain no zoekt/serena/solid-lsp/graphiti/cognee; Oracle imports no core-harness/agentic-system and exposes no work lifecycle authority');
});
test('evidence license and pinned reuse decisions remain explicit',(t)=>{
 const research=read('docs/blackboard/process/oracle-context-intelligence-research/BB-062.md');
 for(const [name,license] of [['Zoekt','Apache-2.0'],['Serena','GPL-3.0-or-later'],['SolidLSP','MIT'],['Aider','Apache-2.0'],['Graphiti','Apache-2.0'],['Cognee','Apache-2.0']]){assert.match(research,new RegExp(name));assert.match(research,new RegExp(license));}
 for(const pin of ['sourcegraph/zoekt@','oraios/serena@','Aider-AI/aider@','getzep/graphiti@','topoteretes/cognee@'])assert.match(research,new RegExp(pin));
 assert.match(research,/>=1,000-star/);
 const benchmark=read('scripts/oracle-context-intelligence/bb062-retrieval-benchmark.mjs');
 for(const id of ['Q1','Q2','Q3','Q4'])assert.match(benchmark,new RegExp(`id:'${id}'`));
 assert.match(benchmark,/graphEdges\.push/);assert.match(benchmark,/matchAll/);
 t.diagnostic('reuse Zoekt=ADAPTER_TARGET Apache-2.0 sourcegraph/zoekt@153817f643cde8b229ee388c1dddbcf07f4798af; Serena=REJECT_FULL_APPLICATION GPL-3.0-or-later oraios/serena@7a2968335f2198b966864de1ce3655c8e485a653, SolidLSP=INJECTED_MIT_CAPABILITY MIT; Aider=STRUCTURAL_INSPIRATION_ONLY Apache-2.0 Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c; Graphiti=DEFER_BACKEND Apache-2.0 getzep/graphiti@ba4a9cb32495b6864160616f8dfa2b898f4a500c; Cognee=REJECT_FOUNDATION_DEPENDENCY Apache-2.0 topoteretes/cognee@eb90d03740755f5252b8b12cce91fd09970f2d81; >=1,000-star rule checked 2026-09-27');
});
test('Living Oracle truth limits delivered adapters and planner',()=>{
 const docs=['architecture','state','semantics','workflow'].map(x=>read(`docs/living/system/oracle/${x}.md`)).join('\n');
 assert.match(docs,/SourceCatalog/);assert.match(docs,/RetrievalPlanner/);assert.match(docs,/Zoekt/);assert.match(docs,/Graphiti/);
 for(const pattern of [/not bundled/,/durable resolution cache|durable storage/,/model-assisted planner|Model-assisted planning/,/automatic progressive/])assert.match(docs,pattern);
 assert.doesNotMatch(docs,/BB-\d+/);
});
