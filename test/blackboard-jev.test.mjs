import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash, read, write, planHash, assertPlan, localPath, assertDeliveryArtifact } from '../scripts/blackboard-delivery-contract.mjs';
import { materialize, evaluate, validateResponse, callJev, assertReady } from '../scripts/blackboard-jev.mjs';
import { publishEvaluation, verifyDelivery, publishDelivery, collectEvidence, importEvaluationEvidence } from '../scripts/blackboard-delivery.mjs';
import { migrate } from '../scripts/blackboard-delivery-migrate.mjs';

function removeFixture(root) {
  const absolute=path.resolve(root);
  if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!/^bb-(jev|migrate)-/.test(path.basename(absolute)))throw new Error('unsafe fixture cleanup');
  fs.rmSync(absolute,{recursive:true,force:true});
}

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-jev-'));
  t.after(()=>removeFixture(root));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(root,'source.js'),'export const answer = 1;\n');
  fs.writeFileSync(path.join(root,'test.js'),'// meaningful fixture source\n');
  fs.mkdirSync(path.join(root,'docs/living/system'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/living/system/state.md'),'# Current system\n\nThe baseline implementation is answer one.\n');
  git('add','.');git('commit','-m','baseline');const baseline=git('rev-parse','HEAD');
  const objective={kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:'OBJECTIVE',artifactId:'BB-1',outcome:'Return two',currentProblem:'Returns one',scope:['answer'],constraints:['Keep interface'],successCriteria:['answer is two'],currentSourceRefs:['source.js']};
  const plan={kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:'READY_IMPLEMENT_PLAN',artifactId:'BB-1',status:'DRAFT',objective:{ref:'objective.json',hash:hash(objective)},scope:['answer'],outOfScope:[],constraints:['Keep interface'],invariants:['export remains'],architectureDecisions:['Change constant'],sourceSeams:{requiredExisting:['source.js'],expectedNew:[],expectedTests:['test.js']},sourceScope:{read:['source.js','test.js','docs/living/**'],write:['source.js','test.js','docs/living/**'],forbiddenWrite:[]},implementationSlices:['Change constant'],livingDocs:{refs:['docs/living/system/state.md'],questionId:'LIVING_DOCS',statement:'Current Living Docs accurately describe the delivered implementation.'},acceptanceCriteria:[{id:'AC1',statement:'answer is two and remains exported',verificationIds:['unit'],evidenceRequired:['unit output']}],invariantCoverage:[{invariant:'export remains',criterionIds:['AC1']}],verificationPlan:[{id:'unit',command:'node --test test.js'}]};
  const task={id:'BB-1',status:'PLANNED',lane:'RESEARCH_SA',phase:'RESEARCH',dependencies:[],components:['outer/blackboard'],artifacts:{inputRefs:['objective.json','plan.json'],outputRefs:[],consolidatedRefs:['docs/living/system/state.md']},contract:{objectiveRef:'objective.json',planRef:'plan.json',researchBaselineSha:baseline}};
  write(root,'objective.json',objective);write(root,'plan.json',plan);write(root,'docs/blackboard/work-graph.json',{tasks:[task],features:[]});
  write(root,'docs/blackboard/jev-policy.json',{model:'jev-1.13.0',policy:'atomic-claims-1',maxPayloadBytes:524288,pricing:null});
  const response=(payload,choice='SATISFIED')=>({model:payload.model,answers:Object.fromEntries(Object.keys(payload.questions).map(id=>[id,{type:'choice',choice,confidence:0.01,probabilities:Object.fromEntries(['SATISFIED','IMPLEMENTATION_DEFECT','INSUFFICIENT_EVIDENCE','PLAN_INPUT_CONTRADICTION'].map(o=>[o,o===choice?1:0]))}])),usage:{input_tokens:100,output_tokens:20}});
  const mock=(choice='SATISFIED')=>async(_url,init)=>new Response(JSON.stringify(response(JSON.parse(init.body),choice)),{status:200});
  const ev=async(choice='SATISFIED')=>evaluate(materialize(root,'BB-1'),{root,apiKey:'fixture',fetchImpl:mock(choice),bypassCache:true});
  const ready=async()=>publishEvaluation(root,'BB-1',await ev());
  const candidate=({updateLivingDocs=true}={})=>{
    fs.writeFileSync(path.join(root,'source.js'),'export const answer = 2;\n');
    if(updateLivingDocs) fs.writeFileSync(path.join(root,'docs/living/system/state.md'),'# Current system\n\nThe delivered implementation returns answer two.\n');
    git('add','source.js','docs/living/system/state.md');git('commit','-m','candidate');
    const candidateSha=git('rev-parse','HEAD');const candidateTree=git('rev-parse','HEAD^{tree}');
    fs.writeFileSync(path.join(root,'run.txt'),'assert.equal(answer, 2): passed\n');
    const p=read(root,'plan.json');
    const evidence={kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:'IMPLEMENTATION_RESULT',artifactId:'BB-1-evidence',plan:{ref:'plan.json',hash:planHash(p)},baselineSha:baseline,candidateSha,candidateTree,verificationRuns:[{id:'unit',command:'node --test test.js',status:'PASSED',exitCode:0,candidateSha,logRef:'run.txt',logHash:hash(fs.readFileSync(path.join(root,'run.txt'),'utf8'))}],claims:[{id:'AC1',evidenceRefs:['run.txt']}]};
    write(root,'evidence.json',evidence);
    const graph=read(root,'docs/blackboard/work-graph.json');Object.assign(graph.tasks[0].contract,{evidenceRef:'evidence.json',candidateSha,baselineSha:baseline});write(root,'docs/blackboard/work-graph.json',graph);
    return {candidateSha,candidateTree};
  };
  return {root,git,baseline,plan,response,mock,ev,ready,candidate};
}

test('readiness batches atomic questions, honors low-confidence typed SATISFIED and caches semantic input',async t=>{
  const f=fixture(t);const input=materialize(f.root,'BB-1');let calls=0;
  const fetchImpl=async(...args)=>{calls++;return f.mock()(...args);};
  const first=await evaluate(input,{root:f.root,apiKey:'fixture',fetchImpl});
  const second=await evaluate(input,{root:f.root,fetchImpl});
  assert.equal(calls,1);assert.equal(second.metrics.cacheHit,true);assert.equal(first.verdict,'SATISFIED');
  const policy=read(f.root,'docs/blackboard/jev-policy.json');policy.maxPayloadBytes*=2;policy.pricing={model:'jev-1.13.0',source:'fixture',date:'2026-09-21',inputPerMillion:1,outputPerMillion:2};write(f.root,'docs/blackboard/jev-policy.json',policy);
  assert.equal(materialize(f.root,'BB-1').cacheKey,input.cacheKey);
  assert.equal(Object.keys(input.payload.questions).length,9);
  const publication=publishEvaluation(f.root,'BB-1',first);
  assert.equal(publication.ref,'docs/blackboard/artifacts/ready-implement-plan/BB-1.readiness-jev-evaluation.json');
  assert.equal(fs.existsSync(path.join(f.root,'docs/blackboard/artifacts/jev-evaluation')),false);
  assert.equal(read(f.root,'plan.json').status,'READY');
  assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].lane,'WORKER');
  assert.doesNotThrow(()=>publishEvaluation(f.root,'BB-1',second));
});
test('plan changes at same ref invalidate readiness and stale publication',async t=>{
  const f=fixture(t);const evaluation=await f.ev();
  const plan=read(f.root,'plan.json');plan.acceptanceCriteria[0].statement='answer is three';write(f.root,'plan.json',plan);
  assert.throws(()=>publishEvaluation(f.root,'BB-1',evaluation),/subject mismatch|stale/);
});
test('objective binding and typed plan invariants fail closed',t=>{
  const f=fixture(t);const p=structuredClone(f.plan);p.acceptanceCriteria.push(p.acceptanceCriteria[0]);assert.throws(()=>assertPlan(p),/duplicate/);
  const obj=read(f.root,'objective.json');obj.outcome='different';write(f.root,'objective.json',obj);
  assert.throws(()=>materialize(f.root,'BB-1'),/stale binding/);
  assert.throws(()=>localPath(f.root,'../secret'),/unsafe/);
});
test('worker evidence binds exact plan, source tree, logs and all claims',async t=>{
  const f=fixture(t);await f.ready();f.candidate();
  assert.equal(materialize(f.root,'BB-1').lane,'WORKER');
  const forged=read(f.root,'evidence.json');forged.verdict='SATISFIED';
  assert.throws(()=>assertDeliveryArtifact(forged),/producer cannot publish/);
  const evidence=read(f.root,'evidence.json');evidence.claims=[];write(f.root,'evidence.json',evidence);
  assert.throws(()=>materialize(f.root,'BB-1'),/evidence claims/);
});
test('worker exit requires a Living Doc update and Jev claim',async t=>{
  const f=fixture(t);await f.ready();f.candidate({updateLivingDocs:false});
  assert.throws(()=>materialize(f.root,'BB-1'),/Living Doc was not updated/);
});
test('readiness cannot authorize a worker without a Living Docs contract',async t=>{
  const f=fixture(t);const plan=read(f.root,'plan.json');delete plan.livingDocs;write(f.root,'plan.json',plan);
  await assert.rejects(()=>f.ready(),/livingDocs/);
});
test('implementation defect repairs worker; plan contradiction returns research and revokes readiness',async t=>{
  const f=fixture(t);await f.ready();f.candidate();
  publishEvaluation(f.root,'BB-1',await f.ev('IMPLEMENTATION_DEFECT'));
  assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].phase,'REPAIR');
  // A changed semantic observation justifies a fresh evaluation, not rerolling the same input.
  fs.writeFileSync(path.join(f.root,'run.txt'),'new contradiction evidence');
  const e=read(f.root,'evidence.json');e.verificationRuns[0].logHash=hash('new contradiction evidence');write(f.root,'evidence.json',e);
  publishEvaluation(f.root,'BB-1',await f.ev('PLAN_INPUT_CONTRADICTION'));
  assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].lane,'RESEARCH_SA');
  assert.equal(read(f.root,'plan.json').status,'DRAFT');
});
test('malformed responses reject missing/extra IDs, invalid types/options/probabilities/model',t=>{
  const f=fixture(t),payload=materialize(f.root,'BB-1').payload;
  for(const mutate of [r=>{delete r.answers[Object.keys(r.answers)[0]];},r=>{r.model='jev-latest';},r=>{r.answers.extra={};},r=>{Object.values(r.answers)[0].type='noul';},r=>{Object.values(r.answers)[0].choice='PASS';},r=>{Object.values(r.answers)[0].probabilities.SATISFIED=0.5;}]){
    const r=f.response(payload);mutate(r);assert.throws(()=>validateResponse(r,payload));
  }
});
test('research evidence is bounded while full-source changes still invalidate semantic cache',t=>{
  const f=fixture(t);
  const largeA='export const answer = 1;\n'+('A'.repeat(12000))+'\nexport function tailMarker() { return 1; }\n';
  fs.writeFileSync(path.join(f.root,'source.js'),largeA);f.git('add','source.js');f.git('commit','-m','large baseline a');
  let graph=read(f.root,'docs/blackboard/work-graph.json');graph.tasks[0].contract.researchBaselineSha=f.git('rev-parse','HEAD');write(f.root,'docs/blackboard/work-graph.json',graph);
  const a=materialize(f.root,'BB-1');
  const sourceA=a.payload.state.evidence.find(item=>item.ref==='source.js');
  assert.equal(sourceA.excerpted,true);assert.ok(sourceA.body.length<2048);assert.equal(sourceA.bytes,Buffer.byteLength(largeA.trimEnd()));

  const middle=5000,changed=2000;const largeB=largeA.slice(0,middle)+'B'.repeat(changed)+largeA.slice(middle+changed);
  fs.writeFileSync(path.join(f.root,'source.js'),largeB);f.git('add','source.js');f.git('commit','-m','large baseline b');
  graph=read(f.root,'docs/blackboard/work-graph.json');graph.tasks[0].contract.researchBaselineSha=f.git('rev-parse','HEAD');write(f.root,'docs/blackboard/work-graph.json',graph);
  const b=materialize(f.root,'BB-1');
  const sourceB=b.payload.state.evidence.find(item=>item.ref==='source.js');
  assert.equal(sourceA.body,sourceB.body);
  assert.notEqual(sourceA.hash,sourceB.hash);
  assert.notEqual(a.cacheKey,b.cacheKey);
  assert.ok(Buffer.byteLength(JSON.stringify(b.payload))<98304);
});
test('API has bounded retry, no auth retry and missing key fails without network',async t=>{
  const f=fixture(t),payload=materialize(f.root,'BB-1').payload;let calls=0;
  const fetchImpl=async()=>{calls++;return new Response('',{status:503});};
  await assert.rejects(()=>callJev(payload,{apiKey:'fixture',fetchImpl,sleep:async()=>{}}),/503/);assert.equal(calls,2);
  calls=0;await assert.rejects(()=>callJev(payload,{apiKey:'fixture',fetchImpl:async()=>{calls++;return new Response('',{status:401});}}),/401/);assert.equal(calls,1);
  await assert.rejects(()=>callJev(payload,{apiKey:'',fetchImpl}),/missing/);assert.equal(calls,1);
});
test('end-to-end only exact candidate in main may publish delivery',async t=>{
  const f=fixture(t);await f.ready();const c=f.candidate();
  const evaluation=await f.ev();
  assert.equal(evaluation.answers.LIVING_DOCS.choice,'SATISFIED');
  publishEvaluation(f.root,'BB-1',evaluation);
  assert.throws(()=>verifyDelivery(f.root,'BB-1',{mainRef:f.baseline,mergeSha:c.candidateSha}));
  const result=publishDelivery(f.root,'BB-1',{mainRef:'refs/heads/main',mergeSha:c.candidateSha});
  assert.equal(result.receipt.candidateSha,c.candidateSha);assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].status,'DONE');
  assert.deepEqual(publishDelivery(f.root,'BB-1',{mergeSha:c.candidateSha}),result);
});
test('timing-only log changes preserve semantic cache identity but substantive evidence invalidates it',async t=>{
  const f=fixture(t);await f.ready();f.candidate();
  const update=text=>{fs.writeFileSync(path.join(f.root,'run.txt'),text);const e=read(f.root,'evidence.json');e.verificationRuns[0].logHash=hash(text);write(f.root,'evidence.json',e);};
  update('pass (1.2ms)\nℹ duration_ms 42\n');const a=materialize(f.root,'BB-1');
  update('pass (8.3ms)\nℹ duration_ms 79\n');const b=materialize(f.root,'BB-1');
  assert.equal(a.cacheKey,b.cacheKey);assert.notEqual(a.subject.evidence.hash,b.subject.evidence.hash);
  update('failure\n');assert.notEqual(materialize(f.root,'BB-1').cacheKey,b.cacheKey);
});
test('current main cannot have reverted an otherwise merged and accepted candidate',async t=>{
  const f=fixture(t);await f.ready();const c=f.candidate();publishEvaluation(f.root,'BB-1',await f.ev());
  fs.writeFileSync(path.join(f.root,'source.js'),'export const answer = 1;');f.git('add','source.js');f.git('commit','-m','revert');
  assert.throws(()=>verifyDelivery(f.root,'BB-1',{mainRef:'refs/heads/main',mergeSha:c.candidateSha}),/no longer exists/);
});
test('delivery permits regenerated control-plane projections after the exact candidate merge',async t=>{
  const f=fixture(t);
  const plan=read(f.root,'plan.json');plan.sourceScope.read.push('docs/blackboard/context/**');plan.sourceScope.write.push('docs/blackboard/context/**');write(f.root,'plan.json',plan);
  await f.ready();
  fs.mkdirSync(path.join(f.root,'docs/blackboard/context/BB-1'),{recursive:true});
  write(f.root,'docs/blackboard/context/BB-1/current.json',{phase:'EXECUTION'});
  f.git('add','docs/blackboard/context/BB-1/current.json');f.git('commit','-m','context projection');
  const c=f.candidate();publishEvaluation(f.root,'BB-1',await f.ev());
  fs.rmSync(path.join(f.root,'docs/blackboard/context/BB-1'),{recursive:true,force:true});
  f.git('add','.');f.git('commit','-m','publication projection');
  const result=verifyDelivery(f.root,'BB-1',{mainRef:'refs/heads/main',mergeSha:c.candidateSha});
  assert.equal(result.receipt.candidateSha,c.candidateSha);
});
test('unresolved research gaps block readiness and verification cannot inherit the provider key',t=>{
  const f=fixture(t);const p=read(f.root,'plan.json');p.researchGaps=['Missing architecture choice'];write(f.root,'plan.json',p);
  assert.throws(()=>materialize(f.root,'BB-1'),/unresolved research/);
  const old=process.env.TYPESAFE_API_KEY;
  try{process.env.TYPESAFE_API_KEY='fixture';assert.throws(()=>collectEvidence(f.root,'BB-1'),/remove TYPESAFE_API_KEY/);}
  finally{if(old===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=old;}
});
test('collector executes the declared command and retains canonical evidence for fresh checkouts',async t=>{
  const f=fixture(t);await f.ready();
  fs.writeFileSync(path.join(f.root,'docs/living/system/state.md'),'# Current system\n\nThe delivered implementation returns answer two.\n');
  f.git('add','objective.json','plan.json','docs/living/system/state.md');f.git('commit','-m','record current plan');
  const candidateSha=f.git('rev-parse','HEAD');
  const graph=read(f.root,'docs/blackboard/work-graph.json');
  Object.assign(graph.tasks[0].contract,{candidateSha,baselineSha:candidateSha});write(f.root,'docs/blackboard/work-graph.json',graph);
  const collected=collectEvidence(f.root,'BB-1');
  assert.equal(collected.ref,'docs/blackboard/artifacts/ready-implement-plan/BB-1.implementation-result.json');
  assert.equal(collected.evidence.verificationRuns[0].candidateSha,candidateSha);
  assert.equal(collected.evidence.verificationRuns[0].exitCode,0);
  assert.ok(fs.readFileSync(path.join(f.root,collected.evidence.verificationRuns[0].logRef),'utf8').includes('exitCode=0'));
  assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].phase,'JUDGMENT');
});
test('CI bundle restores exact canonical evidence before publication and rejects tampered logs',async t=>{
  const f=fixture(t);await f.ready();f.candidate();
  const ref='docs/blackboard/artifacts/ready-implement-plan/BB-1.implementation-result.json',logRef='docs/blackboard/evidence/BB-1/unit.txt';
  const result=read(f.root,'evidence.json');result.verificationRuns[0].logRef=logRef;result.claims[0].evidenceRefs=[logRef];
  fs.mkdirSync(path.dirname(path.join(f.root,logRef)),{recursive:true});fs.copyFileSync(path.join(f.root,'run.txt'),path.join(f.root,logRef));write(f.root,ref,result);
  const graph=read(f.root,'docs/blackboard/work-graph.json');graph.tasks[0].contract.evidenceRef=ref;write(f.root,'docs/blackboard/work-graph.json',graph);
  const evaluation=await f.ev();
  const bundle=path.join(f.root,'bundle');fs.mkdirSync(path.join(bundle,'evidence/BB-1'),{recursive:true});
  write(f.root,'bundle/BB-1-implementation-result.json',result);fs.copyFileSync(path.join(f.root,logRef),path.join(bundle,'evidence/BB-1/unit.txt'));
  fs.unlinkSync(path.join(f.root,ref));fs.unlinkSync(path.join(f.root,logRef));
  importEvaluationEvidence(f.root,'BB-1',evaluation,bundle);publishEvaluation(f.root,'BB-1',evaluation);
  assert.equal(read(f.root,'docs/blackboard/work-graph.json').tasks[0].phase,'MERGE_PENDING');
  fs.writeFileSync(path.join(bundle,'evidence/BB-1/unit.txt'),'tampered');
  assert.throws(()=>importEvaluationEvidence(f.root,'BB-1',evaluation,bundle),/digest mismatch/);
});
test('merged tree changed after candidate cannot claim delivery',async t=>{
  const f=fixture(t);await f.ready();f.candidate();publishEvaluation(f.root,'BB-1',await f.ev());
  fs.writeFileSync(path.join(f.root,'source.js'),'export const answer = 3;');f.git('add','source.js');f.git('commit','-m','changed integration');
  assert.throws(()=>verifyDelivery(f.root,'BB-1',{mainRef:'refs/heads/main',mergeSha:f.git('rev-parse','HEAD')}),/tree differs/);
});
test('migration is idempotent and leaves terminal canonical evidence untouched',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-migrate-'));t.after(()=>removeFixture(root));
  fs.cpSync('docs/blackboard',path.join(root,'docs/blackboard'),{recursive:true});
  const terminal='docs/blackboard/artifacts/ready-implement-plan/BB-048.implementation-result.json';
  const before=fs.readFileSync(path.join(root,terminal));
  const a=migrate(root);const b=migrate(root);assert.deepEqual(a,b);
  assert.deepEqual(fs.readFileSync(path.join(root,terminal)),before);
  assert.ok(a.tasks.filter(t=>t.status!=='DONE').every(t=>t.contract));
});

