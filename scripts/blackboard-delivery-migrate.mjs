import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { read, write, hash, localPath } from './blackboard-delivery-contract.mjs';

const legacyTaskByInput = Object.freeze({
  'BB-048-domain-execution-control.json': 'BB-048',
  'integration-c-cross-domain-obligation-lineage.json': 'BB-052',
  'integration-d-domain-activation-parallel-autonomy.json': 'BB-053',
  'integration-ef-deployment-acceptance-snapshot.json': 'BB-054',
  'integration-g-product-completeness-closure.json': 'BB-055'
});
const legacyTaskBySpec = Object.freeze({
  'integration-b-domain-execution-control.json': 'BB-048',
  'integration-c-cross-domain-obligation-lineage.json': 'BB-052',
  'integration-d-domain-activation-parallel-autonomy.json': 'BB-053',
  'integration-ef-deployment-acceptance-snapshot.json': 'BB-054'
});

function replaceRefs(value, replacements) {
  if (Array.isArray(value)) return value.map(item => replaceRefs(item, replacements));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return replacements.reduce((result, [from, to]) => result.replaceAll(from, to), value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceRefs(child, replacements)]));
}

function rewriteJsonRefs(root, replacements) {
  if (!replacements.length) return;
  const blackboardRoot = localPath(root, 'docs/blackboard');
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const source = fs.readFileSync(target, 'utf8');
        const parsed = JSON.parse(source);
        const rewritten = replaceRefs(parsed, replacements);
        const output = JSON.stringify(rewritten, null, 2) + '\n';
        if (output !== source) fs.writeFileSync(target, output);
      }
    }
  };
  visit(blackboardRoot);
}

function normalizeLegacyArtifactLayout(root) {
  const artifactsRoot = localPath(root, 'docs/blackboard/artifacts');
  const objectiveRoot = localPath(root, 'docs/blackboard/artifacts/objective');
  const planRoot = localPath(root, 'docs/blackboard/artifacts/ready-implement-plan');
  fs.mkdirSync(objectiveRoot, { recursive: true });
  fs.mkdirSync(planRoot, { recursive: true });
  const replacements = [];
  const move = (directory, mapping, suffix, targetRoot) => {
    const sourceRoot = path.join(artifactsRoot, directory);
    if (!fs.existsSync(sourceRoot)) return;
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const taskId = mapping[entry.name];
      if (!taskId) throw new Error(`BLACKBOARD_ARTIFACT_MIGRATION_INVALID: unmapped ${directory}/${entry.name}`);
      const source = path.join(sourceRoot, entry.name);
      const target = path.join(targetRoot, `${taskId}${suffix}.json`);
      if (fs.existsSync(target)) {
        const sourceBody = fs.readFileSync(source);
        const targetBody = fs.readFileSync(target);
        if (!sourceBody.equals(targetBody)) {
          fs.renameSync(source, path.join(targetRoot, `${taskId}${suffix}.legacy.json`));
          replacements.push([`docs/blackboard/artifacts/${directory}/${entry.name}`, `docs/blackboard/artifacts/${path.basename(targetRoot)}/${taskId}${suffix}.legacy.json`]);
        } else {
          fs.unlinkSync(source);
          replacements.push([`docs/blackboard/artifacts/${directory}/${entry.name}`, `docs/blackboard/artifacts/${path.basename(targetRoot)}/${taskId}${suffix}.json`]);
        }
      } else {
        fs.renameSync(source, target);
        replacements.push([`docs/blackboard/artifacts/${directory}/${entry.name}`, `docs/blackboard/artifacts/${path.basename(targetRoot)}/${taskId}${suffix}.json`]);
      }
    }
  };
  move('implementation-input', legacyTaskByInput, '.source', objectiveRoot);
  move('implementation-spec', legacyTaskBySpec, '.source', planRoot);
  move('implementation-result', { 'BB-048.json': 'BB-048' }, '.implementation-result', planRoot);
  move('judgment', { 'BB-048.json': 'BB-048' }, '.judgment', planRoot);
  rewriteJsonRefs(root, replacements);
  for (const directory of ['implementation-input', 'implementation-spec', 'implementation-result', 'judgment']) {
    const dir = path.join(artifactsRoot, directory);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return replacements;
}

