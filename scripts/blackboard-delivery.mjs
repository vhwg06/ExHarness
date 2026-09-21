import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertDeliveryArtifact, assertBinding, read, write, localPath, hash, canonical, planHash, loadSubject, fail } from './blackboard-delivery-contract.mjs';
import { materialize, validateEvaluation, assertReady, git } from './blackboard-jev.mjs';

// These projections are rebuilt by the trusted controller during publication.
// They are bindings/evidence, not product source that a merge must preserve.
export const isMutableControlRef = ref =>
  ref === 'docs/blackboard/state.md' ||
  ref === 'docs/blackboard/work-graph.json' ||
  ref.startsWith('docs/blackboard/context/') ||
  ref.startsWith('docs/blackboard/evidence/') ||
  /^docs\/blackboard\/artifacts\/ready-implement-plan\/[^/]+\.(?:candidate-jev-evaluation|implementation-result|judgment)\.json$/.test(ref);

export function transaction(root, fn) {
  const ref = localPath(root, 'docs/blackboard/.publication.lock');
  let fd;
  try { fd = fs.openSync(ref, 'wx'); } catch { fail('publication lock held; do not steal lock'); }
  try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(ref); }
}
export function publishEvaluation(root, id, evaluation) {
  return transaction(root, () => {
    let { graph, task, plan } = loadSubject(root, id);
    const phase = evaluation.lane === 'RESEARCH_SA' ? 'readiness' : 'candidate';
    const ref = `docs/blackboard/artifacts/ready-implement-plan/${id}.${phase}-jev-evaluation.json`;
    // A publication retry may arrive after its own lane transition.
    const existing = fs.existsSync(localPath(root, ref)) ? read(root, ref) : null;
    if(task.lane==='RESEARCH_SA' && evaluation.lane==='WORKER' && task.contract.evaluationRef===ref && existing && canonical(existing)===canonical(evaluation) && evaluation.verdict==='RESEARCH_REQUIRED') {
      if(planHash(plan)!==evaluation.subject.plan.hash)fail('plan changed after contradiction');
      assertBinding(root,evaluation.subject.objective);assertBinding(root,evaluation.subject.evidence);
      return {ref,lane:task.lane,phase:task.phase,noSemanticProgress:true};
    }
    const readinessRetry = evaluation.lane === 'RESEARCH_SA' && task.lane === 'WORKER' && existing?.cacheKey === evaluation.cacheKey;
    if (task.lane !== evaluation.lane && !readinessRetry) fail('publication lane changed');
    const expected = materialize(root, id, { readiness: evaluation.lane === 'RESEARCH_SA' });
    validateEvaluation(evaluation, expected);
    if (existing?.cacheKey === evaluation.cacheKey && canonical(existing.subject) === canonical(evaluation.subject) && existing.verdict !== evaluation.verdict) fail('unstable replay cannot replace current judgment');
    write(root, ref, evaluation);
    task.contract.evaluationRef = ref;
    delete task.contract.lastResearchEvaluationRef;
    if (evaluation.lane === 'RESEARCH_SA') {
      if (evaluation.verdict === 'SATISFIED') {
        plan.status = 'READY'; plan.readinessRef = ref;
        task.lane = 'WORKER'; task.phase = 'EXECUTION';
        task.contract.evidenceRef??=`docs/blackboard/artifacts/ready-implement-plan/${id}.implementation-result.json`;
      } else {
        plan.status = 'DRAFT'; delete plan.readinessRef;
        task.lane = 'RESEARCH_SA'; task.phase = 'RESEARCH';
      }
      write(root, task.contract.planRef, plan);
    } else if (evaluation.verdict === 'RESEARCH_REQUIRED') {
      task.lane = 'RESEARCH_SA'; task.phase = 'RESEARCH';
      plan.status = 'DRAFT'; delete plan.readinessRef;
      write(root, task.contract.planRef, plan);
    } else task.phase = evaluation.verdict === 'SATISFIED' ? 'MERGE_PENDING' : 'REPAIR';
    task.status = 'PLANNED'; task.claim = null; task.currentContextRef = null;
    task.contract.lastEvaluatedInput = evaluation.cacheKey;
    const context = localPath(root, `docs/blackboard/context/${id}/current.json`);
    if (fs.existsSync(context)) fs.unlinkSync(context);
    write(root, 'docs/blackboard/work-graph.json', graph);
    return { ref, lane: task.lane, phase: task.phase, noSemanticProgress: existing?.cacheKey === evaluation.cacheKey && evaluation.verdict !== 'SATISFIED' };
  });
}
export function importEvaluationEvidence(root,id,evaluation,bundleDirectory) {
  const {task,plan}=loadSubject(root,id);
  if(task.lane!=='WORKER'||evaluation.lane!=='WORKER')fail('evidence import requires WORKER');
  assertReady(root,task,plan);
  if(task.contract.candidateSha!==evaluation.subject.candidateSha || planHash(plan)!==evaluation.subject.plan.hash)fail('import subject is not current');
  const resultFile=path.join(bundleDirectory,`${id}-implementation-result.json`);
  const result=assertDeliveryArtifact(JSON.parse(fs.readFileSync(resultFile,'utf8')));
  if(task.contract.evidenceRef!==evaluation.subject.evidence.ref || hash(result)!==evaluation.subject.evidence.hash)fail('import evidence binding mismatch');
  const files=new Map();
  for(const ref of [...new Set([...result.verificationRuns.map(v=>v.logRef),...result.claims.flatMap(c=>c.evidenceRefs)])]) {
    if(path.posix.dirname(ref)!==`docs/blackboard/evidence/${id}` || !/^[-A-Za-z0-9._]+\.txt$/.test(path.posix.basename(ref)))fail('noncanonical imported evidence ref');
    const body=fs.readFileSync(path.join(bundleDirectory,'evidence',id,path.posix.basename(ref)),'utf8');
    for(const run of result.verificationRuns.filter(v=>v.logRef===ref))if(hash(body)!==run.logHash)fail('imported log digest mismatch');
    files.set(ref,body);
  }
  // Only evidence files may be installed here. The subsequent publisher still validates the full materialized state.
  for(const [ref,body] of files) {
    const destination=localPath(root,ref);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,body);
  }
  write(root,task.contract.evidenceRef,result);
}
export function collectEvidence(root, id) {
  if(process.env.TYPESAFE_API_KEY) fail('remove TYPESAFE_API_KEY before executing candidate verification commands');
  const { task, plan } = loadSubject(root, id);
  if (task.lane !== 'WORKER' || !['EXECUTION', 'REPAIR', 'JUDGMENT'].includes(task.phase)) fail('not worker verification phase');
  assertReady(root, task, plan);
  if (!task.contract.candidateSha || !task.contract.baselineSha) fail('set exact candidateSha and baselineSha on current task');
  const candidateSha = git(root, 'rev-parse', 'HEAD');
  const dirtySource=()=>[...git(root,'diff','--name-only','HEAD').split('\n'),...git(root,'ls-files','--others','--exclude-standard').split('\n')].filter(Boolean).filter(ref=>!ref.startsWith('docs/blackboard/')&&!ref.startsWith('artifacts/')&&!ref.startsWith('.cache/'));
  if (candidateSha !== task.contract.candidateSha || dirtySource().length) fail('verification requires clean exact candidate source');
  const boundPlanHash=planHash(plan);
  const controlChanges=()=>git(root,'diff','HEAD','--','docs/blackboard',`:(exclude)docs/blackboard/evidence/${id}`);
  const controlBefore=controlChanges();
  const directory = `docs/blackboard/evidence/${id}`;
  const verificationRuns = [];
  for (const v of plan.verificationPlan) {
    const result = spawnSync(v.command, { cwd: root, shell: true, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
    const logRef = `${directory}/${v.id}.txt`;
    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}\nexitCode=${result.status}\n`;
    const filename = localPath(root, logRef);
    fs.mkdirSync(localPath(root, directory), { recursive: true }); fs.writeFileSync(filename, log);
    if (result.error || result.status !== 0) fail(`verification failed: ${v.id}`);
    if (dirtySource().length || planHash(read(root,task.contract.planRef))!==boundPlanHash || controlChanges()!==controlBefore) fail('verification changed candidate source or plan');
    verificationRuns.push({ id: v.id, command: v.command, status: 'PASSED', exitCode: 0, candidateSha, logRef, logHash: hash(log) });
  }
  const result = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'IMPLEMENTATION_RESULT', artifactId: `${id}-evidence`, plan: { ref: task.contract.planRef, hash: planHash(plan) }, candidateSha, baselineSha: task.contract.baselineSha, candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'), verificationRuns, claims: plan.acceptanceCriteria.map(c => ({ id: c.id, evidenceRefs: verificationRuns.filter(v => c.verificationIds.includes(v.id)).map(v => v.logRef) })) };
  // Additional domain evidence must be provided explicitly in the current claim mapping.
  for (const c of result.claims) for(const [index,sourceRef] of (task.contract.claimEvidence?.[c.id] ?? []).entries()) {
    const ref=`${directory}/${c.id}-observation-${index}.txt`;
    const content=fs.readFileSync(localPath(root,sourceRef));
    fs.writeFileSync(localPath(root,ref),content);c.evidenceRefs.push(ref);
  }
  const ref = task.contract.evidenceRef ?? `docs/blackboard/artifacts/ready-implement-plan/${id}.implementation-result.json`;
  transaction(root,()=>{
    const fresh=loadSubject(root,id);
    if(planHash(fresh.plan)!==boundPlanHash||fresh.task.contract.candidateSha!==candidateSha)fail('subject changed during verification');
    write(root,ref,result);
    fresh.task.contract.evidenceRef=ref;fresh.task.phase='JUDGMENT';
    write(root,'docs/blackboard/work-graph.json',fresh.graph);
  });
  return { ref, evidence: result };
}
export function verifyDelivery(root, id, { mainRef = 'refs/remotes/origin/main', mergeSha } = {}) {
  const { graph, task, plan } = loadSubject(root, id);
  if (task.lane !== 'WORKER' || task.phase !== 'MERGE_PENDING') fail('not MERGE_PENDING');
  assertReady(root, task, plan);
  const evaluation = read(root, task.contract.evaluationRef);
  const currentInput=materialize(root,id);
  validateEvaluation(evaluation, currentInput);
  if (evaluation.verdict !== 'SATISFIED') fail('claims not all SATISFIED');
  const candidateSha = evaluation.subject.candidateSha, candidateTree = evaluation.subject.candidateTree;
  const observedMainSha = git(root, 'rev-parse', mainRef);
  mergeSha ??= task.contract.mergeSha;
  if (!/^[a-f0-9]{40}$/.test(mergeSha ?? '')) fail('exact mergeSha required');
  git(root, 'merge-base', '--is-ancestor', candidateSha, mergeSha);
  git(root, 'merge-base', '--is-ancestor', mergeSha, observedMainSha);
  if (git(root, 'rev-parse', `${mergeSha}^{tree}`) !== candidateTree) fail('merged tree differs from evaluated candidate');
  for(const source of currentInput.payload.state.sources.filter(source => !isMutableControlRef(source.ref))) {
    const atCandidate=git(root,'ls-tree',candidateSha,'--',source.ref);
    const atMain=git(root,'ls-tree',observedMainSha,'--',source.ref);
    if(atCandidate!==atMain)fail(`evaluated source no longer exists unchanged in main: ${source.ref}`);
  }
  const receipt = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'DELIVERED_FEATURE', artifactId: `${id}-delivery`, plan: { ref: task.contract.planRef, hash: planHash(plan) }, evaluation: { ref: task.contract.evaluationRef, hash: hash(evaluation) }, evidence: evaluation.subject.evidence, candidateSha, candidateTree, mergeSha, observedMainSha, consolidatedRefs: task.artifacts.consolidatedRefs };
  assertDeliveryArtifact(receipt);
  for (const ref of receipt.consolidatedRefs) if (!fs.existsSync(localPath(root, ref))) fail('missing consolidated ref');
  return { graph, task, receipt };
}
export function publishDelivery(root, id, options = {}) {
  return transaction(root, () => {
    const current=read(root,'docs/blackboard/work-graph.json').tasks.find(t=>t.id===id);
    if(current?.status==='DONE' && current.contract?.deliveryRef) {
      const receipt=assertDeliveryArtifact(read(root,current.contract.deliveryRef));
      if(options.mergeSha && options.mergeSha!==receipt.mergeSha)fail('delivery retry merge mismatch');
      if(receipt.plan.ref!==current.contract.planRef || receipt.plan.hash!==planHash(read(root,receipt.plan.ref)))fail('delivery retry plan changed');
      assertBinding(root,receipt.evaluation);
      return {ref:current.contract.deliveryRef,receipt};
    }
    const { graph, task, receipt } = verifyDelivery(root, id, options);
    const ref = `docs/blackboard/artifacts/delivered-feature/${id}.json`;
    write(root, ref, receipt);
    task.contract.deliveryRef = ref; task.status = 'DONE'; task.phase = 'DELIVERED';
    task.claim = null; task.currentContextRef = null;
    task.artifacts.outputRefs = [...new Set([...task.artifacts.outputRefs, ref])];
    const context = localPath(root, `docs/blackboard/context/${id}/current.json`);
    if (fs.existsSync(context)) fs.unlinkSync(context);
    // A feature can close only when every task has its own exact delivery receipt.
    const feature = graph.features.find(f => f.id === task.featureId);
    if (feature && feature.acceptanceTaskId===id && feature.taskIds.every(tid => graph.tasks.find(t => t.id === tid)?.status === 'DONE')) feature.status = 'DONE';
    write(root, 'docs/blackboard/work-graph.json', graph);
    return { ref, receipt };
  });
}
