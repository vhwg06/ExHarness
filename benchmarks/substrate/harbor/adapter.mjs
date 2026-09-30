// Harbor substrate adapter: implements SubstratePort around one pinned Harbor child process per attempt.
// It owns process invocation, trial identity, fresh reset, artifact/verifier extraction, raw evidence
// references and the truthful Harbor-to-normalized failure mapping. packages/benchmark stays Harbor-free.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARBOR_PIN, digest, sha256, taskBundleDigests, instructionDigest, readTaskDeclaration, isRegularTree } from './identity.mjs';

export const AGENT_MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const CALIBRATION_AGENT = 'harbor_agent:CalibrationProducerAgent';
export const EVALUATOR_IDENTITY = `harbor-task-verifier@${HARBOR_PIN.version}`;

// Harbor exception type -> normalized dimension. Anything unlisted during agent execution is AGENT_ERROR.
export const FAILURE_MAPPING = Object.freeze({
  environment: Object.freeze({ EnvironmentStartTimeoutError: 'ENV_BUILD', SandboxBuildFailedError: 'ENV_BUILD' }),
  runtime: Object.freeze({ HealthcheckError: 'ENV_RUNTIME', MemoryLimitExceededError: 'ENV_RUNTIME', SandboxLikelyOutOfMemoryError: 'ENV_RUNTIME', GKEExecStreamClosedError: 'ENV_RUNTIME' }),
  setup: Object.freeze({ AgentSetupTimeoutError: 'ADAPTER_SETUP' }),
  timeout: Object.freeze({ AgentTimeoutError: 'AGENT_TIMEOUT' }),
  provider: Object.freeze({
    ApiRateLimitError: 'RATE_LIMITED', ApiUsageLimitError: 'RATE_LIMITED',
    ApiResponseStalledError: 'PROVIDER_TIMEOUT', ApiConnectionClosedError: 'PROVIDER_TIMEOUT',
    ApiInternalServerError: 'PROVIDER_5XX', ApiOverloadedError: 'PROVIDER_5XX'
  }),
  verifier: Object.freeze({
    RewardFileNotFoundError: 'VERIFIER_ERROR', RewardFileEmptyError: 'VERIFIER_ERROR', VerifierOutputParseError: 'VERIFIER_ERROR',
    VerifierTimeoutError: 'VERIFIER_ERROR', AddTestsDirError: 'VERIFIER_ERROR', DownloadVerifierDirError: 'VERIFIER_ERROR'
  })
});

const SAFE = value => String(value).replace(/[^A-Za-z0-9._-]/g, '_');
const exists = async path => { try { await stat(path); return true; } catch { return false; } };

// Phase in which a Harbor exception occurred: a phase that never started, or the exception time
// relative to the verifier start (Harbor still runs the verifier after an agent-side failure).
function phaseOfFailure(result) {
  if (!result?.agent_setup) return 'environment';
  if (!result?.agent_execution) return 'setup';
  const occurred = Date.parse(result?.exception_info?.occurred_at ?? '');
  const verifierStart = Date.parse(result?.verifier?.started_at ?? '');
  if (!result?.verifier || Number.isNaN(verifierStart) || Number.isNaN(occurred) || occurred < verifierStart) return 'execution';
  return 'verifier';
}

