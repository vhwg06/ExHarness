import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, fixtureIdentities, sha256, validateProfile } from './contract.mjs';
import { ResourceState, portableResourceState, writeAtomicJson } from './resource-state.mjs';

const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_QUALIFICATION_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const nowIso = () => new Date().toISOString();
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);

function protocolHash(value) { return `sha256:${sha256(value)}`; }

function profileSpec(profile) {
  return {
    id: profile.qualificationProfileId ?? null,
    providerModelId: profile.model?.providerModelId ?? null,
    enableThinking: profile.model?.enableThinking ?? null,
    reasoningBudget: profile.model?.reasoningBudget ?? null,
    toolChoice: profile.model?.toolChoice ?? null,
    requestTimeoutSeconds: profile.model?.requestTimeoutSeconds ?? null
  };
}

function armHash(profile) {
  return sha256({ model: profile.model, nodeVersion: profile.nodeVersion, miniCommit: profile.miniCommit,
    agentImageDigest: profile.agentImageDigest, budgets: profile.budgets });
}

export function makeQualificationProfile(baseProfile, spec, value) {
  if (!baseProfile?.model || !spec?.id) fail('base profile and qualification profile spec are required');
  const model = {
    ...baseProfile.model,
    enableThinking: Boolean(spec.enableThinking),
    reasoningBudget: null,
    toolChoice: structuredClone(spec.toolChoice),
    requestTimeoutSeconds: value.qualification.requestTimeoutSeconds
  };
  const profile = {
    ...structuredClone(baseProfile),
    template: false,
    protocolId: value.protocolId,
    protocolHash: protocolHash(value),
    qualificationProfileId: spec.id,
    model,
    armProfileHashes: { DIRECT: null, EXHARNESS: null }
  };
  const hash = armHash(profile);
  profile.armProfileHashes = { DIRECT: hash, EXHARNESS: hash };
  return profile;
}

function artifactBody(artifact) {
  return Object.fromEntries(Object.entries(artifact).filter(([key]) => !['qualificationHash', 'digest'].includes(key)));
}

function qualificationHash(artifact) { return `sha256:${sha256(artifactBody(artifact))}`; }

function artifactDigest(artifact) {
  const body = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'digest'));
  return `sha256:${sha256(body)}`;
}

function compactProbeResult(result) {
  if (!result) return null;
  return {
    schemaVersion: result.schemaVersion ?? 1,
    probeId: result.probeId ?? null,
    status: result.status ?? null,
    requestId: result.requestId ?? null,
    providerRequestId: result.providerRequestId ?? null,
    providerModelId: result.providerModelId ?? null,
    providerAdmission: result.providerAdmission ?? null,
    resourceCode: result.resourceCode ?? null,
    errorType: result.errorType ?? null,
    usage: result.usage ?? null,
    toolCall: result.toolCall ?? null,
    providerEvidenceRef: result.providerEvidenceRef ?? null,
    providerEvidenceHash: result.providerEvidenceHash ?? null,
    evidenceClass: result.evidenceClass ?? null,
    terminalAt: result.terminalAt ?? null
  };
}

function compactProbeManifest(manifest) {
  if (!manifest) return null;
  return {
    evidenceClass: manifest.evidenceClass ?? null,
    modelId: manifest.modelId ?? null,
    required: manifest.required ?? null,
    attempted: manifest.attempted ?? null,
    outputTokenLimit: manifest.outputTokenLimit ?? null,
    selectedProfileId: manifest.selectedProfileId ?? null,
    failures: (manifest.failures ?? []).map(failure => ({
      probeId: failure.probeId ?? null,
      profileId: failure.profileId ?? null,
      reason: failure.reason ?? null,
      result: compactProbeResult(failure.result)
    })),
    probes: (manifest.probes ?? []).map(probe => ({
      probeId: probe.probeId,
      profileId: probe.profileId ?? null,
      requestId: probe.requestId ?? null,
      providerRequestId: probe.providerRequestId ?? null,
      inputTokens: probe.inputTokens ?? null,
      outputTokens: probe.outputTokens ?? null,
      costUsd: probe.costUsd ?? null,
      providerEvidenceRef: probe.providerEvidenceRef ?? null,
      providerEvidenceHash: probe.providerEvidenceHash ?? null,
      toolCall: probe.toolCall ?? null
    }))
  };
}

