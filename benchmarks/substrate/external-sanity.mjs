// External substrate sanity: deterministically seal exactly two pinned Terminal-Bench 2.1 tasks after
// Harbor oracle 5/5 and nop fail 1/1. No coding-model call; selection never reads downstream model results.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { AttemptLedger, createBenchmarkUnit, createExperimentRegistration } from '@exharness/benchmark';
import { createHarborSubstrate, EVALUATOR_IDENTITY } from './harbor/adapter.mjs';
import { TERMINAL_BENCH_PIN, resolveHarborIdentity, taskBundleDigests, instructionDigest, environmentIdentity, readTaskDeclaration } from './harbor/identity.mjs';
import { runAttempt, writeExperiment } from './attempt-runner.mjs';
import { auditExperiment } from './audit-experiment.mjs';
import { SUBSTRATE_ROOT, REPO_ROOT, HARBOR, fileDigest, readJson, pretty, git } from './common.mjs';

export const MANIFEST_REF = 'benchmarks/substrate/manifests/terminal-bench-2.1.json';
export const CONTROLS_REF = 'benchmarks/substrate/manifests/terminal-bench-2.1';
export const RULE = Object.freeze({ oracleRuns: 5, oracleMustPass: 5, nopRuns: 1, nopMustFail: 1, select: 2 });
const PLAN_DIR = 'docs/blackboard/artifacts/ready-implement-plan';

// ---- pure selection logic -------------------------------------------------------------------------
export function parseDatasetToml(text) {
  const tasks = [];
  for (const block of text.split(/\n\[\[tasks\]\]\n/).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const digest = block.match(/^digest\s*=\s*"(sha256:[0-9a-f]{64})"/m)?.[1];
    if (!name || !digest) throw new Error('malformed dataset.toml task entry');
    tasks.push({ name, digest });
  }
  return tasks;
}

export function shortName(name) { return name.split('/').at(-1); }