test('migration normalizes legacy directories and rewrites graph bindings',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-migrate-'));t.after(()=>removeFixture(root));
  fs.cpSync('docs/blackboard',path.join(root,'docs/blackboard'),{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(root,'fixture.txt'),'legacy migration fixture\n');git('add','.');git('commit','-m','baseline');

  const artifacts=path.join(root,'docs/blackboard/artifacts');
  for(const directory of ['implementation-input','implementation-spec','implementation-result','judgment'])
    fs.mkdirSync(path.join(artifacts,directory),{recursive:true});
  fs.renameSync(
    path.join(artifacts,'objective/BB-052.source.json'),
    path.join(artifacts,'implementation-input/integration-c-cross-domain-obligation-lineage.json')
  );
  fs.renameSync(
    path.join(artifacts,'ready-implement-plan/BB-052.source.json'),
    path.join(artifacts,'implementation-spec/integration-c-cross-domain-obligation-lineage.json')
  );
  fs.rmSync(path.join(artifacts,'objective/BB-052.json'));
  fs.rmSync(path.join(artifacts,'ready-implement-plan/BB-052.json'));

  const graph=read(root,'docs/blackboard/work-graph.json');
  const task=graph.tasks.find(item=>item.id==='BB-052');
  delete task.contract;delete task.lane;delete task.phase;
  task.artifacts.inputRefs=[
    'docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage.json',
    'docs/blackboard/artifacts/implementation-spec/integration-c-cross-domain-obligation-lineage.json'
  ];
  write(root,'docs/blackboard/work-graph.json',graph);

  migrate(root);

  for(const directory of ['implementation-input','implementation-spec','implementation-result','judgment'])
    assert.equal(fs.existsSync(path.join(artifacts,directory)),false);
  assert.equal(fs.existsSync(path.join(artifacts,'objective/BB-052.json')),true);
  assert.equal(fs.existsSync(path.join(artifacts,'ready-implement-plan/BB-052.json')),true);
  const migrated=read(root,'docs/blackboard/work-graph.json').tasks.find(item=>item.id==='BB-052');
  assert.deepEqual(migrated.artifacts.inputRefs,[
    'docs/blackboard/artifacts/objective/BB-052.json',
    'docs/blackboard/artifacts/ready-implement-plan/BB-052.json'
  ]);
  assert.equal(read(root,'docs/blackboard/artifacts/ready-implement-plan/BB-052.json').objective.ref,'docs/blackboard/artifacts/objective/BB-052.json');
  assert.doesNotThrow(()=>migrate(root));
});


