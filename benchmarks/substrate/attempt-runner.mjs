// Substrate-neutral attempt lifecycle over the public @exharness/benchmark API:
// beginAttempt -> prepare -> execute -> collect -> normalize -> manifest -> settleAttempt -> persist.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { AttemptLedger, assertSubstratePort, createEvidenceManifest, normalizeAccounting, normalizeOutcome } from '@exharness/benchmark';

const json = value => `${JSON.stringify(value, null, 2)}\n`;

export async function writeExperiment(root, { registration, units }) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'registration.json'), json(registration));
  await writeFile(join(root, 'units.json'), json(units));
}

// Ledger persistence is serialized per experiment root so concurrent attempts never interleave writes.
const persistQueues = new Map();
export function persistLedger(root, ledger) {
  const queued = (persistQueues.get(root) ?? Promise.resolve()).then(() => writeFile(join(root, 'ledger.json'), json(ledger.events())));
  persistQueues.set(root, queued.catch(() => {}));
  return queued;
}

// runtime: { sourceSha, profileHash }; producer: substrate-specific producer spec with kind/identity.
export async function runAttempt({ ledger, substrate, unit, attemptId, retryOfAttemptId = null, producer, taskDir, runtime, budget, experimentRoot, now = () => new Date().toISOString() }) {
  assertSubstratePort(substrate);
  ledger.beginAttempt({ unitId: unit.unitId, attemptId, retryOfAttemptId, startedAt: now() });
  await persistLedger(experimentRoot, ledger);
  const prepared = await substrate.prepare(unit, { attemptId, taskDir });
  const trial = await substrate.execute(prepared, producer);
  const collected = await substrate.collect(trial);
  const outcome = normalizeOutcome(collected.outcomeInput);
  const usage = normalizeAccounting(collected.usageObservation);
  const manifest = createEvidenceManifest({ experimentId: unit.experimentId, unitId: unit.unitId, attemptId, entries: collected.entries });
  const identity = substrate.identity();
  const started = Date.parse(collected.timing.startedAt);
  const ended = Date.parse(collected.timing.endedAt);
  const { record } = ledger.settleAttempt({
    experimentId: unit.experimentId, cohortId: null, unitId: unit.unitId, attemptId, retryOfAttemptId,
    protocolHash: ledger.registration.protocol.hash,
    task: { id: unit.task.id, bundleDigest: unit.task.bundleDigest, environmentIdentity: unit.environmentIdentity, instructionDigest: unit.instructionDigest },
    runtime: { substrate: identity.substrate, substrateVersion: identity.version, substrateCommit: identity.commit, sourceSha: runtime.sourceSha, profileHash: runtime.profileHash },
    producer: { kind: producer.kind, identity: producer.identity, model: null, provider: null },
    budget,
    candidate: collected.candidate,
    evidence: { ...collected.evidence, manifestDigest: manifest.manifestDigest },
    usage,
    timing: { startedAt: collected.timing.startedAt, endedAt: collected.timing.endedAt, elapsedMs: Number.isNaN(ended - started) ? null : ended - started, providerWaitMs: null, capabilityWaitMs: null },
    quality: outcome.quality, termination: outcome.termination, providerStatus: outcome.providerStatus, infrastructureStatus: outcome.infrastructureStatus,
    failureFingerprint: collected.failureFingerprint
  }, { settledAt: now() });
  const attemptRoot = dirname(prepared.evidenceDir);
  await writeFile(join(attemptRoot, 'record.json'), json(record));
  await writeFile(join(attemptRoot, 'manifest.json'), json(manifest));
  await persistLedger(experimentRoot, ledger);
  return { record, manifest, attemptRoot, evidenceDir: prepared.evidenceDir };
}

// Load a materialized experiment directory (registration, units, ledger, per-attempt record/manifest).
export async function loadExperiment(root) {
  const read = async path => JSON.parse(await readFile(path, 'utf8'));
  const registration = await read(join(root, 'registration.json'));
  const units = await read(join(root, 'units.json'));
  const events = await read(join(root, 'ledger.json'));
  const attempts = [];
  for (const unitDir of (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    for (const attemptDir of (await readdir(join(root, unitDir), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
      const base = join(root, unitDir, attemptDir);
      try {
        attempts.push({ base, record: await read(join(base, 'record.json')), manifest: await read(join(base, 'manifest.json')), evidenceDir: join(base, 'evidence') });
      } catch { attempts.push({ base, record: null, manifest: null, evidenceDir: join(base, 'evidence') }); }
    }
  }
  return { registration, units, events, attempts, ledgerFactory: () => AttemptLedger.replay({ registration, units, events, records: attempts.map(a => a.record).filter(Boolean) }) };
}

export function fileStore(root) {
  return {
    async read(ref) {
      if (ref.split('/').some(part => part === '..' || part === '')) throw new Error(`bad ref ${ref}`);
      return readFile(join(root, ...ref.split('/')));
    }
  };
}