function ensureRetainedDonePlan(root, taskId) {
  const objectiveRef=`docs/blackboard/artifacts/objective/${taskId}.json`;
  const planRef=`docs/blackboard/artifacts/ready-implement-plan/${taskId}.json`;
  if (fs.existsSync(localPath(root, objectiveRef)) && fs.existsSync(localPath(root, planRef))) return;
  const input=read(root, `docs/blackboard/artifacts/objective/${taskId}.source.json`);
  const spec=read(root, `docs/blackboard/artifacts/ready-implement-plan/${taskId}.source.json`);
  const objective={
    kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:'OBJECTIVE',artifactId:taskId,
    outcome:input.semantics.desiredOutcome,currentProblem:input.semantics.currentState,
    scope:input.semantics.affectedCapabilities,constraints:input.semantics.invariants.map(x=>x.statement),
    successCriteria:input.semantics.acceptanceCriteria.map(x=>x.statement),
    currentSourceRefs:input.provenance.currentSystemRefs,
    retainedTerminalEvidence:[`docs/blackboard/artifacts/ready-implement-plan/${taskId}.implementation-result.json`,`docs/blackboard/artifacts/ready-implement-plan/${taskId}.judgment.json`]
  };
  const criteria=spec.acceptanceCriteria.map((statement,index)=>({id:`AC-${index+1}`,statement,verificationIds:['retained-verification'],evidenceRequired:['retained terminal evidence']}));
  const plan={
    kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:'READY_IMPLEMENT_PLAN',artifactId:taskId,status:'DRAFT',
    objective:{ref:objectiveRef,hash:hash(objective)},scope:objective.scope,outOfScope:input.semantics.outOfScope.map(x=>x.statement),
    constraints:objective.constraints,invariants:spec.hardInvariants,architectureDecisions:spec.architectureDecisions,
    sourceSeams:spec.sourceSeams,sourceScope:{read:[...new Set([...spec.sourceSeams.requiredExisting,...spec.sourceSeams.expectedTests])],write:[],forbiddenWrite:[]},
    implementationSlices:spec.implementationSlices.map(x=>`${x.id}: ${x.output}`),acceptanceCriteria:criteria,
    invariantCoverage:spec.hardInvariants.map((invariant,index)=>({invariant,criterionIds:[criteria[index%Math.max(criteria.length,1)]?.id??'AC-1']})),
    verificationPlan:[{id:'retained-verification',command:'npm run verify'}],
    retainedTerminalEvidence:true,currentStatus:'DELIVERED',researchGaps:[]
  };
  write(root,objectiveRef,objective);write(root,planRef,plan);
}

