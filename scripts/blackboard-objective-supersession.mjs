// OBJECTIVE_SUPERSESSION: the only authority that may replace an unfinished task's canonical objective.
// Verification is deterministic and data-only: trusted PR-base Board/objective bytes are compared with
// candidate data read from the PR head. No candidate module is imported or executed.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { read, fail, hash, canonical, localPath, planHash, assertPlan, assertDeliveryArtifact, assertObjectiveSupersession } from './blackboard-delivery-contract.mjs';
import { directDependentIds, assertResearchReset } from './blackboard-work-graph.mjs';

export const GRAPH_REF = 'docs/blackboard/work-graph.json';
export const STATE_REF = 'docs/blackboard/state.md';
export const OBJECTIVE_DIR = 'docs/blackboard/artifacts/objective';
export const supersessionRef = id => `${OBJECTIVE_DIR}/${id}.supersession.json`;
// Stale readiness/worker authority removed when work returns to research under a replacement objective.
export const CLEARED_CONTRACT_FIELDS = Object.freeze(['evaluationRef', 'lastEvaluatedInput', 'lastResearchEvaluationRef', 'candidateSha', 'baselineSha', 'evidenceRef', 'claimEvidence', 'deliveryRef', 'mergeSha']);
export const DISPOSITIONS = Object.freeze(['TERMINAL_UNCHANGED', 'RESET_RESEARCH', 'RETAIN_RESEARCH']);
const PROTECTED_ROOTS = ['scripts/', 'packages/', 'test/', '.github/', 'package.json', 'jev-policy.json'];