// Every task named (as a whole word) or referenced by digest in a canonical plan is reserved.
export function reservedTasks(plans, tasks) {
  const reserved = new Map();
  for (const plan of plans) {
    for (const task of tasks) {
      const short = shortName(task.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![A-Za-z0-9_-])${short}(?![A-Za-z0-9_-])`).test(plan.text) || plan.text.includes(task.digest.slice(7))) {
        const entry = reserved.get(task.name) ?? { name: task.name, digest: task.digest, plans: [] };
        entry.plans.push(plan.ref);
        reserved.set(task.name, entry);
      }
    }
  }
  return [...reserved.values()].sort((a, b) => (a.digest < b.digest ? -1 : 1));
}

export function candidateOrder(tasks, reserved) {
  const excluded = new Set(reserved.map(entry => entry.name));
  return tasks.filter(task => !excluded.has(task.name)).sort((a, b) => (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0));
}

// controls: name -> { oracle: [quality...], nop: [quality...] } in execution order.
export function selectExternalSanity(order, controls, rule = RULE) {
  const selected = [];
  const disqualified = [];
  const violations = [];
  let stoppedAt = null;
  for (const [index, candidate] of order.entries()) {
    const control = controls[candidate.name];
    if (selected.length === rule.select) {
      if (control) violations.push(`${candidate.name} was executed after two tasks were already selected`);
      continue;
    }
    if (!control) { stoppedAt = stoppedAt ?? index; continue; }
    if (stoppedAt !== null) violations.push(`${candidate.name} was executed out of order`);
    const oracle = control.oracle ?? [];
    const nop = control.nop ?? [];
    const oracleFailure = oracle.findIndex(quality => quality !== 'ACCEPTED');
    if (oracleFailure !== -1) {
      if (oracle.length !== oracleFailure + 1 || nop.length) violations.push(`${candidate.name} continued after an oracle failure`);
      disqualified.push({ name: candidate.name, reason: `oracle run ${oracleFailure + 1} was ${oracle[oracleFailure]}` });
      continue;
    }
    if (oracle.length < rule.oracleRuns) { stoppedAt = stoppedAt ?? index; violations.push(`${candidate.name} has only ${oracle.length} oracle runs`); continue; }
    if (oracle.length > rule.oracleRuns) violations.push(`${candidate.name} has more than ${rule.oracleRuns} oracle runs`);
    if (nop.length !== rule.nopRuns) { violations.push(`${candidate.name} has ${nop.length} nop runs`); continue; }
    if (nop[0] !== 'REJECTED') { disqualified.push({ name: candidate.name, reason: `nop was ${nop[0]}, not a verifier failure` }); continue; }
    selected.push({ name: candidate.name, digest: candidate.digest });
  }
  const status = violations.length ? 'INVALID' : selected.length === rule.select ? 'SEALED' : 'INCONCLUSIVE';
  return { status, selected, disqualified, violations };
}

// ---- repository-bound inputs ----------------------------------------------------------------------
function planTextsAt(commit) {
  const listing = git(['ls-tree', commit, `${PLAN_DIR}/`]).trim().split('\n').filter(Boolean);
  return listing.map(line => {
    const [meta, ref] = line.split('\t');
    const blob = meta.split(' ')[2];
    return { ref, blob, text: git(['cat-file', '-p', blob]) };
  }).filter(plan => /\/BB-\d+\.json$/.test(plan.ref) && !plan.ref.endsWith('/BB-065.json'));
}

export async function terminalBenchRoot() {
  const root = process.env.TERMINAL_BENCH_ROOT || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'exharness', 'terminal-bench-2-1');
  try { await stat(join(root, '.git')); } catch {
    await mkdir(root, { recursive: true });
    const clone = spawnSync('git', ['clone', '--quiet', TERMINAL_BENCH_PIN.repository, root], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`cannot clone ${TERMINAL_BENCH_PIN.repository}: ${clone.stderr}`);
  }
  const head = git(['rev-parse', 'HEAD'], { cwd: root }).trim();
  if (head !== TERMINAL_BENCH_PIN.sourceCommit) {
    git(['checkout', '--quiet', '--detach', TERMINAL_BENCH_PIN.sourceCommit], { cwd: root });
  }
  if (git(['rev-parse', 'HEAD'], { cwd: root }).trim() !== TERMINAL_BENCH_PIN.sourceCommit) throw new Error('Terminal-Bench checkout is not at the pinned commit');
  if (git(['status', '--porcelain'], { cwd: root }).trim()) throw new Error('Terminal-Bench checkout is not clean');
  return root;
}

async function pinnedSource() {
  const root = await terminalBenchRoot();
  const datasetBytes = await readFile(join(root, 'tasks', 'dataset.toml'));
  const tasks = parseDatasetToml(datasetBytes.toString('utf8'));
  const dirs = tasks.map(task => join(root, 'tasks', shortName(task.name)));
  const recomputed = taskBundleDigests(dirs, { pythonBin: HARBOR.python });
  const drift = tasks.filter((task, index) => recomputed[dirs[index]] !== task.digest).map(task => task.name);
  return { root, tasks, datasetDigest: fileDigest(datasetBytes), drift };
}

// ---- execution (run once to seal) -----------------------------------------------------------------
export async function executeExternalPreflight({ outputRoot }) {
  const harbor = await resolveHarborIdentity({ harborBin: HARBOR.bin, pythonBin: HARBOR.python });
  if (!harbor.pinned) return { mode: 'external-preflight', status: 'FAIL', problems: harbor.problems };
  const source = await pinnedSource();
  if (source.drift.length) return { mode: 'external-preflight', status: 'FAIL', problems: [`bundle digest drift: ${source.drift.join(', ')}`] };
  const reservationCommit = process.env.BENCHMARK_RESERVATION_COMMIT || git(['merge-base', 'HEAD', 'origin/main']).trim();
  const plans = planTextsAt(reservationCommit);
  const reserved = reservedTasks(plans, source.tasks);
  const order = candidateOrder(source.tasks, reserved);
  const preregistration = {
    kind: 'BENCHMARK_SUBSTRATE_PREREGISTRATION_V1',
    harbor: harbor.identity,
    source: { dataset: TERMINAL_BENCH_PIN.dataset, repository: TERMINAL_BENCH_PIN.repository, sourceCommit: TERMINAL_BENCH_PIN.sourceCommit, datasetManifestDigest: source.datasetDigest, taskCount: source.tasks.length },
    reservation: { commit: reservationCommit, plans: [...new Set(reserved.flatMap(entry => entry.plans))].sort().map(ref => ({ ref, blob: plans.find(plan => plan.ref === ref).blob })), scannedPlans: plans.length, reserved },
    rule: RULE,
    candidateOrder: order,
    codingModelCalls: 0,
    downstreamModelResultsRead: false
  };
  const preregistrationDigest = fileDigest(JSON.stringify(preregistration));
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, 'preregistration.json'), pretty({ ...preregistration, preregistrationDigest }));
  const substrate = createHarborSubstrate({ harborBin: HARBOR.bin, pythonBin: HARBOR.python, outputRoot, identity: harbor.identity, verifierFiles: ['reward.txt', 'reward.json', 'ctrf.json'] });
  const controls = {};
  const experiments = [];
  const log = message => process.stderr.write(`[external-preflight ${new Date().toISOString()}] ${message}\n`);
  for (const candidate of order) {
    if (selectExternalSanity(order, controls).selected.length === RULE.select) break;
    const taskDir = join(source.root, 'tasks', shortName(candidate.name));
    const declaration = await readTaskDeclaration(taskDir);
    let envIdentity;
    try { envIdentity = await environmentIdentity(taskDir, { pull: true }); } catch (error) { envIdentity = `docker-image-unavailable:${declaration.dockerImage}`; log(`${candidate.name}: ${error.message}`); }
    const experimentId = `TB21-CONTROL-${shortName(candidate.name)}`;
    const unitIds = [...Array(RULE.oracleRuns).keys()].map(index => `${shortName(candidate.name)}--ORACLE--r${index}`).concat([`${shortName(candidate.name)}--NOP--r0`]);
    const registration = createExperimentRegistration({
      experimentId, protocol: { id: 'TB21-EXTERNAL-SANITY', version: '1', hash: preregistrationDigest }, sourceIdentity: `terminal-bench:${TERMINAL_BENCH_PIN.sourceCommit}`,
      workloadManifest: { ref: `${TERMINAL_BENCH_PIN.repository}#${TERMINAL_BENCH_PIN.sourceCommit}:tasks/dataset.toml`, digest: source.datasetDigest },
      environmentIdentity: envIdentity, producerProfile: { id: 'harbor-oracle-nop-controls', hash: fileDigest('ORACLE,NOP') },
      resourceBudget: { id: 'task-declared-timeouts', hash: fileDigest(await readFile(join(taskDir, 'task.toml'))) },
      artifactPolicy: { declaredBy: 'task.toml artifacts', candidate: 'task environment state judged by the task verifier' }, evaluatorIdentity: EVALUATOR_IDENTITY,
      resetPolicy: { newHarborTrialPerAttempt: true, newAttemptOutputRoot: true, harborEnvironmentDelete: true }, unitIds, createdAt: new Date().toISOString()
    });
    const instruction = await instructionDigest(taskDir);
    const bound = unitIds.map(unitId => createBenchmarkUnit({
      unitId, experimentId, task: { id: candidate.name, bundleDigest: candidate.digest }, environmentIdentity: envIdentity, instructionDigest: instruction,
      producerProfile: unitId.includes('--NOP--') ? 'harbor-nop' : 'harbor-oracle', repeatIndex: Number(unitId.at(-1)), arm: unitId.includes('--NOP--') ? 'NOP' : 'ORACLE',
      budgetProfileHash: registration.resourceBudget.hash
    }, { registration }));
    const experimentRoot = join(outputRoot, experimentId);
    await writeExperiment(experimentRoot, { registration, units: bound });
    const ledger = new AttemptLedger({ registration });
    bound.forEach(unit => ledger.registerUnit(unit));
    controls[candidate.name] = { oracle: [], nop: [] };
    for (const unit of bound) {
      if (unit.arm === 'NOP' && controls[candidate.name].oracle.length !== RULE.oracleRuns) break;
      if (unit.arm === 'ORACLE' && controls[candidate.name].oracle.some(quality => quality !== 'ACCEPTED')) continue;
      const producer = { kind: unit.arm, identity: `harbor-${unit.arm.toLowerCase()}@${harbor.identity.version}` };
      log(`${candidate.name} ${unit.unitId} starting`);
      const { record } = await runAttempt({ ledger, substrate, unit, attemptId: `${unit.unitId}--attempt-1`, producer, taskDir,
        runtime: { sourceSha: git(['rev-parse', 'HEAD']).trim(), profileHash: registration.producerProfile.hash }, budget: { wallMs: null, inputTokens: null, outputTokens: null, costUsd: null, toolCalls: null }, experimentRoot });
      log(`${candidate.name} ${unit.unitId} -> ${record.quality.verdict} ${record.termination} ${record.infrastructureStatus}`);
      controls[candidate.name][unit.arm === 'NOP' ? 'nop' : 'oracle'].push(record.quality.verdict);
    }
    experiments.push(experimentId);
    const verdict = selectExternalSanity(order, controls);
    if (!verdict.selected.some(entry => entry.name === candidate.name) && declaration.dockerImage) spawnSync('docker', ['image', 'rm', declaration.dockerImage], { encoding: 'utf8' });
  }
  const selection = selectExternalSanity(order, controls);
  // Materialize the sealed evidence into the repository (Harbor trial working dirs are not copied).
  const target = join(REPO_ROOT, CONTROLS_REF);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(join(outputRoot, 'preregistration.json'), join(target, 'preregistration.json'));
  for (const experimentId of experiments) {
    await cp(join(outputRoot, experimentId), join(target, experimentId), { recursive: true, filter: path => !/[\\/]trials([\\/]|$)/.test(relative(outputRoot, path)) });
  }
  const selected = [];
  for (const entry of selection.selected) {
    const units = await readJson(join(target, `TB21-CONTROL-${shortName(entry.name)}`, 'units.json'));
    const declaration = await readTaskDeclaration(join(source.root, 'tasks', shortName(entry.name)));
    selected.push({ ...entry, dockerImage: declaration.dockerImage, environmentIdentity: units[0].environmentIdentity, instructionDigest: units[0].instructionDigest });
  }
  const manifest = {
    kind: 'BENCHMARK_SUBSTRATE_MANIFEST_V1', schemaVersion: 1, status: selection.status, sealedAt: new Date().toISOString(),
    preregistrationRef: `${CONTROLS_REF}/preregistration.json`, preregistrationDigest,
    harbor: harbor.identity, source: preregistration.source, reservation: preregistration.reservation, rule: RULE,
    candidateOrder: order.map(task => task.name),
    controls: Object.entries(controls).map(([name, control]) => ({ name, experimentRef: `${CONTROLS_REF}/TB21-CONTROL-${shortName(name)}`, oracle: control.oracle, nop: control.nop })),
    disqualified: selection.disqualified, selected,
    codingModelCalls: 0, downstreamModelResultsRead: false
  };
  await writeFile(join(REPO_ROOT, MANIFEST_REF), pretty(manifest));
  return { mode: 'external-preflight', status: selection.status === 'SEALED' ? 'SEALED' : 'FAIL', selection, experiments };
}