export function validateQualificationArtifact({ artifact, profile, value }) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.evidenceClass !== 'LIVE_QUALIFICATION' ||
      artifact.status !== 'READY' || artifact.protocolId !== value.protocolId ||
      artifact.protocolHash !== protocolHash(value)) fail('qualification artifact is not a ready CORE_VALUE_V2 result', 3);
  if (artifact.qualificationHash !== qualificationHash(artifact) || artifact.digest !== artifactDigest(artifact))
    fail('qualification artifact hash is invalid', 3);
  if (artifact.candidateSha !== profile.candidateSha || artifact.candidateTree !== profile.candidateTree)
    fail('qualification candidate binding differs from the selected profile', 3);
  if (profile.protocolId !== value.protocolId || profile.protocolHash !== protocolHash(value) ||
      profile.qualificationHash !== artifact.qualificationHash || profile.qualificationProfileId !== artifact.selectedProfileId)
    fail('selected profile is not bound to the qualification artifact', 3);
  const selected = artifact.attempts?.find(item => item.profileId === artifact.selectedProfileId);
  if (!selected?.ready || selected.probes?.length < value.qualification.requiredSuccessfulProbes)
    fail('selected qualification profile lacks the required settled probes', 3);
  const expectedSpec = profileSpec(profile);
  if (canonical(expectedSpec) !== canonical(artifact.selectedProfileSpec))
    fail('selected profile request configuration differs from qualification evidence', 3);
  const attempted = artifact.attempts.flatMap(item => [...(item.probes ?? []), ...(item.failures ?? [])]).length;
  if (attempted > value.qualification.maxWireAttempts)
    fail('qualification campaign exceeded its registered wire-attempt limit', 3);
  for (const probe of selected.probes) {
    const usage = probe.usage ?? { inputTokens: probe.inputTokens, outputTokens: probe.outputTokens };
    if (probe.status !== 'PASS' || probe.providerModelId !== profile.model.providerModelId ||
        probe.toolCall?.toolName !== 'bash' || !probe.providerEvidenceRef || !probe.providerEvidenceHash ||
        !Number.isInteger(usage.outputTokens) || usage.outputTokens > value.limits.maxProbeOutputTokens)
      fail('qualification probe is not a settled, attested bash call', 3);
  }
  return true;
}

async function readProbeManifest(path) { return plainJson(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)); }

