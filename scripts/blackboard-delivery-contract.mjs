import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const fail = message => { throw new Error(`BLACKBOARD_DELIVERY_INVALID: ${message}`); };
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])]));
  return value;
}
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function localPath(root, ref) {
  if (typeof ref !== 'string' || !ref || ref.includes('\\') || path.isAbsolute(ref) || ref.split('/').some(s => !s || s === '..' || s === '.') || ref.includes(':')) fail(`unsafe ref: ${ref}`);
  const target = path.resolve(root, ref);
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(realRoot, fs.realpathSync(probe));
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`ref escapes root: ${ref}`);
  return target;
}
export const read = (root, ref) => JSON.parse(fs.readFileSync(localPath(root, ref), 'utf8'));
export function write(root, ref, value) {
  const target = localPath(root, ref);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, target);
}
export const nonempty = (v, label) => { if (typeof v !== 'string' || !v.trim()) fail(label); };
export function list(v, label, allowEmpty = false) {
  if (!Array.isArray(v) || (!allowEmpty && !v.length)) fail(label);
  for (const x of v) nonempty(x, label);
  if (new Set(v).size !== v.length) fail(`${label}: duplicate`);
}
export function digest(v, label) { if (!/^[a-f0-9]{64}$/.test(v ?? '')) fail(label); }
export function sha(v, label) { if (!/^[a-f0-9]{40}$/.test(v ?? '')) fail(label); }
export function binding(v, label) { nonempty(v?.ref, `${label}.ref`); digest(v?.hash, `${label}.hash`); }
export function bind(root, ref) { return { ref, hash: hash(read(root, ref)) }; }
export function assertBinding(root, value) {
  binding(value, 'binding');
  if (hash(read(root, value.ref)) !== value.hash) fail(`stale binding: ${value.ref}`);
}
export function planContent(plan) {
  const { status, readinessRef, ...content } = plan;
  return content;
}
export const planHash = plan => hash(planContent(plan));
export function assertPlan(plan) {
  if (plan?.artifactType !== 'READY_IMPLEMENT_PLAN' || !['DRAFT', 'READY'].includes(plan.status)) fail('plan type/status');
  binding(plan.objective, 'objective');
  for (const key of ['scope', 'constraints', 'invariants', 'architectureDecisions', 'implementationSlices']) list(plan[key], key);
  list(plan.outOfScope, 'outOfScope', true);
  for (const key of ['read', 'write', 'forbiddenWrite']) list(plan.sourceScope?.[key], `sourceScope.${key}`, key !== 'read');
  for(const writable of plan.sourceScope.write)for(const forbidden of plan.sourceScope.forbiddenWrite) {
    if(scopeContains(writable,forbidden)||scopeContains(forbidden,writable))fail('write/forbidden scope overlap');
  }
  for (const key of ['requiredExisting', 'expectedNew', 'expectedTests']) list(plan.sourceSeams?.[key], `sourceSeams.${key}`, key === 'expectedNew');
  if (!Array.isArray(plan.acceptanceCriteria) || !plan.acceptanceCriteria.length) fail('acceptanceCriteria');
  const ids = new Set();
  for (const c of plan.acceptanceCriteria) {
    nonempty(c.id, 'criterion.id'); nonempty(c.statement, 'criterion.statement');
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.id))fail('unsafe criterion id');
    if (ids.has(c.id)) fail('duplicate criterion'); ids.add(c.id);
    list(c.verificationIds, 'criterion.verificationIds'); list(c.evidenceRequired, 'criterion.evidenceRequired');
  }
  if (!Array.isArray(plan.verificationPlan) || !plan.verificationPlan.length) fail('verificationPlan');
  const runs = new Set();
  for (const v of plan.verificationPlan) {
    nonempty(v.id, 'verification.id'); nonempty(v.command, 'verification.command');
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.id))fail('unsafe verification id');
    if (runs.has(v.id)) fail('duplicate verification'); runs.add(v.id);
  }
  for (const c of plan.acceptanceCriteria) for (const id of c.verificationIds) if (!runs.has(id)) fail(`unknown verification: ${id}`);
  if (!Array.isArray(plan.invariantCoverage) || plan.invariantCoverage.length !== plan.invariants.length) fail('invariantCoverage');
  for (let i = 0; i < plan.invariants.length; i++) {
    const mapping = plan.invariantCoverage[i];
    if (mapping.invariant !== plan.invariants[i]) fail('invariant coverage mismatch');
    list(mapping.criterionIds, 'invariant criterionIds');
    for (const id of mapping.criterionIds) if (!ids.has(id)) fail('unknown invariant criterion');
  }
  if (plan.status === 'READY') nonempty(plan.readinessRef, 'readinessRef');
  return plan;
}
export const outcomes = ['SATISFIED', 'IMPLEMENTATION_DEFECT', 'INSUFFICIENT_EVIDENCE', 'PLAN_INPUT_CONTRADICTION'];
export function verdict(answers, lane) {
  const choices = Object.values(answers).map(a => a.choice);
  if (!choices.length) fail('empty answers');
  if (choices.every(c => c === 'SATISFIED')) return 'SATISFIED';
  if (lane === 'RESEARCH_SA' || choices.includes('PLAN_INPUT_CONTRADICTION')) return 'RESEARCH_REQUIRED';
  return 'REPAIR_REQUIRED';
}
export const deliveryTypes = new Set(['OBJECTIVE', 'READY_IMPLEMENT_PLAN', 'JEV_EVALUATION', 'DELIVERED_FEATURE']);
export function assertDeliveryArtifact(a) {
  if (a?.kind !== 'BLACKBOARD_ARTIFACT' || a.version !== 1) fail('artifact kind/version');
  nonempty(a.artifactId, 'artifactId');
  if (a.artifactType === 'OBJECTIVE') {
    nonempty(a.outcome, 'outcome'); nonempty(a.currentProblem, 'currentProblem');
    for (const key of ['scope', 'constraints', 'successCriteria', 'currentSourceRefs']) list(a[key], key);
  } else if (a.artifactType === 'READY_IMPLEMENT_PLAN') assertPlan(a);
  else if (a.artifactType === 'JEV_EVALUATION') {
    if (!['RESEARCH_SA', 'WORKER'].includes(a.lane)) fail('evaluation lane');
    nonempty(a.subject?.workId, 'evaluation workId'); binding(a.subject?.plan, 'evaluation plan');
    for (const k of ['stateHash', 'specHash', 'cacheKey']) digest(a[k], k);
    nonempty(a.model, 'model');
    if (!a.answers || Object.values(a.answers).some(x => x.type !== 'choice' || !outcomes.includes(x.choice))) fail('evaluation answers');
    if (a.verdict !== verdict(a.answers, a.lane)) fail('evaluation verdict');
  } else if (a.artifactType === 'IMPLEMENTATION_RESULT') {
    const allowed=new Set(['kind','version','artifactType','artifactId','plan','candidateSha','baselineSha','candidateTree','verificationRuns','claims']);
    for(const key of Object.keys(a))if(!allowed.has(key))fail(`producer cannot publish ${key}`);
    binding(a.plan, 'evidence plan'); sha(a.candidateSha, 'candidateSha'); sha(a.baselineSha, 'baselineSha'); sha(a.candidateTree, 'candidateTree');
    if (!Array.isArray(a.verificationRuns) || !a.verificationRuns.length) fail('verificationRuns');
    if (!Array.isArray(a.claims) || !a.claims.length) fail('evidence claims');
  } else if (a.artifactType === 'DELIVERED_FEATURE') {
    binding(a.plan, 'delivery plan'); binding(a.evaluation, 'delivery evaluation');
    for (const k of ['candidateSha', 'candidateTree', 'mergeSha', 'observedMainSha']) sha(a[k], k);
    list(a.consolidatedRefs, 'consolidatedRefs');
  } else fail('artifact type');
  return a;
}
export function scopeContains(pattern, file) {
  return pattern === '**' || pattern === file || (pattern.endsWith('/**') && (file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2))));
}
export function loadSubject(root, id) {
  const graph = read(root, 'docs/blackboard/work-graph.json');
  const task = graph.tasks.find(t => t.id === id);
  if (!task || !task.contract || task.status === 'DONE') fail(`not unfinished delivery work: ${id}`);
  const plan = assertPlan(read(root, task.contract.planRef));
  assertBinding(root, plan.objective);
  if (plan.objective.ref !== task.contract.objectiveRef) fail('objective ref mismatch');
  return { graph, task, plan, objective: read(root, plan.objective.ref) };
}
