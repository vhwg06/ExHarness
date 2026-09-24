import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIBRATION_TASK_IDS, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, PROTOCOL_HASH, fixtureIdentities, sha256, validateProfile } from './contract.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, '../../..');
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const digest = async path => `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function prepareCalibrationProfile({ output, operatorId, reviewerId, pythonExecutable, imageTag }) {
  if (!output || !operatorId || !reviewerId || !pythonExecutable || !imageTag)
    throw new Error('PROFILE_PREP_INVALID: output/operator/reviewer/python/image required');
  if (operatorId === reviewerId) throw new Error('PROFILE_PREP_INVALID: reviewer must differ from operator');
  if (process.version.slice(1) !== NODE_VERSION) throw new Error(`PROFILE_PREP_INVALID: Node ${NODE_VERSION} required`);
  if (git('status', '--porcelain', '--', 'scripts/delivery/baseline', 'test/delivery', 'docs/living/system/state.md'))
    throw new Error('PROFILE_PREP_INVALID: candidate source is not committed');
  const template = JSON.parse(await readFile(join(root, 'profile.json'), 'utf8'));
  const identities = await fixtureIdentities();
  const { chromium } = await import('playwright');
  const nodeImageDigest = (await readFile(join(root, 'Dockerfile'), 'utf8')).match(/FROM\s+\S+@(sha256:[a-f0-9]{64})/)?.[1];
  if (!nodeImageDigest) throw new Error('PROFILE_PREP_INVALID: Dockerfile base digest missing');
  const imageRows = execFileSync('docker', ['image', 'ls', '--no-trunc', '--format', '{{json .}}', imageTag], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (imageRows.length !== 1) throw new Error('PROFILE_PREP_INVALID: expected one built image for the selected tag');
  const image = JSON.parse(execFileSync('docker', ['image', 'inspect', imageRows[0].ID], { encoding: 'utf8' }))[0];
  const imageDigest = image.Id;
  const pinnedImage = image.RepoDigests?.find(value => value.endsWith(`@${imageDigest}`));
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest) || !pinnedImage)
    throw new Error('PROFILE_PREP_INVALID: built Docker image has no immutable digest');
  const installed = JSON.parse(execFileSync(resolve(pythonExecutable), ['-c',
    "import json,sys,importlib.metadata as m; d=json.loads(m.distribution('mini-swe-agent').read_text('direct_url.json')); print(json.dumps({'version':'.'.join(map(str,sys.version_info[:3])),'commit':d['vcs_info']['commit_id']}))"], { encoding: 'utf8' }));
  if (installed.version !== template.pythonVersion || installed.commit !== template.miniCommit)
    throw new Error('PROFILE_PREP_INVALID: Python or mini-SWE-agent pin differs');
  const model = template.model;
  const armHash = sha256({ model, nodeVersion: NODE_VERSION, miniCommit: template.miniCommit,
    agentImageDigest: imageDigest, budgets: PROTOCOL.budgets });
  const profile = { ...template, template: false, experimentId: `bb065-calibration-${git('rev-parse', '--short=12', 'HEAD')}`,
    operatorId, reviewerId, protocolHash: PROTOCOL_HASH, candidateSha: git('rev-parse', 'HEAD'),
    candidateTree: git('rev-parse', 'HEAD^{tree}'), ...identities, nodeVersion: NODE_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION, pythonExecutable: resolve(pythonExecutable), pythonVersion: installed.version,
    nodeImageDigest, browserDigest: await digest(chromium.executablePath()),
    pythonLockDigest: await digest(join(root, 'requirements.lock')), agentImageDigest: imageDigest,
    agentImage: pinnedImage, calibrationTaskIds: [...CALIBRATION_TASK_IDS],
    contexts: [], budgets: structuredClone(PROTOCOL.budgets), armProfileHashes: { DIRECT: armHash, EXHARNESS: armHash } };
  validateProfile(profile, { ...identities, requirePilot: false });
  const target = resolve(output);
  if (target === join(root, 'profile.json')) throw new Error('PROFILE_PREP_INVALID: template must remain unmodified');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(profile, null, 2) + '\n', { flag: 'wx' });
  return { output: target, experimentId: profile.experimentId, candidateSha: profile.candidateSha, profileHash: sha256(profile) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const prepared = await prepareCalibrationProfile({ output: option(args, '--output'), operatorId: option(args, '--operator'),
    reviewerId: option(args, '--reviewer'), pythonExecutable: option(args, '--python'), imageTag: option(args, '--image') });
  console.log(JSON.stringify(prepared));
}