async function writeCurrentArtifact(path, artifact) {
  const prior = await plainJson(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (prior?.status === 'READY' && canonical(prior) !== canonical(artifact)) fail('ready qualification artifact is immutable', 4);
  await writeAtomicJson(path, artifact);
}

export async function runQualification({ profile: baseProfile, profilePath = null, output, clock = () => new Date() } = {}) {
  if (!baseProfile || !output) fail('profile and output are required');
  const { loadValueProtocol, runProviderProbes } = await import('./study.mjs');
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const identities = await fixtureIdentities();
  const baseProfileHash = `sha256:${sha256(baseProfile)}`;
  const campaignId = baseProfile.qualificationCampaignId ?? `${value.studyId}:qualification:${baseProfile.candidateSha}`;
  const campaignRoot = resolve(output);
  const protocolDigest = protocolHash(value);
  let campaignManifest = { schemaVersion: 1, evidenceClass: 'LIVE_QUALIFICATION_CAMPAIGN', campaignId,
    protocolId: value.protocolId, protocolHash: protocolDigest, baseProfileHash,
    candidateSha: baseProfile.candidateSha, candidateTree: baseProfile.candidateTree, startedAt: nowIso() };
  const campaignPath = join(campaignRoot, 'campaign.json');
  const priorCampaign = await plainJson(campaignPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (priorCampaign) {
    if (canonical(priorCampaign) !== canonical({ ...campaignManifest, startedAt: priorCampaign.startedAt }))
      fail('qualification campaign identity changed on resume', 4);
    campaignManifest = priorCampaign;
  } else await writeAtomicJson(campaignPath, campaignManifest);
  const existingQualification = await plainJson(join(campaignRoot, 'qualification.json')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existingQualification?.status === 'READY') {
    const selectedProfilePath = join(campaignRoot, 'profile.selected.json');
    const selectedProfile = await plainJson(selectedProfilePath).catch(() => null);
    if (!selectedProfile) fail('ready qualification is missing its selected profile', 4);
    validateQualificationArtifact({ artifact: existingQualification, profile: selectedProfile, value });
    return { mode: 'qualification', status: 'READY', output: campaignRoot, selectedProfile: selectedProfilePath,
      qualificationRef: join(campaignRoot, 'qualification.json'), wireRequests: null, exitCode: 0 };
  }
  const probeValue = { ...value, limits: { ...value.limits,
    maxCohortWallSeconds: value.qualification.deadlineSeconds,
    maxProbeRequests: value.qualification.maxWireAttempts,
    maxProbeUsd: value.qualification.maxUsd } };
  const resource = new ResourceState({ journalPath: join(campaignRoot, 'events.jsonl'), experimentId: campaignId,
    profileHash: baseProfileHash, candidateSha: baseProfile.candidateSha, candidateTree: baseProfile.candidateTree,
    protocolHash: protocolDigest, limits: { ...probeValue.limits, maxCohortApiUsd: value.qualification.maxUsd }, now: clock });
  const attempts = [];
  let selected = null;
  let campaignStatus = 'FAILED';
  for (const spec of value.qualification.profiles) {
    if (selected) break;
    const variant = makeQualificationProfile(baseProfile, spec, value);
    validateProfile(variant, { ...identities, requireLive: true, requirePilot: false,
      protocolId: value.protocolId, protocolHash: protocolDigest });
    const profileDir = join(campaignRoot, 'profiles', spec.id);
    const manifest = { ...campaignManifest, registeredAt: campaignManifest.startedAt };
    const result = await runProviderProbes({ profile: variant, output: profileDir, manifest, resource, clock, value: probeValue });
    const probeManifest = await readProbeManifest(join(profileDir, 'setup', 'probes.json'));
    const record = { profileId: spec.id, profileSpec: profileSpec(variant), ready: Boolean(result.ready),
      prerequisiteMissing: Boolean(result.prerequisiteMissing), unresolvedProvider: Boolean(result.unresolvedProvider),
      resourceExhausted: Boolean(result.resourceExhausted), probes: (probeManifest?.probes ?? []).map(probe => ({ ...probe,
        status: 'PASS', providerModelId: variant.model.providerModelId,
        usage: { inputTokens: probe.inputTokens ?? null, outputTokens: probe.outputTokens ?? null,
          cachedInputTokens: probe.cachedInputTokens ?? null } })),
      failures: (probeManifest?.failures ?? []).map(failure => ({ ...failure, result: compactProbeResult(failure.result) })),
      outputRef: relative(campaignRoot, profileDir).replaceAll('\\', '/') };
    attempts.push(record);
    if (result.ready) {
      selected = { spec, variant, record };
      campaignStatus = 'READY';
      break;
    }
    const state = await resource.state();
    if (result.unresolvedProvider) { campaignStatus = 'UNRESOLVED_PROVIDER'; break; }
    if (result.resourceExhausted) { campaignStatus = 'RESOURCE_EXHAUSTED'; break; }
    if (state.routeNextEligibleAt && Date.parse(state.routeNextEligibleAt) > Date.now()) { campaignStatus = 'WAITING_PROVIDER'; break; }
    if (state.counters.wireRequests >= value.qualification.maxWireAttempts) break;
  }
  const state = await resource.state();
  if (!selected && campaignStatus === 'FAILED' && state.routeNextEligibleAt && Date.parse(state.routeNextEligibleAt) > Date.now()) campaignStatus = 'WAITING_PROVIDER';
  const failures = attempts.flatMap(item => item.failures.map(failure => ({ profileId: item.profileId, ...failure })));
  const body = {
    schemaVersion: 1,
    evidenceClass: 'LIVE_QUALIFICATION',
    status: campaignStatus,
    protocolId: value.protocolId,
    protocolHash: protocolDigest,
    campaignId,
    baseProfileHash,
    candidateSha: baseProfile.candidateSha,
    candidateTree: baseProfile.candidateTree,
    requiredSuccessfulProbes: value.qualification.requiredSuccessfulProbes,
    maxWireAttempts: value.qualification.maxWireAttempts,
    selectedProfileId: selected?.spec.id ?? null,
    selectedProfileSpec: selected ? profileSpec(selected.variant) : null,
    attempts,
    failures,
    resource: { evidenceClass: 'LIVE_RESOURCE_CAMPAIGN', journalRef: 'events.jsonl',
      wireRequests: state.counters.wireRequests, settled: state.counters.settled,
      notAdmitted: state.counters.notAdmitted, unknown: state.counters.unknown,
      stateHash: `sha256:${sha256(portableResourceState(state))}` },
    completedAt: nowIso()
  };
  const artifact = { ...body, qualificationHash: qualificationHash(body) };
  artifact.digest = artifactDigest(artifact);
  await writeCurrentArtifact(join(campaignRoot, 'qualification.json'), artifact);
  if (selected) {
    const selectedProfile = { ...selected.variant,
      qualificationHash: artifact.qualificationHash,
      qualificationRef: 'qualification.json',
      cohortId: `${value.studyId}:${artifact.qualificationHash.slice(-12)}` };
    const selectedHash = armHash(selectedProfile);
    selectedProfile.armProfileHashes = { DIRECT: selectedHash, EXHARNESS: selectedHash };
    validateProfile(selectedProfile, { ...identities, requireLive: true, requirePilot: false,
      protocolId: value.protocolId, protocolHash: protocolDigest });
    await writeAtomicJson(join(campaignRoot, 'profile.selected.json'), selectedProfile);
  }
  const exitCode = campaignStatus === 'READY' ? 0 : campaignStatus === 'WAITING_PROVIDER' ? 10 :
    campaignStatus === 'UNRESOLVED_PROVIDER' ? 11 : campaignStatus === 'RESOURCE_EXHAUSTED' ? 12 : 3;
  return { mode: 'qualification', status: campaignStatus, output: campaignRoot,
    selectedProfile: selected ? join(campaignRoot, 'profile.selected.json') : null,
    qualificationRef: join(campaignRoot, 'qualification.json'), wireRequests: state.counters.wireRequests, exitCode };
}

export async function main(args = process.argv.slice(2)) {
  const profilePath = option(args, '--profile');
  const output = option(args, '--output');
  if (!profilePath || !output) fail('--profile and --output are required');
  const profile = await plainJson(resolve(profilePath));
  return runQualification({ profile, profilePath: resolve(profilePath), output: resolve(output) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.exitCode) process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 4;
  }
}
