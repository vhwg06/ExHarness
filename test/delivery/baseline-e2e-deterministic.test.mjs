import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditValue, completeValue, evaluateValue } from '../../scripts/delivery/baseline/jev-value.mjs';
import { runFactualAudit } from '../../scripts/delivery/baseline/factual-audit.mjs';
import { ResourceState } from '../../scripts/delivery/baseline/resource-state.mjs';
import { calculateStudyReport } from '../../scripts/delivery/baseline/report.mjs';
import { coordinateDirectAttempt, createStudyManifest, exportStudy, loadValueProtocol } from '../../scripts/delivery/baseline/study.mjs';
import { runControlledTrials } from '../../scripts/delivery/baseline/controlled-trials.mjs';
import { createCoreArm } from '../../scripts/delivery/baseline/core-arm.mjs';
import { candidateDigest, verifyCandidate } from '../../scripts/delivery/baseline/fixture/acceptance.mjs';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, fixtureIdentities, sha256 } from '../../scripts/delivery/baseline/contract.mjs';

const baselineRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'delivery', 'baseline');
const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const TRIAL_FILES = ['server.mjs', 'index.html', 'client.js', 'smoke.mjs'];

async function testProfile() {
  const identities = await fixtureIdentities();
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const template = JSON.parse(await readFile(join(baselineRoot, 'profile.json'), 'utf8'));
  const armHash = sha256({ model: template.model, nodeVersion: NODE_VERSION, miniCommit: MINI_COMMIT,
    agentImageDigest: IMAGE_DIGEST, budgets: PROTOCOL.budgets });
  return { ...template, template: false, experimentId: 'e2e-deterministic', operatorId: 'operator', reviewerId: 'reviewer',
    protocolHash: `sha256:${sha256(value)}`, candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40),
    ...identities, nodeVersion: NODE_VERSION, playwrightVersion: PLAYWRIGHT_VERSION,
    pythonExecutable: 'C:/python312/python.exe', pythonVersion: '3.12.13',
    nodeImageDigest: IMAGE_DIGEST, browserDigest: IMAGE_DIGEST, pythonLockDigest: IMAGE_DIGEST,
    agentImageDigest: IMAGE_DIGEST, agentImage: `fixture@${IMAGE_DIGEST}`,
    budgets: structuredClone(PROTOCOL.budgets), calibrationTaskIds: [...CALIBRATION_TASK_IDS],
    contexts: [], armProfileHashes: { DIRECT: armHash, EXHARNESS: armHash } };
}

function transport() {
  let calls = 0;
  const call = async payload => {
    calls += 1;
    if (payload.questions.value) {
      return { response: { model: payload.model, answers: { value: { type: 'choice', choice: 'VALUE_DEMONSTRATED', confidence: 0.8,
        probabilities: { VALUE_DEMONSTRATED: 0.8, NO_VALUE_DEMONSTRATED: 0.1, INCONCLUSIVE: 0.1 } } }, usage: { input_tokens: 1200, output_tokens: 1 } }, attempts: 1 };
    }
    const answers = {};
    for (const id of Object.keys(payload.questions)) answers[id] = { type: 'choice', choice: 'SATISFIED', confidence: 0.9,
      probabilities: { SATISFIED: 0.9, INSUFFICIENT_EVIDENCE: 0.05, CONTRADICTED: 0.05 } };
    return { response: { model: payload.model, answers, usage: { input_tokens: 1800, output_tokens: 6 } }, attempts: 1 };
  };
  return { call, calls: () => calls };
}

