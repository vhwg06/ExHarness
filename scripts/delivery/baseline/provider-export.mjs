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

export function reconcileOriginalResponse(raw, row, model) {
  if (model.provider !== 'nvidia_nim' || !['ORIGINAL_RESPONSE_ATTESTED', 'ASYNC_STATUS_RECORD'].includes(row.providerEvidenceMode) ||
      raw.schemaVersion !== 1 || raw.evidenceMode !== row.providerEvidenceMode ||
      raw.captureFormat !== 'NVIDIA_CHAT_COMPLETIONS_JSON_V1' || raw.requestId !== row.requestId || raw.taskId !== row.taskId)
    throw new Error('PROVIDER_EXPORT_INVALID: invalid NIM response attestation');
  const response = raw.response;
  if (response?.id !== row.providerRequestId || response.model !== model.providerModelId ||
      row.returnedModelId !== model.providerModelId || response.usage?.prompt_tokens !== row.inputTokens ||
      response.usage?.completion_tokens !== row.outputTokens)
    throw new Error('PROVIDER_EXPORT_INVALID: NIM response identity or usage differs from ledger');
  const cached = response.usage?.prompt_tokens_details?.cached_tokens ?? null;
  const cacheEvidence = cached === null ? 'NOT_REPORTED' : 'REPORTED';
  if (cached !== row.cachedInputTokens || cacheEvidence !== row.cacheEvidence)
    throw new Error('PROVIDER_EXPORT_INVALID: NIM cache evidence differs from ledger');
  if (row.providerEvidenceMode === 'ASYNC_STATUS_RECORD') {
    const trace = raw.statusTrace;
    if (!Array.isArray(trace) || trace.length < 2 || trace[0].httpStatus !== 202 || trace.at(-1).httpStatus !== 200 ||
        !trace.every(item => item.requestId === trace[0].requestId && [200, 202].includes(item.httpStatus)))
      throw new Error('PROVIDER_EXPORT_INVALID: incomplete NIM 202 status chain');
  } else if (raw.statusTrace?.length) {
    throw new Error('PROVIDER_EXPORT_INVALID: synchronous NIM completion has a status chain');
  }
  if (cached === null && model.cachedInputUsdPerMillion !== model.inputUsdPerMillion)
    throw new Error('PROVIDER_EXPORT_INVALID: cache price cannot be calculated from omitted usage');
  const pricedCached = cached ?? 0;
  const cost = ((row.inputTokens - pricedCached) * model.inputUsdPerMillion +
    pricedCached * model.cachedInputUsdPerMillion + row.outputTokens * model.outputUsdPerMillion) / 1_000_000;
  if (cost !== row.costUsd) throw new Error('PROVIDER_EXPORT_INVALID: NIM cost differs from registered pricing');
  return { cachedInputVerification: cacheEvidence };
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
  const nim = profile.model.provider === 'nvidia_nim';
  validateProfile(profile, { ...await fixtureIdentities(), requireLive: !nim, requirePilot: false });
  const openRouter = profile.model.credentialEnv === 'OPENROUTER_API_KEY';
  if (!nim && !openRouter && (profile.model.endpointOrigin !== 'https://api.openai.com' || profile.model.snapshot !== 'gpt-6-luna'))
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
  if (nim) {
    const expectedRef = row => `${row.taskId}/provider-responses/${row.requestId}.json`;
    const makeRecord = async row => {
      if (!/^[A-Za-z0-9-]+$/.test(row.taskId ?? '') || !/^[a-f0-9]{32}$/.test(row.requestId ?? '') ||
          row.providerEvidenceRef !== expectedRef(row) || !/^sha256:[a-f0-9]{64}$/.test(row.providerEvidenceHash ?? ''))
        throw new Error('PROVIDER_EXPORT_INVALID: NIM response evidence path or hash missing');
      const bytes = await readFile(join(root, row.providerEvidenceRef));
      if (sha256(bytes) !== row.providerEvidenceHash) throw new Error('PROVIDER_EXPORT_INVALID: NIM response evidence changed');
      const raw = JSON.parse(bytes.toString('utf8'));
      reconcileOriginalResponse(raw, row, profile.model);
      return { evidenceClass: 'PROVIDER_EVIDENCE', exportedBy: operatorId,
        evidenceMode: row.providerEvidenceMode, captureFormat: raw.captureFormat,
        sourceRef: `${profile.model.apiBaseUrl}/chat/completions`,
        providerRequestId: row.providerRequestId, rawRecordRef: row.providerEvidenceRef,
        rawRecordHash: row.providerEvidenceHash, capturedAt: raw.capturedAt,
        returnedModelId: row.returnedModelId, inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens, cacheEvidence: row.cacheEvidence,
        outputTokens: row.outputTokens, costUsd: row.costUsd };
    };
    const records = [];
    for (const row of settled) records.push(await makeRecord(row));
    if (existing !== null) {
      const stored = existing.split(/\r?\n/).filter(Boolean).map(JSON.parse);
      if (stored.length !== records.length || stored.some((record, index) => JSON.stringify(record) !== JSON.stringify(records[index])))
        throw new Error('PROVIDER_EXPORT_INVALID: existing NIM evidence export differs from provider responses');
      return { exported: records.length, operatorId, reused: true, evidenceMode: 'ORIGINAL_RESPONSE_ATTESTED' };
    }
    await createOnce(join(root, 'provider-export.jsonl'), Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n'));
    return { exported: records.length, operatorId, evidenceMode: 'ORIGINAL_RESPONSE_ATTESTED' };
  }
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