// Pure mapping from a Harbor trial result (plus adapter-observed extraction) to the normalization input.
export function mapHarborResult(result, { extractionStatus, verifierEvidenceRef, evaluatorIdentity = EVALUATOR_IDENTITY }) {
  const exceptionType = result?.exception_info?.exception_type ?? null;
  const metadata = result?.agent_result?.metadata ?? {};
  let infrastructureStatus = 'NONE';
  let providerStatus = 'NONE';
  let termination = 'COMPLETED';
  let producerStatus = typeof metadata.producerStatus === 'string' ? metadata.producerStatus : 'SUCCESS';
  let verifierFailed = false;
  if (exceptionType) {
    const phase = phaseOfFailure(result);
    if (FAILURE_MAPPING.verifier[exceptionType]) verifierFailed = true;
    else if (FAILURE_MAPPING.environment[exceptionType] || phase === 'environment') infrastructureStatus = 'ENV_BUILD';
    else if (FAILURE_MAPPING.runtime[exceptionType]) infrastructureStatus = 'ENV_RUNTIME';
    else if (FAILURE_MAPPING.setup[exceptionType] || phase === 'setup') infrastructureStatus = 'ADAPTER_SETUP';
    else if (FAILURE_MAPPING.timeout[exceptionType]) { termination = 'AGENT_TIMEOUT'; producerStatus = 'TIMEOUT'; }
    else if (FAILURE_MAPPING.provider[exceptionType]) { providerStatus = FAILURE_MAPPING.provider[exceptionType]; termination = 'AGENT_ERROR'; producerStatus = 'ERROR'; }
    else if (phase === 'execution') { termination = 'AGENT_ERROR'; producerStatus = 'ERROR'; }
    else verifierFailed = true;
  }
  if (!exceptionType && typeof metadata.termination === 'string' && ['COMPLETED', 'BUDGET_EXHAUSTED'].includes(metadata.termination)) termination = metadata.termination;
  if (['ENV_BUILD', 'ADAPTER_SETUP'].includes(infrastructureStatus)) producerStatus = 'NOT_STARTED';
  if (extractionStatus === 'FAILED' && infrastructureStatus === 'NONE') infrastructureStatus = 'ARTIFACT_EXTRACTION';
  const providerFailure = providerStatus !== 'NONE';
  const evaluable = infrastructureStatus === 'NONE' && extractionStatus !== 'FAILED'
    && !(providerFailure && !['EXTRACTED', 'NOT_DECLARED'].includes(extractionStatus));
  let verdict = 'NOT_RUN';
  if (evaluable) {
    const reward = result?.verifier_result?.rewards?.reward;
    if (verifierFailed || typeof reward !== 'number') verdict = 'ERROR';
    else verdict = reward === 1 ? 'PASS' : 'FAIL';
  }
  return {
    producerStatus, termination, providerStatus, infrastructureStatus,
    candidate: { extractionStatus, evaluable },
    evaluator: { verdict, identity: evaluatorIdentity, evidenceRef: verdict === 'NOT_RUN' ? null : verifierEvidenceRef }
  };
}

export function usageFromHarbor(result) {
  const agent = result?.agent_result ?? {};
  const pairs = [['inputTokens', agent.n_input_tokens], ['outputTokens', agent.n_output_tokens], ['cachedTokens', agent.n_cache_tokens], ['providerCostUsd', agent.cost_usd]];
  const values = {};
  const reportedFields = [];
  for (const [field, value] of pairs) if (typeof value === 'number') { values[field] = value; reportedFields.push(field); }
  return { source: `harbor-agent-context:${result?.agent_info?.name ?? 'unknown'}`, reportedFields, values };
}