const gitOut = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const bytes = (root, ref) => { const p = localPath(root, ref); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
const same = (a, b) => canonical(a) === canonical(b);

// Expected disposition of a direct dependent, decided from trusted Board state only.
export function dependentDisposition(task) {
  if (task.status === 'DONE') return 'TERMINAL_UNCHANGED';
  if (task.lane === 'RESEARCH_SA') return 'RETAIN_RESEARCH';
  if (task.lane === 'WORKER') return 'RESET_RESEARCH';
  fail(`dependent ${task.id} has no delivery lane`);
}
export function expectedDependents(trustedGraph, targetId) {
  const byId = new Map(trustedGraph.tasks.map(t => [t.id, t]));
  return directDependentIds(trustedGraph, targetId).map(id => {
    const task = byId.get(id);
    return { taskId: id, disposition: dependentDisposition(task), planRef: task.contract?.planRef ?? null };
  });
}

// Receipts that are new or changed in the subject relative to the trusted checkout.
export function detectSupersessions({ trustedRoot, subjectRoot, trustedGraph }) {
  const found = [];
  const dir = localPath(subjectRoot, OBJECTIVE_DIR);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.supersession.json')) : [];
  const ids = new Set(trustedGraph.tasks.map(t => t.id));
  for (const name of names) {
    const id = name.slice(0, -'.supersession.json'.length);
    if (!/^BB-\d+$/.test(id)) fail(`non-canonical supersession receipt: ${name}`);
    if (!ids.has(id)) fail(`supersession targets unknown work: ${id}`);
    const ref = supersessionRef(id);
    const subject = bytes(subjectRoot, ref), trusted = bytes(trustedRoot, ref);
    if (!trusted || !subject.equals(trusted)) found.push(id);
  }
  for (const task of trustedGraph.tasks) {
    const ref = supersessionRef(task.id);
    if (bytes(trustedRoot, ref) && !bytes(subjectRoot, ref)) fail(`supersession receipt deleted: ${task.id}`);
  }
  return found.sort();
}
// INV-1: outside a verified supersession, trusted objective bytes are immutable for contracted work.
export function assertObjectivesUnchanged({ trustedRoot, subjectRoot, trustedGraph, exempt = [] }) {
  const skip = new Set(exempt);
  for (const task of trustedGraph.tasks) {
    if (typeof task.contract?.objectiveRef !== 'string' || skip.has(task.id)) continue;
    const trusted = bytes(trustedRoot, task.contract.objectiveRef), subject = bytes(subjectRoot, task.contract.objectiveRef);
    if (!trusted) continue; // Trusted Board shape is validated by repository verification.
    if (!subject || !subject.equals(trusted)) fail(`objective changed without OBJECTIVE_SUPERSESSION: ${task.id}`);
  }
}
export function supersessionFence(trustedGraph, ids) {
  const fenced = new Set(ids);
  for (const id of ids) for (const dep of directDependentIds(trustedGraph, id)) fenced.add(dep);
  return fenced;
}

function assertResetPlan(trustedRoot, subjectRoot, task, objectiveHash, label) {
  const trustedPlan = read(trustedRoot, task.contract.planRef);
  const plan = assertPlan(read(subjectRoot, task.contract.planRef));
  if (plan.status !== 'DRAFT' || plan.readinessRef !== undefined) fail(`${label} plan must be DRAFT without readinessRef`);
  if (plan.objective.ref !== task.contract.objectiveRef || plan.objective.hash !== objectiveHash) fail(`${label} plan must bind the current objective`);
  return { trustedPlan, plan };
}
function allowedChange(ref, allowed, deletable, prefixes) {
  return allowed.has(ref) || deletable.has(ref) || prefixes.some(p => ref.startsWith(p));
}

export function verifySupersession({ trustedRoot, subjectRoot, prBaseSha, candidateSha, targetWorkId }) {
  if (!/^BB-\d+$/.test(targetWorkId ?? '')) fail('invalid supersession target');
  if (!/^[a-f0-9]{40}$/.test(prBaseSha ?? '') || !/^[a-f0-9]{40}$/.test(candidateSha ?? '')) fail('invalid supersession subject');
  if (gitOut(trustedRoot, 'rev-parse', 'HEAD') !== prBaseSha) fail('trusted checkout differs from PR base');
  if (gitOut(subjectRoot, 'rev-parse', 'HEAD') !== candidateSha) fail('subject checkout differs from CI subject');
  try { gitOut(subjectRoot, 'merge-base', '--is-ancestor', prBaseSha, candidateSha); } catch { fail('stale supersession: PR base is not an ancestor of the candidate'); }

  const trustedGraph = read(trustedRoot, GRAPH_REF), graph = read(subjectRoot, GRAPH_REF);
  const id = targetWorkId, ref = supersessionRef(id);
  const receipt = assertObjectiveSupersession(read(subjectRoot, ref));
  if (receipt.targetWorkId !== id || receipt.artifactId !== `${id}-supersession`) fail('receipt target mismatch');
  // FRESHNESS: the receipt is bound to the exact trusted base, objective bytes and Board refs.
  if (receipt.trustedBaseSha !== prBaseSha) fail('stale supersession: trustedBaseSha differs from PR base');
  const trustedTask = trustedGraph.tasks.find(t => t.id === id);
  if (!trustedTask?.contract) fail('supersession target is not contracted work');
  if (trustedTask.status === 'DONE' || trustedTask.lane !== 'RESEARCH_SA') fail('supersession target must be unfinished RESEARCH_SA work');
  const objectiveRef = trustedTask.contract.objectiveRef, planRef = trustedTask.contract.planRef;
  if (receipt.oldObjective.ref !== objectiveRef || receipt.replacementObjective.ref !== objectiveRef) fail('supersession must keep the stable objective path');
  if (receipt.planRef !== planRef) fail('supersession plan ref differs from trusted Board');
  const trustedObjective = read(trustedRoot, objectiveRef);
  if (receipt.oldObjective.hash !== hash(trustedObjective)) fail('stale supersession: old objective hash differs from trusted bytes');
  const replacement = assertDeliveryArtifact(read(subjectRoot, objectiveRef));
  if (replacement.artifactType !== 'OBJECTIVE' || replacement.artifactId !== trustedObjective.artifactId) fail('replacement is not the target OBJECTIVE');
  if (hash(replacement) !== receipt.replacementObjective.hash) fail('replacement objective hash mismatch');
  if (receipt.replacementObjective.hash === receipt.oldObjective.hash) fail('replacement objective is unchanged');
  for (const evidence of receipt.evidenceRefs) if (!fs.existsSync(localPath(subjectRoot, evidence))) fail(`supersession evidence missing: ${evidence}`);

  // TARGET_RESET: identity/topology preserved, research routing with no stale authority.
  const task = graph.tasks.find(t => t.id === id);
  if (!task) fail('supersession target removed');
  assertResearchReset(task);
  if (task.contract.objectiveRef !== objectiveRef || task.contract.planRef !== planRef ||
      task.contract.researchBaselineSha !== trustedTask.contract.researchBaselineSha) fail('supersession target contract refs changed');
  assertIdentityPreserved(trustedTask, task);
  assertResetPlan(trustedRoot, subjectRoot, task, receipt.replacementObjective.hash, 'target');

  // DEPENDENT_IMPACT: exactly the trusted direct dependents with deterministic dispositions.
  const expected = expectedDependents(trustedGraph, id);
  const declared = receipt.directDependents;
  if (new Set(declared.map(d => d.taskId)).size !== declared.length) fail('duplicate supersession dependent');
  if (!same(declared.map(d => d.taskId).sort(), expected.map(d => d.taskId))) fail('supersession dependents differ from trusted direct dependents');
  const deletable = new Set(), allowed = new Set([GRAPH_REF, STATE_REF, ref, objectiveRef, planRef]);
  const addStale = t => { for (const key of ['evaluationRef', 'lastResearchEvaluationRef', 'evidenceRef']) if (typeof t.contract?.[key] === 'string') deletable.add(t.contract[key]); };
  addStale(trustedTask);
  const prefixes = [`docs/blackboard/context/${id}/`, `docs/blackboard/evidence/${id}/`];
  const handled = new Set([id]);
  for (const want of expected) {
    const got = declared.find(d => d.taskId === want.taskId);
    if (got.disposition !== want.disposition) fail(`dependent ${want.taskId} disposition must be ${want.disposition}`);
    if ((got.planRef ?? null) !== want.planRef) fail(`dependent ${want.taskId} plan ref mismatch`);
    const before = trustedGraph.tasks.find(t => t.id === want.taskId);
    const after = graph.tasks.find(t => t.id === want.taskId);
    if (!after) fail(`dependent removed: ${want.taskId}`);
    handled.add(want.taskId);
    if (want.disposition === 'TERMINAL_UNCHANGED' || want.disposition === 'RETAIN_RESEARCH') {
      // Research dependents keep their refs and content; an active research claim is released.
      const retained = want.disposition === 'RETAIN_RESEARCH' && before.status === 'ACTIVE'
        ? { ...before, status: 'PLANNED', claim: null, currentContextRef: null } : before;
      if (!same(retained, after)) fail(`dependent ${want.taskId} must be unchanged (${want.disposition})`);
      if (want.disposition === 'RETAIN_RESEARCH') prefixes.push(`docs/blackboard/context/${want.taskId}/`);
      if (before.contract && !bytes(trustedRoot, before.contract.planRef).equals(bytes(subjectRoot, before.contract.planRef) ?? Buffer.alloc(0))) fail(`dependent ${want.taskId} plan must be unchanged`);
      continue;
    }
    assertResearchReset(after);
    if (!same({ ...after.contract }, pick(before.contract, ['objectiveRef', 'planRef', 'researchBaselineSha']))) fail(`dependent ${want.taskId} contract refs changed`);
    assertIdentityPreserved(before, after);
    const { trustedPlan, plan } = assertResetPlan(trustedRoot, subjectRoot, after, hash(read(trustedRoot, before.contract.objectiveRef)), `dependent ${want.taskId}`);
    if (planHash(plan) !== planHash(trustedPlan)) fail(`dependent ${want.taskId} plan content changed`);
    allowed.add(before.contract.planRef); addStale(before);
    prefixes.push(`docs/blackboard/context/${want.taskId}/`);
  }
  // Everything else on the Board is untouched.
  const { tasks: trustedTasks, ...trustedRest } = trustedGraph, { tasks, ...rest } = graph;
  if (!same(trustedRest, rest)) fail('supersession changed Board structure outside target/dependents');
  if (tasks.length !== trustedTasks.length || tasks.some((t, i) => t.id !== trustedTasks[i].id)) fail('supersession changed task set or order');
  for (const t of trustedTasks) if (!handled.has(t.id) && !same(t, tasks.find(x => x.id === t.id))) fail(`supersession changed unrelated work: ${t.id}`);

  // MIGRATION_BOUNDARY / RETENTION: only Board data changes; no code, no sibling generations, no history rewrites.
  const changed = gitOut(subjectRoot, 'diff', '--name-status', '--no-renames', prBaseSha, candidateSha).split('\n').filter(Boolean)
    .map(line => { const [status, file] = line.split('\t'); return { status, file }; });
  for (const { status, file } of changed) {
    if (PROTECTED_ROOTS.some(p => file === p || file.startsWith(p))) fail(`supersession cannot bundle code or workflow changes: ${file}`);
    if (deletable.has(file) && status !== 'D') fail(`historical artifact cannot be rewritten: ${file}`);
    if (!allowedChange(file, allowed, deletable, prefixes)) fail(`supersession changed unrelated path: ${file}`);
    if (file.startsWith(`docs/blackboard/context/`) && status !== 'D') fail(`supersession may only remove active context: ${file}`);
  }
  if (!changed.some(c => c.file === objectiveRef)) fail('supersession does not replace the objective');
  return { workId: id, publication: 'OBJECTIVE_SUPERSESSION', oldObjective: receipt.oldObjective.hash, replacementObjective: receipt.replacementObjective.hash, dependents: expected };
}
function pick(obj, keys) { return Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]])); }
function assertIdentityPreserved(before, after) {
  for (const key of ['id', 'featureId', 'title', 'kind', 'complexity', 'components', 'dependencies', 'expectedOutputs', 'artifacts'])
    if (!same(before[key], after[key])) fail(`supersession changed ${before.id}.${key}`);
}
// Repository-level check: every retained receipt binds the current objective at its stable path.
export function verifyRetainedSupersessions(root, graph) {
  const dir = localPath(root, OBJECTIVE_DIR);
  if (!fs.existsSync(dir)) return [];
  const verified = [];
  for (const name of fs.readdirSync(dir)) {
    if (/\.(g\d+|v\d+|gen\d+|rev\d+)\./i.test(name)) fail(`version sibling artifact: ${name}`);
    if (!name.endsWith('.supersession.json')) continue;
    const id = name.slice(0, -'.supersession.json'.length);
    const receipt = assertObjectiveSupersession(read(root, supersessionRef(id)));
    const task = graph.tasks.find(t => t.id === id);
    if (receipt.targetWorkId !== id || !task?.contract) fail(`supersession receipt without contracted target: ${name}`);
    if (receipt.replacementObjective.ref !== task.contract.objectiveRef || receipt.planRef !== task.contract.planRef) fail(`supersession refs differ from Board: ${id}`);
    if (hash(read(root, task.contract.objectiveRef)) !== receipt.replacementObjective.hash) fail(`current objective differs from supersession replacement: ${id}`);
    verified.push(id);
  }
  return verified;
}
