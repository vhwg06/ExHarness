import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
test('provider-neutral contract keeps Core independent of Oracle',()=>{
 const core=read('packages/core-harness/src/context-resolution.js')+read('packages/core-harness/src/agent-runtime.js');
 assert.doesNotMatch(core,/@exharness\/oracle|packages\/oracle|oracle\/src/);
 const oracle=read('packages/oracle/src/context-contract.js');
 assert.doesNotMatch(oracle,/@exharness\/core|agentic-system|BackendContext|QaContext|acceptanceDecision/);
 for(const field of ['providerId','tool','operation','queryDsl','mcpMethod']) assert.doesNotMatch(read('scripts/oracle-context-intelligence/bb061-contract-compatibility-probe.mjs'),new RegExp(`\\b${field}\\b`));
});
test('evidence and currentness have executable source guards',()=>{
 const source=read('packages/oracle/src/context-contract.js');
 for(const term of ['requiredProvenance','CURRENT','STRONG','BUDGET_EXHAUSTED','previousResolutionId','UNSATISFIED']) assert.match(source,new RegExp(term));
});
test('Living docs state delivered contract and undelivered limits',()=>{
 const oracle=['architecture','state','semantics'].map(x=>read(`docs/living/system/oracle/${x}.md`)).join('\n');
 const core=['architecture','state','workflow'].map(x=>read(`docs/living/system/core-harness/${x}.md`)).join('\n');
 assert.match(oracle,/ContextRequirement\/ContextResolution/);assert.match(core,/injected resolver/);
 assert.match(oracle,/provider catalog|Provider catalog/);assert.match(oracle,/durable/);assert.match(oracle,/automatic progressive|automatically advance/);
 assert.doesNotMatch(oracle+core,/BB-\d+/);
});