export function migrate(root = '.') {
  normalizeLegacyArtifactLayout(root);
  ensureRetainedDonePlan(root, 'BB-048');
  const graph = read(root, 'docs/blackboard/work-graph.json');
  const registry = read(root, 'docs/blackboard/component-registry.json');
  graph.retainedTerminalTaskIds??=graph.tasks.filter(t=>t.status==='DONE'&&!t.contract).map(t=>t.id);
  if (!registry.components.some(c => c.id === 'outer/blackboard')) registry.components.push({ id:'outer/blackboard',contextOwner:'outer/blackboard',contextProfile:{currentSystemRefs:['docs/living/system/state.md'],sourceRoots:['scripts/blackboard-work-graph.mjs','scripts/blackboard-artifact-contract.mjs'],testRoots:['test/blackboard-work-graph.test.mjs'],contractRefs:['docs/blackboard/contracts.md'],progressiveSearchRoots:['scripts/**','test/**','docs/blackboard/**','.github/workflows/**']} });
  if (!graph.tasks.some(t => t.id === 'BB-056')) {
    if(graph.allocation.nextWorkId !== 'BB-056') throw new Error('BB-056 is no longer the next available work id');
    graph.tasks.push({id:'BB-056',featureId:null,title:'Deliver two-lane outer Blackboard with Jev judgment',kind:'IMPLEMENTATION',status:'PLANNED',complexity:'XL',components:['outer/blackboard'],dependencies:[],artifacts:{inputRefs:[],outputRefs:[],consolidatedRefs:[]},expectedOutputs:['OBJECTIVE -> READY_IMPLEMENT_PLAN -> DELIVERED_FEATURE','Jev API/CI judgment and semantic cache','Current-only unfinished work migration'],currentContextRef:null,claim:null});
    graph.allocation.nextWorkId='BB-057';
  }
  for(const task of graph.tasks) {
    if(task.status==='DONE') {
      if(task.id==='BB-048') {
        task.artifacts.inputRefs=['docs/blackboard/artifacts/objective/BB-048.json','docs/blackboard/artifacts/ready-implement-plan/BB-048.json'];
        task.artifacts.outputRefs=['docs/blackboard/artifacts/ready-implement-plan/BB-048.implementation-result.json','docs/blackboard/artifacts/ready-implement-plan/BB-048.judgment.json'];
      }
      continue;
    }
    if(task.contract) continue;
    const artifacts=task.artifacts.inputRefs.filter(r=>r.endsWith('.json')).map(r=>read(root,r));
    const input=artifacts.find(a=>a.artifactType==='IMPLEMENTATION_INPUT');
    const spec=artifacts.find(a=>a.artifactType==='IMPLEMENTATION_SPEC');
    const profiles=task.components.map(id=>registry.components.find(c=>c.id===id).contextProfile);
    const objectiveRef=`docs/blackboard/artifacts/objective/${task.id}.json`;
    const planRef=`docs/blackboard/artifacts/ready-implement-plan/${task.id}.json`;
    const base=(type)=>({kind:'BLACKBOARD_ARTIFACT',version:1,artifactType:type,artifactId:task.id});
    const objective={...base('OBJECTIVE'),outcome:input?.semantics.desiredOutcome??task.title,currentProblem:input?.semantics.currentState??'Outer Blackboard lacks implementable-plan convergence, Jev evaluation and exact delivery enforcement.',scope:input?.semantics.affectedCapabilities??task.expectedOutputs,constraints:input?.semantics.invariants.map(c=>c.statement)??['Exactly RESEARCH_SA and WORKER lanes','Current-only canonical artifacts; retain terminal evidence','Jev owns semantic judgment; producer cannot accept its own output'],successCriteria:input?.semantics.acceptanceCriteria.map(c=>c.statement)??['Research converges only with an implementable plan and SATISFIED readiness claims','Worker converges only when every acceptance claim is SATISFIED and exact candidate exists in main','Normal verification never calls live Jev','Semantic cache prevents unchanged reevaluation','Migration preserves terminal artifacts'],currentSourceRefs:[...new Set(profiles.flatMap(p=>p.currentSystemRefs))]};
    write(root,objectiveRef,objective);
    const own=task.id==='BB-056';
    const sourceRoots=[...new Set(profiles.flatMap(p=>p.sourceRoots))];
    const testRoots=[...new Set(profiles.flatMap(p=>p.testRoots))];
    const invariants=spec?.hardInvariants??objective.constraints;
    const criteria=(input?.semantics.acceptanceCriteria??objective.successCriteria.map((statement,i)=>({id:`AC-${i+1}`,statement}))).map(c=>({...c,verificationIds:['repository-verification'],evidenceRequired:['Passing exact-candidate verification logs and relevant source evidence']}));
    for(let i=0;i<invariants.length;i++) criteria.push({id:`INV-${i+1}`,statement:invariants[i],verificationIds:['repository-verification'],evidenceRequired:['Exact candidate source and negative verification evidence']});
    const seams={requiredExisting:spec?.sourceSeams.requiredExisting??sourceRoots,expectedNew:spec?.sourceSeams.expectedNew??[],expectedTests:spec?.sourceSeams.expectedTests?.length?spec.sourceSeams.expectedTests:testRoots};
    const plan={...base('READY_IMPLEMENT_PLAN'),status:'DRAFT',objective:{ref:objectiveRef,hash:hash(objective)},scope:objective.scope,outOfScope:input?.semantics.outOfScope.map(c=>c.statement)??['Internal agentic application runtime refactor'],constraints:objective.constraints,invariants,architectureDecisions:spec?.architectureDecisions??(own?['Node fetch calls TypeSafe directly; typed choice determines semantic outcome','Graph is routing authority; canonical ref plus content hash binds semantic subject','Publish current artifacts in place; Git is not consumed as context history','CI evaluates separately from normal verification; merge preserves candidate commit']:['RESEARCH REQUIRED: resolve architecture decisions before readiness']),sourceSeams:seams,sourceScope:{read:own?['scripts/**','test/**','docs/**','.github/**','package.json','AGENTS.md']:[...new Set([...sourceRoots,...testRoots,...seams.requiredExisting,...seams.expectedNew,...seams.expectedTests])],write:own?['scripts/**','test/**','docs/blackboard/**','docs/living/system/**','.github/**','package.json','AGENTS.md','.gitignore']:[...new Set([...sourceRoots,...testRoots,...seams.requiredExisting,...seams.expectedNew,...seams.expectedTests])],forbiddenWrite:own?['packages/**']:['docs/blackboard/artifacts/objective/**','docs/blackboard/artifacts/ready-implement-plan/**']},implementationSlices:spec?.implementationSlices.map(s=>`${s.id}: ${s.output}`)??(own?['Contracts and exact binding','Jev materialization, typed validation, cache and metrics','Context routing and current-only migration','CI, merge receipt and regression verification']:['RESEARCH REQUIRED: decompose implementation and resolve source seams']),acceptanceCriteria:criteria,invariantCoverage:invariants.map((invariant,i)=>({invariant,criterionIds:[`INV-${i+1}`]})),verificationPlan:[{id:'repository-verification',command:'npm run verify'}],researchGaps:own?['Live TypeSafe readiness and candidate evaluation require TYPESAFE_API_KEY','Exact candidate must be committed, verified and merged to main before delivery']:['Confirm architecture/source seams against current delivered dependencies','Replace generic verification mapping with criterion-specific commands and evidence; no automatic READY during migration']};
    write(root,planRef,plan);
    const researchBaselineSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    task.contract={objectiveRef,planRef,researchBaselineSha,baselineSha:researchBaselineSha};task.lane='RESEARCH_SA';task.phase='RESEARCH';
    task.artifacts.inputRefs=[objectiveRef,planRef];
    task.status=task.status==='BLOCKED'?'BLOCKED':'PLANNED';task.claim=null;task.currentContextRef=null;
    const context=localPath(root,`docs/blackboard/context/${task.id}/current.json`);
    if(fs.existsSync(context)) fs.unlinkSync(context);
  }
  graph.deliveryContract='OBJECTIVE_PLAN_DELIVERY';
  for(const feature of graph.features) if(feature.status!=='DONE' && feature.taskIds.length===1) feature.acceptanceTaskId??=feature.taskIds[0];
  write(root,'docs/blackboard/component-registry.json',registry);
  write(root,'docs/blackboard/work-graph.json',graph);
  return graph;
}
if(process.argv[1]?.endsWith('blackboard-delivery-migrate.mjs')) migrate();
