import { createHash } from 'node:crypto';
import { open, readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureIdentities, validateProfile } from './contract.mjs';

const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const readLines = async path => (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);

async function createOnce(path, bytes) {
  try {
    const file = await open(path, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readFile(path)).equals(bytes)) throw error;
  }
}

export async function exportProviderRecords({ profilePath, output, reviewerId }) {
  const profile = await readJson(resolve(profilePath));
  validateProfile(profile, { ...await fixtureIdentities(), requireLive: true, requirePilot: false });
  if (profile.model.endpointOrigin !== 'https://api.openai.com' || profile.model.snapshot !== 'gpt-6-luna')
    throw new Error('PROVIDER_EXPORT_INVALID: this exporter supports pinned OpenAI GPT Luna only');
  if (reviewerId !== profile.reviewerId || reviewerId === profile.operatorId)
    throw new Error('PROVIDER_EXPORT_INVALID: independent reviewer identity required');
  const root = resolve(output);
  const manifest = await readJson(join(root, 'manifest.json'));
  if (manifest.profileHash !== (await import('./contract.mjs')).sha256(profile))
    throw new Error('PROVIDER_EXPORT_INVALID: profile differs from run manifest');
  const usage = await readLines(join(root, 'usage.jsonl'));
  const settled = usage.filter(row => row.status === 'SETTLED');
  if (!settled.length || settled.some(row => !row.providerRequestId))
    throw new Error('PROVIDER_EXPORT_INVALID: no settled provider requests');
  const existing = await readFile(join(root, 'provider-export.jsonl'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null) {
    const records = existing.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    if (records.length !== settled.length || records.some(record => !settled.some(row => row.providerRequestId === record.providerRequestId) ||
        record.exportedBy !== reviewerId)) throw new Error('PROVIDER_EXPORT_INVALID: existing export differs from settled usage');
    for (const record of records) if (sha256(await readFile(join(root, record.rawRecordRef))) !== record.rawRecordHash)
      throw new Error('PROVIDER_EXPORT_INVALID: existing raw record changed');
    return { exported: records.length, reviewerId, reused: true };
  }
  const recordsDir = join(root, 'provider-records');
  await mkdir(recordsDir, { recursive: true });
  const records = [];
  for (const row of settled) {
    if (!/^chatcmpl-[A-Za-z0-9_-]+$/.test(row.providerRequestId))
      throw new Error('PROVIDER_EXPORT_INVALID: unexpected OpenAI completion id');
    const sourceRef = `${profile.model.apiBaseUrl}/chat/completions/${encodeURIComponent(row.providerRequestId)}`;
    const response = await fetch(sourceRef, { headers: { Authorization: `Bearer ${process.env[profile.model.credentialEnv]}` } });
    if (!response.ok) throw new Error(`PROVIDER_EXPORT_INVALID: OpenAI retrieval failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) throw new Error('PROVIDER_EXPORT_INVALID: provider record too large');
    const raw = JSON.parse(bytes.toString('utf8'));
    if (raw.id !== row.providerRequestId || raw.model !== profile.model.snapshot || raw.service_tier !== 'default' || raw.usage?.prompt_tokens !== row.inputTokens ||
        raw.usage?.completion_tokens !== row.outputTokens || (raw.usage?.prompt_tokens_details?.cached_tokens ?? 0) !== row.cachedInputTokens)
      throw new Error('PROVIDER_EXPORT_INVALID: independently retrieved usage differs from ledger');
    const rawRecordRef = `provider-records/${row.providerRequestId}.json`;
    await createOnce(join(root, rawRecordRef), bytes);
    records.push({ evidenceClass: 'PROVIDER_EXPORT', exportedBy: reviewerId, retrievedAt: new Date().toISOString(),
      sourceRef, providerRequestId: row.providerRequestId, rawRecordRef, rawRecordHash: sha256(bytes),
      inputTokens: raw.usage.prompt_tokens, cachedInputTokens: raw.usage.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: raw.usage.completion_tokens, costUsd: row.costUsd });
  }
  await createOnce(join(root, 'provider-export.jsonl'), Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n'));
  return { exported: records.length, reviewerId };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profilePath = option(process.argv, '--profile'), output = option(process.argv, '--output'), reviewerId = option(process.argv, '--reviewer');
  if (!profilePath || !output || !reviewerId) throw new Error('usage: provider-export.mjs --profile <path> --output <dir> --reviewer <id>');
  console.log(JSON.stringify(await exportProviderRecords({ profilePath, output, reviewerId })));
}