test('deterministic rehearsal runs register, execute, controlled, audit, two-stage double, export and audit', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-e2e-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const keyRoot = await mkdtemp(join(tmpdir(), 'baseline-e2e-keys-'));
  t.after(() => rm(keyRoot, { recursive: true, force: true }));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const profile = await testProfile();
  profile.qualificationHash = `sha256:${'c'.repeat(64)}`;
  profile.qualificationProfileId = 'A';
  profile.qualificationRef = 'qualification.json';
  profile.cohortId = `${value.studyId}:e2e-deterministic`;
  const identities = await fixtureIdentities();
  const keyPair = generateKeyPairSync('ed25519');
  await writeFile(join(keyRoot, 'private.pem'), keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await writeFile(join(keyRoot, 'public.pem'), keyPair.publicKey.export({ type: 'spki', format: 'pem' }));
  const { createHash } = await import('node:crypto');
  const trustedFingerprint = `sha256:${createHash('sha256').update(keyPair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`;

  // Register a deterministic cohort: the manifest shape is real, the evidence
  // class is explicitly deterministic and never a live benchmark claim.
  const canaryBody = { schemaVersion: 1, evidenceClass: 'LIVE_CANARY', task: 'NONCE_MARKER',
    profileHash: sha256(profile), candidateSha: profile.candidateSha, candidateTree: profile.candidateTree,
    modelId: profile.model.providerModelId, nonce: 'e2e', marker: 'CANARY-MARKER-e2e',
    markerRef: 'canary/attempt-1/candidate/marker.txt', trajectoryRef: 'canary/attempt-1/trajectory.json',
    ledgerRef: 'executions/CANARY:AUX/provider-ledger.jsonl', toolTurns: 2, toolResults: 2,
    toolTurnsInterleaved: true, wireRequests: 1, inputTokens: 400, outputTokens: 90, apiUsd: 0,
    activeMs: 60000, exitStatus: 'Submitted', driverFailed: null,
    caps: { maxWireRequests: 4, maxTotalTokens: 50000, maxActiveSeconds: 1200, maxApiUsd: 5 },
    status: 'PASS', generatedAt: '2026-09-26T00:00:00.000Z' };
  const canary = { ...canaryBody, digest: `sha256:${sha256(canaryBody)}` };
  const registered = await createStudyManifest({ profile, identities, protocol: value,
    jevTrustedPublicKeyFingerprint: trustedFingerprint, canary });
  const deterministicBody = { ...registered, evidenceClass: 'DETERMINISTIC_REGISTRATION' };
  delete deterministicBody.digest;
  const manifest = { ...deterministicBody, digest: `sha256:${sha256(deterministicBody)}` };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
  await mkdir(join(output, 'canary'), { recursive: true });
  await writeFile(join(output, 'canary', 'canary.json'), JSON.stringify(canary));

  // Execute all twelve through the real DIRECT seam and the real Core adapter
  // with mechanical producers and the independent verifier. No provider calls.
  const executions = [];
  for (const task of manifest.tasks) {
    const executionDir = join(output, 'executions', task.executionId.replaceAll(':', '__'));
    const candidateDir = join(executionDir, 'attempt-1', 'candidate');
    await mkdir(candidateDir, { recursive: true });
    for (const name of TRIAL_FILES) await copyFile(join(baselineRoot, 'fixture', name), join(candidateDir, name));
    const resetDigest = await candidateDigest(candidateDir);
    const started = Date.now();
    let verification;
    let candidate;
    let core = null;
    if (task.arm === 'DIRECT') {
      const coordinated = await coordinateDirectAttempt({
        runExecutor: async () => {
          await writeFile(join(candidateDir, 'server.mjs'), `${await readFile(join(candidateDir, 'server.mjs'), 'utf8')}\n// e2e-producer\n`);
          const digest = await candidateDigest(candidateDir);
          return { candidateDigest: digest, candidateRef: `executions/${task.executionId.replaceAll(':', '__')}/attempt-1/candidate`,
            provider: { wireRequests: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: false },
            timing: { activeMs: 1, providerWaitMs: 0 }, driverResult: { deterministic: true } };
        },
        verifyCandidate: async produced => verifyCandidate({ candidateDir, fault: task.taskId, browser: true })
          .then(result => ({ status: result.status, candidateDigest: result.candidateDigest, checks: result.checks })) });
      verification = { status: coordinated.verification.status, checks: coordinated.verification.checks,
        candidateDigest: coordinated.verification.candidateDigest };
      candidate = coordinated.common.candidateDigest;
    } else {
      const arm = createCoreArm({ directory: executionDir, executionId: task.executionId, cohortId: manifest.cohortId,
        work: { taskId: task.taskId, pairId: task.pairId, repeat: task.repeat },
        seedCandidate: { id: task.executionId, version: resetDigest },
        executeAttempt: async () => {
          await writeFile(join(candidateDir, 'server.mjs'), `${await readFile(join(candidateDir, 'server.mjs'), 'utf8')}\n// e2e-producer\n`);
          const digest = await candidateDigest(candidateDir);
          return { candidateDigest: digest, candidateRef: 'candidate',
            provider: { wireRequests: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: false },
            timing: { activeMs: 1, providerWaitMs: 0 }, driverResult: { deterministic: true } };
        },
        verifyCandidate: async () => {
          const result = await verifyCandidate({ candidateDir, fault: task.taskId, browser: true });
          return { status: result.status, candidateDigest: result.candidateDigest, checks: result.checks };
        },
        clock: () => new Date().toISOString() });
      const result = await arm.run({ attemptId: `${task.executionId}:attempt-1`, taskId: task.taskId,
        fault: task.taskId, verificationRef: `executions/${task.executionId.replaceAll(':', '__')}/attempt-1/verification.json` });
      const details = result.verification?.details ?? result.verification;
      verification = { status: details?.status === 'PASS' ? 'ACCEPTED' : details?.status === 'FAIL' ? 'REJECTED' : details?.status ?? 'INCONCLUSIVE',
        checks: details?.checks ?? [], candidateDigest: result.candidateDigest };
      candidate = result.candidateDigest;
      core = { eventCounts: result.core.eventCounts, stateBytes: result.core.stateBytes };
    }
    const activeMs = Math.max(1, Date.now() - started);
    const checks = verification.checks ?? [];
    const verificationPath = join(executionDir, 'attempt-1', 'verification.json');
    await writeFile(verificationPath, JSON.stringify({ ...verification, taskId: task.taskId, arm: task.arm,
      executionId: task.executionId, candidateDigest: candidate, independent: true, evidenceClass: 'DETERMINISTIC' }));
    const { createHash } = await import('node:crypto');
    executions.push({ schemaVersion: 1, evidenceClass: 'DETERMINISTIC', executionId: task.executionId,
      pairId: task.pairId, taskId: task.taskId, repeat: task.repeat, arm: task.arm,
      attemptId: `${task.executionId}:attempt-1`, profileHash: manifest.profileHash,
      promptHash: `sha256:${sha256('e2e-prompt')}`, resetDigest, candidateDigest: candidate, attemptCount: 1,
      terminalReason: verification.status === 'ACCEPTED' ? 'COMPLETED' : 'ATTEMPT_LIMIT',
      verificationStatus: verification.status, checksPassed: checks.filter(item => item.pass).length,
      checksTotal: checks.length, verificationChecks: checks.map(item => ({ check: item.check, pass: Boolean(item.pass) })),
      verificationHash: `sha256:${createHash('sha256').update(await readFile(verificationPath)).digest('hex')}`,
      accepted: false,
      provider: { wireRequests: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageUnknown: false, apiUsd: 0 },
      timing: { registeredAt: task.registeredStart, startedAt: task.registeredStart,
        terminalAt: new Date().toISOString(), activeMs, attemptActiveMs: activeMs, providerWaitMs: 0,
        elapsedMs: activeMs, phases: { executorMs: activeMs, verifyMs: null, coreMs: null } },
      overheadUsd: null, humanIntervals: [], core });
  }
  await writeFile(join(output, 'metrics.json'), JSON.stringify({ schemaVersion: 1, studyId: manifest.studyId, executions }));
  const resource = new ResourceState({ journalPath: join(output, 'events.jsonl'), experimentId: manifest.studyId,
    profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree,
    protocolHash: manifest.protocolHash, limits: value.limits });
  for (const task of manifest.tasks) {
    await resource.registerExecution({ ...task, deadline: '2026-09-29T00:00:00.000Z' });
    await resource.terminal({ executionId: task.executionId, reason: 'COMPLETED' });
  }
  const report = calculateStudyReport({ manifest, metrics: { schemaVersion: 1, studyId: manifest.studyId, executions },
    observationAsOf: '2026-09-26T03:00:00.000Z', resourceState: await resource.state() });
  assert.equal(report.complete, false);
  assert.equal(report.evidenceClass, 'DETERMINISTIC');
  await writeFile(join(output, 'report.json'), JSON.stringify(report));

  // Controlled trials run for real with the same mechanical producers.
  const controlled = await runControlledTrials({ profile: { candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree }, output });
  assert.equal(controlled.count, 24);

  // Setup and qualification stubs bound to the manifest hashes.
  const probes = [1, 2].map(index => ({ probeId: `PROBE-${index}`, requestId: `probe-request-${index}`,
    providerRequestId: `provider-probe-${index}`, inputTokens: 20, outputTokens: 4, costUsd: 0,
    providerEvidenceRef: `setup/probe-${index}/provider-response.json`,
    providerEvidenceHash: null,
    toolCall: { toolCallId: `probe-call-${index}`, toolName: 'bash', command: `printf 'EXHARNESS_PROBE_${index}'` } }));
  const { createHash: e2eHash } = await import('node:crypto');
  for (const probe of probes) {
    await mkdir(join(output, 'setup', `probe-${probe.probeId.slice(-1)}`), { recursive: true });
    const bytes = Buffer.from(JSON.stringify({ id: `e2e-${probe.probeId}` }) + '\n');
    await writeFile(join(output, probe.providerEvidenceRef), bytes);
    probe.providerEvidenceHash = `sha256:${e2eHash('sha256').update(bytes).digest('hex')}`;
    await writeFile(join(output, 'setup', probe.probeId.toLowerCase(), 'result.json'), JSON.stringify({ status: 'PASS',
      providerEvidenceRef: probe.providerEvidenceRef, providerEvidenceHash: probe.providerEvidenceHash,
      toolCall: probe.toolCall, usage: { outputTokens: probe.outputTokens } }));
  }
  await writeFile(join(output, 'setup', 'probes.json'), JSON.stringify({ schemaVersion: 1, evidenceClass: 'LIVE_PROVIDER_PROBES',
    modelId: profile.model.providerModelId, required: 2, outputTokenLimit: value.limits.maxProbeOutputTokens,
    probes, failures: [], selectedProfileId: 'A', qualificationHash: manifest.qualificationHash }));
  await writeFile(join(output, 'qualification.json'), JSON.stringify({ qualificationHash: manifest.qualificationHash, selectedProfileId: 'A' }));

  // Factual gate (completion not required for the rehearsal), then the
  // deterministic two-stage double, export and audit.
  const factual = await runFactualAudit({ output, allowDeterministic: true, requireComplete: false });
  assert.ok(factual.checks.includes('controlled-trials'));
  const fake = transport();
  const evaluated = await evaluateValue({ output, callJevImpl: fake.call, allowDeterministic: true,
    privateKeyPath: join(keyRoot, 'private.pem'), publicKeyPath: join(keyRoot, 'public.pem') });
  assert.equal(fake.calls(), 2);
  assert.equal(evaluated.finalChoice, 'VALUE_DEMONSTRATED');
  assert.equal(evaluated.evidenceClass, 'DETERMINISTIC_VALUE_EVALUATION');
  assert.equal((await auditValue({ output, publicKeyPath: join(keyRoot, 'public.pem'), allowDeterministic: true })).finalChoice, 'VALUE_DEMONSTRATED');
  await assert.rejects(() => completeValue({ output, publicKeyPath: join(keyRoot, 'public.pem'), allowDeterministic: true }),
    /complete twelve-execution factual report/);
  const exported = await exportStudy(output);
  const handoff = JSON.parse(await readFile(join(output, 'handoff.json'), 'utf8'));
  const refs = new Set(handoff.files.map(row => row.ref));
  for (const ref of ['jev-stage-one.request.json', 'jev-stage-one.response.json', 'jev-stage-one.receipt.json',
      'jev-stage-two.request.json', 'jev-stage-two.response.json', 'jev-stage-two.receipt.json',
      'value.json', 'controlled-trials.json', 'canary/canary.json']) assert.ok(refs.has(ref), ref);
  assert.equal(exported.output, 'handoff.json');
});