// ---- verification of the sealed manifest ----------------------------------------------------------
export async function verifyExternalPreflight({ root = REPO_ROOT } = {}) {
  const problems = [];
  const manifest = await readJson(join(root, MANIFEST_REF));
  const preregistrationBytes = await readFile(join(root, manifest.preregistrationRef));
  const { preregistrationDigest, ...preregistration } = JSON.parse(preregistrationBytes);
  if (manifest.kind !== 'BENCHMARK_SUBSTRATE_MANIFEST_V1' || manifest.status !== 'SEALED') problems.push('manifest is not a sealed BENCHMARK_SUBSTRATE_MANIFEST_V1');
  if (fileDigest(JSON.stringify(preregistration)) !== preregistrationDigest || preregistrationDigest !== manifest.preregistrationDigest) problems.push('preregistration digest mismatch');
  const harbor = await resolveHarborIdentity({ harborBin: HARBOR.bin, pythonBin: HARBOR.python });
  if (!harbor.pinned) problems.push(...harbor.problems);
  if (manifest.harbor.sourceTreeDigest !== harbor.identity.sourceTreeDigest || manifest.harbor.commit !== harbor.identity.commit) problems.push('sealed Harbor identity differs from the installed pinned Harbor');
  const source = await pinnedSource();
  if (source.drift.length) problems.push(`bundle digest drift: ${source.drift.join(', ')}`);
  if (source.datasetDigest !== manifest.source.datasetManifestDigest || manifest.source.sourceCommit !== TERMINAL_BENCH_PIN.sourceCommit) problems.push('pinned Terminal-Bench source differs');
  const plans = planTextsAt(manifest.reservation.commit);
  const reserved = reservedTasks(plans, source.tasks);
  if (JSON.stringify(reserved) !== JSON.stringify(manifest.reservation.reserved)) problems.push('reserved downstream tasks do not recompute from the canonical plans at the reservation commit');
  const order = candidateOrder(source.tasks, reserved);
  if (JSON.stringify(order.map(task => task.name)) !== JSON.stringify(manifest.candidateOrder) || JSON.stringify(order) !== JSON.stringify(preregistration.candidateOrder)) problems.push('candidate order does not recompute from pinned digests');
  const controls = {};
  const audits = [];
  for (const control of manifest.controls) {
    const experimentRoot = join(root, control.experimentRef);
    const audit = await auditExperiment(experimentRoot);
    audits.push({ experimentId: audit.experimentId, attempts: audit.attempts, status: audit.status });
    if (audit.status !== 'PASS') problems.push(`${control.name} control evidence fails audit: ${JSON.stringify(audit.findings.slice(0, 3))}`);
    const registration = await readJson(join(experimentRoot, 'registration.json'));
    if (registration.protocol.hash !== preregistrationDigest) problems.push(`${control.name} controls are not bound to the preregistration`);
    const records = [];
    for (const unitDir of (await readdir(experimentRoot, { withFileTypes: true })).filter(entry => entry.isDirectory())) {
      for (const attemptDir of await readdir(join(experimentRoot, unitDir.name))) records.push(await readJson(join(experimentRoot, unitDir.name, attemptDir, 'record.json')));
    }
    const ledger = await readJson(join(experimentRoot, 'ledger.json'));
    const byAttempt = new Map(records.map(record => [record.attemptId, record]));
    const ordered = ledger.filter(event => event.type === 'SETTLED').map(event => byAttempt.get(event.attemptId));
    controls[control.name] = { oracle: ordered.filter(r => r.producer.kind === 'ORACLE').map(r => r.quality.verdict), nop: ordered.filter(r => r.producer.kind === 'NOP').map(r => r.quality.verdict) };
    if (records.some(record => !['ORACLE', 'NOP'].includes(record.producer.kind) || record.producer.model !== null)) problems.push(`${control.name} used a producer other than Harbor oracle/nop`);
    if (JSON.stringify(controls[control.name]) !== JSON.stringify({ oracle: control.oracle, nop: control.nop })) problems.push(`${control.name} tallies differ from the evidence`);
  }
  const selection = selectExternalSanity(order, controls);
  if (selection.status !== 'SEALED') problems.push(`selection is ${selection.status}: ${selection.violations.join('; ')}`);
  if (JSON.stringify(selection.selected.map(entry => entry.name)) !== JSON.stringify(manifest.selected.map(entry => entry.name))) problems.push('selected tasks do not follow the preregistered rule');
  for (const entry of manifest.selected) {
    const declaration = await readTaskDeclaration(join(source.root, 'tasks', shortName(entry.name)));
    if (entry.dockerImage !== declaration.dockerImage || !entry.environmentIdentity.startsWith(`docker-image:${declaration.dockerImage}@sha256:`)) problems.push(`${entry.name} environment identity is not the pinned image digest`);
    if (entry.instructionDigest !== await instructionDigest(join(source.root, 'tasks', shortName(entry.name)))) problems.push(`${entry.name} instruction digest drifted`);
  }
  if (manifest.codingModelCalls !== 0 || manifest.downstreamModelResultsRead !== false) problems.push('external sanity must make no coding-model call and read no downstream result');
  return {
    mode: 'external-preflight', status: problems.length ? 'FAIL' : 'PASS', manifest: MANIFEST_REF, sourceCommit: manifest.source.sourceCommit, harbor: manifest.harbor,
    reserved: reserved.map(entry => entry.name), candidateOrderHead: manifest.candidateOrder.slice(0, 8), controls: manifest.controls.map(control => ({ name: control.name, oracle: control.oracle, nop: control.nop })),
    disqualified: manifest.disqualified, selected: manifest.selected, controlAudits: audits, problems
  };
}
