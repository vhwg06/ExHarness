import { createHash } from 'node:crypto';
import { open, readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureIdentities, validateProfile } from './contract.mjs';

const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const readLines = async path => (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);

export function reconcileStoredCompletion(raw, row, model) {
  if (model.credentialEnv === 'OPENROUTER_API_KEY') {
    const data = raw.data;
    if (data?.id !== row.providerRequestId || data.model !== model.resolvedModelId ||
        data.native_tokens_prompt !== row.inputTokens || data.native_tokens_completion !== row.outputTokens ||
        data.native_tokens_cached !== row.cachedInputTokens || data.total_cost !== row.costUsd)
      throw new Error('PROVIDER_EXPORT_INVALID: OpenRouter generation differs from ledger');
    return { cachedInputVerification: 'RETRIEVED_RECORD' };
  }
  if (raw.id !== row.providerRequestId || raw.model !== model.snapshot || raw.service_tier !== 'default' ||
      raw.usage?.prompt_tokens !== row.inputTokens || raw.usage?.completion_tokens !== row.outputTokens)
    throw new Error('PROVIDER_EXPORT_INVALID: independently retrieved usage differs from ledger');
  const cached = raw.usage?.prompt_tokens_details?.cached_tokens;
  if (cached != null && cached !== row.cachedInputTokens)
    throw new Error('PROVIDER_EXPORT_INVALID: retrieved cache usage differs from original response');
  return { cachedInputVerification: cached == null ? 'ORIGINAL_RESPONSE_ONLY' : 'RETRIEVED_RECORD' };
}

async function createOnce(path, bytes) {
  try {
    const file = await open(path, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readFile(path)).equals(bytes)) throw error;
  }
}

export async function exportProviderRecords({ profilePath, output, operatorId }) {
  const profile = await readJson(resolve(profilePath));
  validateProfile(profile, { ...await fixtureIdentities(), requireLive: true, requirePilot: false });
  const openRouter = profile.model.credentialEnv === 'OPENROUTER_API_KEY';
  if (!openRouter && (profile.model.endpointOrigin !== 'https://api.openai.com' || profile.model.snapshot !== 'gpt-6-luna'))
    throw new Error('PROVIDER_EXPORT_INVALID: unsupported provider');
  if (operatorId !== profile.operatorId)
    throw new Error('PROVIDER_EXPORT_INVALID: export actor must match registered operator');
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
        record.exportedBy !== operatorId || record.retrievalMethod !== (openRouter ? 'OPENROUTER_GENERATION_GET' : 'OPENAI_CHAT_COMPLETIONS_GET')))
      throw new Error('PROVIDER_EXPORT_INVALID: existing export differs from settled usage');
    for (const record of records) if (sha256(await readFile(join(root, record.rawRecordRef))) !== record.rawRecordHash)
      throw new Error('PROVIDER_EXPORT_INVALID: existing raw record changed');
    return { exported: records.length, operatorId, reused: true };
  }
  const recordsDir = join(root, 'provider-records');
  await mkdir(recordsDir, { recursive: true });
  const records = [];
  for (const row of settled) {
    if (!(openRouter ? /^gen-[A-Za-z0-9_-]+$/ : /^chatcmpl-[A-Za-z0-9_-]+$/).test(row.providerRequestId))
      throw new Error('PROVIDER_EXPORT_INVALID: unexpected provider completion id');
    const sourceRef = openRouter ? `${profile.model.apiBaseUrl}/generation?id=${encodeURIComponent(row.providerRequestId)}` :
      `${profile.model.apiBaseUrl}/chat/completions/${encodeURIComponent(row.providerRequestId)}`;
    const response = await fetch(sourceRef, { headers: { Authorization: `Bearer ${process.env[profile.model.credentialEnv]}` } });
    if (!response.ok) throw new Error(`PROVIDER_EXPORT_INVALID: provider retrieval failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) throw new Error('PROVIDER_EXPORT_INVALID: provider record too large');
    const raw = JSON.parse(bytes.toString('utf8'));
    const reconciliation = reconcileStoredCompletion(raw, row, profile.model);
    const rawRecordRef = `provider-records/${row.providerRequestId}.json`;
    await createOnce(join(root, rawRecordRef), bytes);
    records.push({ evidenceClass: 'PROVIDER_EXPORT', exportedBy: operatorId,
      retrievalMethod: openRouter ? 'OPENROUTER_GENERATION_GET' : 'OPENAI_CHAT_COMPLETIONS_GET', retrievedAt: new Date().toISOString(),
      sourceRef, providerRequestId: row.providerRequestId, rawRecordRef, rawRecordHash: sha256(bytes),
      inputTokens: openRouter ? raw.data.native_tokens_prompt : raw.usage.prompt_tokens, cachedInputTokens: row.cachedInputTokens,
      cachedInputVerification: reconciliation.cachedInputVerification,
      outputTokens: openRouter ? raw.data.native_tokens_completion : raw.usage.completion_tokens, costUsd: row.costUsd });
  }
  await createOnce(join(root, 'provider-export.jsonl'), Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n'));
  return { exported: records.length, operatorId };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profilePath = option(process.argv, '--profile'), output = option(process.argv, '--output'), operatorId = option(process.argv, '--operator');
  if (!profilePath || !output || !operatorId) throw new Error('usage: provider-export.mjs --profile <path> --output <dir> --operator <id>');
  console.log(JSON.stringify(await exportProviderRecords({ profilePath, output, operatorId })));
}
