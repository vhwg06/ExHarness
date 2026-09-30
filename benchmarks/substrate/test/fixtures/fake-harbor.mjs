#!/usr/bin/env node
// Deterministic stand-in for `harbor trials start` used only by substrate adapter tests.
// It writes the same trial-directory shape Harbor v0.23.0 writes (result.json, verifier/, artifacts/)
// without Docker, a model or a credential. FAKE_HARBOR_MODE selects the scripted trial outcome.
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const flag = name => { const index = argv.indexOf(name); return index === -1 ? null : argv[index + 1]; };
const mode = process.env.FAKE_HARBOR_MODE || 'pass';
if (process.env.FAKE_HARBOR_LOG) appendFileSync(process.env.FAKE_HARBOR_LOG, `${JSON.stringify({ argv, mode })}\n`);
const trialsDir = flag('--trials-dir');
const trialName = flag('--trial-name');
const agent = flag('-a');
if (argv[0] !== 'trials' || argv[1] !== 'start' || !trialsDir || !trialName || !flag('-p') || !agent) { process.stderr.write('fake-harbor: bad invocation\n'); process.exit(2); }
process.stdout.write(`fake-harbor ${mode} ${trialName}\n`);
if (mode === 'no-result') process.exit(1);

const trialDir = join(trialsDir, trialName);
mkdirSync(join(trialDir, 'verifier'), { recursive: true });
mkdirSync(join(trialDir, 'artifacts'), { recursive: true });
if (mode === 'malformed') { writeFileSync(join(trialDir, 'result.json'), '{ "id": '); process.exit(1); }

const t = second => `2026-01-01T00:00:${String(second).padStart(2, '0')}Z`;
const artifactDir = join(trialDir, 'artifacts', 'app', 'out');
const writeArtifact = () => {
  mkdirSync(join(artifactDir, 'nested'), { recursive: true });
  writeFileSync(join(artifactDir, 'result.txt'), 'calibrated\n');
  writeFileSync(join(artifactDir, 'nested', 'part.txt'), 'nested\n');
};
const result = {
  id: randomUUID(), trial_name: mode === 'foreign-trial' ? 'someone-else' : trialName,
  agent_info: { name: agent }, config: { environment: { delete: true } },
  started_at: t(0), finished_at: t(9),
  agent_setup: { started_at: t(1), finished_at: t(2) },
  agent_execution: { started_at: t(2), finished_at: t(5) },
  agent_result: { metadata: {} },
  verifier: { started_at: t(6), finished_at: t(8) },
  verifier_result: { rewards: { reward: 1 } },
  exception_info: null
};
if (mode === 'pass' || mode === 'usage') writeArtifact();
if (mode === 'usage') Object.assign(result.agent_result, { n_input_tokens: 100, n_output_tokens: 20, n_cache_tokens: 0, cost_usd: 0.25 });
if (mode === 'reject') { writeArtifact(); result.verifier_result.rewards.reward = 0; }
if (mode === 'rate-limit') {
  result.verifier_result = { rewards: { reward: 0 } };
  result.exception_info = { exception_type: 'ApiRateLimitError', exception_message: '429', occurred_at: t(4) };
}
if (mode === 'verifier-crash') {
  writeArtifact();
  result.verifier_result = null;
  result.exception_info = { exception_type: 'VerifierTimeoutError', exception_message: 'verifier timed out', occurred_at: t(7) };
}
if (mode === 'symlink') { mkdirSync(artifactDir, { recursive: true }); symlinkSync('/nonexistent/result.txt', join(artifactDir, 'result.txt')); }
writeFileSync(join(trialDir, 'artifacts', 'manifest.json'), JSON.stringify([{ source: '/app/out', destination: 'artifacts/app/out', type: 'directory', status: 'ok' }]));
if (result.verifier_result) {
  writeFileSync(join(trialDir, 'verifier', 'reward.txt'), `${result.verifier_result.rewards.reward}\n`);
  writeFileSync(join(trialDir, 'verifier', 'test-stdout.txt'), `fake verifier reward ${result.verifier_result.rewards.reward}\n`);
}
writeFileSync(join(trialDir, 'result.json'), JSON.stringify(result, null, 2));
