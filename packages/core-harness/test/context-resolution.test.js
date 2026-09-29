import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentRuntime, createPredictStrategy, defineContextRequirementBlock, resolveContextRequirementBlocks, defineJudgment } from '../src/index.js';
const block=()=>defineContextRequirementBlock({name:'semantic',trust:'UNTRUSTED',requirement:{need:'source'},project(resolution){if(resolution.status==='UNSATISFIED')throw new Error('unsatisfied');return resolution.value;}});
test('selected requirement is projected to a fixed context block once per call',async()=>{
 let calls=0;const args=[];
 const seen=[];
 const runtime=createAgentRuntime({contextRequirementBlocks:[block()],contextBlocks:[{name:'static',value:'policy'}],contextResolver:{async resolve(requirement,metadata){calls++;args.push({requirement,metadata});return {status:'COMPLETE',value:{revision:calls}};}},judgments:[defineJudgment({name:'check',context:{blocks:['semantic','static']},parseOutput(value){if(typeof value!=='string')throw new TypeError('retry');return value;},strategy:createPredictStrategy({model:{name:'sequence',async generate(request){seen.push(request);return seen.length===1?42:'done';}},maxAttempts:2})})],strategy:{async run(){return 'unselected';}}});
 await runtime.invokeJudgment('check',{x:1},{context:{scope:'repo'}});
 assert.equal(seen.length,2);assert.deepEqual(seen[0].promptContext.blocks.find(b=>b.name==='semantic').value,seen[1].promptContext.blocks.find(b=>b.name==='semantic').value);
 assert.equal(calls,1);assert.deepEqual(args[0].requirement,{need:'source'});assert.deepEqual(args[0].metadata.input,{x:1});assert.deepEqual(args[0].metadata.context,{scope:'repo'});
 await runtime.run({contextSelection:{blocks:['static']}});assert.equal(calls,1);
});
test('judgment selection and failure stop before strategy/model/action',async()=>{
 let executions=0;const runtime=createAgentRuntime({contextRequirementBlocks:[block()],contextResolver:{resolve(){return {status:'UNSATISFIED'};}},judgments:[defineJudgment({name:'check',context:{blocks:['semantic']}})],strategy:{async run(){executions++;return 'bad';}}});
 await assert.rejects(runtime.invokeJudgment('check',{}),/unsatisfied/);assert.equal(executions,0);
 const absent=createAgentRuntime({contextRequirementBlocks:[block()],strategy:{async run(){executions++;}}});
 await assert.rejects(absent.run({contextSelection:{blocks:['semantic']}}),/contextResolver/);assert.equal(executions,0);
 const rejected=createAgentRuntime({contextRequirementBlocks:[block()],contextResolver:{resolve(){throw new Error('source failed');}},strategy:{async run(){executions++;}}});
 await assert.rejects(rejected.run({contextSelection:{blocks:['semantic']}}),/source failed/);assert.equal(executions,0);
});
test('opaque JSON-safe values and duplicate names are enforced',async()=>{
 assert.throws(()=>defineContextRequirementBlock({name:'bad',requirement:{x:()=>1},project:x=>x}),/JSON-safe/);
 assert.throws(()=>createAgentRuntime({contextBlocks:[{name:'same',value:1}],contextRequirementBlocks:[{name:'same',requirement:1,project:x=>x}],strategy:{run(){}}}),/duplicate/);
 await assert.rejects(resolveContextRequirementBlocks({blocks:[block()],selectedNames:['semantic'],resolver:{resolve(){return {value:undefined};}},metadata:{}}),/JSON-safe/);
});