export function createHarborSubstrate({ harborBin = 'harbor', pythonBin = 'python3', outputRoot, env = process.env, timeoutMs = 3 * 60 * 60 * 1000, identity = null, verifierFiles = ['reward.txt', 'reward.json', 'ctrf.json', 'test-stdout.txt'] } = {}) {
  if (!outputRoot) throw new Error('outputRoot is required');
  const root = resolve(outputRoot);
  const usedTrials = new Set();
  const usedRoots = new Set();
  const childEnv = { ...env, PYTHONPATH: [AGENT_MODULE_DIR, env.PYTHONPATH].filter(Boolean).join(':') };
  const pinned = identity ?? { substrate: 'harbor', version: HARBOR_PIN.version, commit: HARBOR_PIN.commit };

  return {
    identity() { return { substrate: pinned.substrate, version: pinned.version, commit: pinned.commit }; },

    async prepare(unit, { attemptId, taskDir }) {
      const attemptRoot = join(root, SAFE(unit.experimentId), SAFE(unit.unitId), SAFE(attemptId));
      const trialName = `x-${sha256(`${unit.experimentId}\0${unit.unitId}\0${attemptId}`).slice(0, 24)}`;
      if (usedRoots.has(attemptRoot) || usedTrials.has(trialName) || await exists(attemptRoot)) throw new Error(`RESET_REUSED: attempt output ${relative(root, attemptRoot)} or trial ${trialName} already exists`);
      const bundle = taskBundleDigests([taskDir], { pythonBin, env: childEnv })[taskDir];
      if (bundle !== unit.task.bundleDigest) throw new Error(`FIXED_FACTOR_DRIFT: task bundle ${bundle} != registered ${unit.task.bundleDigest}`);
      if (await instructionDigest(taskDir) !== unit.instructionDigest) throw new Error('FIXED_FACTOR_DRIFT: instruction digest changed');
      usedRoots.add(attemptRoot);
      usedTrials.add(trialName);
      const trialsDir = join(attemptRoot, 'trials');
      const evidenceDir = join(attemptRoot, 'evidence');
      await mkdir(trialsDir, { recursive: true });
      await mkdir(evidenceDir, { recursive: true });
      return { unit, attemptId, taskDir, attemptRoot, trialsDir, evidenceDir, trialName, trialDir: join(trialsDir, trialName),
        preexisting: [...await readdir(trialsDir), ...await readdir(evidenceDir)], declaration: await readTaskDeclaration(taskDir) };
    },

    async execute(prepared, producer) {
      const agent = producer.kind === 'ORACLE' ? ['-a', 'oracle'] : producer.kind === 'NOP' ? ['-a', 'nop']
        : producer.kind === 'CALIBRATION_PRODUCER' ? ['-a', CALIBRATION_AGENT, '--agent-kwarg', `mode=${producer.mode}`] : null;
      if (!agent) throw new Error(`unsupported producer kind ${producer.kind}`);
      const args = ['trials', 'start', '-p', prepared.taskDir, ...agent, '--trials-dir', prepared.trialsDir, '--trial-name', prepared.trialName];
      if (producer.agentTimeoutSec) args.push('--agent-timeout', String(producer.agentTimeoutSec));
      const startedAt = new Date().toISOString();
      const outcome = await new Promise(resolvePromise => {
        const child = spawn(harborBin, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = []; const stderr = [];
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('error', error => { clearTimeout(timer); resolvePromise({ exitCode: null, signal: null, spawnError: error.message, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
        child.on('close', (exitCode, signal) => { clearTimeout(timer); resolvePromise({ exitCode, signal, spawnError: null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
      });
      await writeFile(join(prepared.evidenceDir, 'stdout.txt'), outcome.stdout);
      await writeFile(join(prepared.evidenceDir, 'stderr.txt'), outcome.stderr);
      return { prepared, producer, args, startedAt, endedAt: new Date().toISOString(), exitCode: outcome.exitCode, signal: outcome.signal, spawnError: outcome.spawnError };
    },

    async collect(trial) {
      const { prepared } = trial;
      const evidence = prepared.evidenceDir;
      const files = [{ role: 'STDOUT', path: join(evidence, 'stdout.txt') }, { role: 'STDERR', path: join(evidence, 'stderr.txt') }];
      const put = async (role, ref, bytes) => { const path = join(evidence, ...ref.split('/')); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); files.push({ role, path }); return ref; };
      const copy = async (role, ref, source) => { const path = join(evidence, ...ref.split('/')); await mkdir(dirname(path), { recursive: true }); await copyFile(source, path); files.push({ role, path }); return ref; };

      let result = null;
      let protocolProblem = null;
      try {
        result = JSON.parse(await readFile(join(prepared.trialDir, 'result.json'), 'utf8'));
        if (!result || typeof result.id !== 'string' || result.trial_name !== prepared.trialName) protocolProblem = 'trial result does not identify this trial';
      } catch (error) {
        protocolProblem = `missing or malformed trial result: ${error.message}`;
      }
      if (protocolProblem) {
        await put('RAW_RESULT', 'raw/result.json', `${JSON.stringify({ protocolProblem, exitCode: trial.exitCode, signal: trial.signal, spawnError: trial.spawnError }, null, 2)}\n`);
      } else {
        await copy('RAW_RESULT', 'raw/result.json', join(prepared.trialDir, 'result.json'));
        if (await exists(join(prepared.trialDir, 'artifacts', 'manifest.json'))) await copy('SUBSTRATE_RECORD', 'raw/harbor-artifacts-manifest.json', join(prepared.trialDir, 'artifacts', 'manifest.json'));
        if (await exists(join(prepared.trialDir, 'agent', 'trajectory.json'))) await copy('TRAJECTORY', 'raw/trajectory.json', join(prepared.trialDir, 'agent', 'trajectory.json'));
      }

      // Artifact extraction: only paths the task declares; symlinks or special files are an extraction failure.
      let extractionStatus = 'NOT_DECLARED';
      let artifactManifestRef = null;
      let artifactDigest = null;
      let artifactRef = null;
      const artifactProblems = [];
      if (!protocolProblem && prepared.declaration.artifacts.length) {
        const harborManifest = await readFile(join(prepared.trialDir, 'artifacts', 'manifest.json'), 'utf8').then(JSON.parse).catch(() => []);
        const trialLog = await readFile(join(prepared.trialDir, 'trial.log'), 'utf8').catch(() => '');
        const listing = [];
        let failed = false;
        let produced = false;
        for (const declared of prepared.declaration.artifacts) {
          const local = join(prepared.trialDir, 'artifacts', ...declared.split('/').filter(Boolean));
          const entry = harborManifest.find(item => item.source === declared);
          if (!await exists(local)) {
            if (entry?.status === 'failed' && !trialLog.includes(`Could not find the file ${declared}`)) { failed = true; artifactProblems.push(`${declared}: Harbor download failed`); }
            continue;
          }
          const tree = await isRegularTree(local);
          if (tree.problems.length) { failed = true; artifactProblems.push(...tree.problems.map(problem => `${declared}/${problem}`)); continue; }
          for (const file of tree.files) {
            const ref = `artifacts/${relative(join(prepared.trialDir, 'artifacts'), file).split(sep).join('/')}`;
            const bytes = await readFile(file);
            await put('ARTIFACT', ref, bytes);
            listing.push({ ref, digest: digest(bytes), bytes: bytes.length });
            produced = true;
          }
        }
        if (failed) extractionStatus = 'FAILED';
        else if (!produced) extractionStatus = 'NOT_PRODUCED';
        else {
          extractionStatus = 'EXTRACTED';
          listing.sort((a, b) => (a.ref < b.ref ? -1 : 1));
          const bytes = `${JSON.stringify({ kind: 'BENCHMARK_ARTIFACT_MANIFEST_V1', files: listing }, null, 2)}\n`;
          artifactManifestRef = await put('ARTIFACT_MANIFEST', 'artifacts/manifest.json', bytes);
          artifactDigest = digest(bytes);
          artifactRef = listing[0].ref;
        }
        if (extractionStatus !== 'EXTRACTED') for (const entry of files.filter(file => file.role === 'ARTIFACT')) entry.role = 'SUBSTRATE_RECORD';
      }

      const mapped = protocolProblem
        ? { producerStatus: 'UNKNOWN', termination: 'AGENT_ERROR', providerStatus: 'NONE', infrastructureStatus: 'HARNESS_PROTOCOL', candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: false }, evaluator: { verdict: 'NOT_RUN', identity: EVALUATOR_IDENTITY, evidenceRef: null } }
        : mapHarborResult(result, { extractionStatus, verifierEvidenceRef: null });

      // Independent verifier evidence is read only when the candidate is evaluable.
      const verifierRefs = [];
      if (mapped.evaluator.verdict !== 'NOT_RUN') {
        for (const name of verifierFiles) {
          const source = join(prepared.trialDir, 'verifier', name);
          if (await exists(source)) verifierRefs.push(await copy('VERIFIER_OUTPUT', `verifier/${name}`, source));
        }
        if (mapped.evaluator.verdict === 'ERROR') verifierRefs.push(await put('VERIFIER_OUTPUT', 'verifier/exception.json', `${JSON.stringify(result.exception_info ?? { detail: 'no verifier reward' }, null, 2)}\n`));
        mapped.evaluator.evidenceRef = verifierRefs.find(ref => /reward\.(txt|json)$/.test(ref)) ?? verifierRefs[0];
      }

      const resetBytes = `${JSON.stringify({
        kind: 'BENCHMARK_RESET_IDENTITY_V1', attemptId: prepared.attemptId, trialId: prepared.trialName, harborTrialUuid: result?.id ?? null,
        workspaceRef: `harbor-trial-environment:${result?.id ?? prepared.trialName}`, outputRef: relative(root, prepared.attemptRoot).split(sep).join('/'),
        environmentDelete: result?.config?.environment?.delete ?? null, preexisting: prepared.preexisting, taskBundleDigest: prepared.unit.task.bundleDigest
      }, null, 2)}\n`;
      await put('RESET_IDENTITY', 'reset.json', resetBytes);
      const usageObservation = protocolProblem ? { source: 'harbor-agent-context:unavailable', reportedFields: [], values: {} } : usageFromHarbor(result);
      await put('USAGE_OBSERVATION', 'usage.json', `${JSON.stringify(usageObservation, null, 2)}\n`);
      await put('NORMALIZATION', 'normalization.json', `${JSON.stringify({ kind: 'BENCHMARK_NORMALIZATION_INPUT_V1', outcomeInput: mapped, artifactProblems }, null, 2)}\n`);

      const entries = [];
      for (const file of files) {
        const bytes = await readFile(file.path);
        entries.push({ role: file.role, ref: relative(evidence, file.path).split(sep).join('/'), digest: digest(bytes), bytes: bytes.length });
      }
      const exceptionType = result?.exception_info?.exception_type ?? null;
      return {
        outcomeInput: mapped,
        usageObservation,
        entries,
        candidate: { artifactRef, artifactDigest, extractionStatus },
        evidence: { substrateTrialRef: prepared.trialName, resultRef: 'raw/result.json', trajectoryRef: entries.some(e => e.ref === 'raw/trajectory.json') ? 'raw/trajectory.json' : null,
          verifierRefs, artifactManifestRef },
        timing: { startedAt: result?.started_at ?? trial.startedAt, endedAt: result?.finished_at ?? trial.endedAt },
        failureFingerprint: protocolProblem ? `HARNESS_PROTOCOL:${sha256(protocolProblem).slice(0, 16)}` : exceptionType ? `${exceptionType}:${sha256(result.exception_info.exception_message ?? '').slice(0, 16)}` : null,
        harborTrialUuid: result?.id ?? null
      };
    }
  };
}