test('CI selector routes exact research plan candidates from PR heads and merged main commits',t=>{
  const f=fixture(t);
  f.git('add','.');f.git('commit','-m','record research control plane');

  const ciScript=path.resolve('scripts/blackboard-jev-ci.mjs');
  const runSelect=(trustedRoot,subjectRoot,candidateSha)=>{
    const output=path.join(subjectRoot,'jev-select.out');
    fs.rmSync(output,{force:true});
    execFileSync(process.execPath,[ciScript,'select'],{
      cwd:process.cwd(),
      env:{...process.env,WORK_ID:'',CANDIDATE_SHA:candidateSha,TRUSTED_ROOT:trustedRoot,SUBJECT_ROOT:subjectRoot,GITHUB_OUTPUT:output},
      stdio:['ignore','pipe','pipe']
    });
    const line=fs.readFileSync(output,'utf8').trim().split('\n').find(x=>x.startsWith('work='));
    return JSON.parse(line.slice('work='.length));
  };

  const subject=fs.mkdtempSync(path.join(os.tmpdir(),'bb-jev-subject-'));
  t.after(()=>removeFixture(subject));
  fs.cpSync(f.root,subject,{recursive:true});
  const subjectGit=(...args)=>execFileSync('git',args,{cwd:subject,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const branchPlan=read(subject,'plan.json');
  branchPlan.architectureDecisions.push('Bind research CI to the exact plan candidate');
  write(subject,'plan.json',branchPlan);
  subjectGit('add','plan.json');subjectGit('commit','-m','research plan candidate');
  const branchSha=subjectGit('rev-parse','HEAD');
  assert.deepEqual(runSelect(f.root,subject,branchSha),[{id:'BB-1',sha:branchSha}]);

  const mainPlan=read(f.root,'plan.json');
  mainPlan.architectureDecisions.push('Trigger research judgment after merge');
  write(f.root,'plan.json',mainPlan);
  f.git('add','plan.json');f.git('commit','-m','merge research plan');
  const mainSha=f.git('rev-parse','HEAD');
  assert.deepEqual(runSelect(f.root,f.root,mainSha),[{id:'BB-1',sha:mainSha}]);
});

test('CI selector verifies canonical SATISFIED readiness publication instead of reporting fake Jev success',async t=>{
  const f=fixture(t);
  f.git('add','.');f.git('commit','-m','record research control plane');
  const readiness=await f.ev();

  const ciScript=path.resolve('scripts/blackboard-jev-ci.mjs');
  const runSelect=(trustedRoot,subjectRoot,candidateSha)=>{
    const output=path.join(subjectRoot,'jev-select.out');
    fs.rmSync(output,{force:true});
    execFileSync(process.execPath,[ciScript,'select'],{
      cwd:process.cwd(),
      env:{...process.env,WORK_ID:'',CANDIDATE_SHA:candidateSha,TRUSTED_ROOT:trustedRoot,SUBJECT_ROOT:subjectRoot,GITHUB_OUTPUT:output},
      stdio:['ignore','pipe','pipe']
    });
    return Object.fromEntries(fs.readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>{
      const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];
    }));
  };

  const subject=fs.mkdtempSync(path.join(os.tmpdir(),'bb-jev-subject-'));
  t.after(()=>removeFixture(subject));
  fs.cpSync(f.root,subject,{recursive:true});
  const subjectGit=(...args)=>execFileSync('git',args,{cwd:subject,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

  const plan=read(subject,'plan.json');
  const evaluationRef='docs/blackboard/artifacts/ready-implement-plan/BB-1.readiness-jev-evaluation.json';
  plan.status='READY';plan.readinessRef=evaluationRef;write(subject,'plan.json',plan);
  write(subject,evaluationRef,readiness);
  const graph=read(subject,'docs/blackboard/work-graph.json'),task=graph.tasks[0];
  Object.assign(task,{lane:'WORKER',phase:'EXECUTION',status:'PLANNED',claim:null,currentContextRef:null});
  Object.assign(task.contract,{evaluationRef,lastEvaluatedInput:readiness.cacheKey,evidenceRef:'docs/blackboard/artifacts/ready-implement-plan/BB-1.implementation-result.json'});
  write(subject,'docs/blackboard/work-graph.json',graph);
  subjectGit('add','.');subjectGit('commit','-m','publish readiness');
  const publicationSha=subjectGit('rev-parse','HEAD');

  const selected=runSelect(f.root,subject,publicationSha);
  assert.deepEqual(JSON.parse(selected.work),[]);
  assert.deepEqual(JSON.parse(selected.publications),[{id:'BB-1',sha:publicationSha}]);
  assert.equal(selected.trusted_sha,f.git('rev-parse','HEAD'));
  assert.doesNotThrow(()=>execFileSync(process.execPath,[ciScript,'verify-publication'],{
    cwd:process.cwd(),
    env:{...process.env,WORK_ID:'BB-1',CANDIDATE_SHA:publicationSha,TRUSTED_ROOT:f.root,SUBJECT_ROOT:subject},
    stdio:['ignore','pipe','pipe']
  }));

  const forged=read(subject,evaluationRef);forged.verdict='RESEARCH_REQUIRED';write(subject,evaluationRef,forged);
  subjectGit('add',evaluationRef);subjectGit('commit','-m','forge readiness publication');
  const forgedSha=subjectGit('rev-parse','HEAD');
  assert.throws(()=>runSelect(f.root,subject,forgedSha),/research candidate changed trusted routing contract|Command failed/);
});


test('CI separates Blackboard routing from evaluation-only blackboard-jev workflow',()=>{
  const jev=fs.readFileSync('.github/workflows/blackboard-jev.yml','utf8');
  const router=fs.readFileSync('.github/workflows/blackboard-router.yml','utf8');
  assert.match(jev,/name: blackboard-jev/);
  assert.match(jev,/workflow_dispatch:/);
  assert.doesNotMatch(jev,/workflow_run:/);
  assert.match(jev,/name: collect Jev evidence/);
  assert.match(jev,/name: Jev evaluate/);
  assert.doesNotMatch(jev,/no Jev evaluation required|verify published Jev readiness/);
  assert.match(router,/name: blackboard-router/);
  assert.match(router,/workflow_run:/);
  assert.match(router,/name: dispatch Jev/);
  assert.match(router,/gh api --method GET/);
  assert.match(router,/trusted_sha: \$\{\{ steps\.trusted\.outputs\.sha \}\}/);
  assert.match(router,/controller_sha: \$\{\{ steps\.controller\.outputs\.sha \}\}/);
  assert.match(router,/id: trusted/);
  assert.match(router,/node controller\/scripts\/blackboard-jev-ci\.mjs select/);
  assert.match(jev,/controller_sha:/);
  assert.match(jev,/node controller\/scripts\/blackboard-jev-ci\.mjs collect/);
  assert.match(jev,/node controller\/scripts\/blackboard-jev-ci\.mjs evaluate/);
  assert.match(router,/select\(\.head\.sha == \$sha\)/);
  assert.doesNotMatch(router,/git -C trusted merge-base HEAD/);
  assert.doesNotMatch(router,/pull_requests\[0\]\.base\.sha/);
  assert.match(jev,/steps\.trusted\.outputs\.sha/);
  assert.match(router,/blackboard-jev\.yml\/dispatches/);
  assert.match(router,/name: verify published Jev readiness/);
  assert.match(router,/name: no Blackboard judgment required/);
});
