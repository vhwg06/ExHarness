import { createHash } from 'node:crypto';
import { defineContextRequirement, defineContextResolution } from './context-contract.js';
import { ProviderOperation } from './provider-contract.js';

const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (m) => { throw new TypeError(m); };
function record(v, fields, label, required = fields) {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
    (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) fail(`${label} must be a plain object`);
  for (const k of Reflect.ownKeys(v)) if (typeof k !== 'string' || !fields.includes(k)) fail(`${label} has unknown field ${String(k)}`);
  for (const k of required) if (!own(v, k)) fail(`${label}.${k} is required`);
  return v;
}
function str(v, l) { if (typeof v !== 'string' || !v.trim()) fail(`${l} must be nonempty text`); return v; }
function one(v, c, l) { if (!c.includes(v)) fail(`${l} is invalid`); return v; }
function arr(v, l, ne = false) { if (!Array.isArray(v) || (ne && !v.length)) fail(`${l} must be ${ne ? 'nonempty ' : ''}array`); return v; }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function hash(v) { return createHash('sha256').update(canonical(v)).digest('hex'); }

export const SourceObservationState = Object.freeze({ PRESENT: 'PRESENT', ABSENT: 'ABSENT', UNAVAILABLE: 'UNAVAILABLE', AMBIGUOUS: 'AMBIGUOUS' });

function observationBody(raw) {
  const o = record(raw, ['kind', 'version', 'evidenceId', 'source', 'observed'], 'SourceObservation', ['evidenceId', 'source', 'observed']);
  if (own(o, 'kind')) one(o.kind, ['SOURCE_OBSERVATION'], 'observation.kind');
  if (own(o, 'version')) one(o.version, [1], 'observation.version');
  const s = record(o.source, ['kind', 'ref', 'snapshot'], 'observation.source', ['kind', 'ref', 'snapshot']);
  const snap = record(s.snapshot, ['mode', 'ref'], 'observation.source.snapshot', ['mode']);
  one(snap.mode, ['EXACT', 'CURRENT'], 'snapshot.mode');
  if (snap.mode === 'EXACT') str(snap.ref, 'snapshot.ref');
  else if (own(snap, 'ref')) fail('CURRENT snapshot cannot name ref');
  const b = record(o.observed, ['state', 'snapshotRef', 'validators', 'authorityRef', 'authorityRevision', 'provenanceDigest'], 'observation.observed', ['state']);
  const state = one(b.state, Object.values(SourceObservationState), 'observed.state');
  const out = {
    kind: 'SOURCE_OBSERVATION', version: 1, evidenceId: str(o.evidenceId, 'evidenceId'),
    source: { kind: str(s.kind, 'source.kind'), ref: str(s.ref, 'source.ref'), snapshot: snap.mode === 'EXACT' ? { mode: 'EXACT', ref: snap.ref } : { mode: 'CURRENT' } },
    observed: { state },
  };
  if (own(b, 'snapshotRef')) out.observed.snapshotRef = str(b.snapshotRef, 'observed.snapshotRef');
  if (own(b, 'validators')) {
    out.observed.validators = arr(b.validators, 'observed.validators').map((v, i) => {
      const x = record(v, ['kind', 'value', 'strength'], `validator[${i}]`);
      return { kind: one(x.kind, ['REVISION', 'CONTENT_DIGEST', 'OPAQUE'], 'validator.kind'), value: str(x.value, 'validator.value'), strength: one(x.strength, ['STRONG', 'WEAK'], 'validator.strength') };
    });
  }
  if (own(b, 'authorityRef')) out.observed.authorityRef = str(b.authorityRef, 'authorityRef');
  if (own(b, 'authorityRevision')) out.observed.authorityRevision = str(b.authorityRevision, 'authorityRevision');
  if (own(b, 'provenanceDigest')) out.observed.provenanceDigest = str(b.provenanceDigest, 'provenanceDigest');
  if (state === 'PRESENT' && out.source.snapshot.mode === 'CURRENT' && !out.observed.snapshotRef) fail('PRESENT CURRENT observation requires snapshotRef');
  return out;
}

export function defineSourceObservation(raw) { return freeze(observationBody(raw)); }
export function observationDigest(obs) { return hash(observationBody(obs)); }

export function defineResolverConfiguration(raw) {
  const c = record(raw, ['kind', 'version', 'contractRevision', 'plannerRevision', 'materializationRevision', 'providerBindings'], 'ResolverConfiguration', ['contractRevision', 'plannerRevision', 'materializationRevision', 'providerBindings']);
  if (own(c, 'kind')) one(c.kind, ['RESOLVER_CONFIGURATION'], 'config.kind');
  if (own(c, 'version')) one(c.version, [1], 'config.version');
  const bindings = record(c.providerBindings, Object.keys(c.providerBindings), 'providerBindings', []);
  for (const [k, v] of Object.entries(bindings)) str(v, `providerBindings.${k}`);
  return freeze({ kind: 'RESOLVER_CONFIGURATION', version: 1, contractRevision: str(c.contractRevision, 'contractRevision'), plannerRevision: str(c.plannerRevision, 'plannerRevision'), materializationRevision: str(c.materializationRevision, 'materializationRevision'), providerBindings: { ...bindings } });
}
export function resolverConfigDigest(config) { return hash(defineResolverConfiguration(config)); }

export function defineDerivationInput(raw) {
  const d = record(raw, ['evidenceId', 'providerId', 'operation', 'providerRevision', 'providerSnapshotRef', 'configDigest'], 'DerivationInput', ['evidenceId', 'providerId', 'operation', 'providerRevision']);
  const out = { evidenceId: str(d.evidenceId, 'evidenceId'), providerId: str(d.providerId, 'providerId'), operation: one(d.operation, Object.values(ProviderOperation), 'operation'), providerRevision: str(d.providerRevision, 'providerRevision') };
  if (own(d, 'providerSnapshotRef')) out.providerSnapshotRef = str(d.providerSnapshotRef, 'providerSnapshotRef');
  if (own(d, 'configDigest')) out.configDigest = str(d.configDigest, 'configDigest');
  return freeze(out);
}

function normalizeObservations(list) {
  return arr(list, 'sourceObservations', true).map(defineSourceObservation).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}
function normalizeDerivations(list) {
  return arr(list ?? [], 'derivationInputs').map(defineDerivationInput).sort((a, b) => (a.evidenceId + a.providerId + a.operation).localeCompare(b.evidenceId + b.providerId + b.operation));
}

export function reuseKey({ requirementId, resolverConfigDigest: configDigest, sourceObservations, derivationInputs = [] }) {
  const req = str(requirementId, 'requirementId');
  if (!/^[a-f0-9]{64}$/.test(configDigest ?? '')) fail('resolverConfigDigest must be sha256 hex');
  const obs = normalizeObservations(sourceObservations);
  const deriv = normalizeDerivations(derivationInputs);
  return hash({ requirementId: req, resolverConfigDigest: configDigest, sourceObservations: obs.map((o) => ({ evidenceId: o.evidenceId, digest: observationDigest(o) })), derivationInputs: deriv });
}

function lineageBody(raw) {
  const l = record(raw, ['itemDigest', 'sourceObservationIds', 'provenanceRefs'], 'itemLineage', ['itemDigest', 'sourceObservationIds', 'provenanceRefs']);
  if (!/^[a-f0-9]{64}$/.test(l.itemDigest)) fail('itemDigest must be sha256 hex');
  return { itemDigest: l.itemDigest, sourceObservationIds: arr(l.sourceObservationIds, 'sourceObservationIds', true).map((v) => str(v, 'sourceObservationId')), provenanceRefs: arr(l.provenanceRefs, 'provenanceRefs').map((v) => str(v, 'provenanceRef')) };
}

function receiptBody(raw) {
  const r = record(raw, ['kind', 'version', 'receiptId', 'receiptRef', 'reuseKey', 'requirementId', 'resolutionId', 'materializationId', 'resolutionArtifactRef', 'resolverConfigDigest', 'sourceObservations', 'derivationInputs', 'itemLineage'], 'ContextResolutionReceipt', ['reuseKey', 'requirementId', 'resolutionId', 'materializationId', 'resolutionArtifactRef', 'resolverConfigDigest', 'sourceObservations', 'itemLineage']);
  if (own(r, 'kind')) one(r.kind, ['CONTEXT_RESOLUTION_RECEIPT'], 'receipt.kind');
  if (own(r, 'version')) one(r.version, [1], 'receipt.version');
  const obs = normalizeObservations(r.sourceObservations);
  const deriv = normalizeDerivations(r.derivationInputs ?? []);
  const lineage = arr(r.itemLineage, 'itemLineage', true).map(lineageBody);
  const body = {
    kind: 'CONTEXT_RESOLUTION_RECEIPT', version: 1,
    reuseKey: str(r.reuseKey, 'reuseKey'), requirementId: str(r.requirementId, 'requirementId'),
    resolutionId: str(r.resolutionId, 'resolutionId'), materializationId: str(r.materializationId, 'materializationId'),
    resolutionArtifactRef: str(r.resolutionArtifactRef, 'resolutionArtifactRef'),
    resolverConfigDigest: str(r.resolverConfigDigest, 'resolverConfigDigest'),
    sourceObservations: obs, derivationInputs: deriv, itemLineage: lineage,
  };
  if (!/^[a-f0-9]{64}$/.test(body.reuseKey)) fail('reuseKey must be sha256 hex');
  const expect = reuseKey({ requirementId: body.requirementId, resolverConfigDigest: body.resolverConfigDigest, sourceObservations: obs, derivationInputs: deriv });
  if (body.reuseKey !== expect) fail('reuseKey does not bind requirement/config/observations/derivations');
  const ids = new Set(obs.map((o) => o.evidenceId));
  for (const l of lineage) for (const id of l.sourceObservationIds) if (!ids.has(id)) fail(`lineage references unknown observation: ${id}`);
  const id = hash({ ...body, receiptId: undefined });
  const receiptId = hash(body);
  void id;
  if (own(r, 'receiptId') && r.receiptId !== receiptId) fail('receiptId mismatch');
  return { body, receiptId };
}

export function defineContextResolutionReceipt(raw) {
  const { body, receiptId } = receiptBody(raw);
  return freeze({ ...body, receiptId });
}
export function receiptId(receipt) { return receiptBody(receipt).receiptId; }

export function evaluateReceiptCurrentness(receipt, currentObservations) {
  const r = defineContextResolutionReceipt(receipt);
  const current = normalizeObservations(currentObservations);
  const before = new Map(r.sourceObservations.map((o) => [o.evidenceId, observationDigest(o)]));
  const after = new Map(current.map((o) => [o.evidenceId, observationDigest(o)]));
  const changed = [];
  const reasons = [];
  for (const [id, digest] of before) {
    if (!after.has(id)) { changed.push(id); reasons.push(`${id}: observation missing`); continue; }
    if (after.get(id) !== digest) {
      changed.push(id);
      const prev = r.sourceObservations.find((o) => o.evidenceId === id);
      const next = current.find((o) => o.evidenceId === id);
      if (prev.observed.snapshotRef !== next.observed.snapshotRef) reasons.push(`${id}: snapshot ${prev.observed.snapshotRef ?? '?'} -> ${next.observed.snapshotRef ?? '?'}`);
      else if (prev.observed.state !== next.observed.state) reasons.push(`${id}: state ${prev.observed.state} -> ${next.observed.state}`);
      else reasons.push(`${id}: observation digest changed`);
    }
  }
  for (const id of after.keys()) if (!before.has(id)) { changed.push(id); reasons.push(`${id}: unexpected observation`); }
  changed.sort();
  return freeze(changed.length ? { status: 'STALE', changedEvidenceIds: changed, reasons } : { status: 'CURRENT', changedEvidenceIds: [], reasons: [] });
}

export class DurabilityFailure extends Error {
  constructor({ reason, detail }) {
    one(reason, ['STALE_DURING_RESOLUTION', 'NONDETERMINISTIC_RESOLUTION_CONFLICT', 'NOT_REUSABLE', 'CURRENTNESS_UNVERIFIABLE'], 'durability reason');
    super(str(detail, 'durability detail'));
    this.name = 'DurabilityFailure';
    this.reason = reason;
  }
}

export function isReusableResolution(resolution, requirement, observations) {
  const req = defineContextRequirement(requirement);
  const res = defineContextResolution(resolution, requirement);
  const obs = new Map(normalizeObservations(observations).map((o) => [o.evidenceId, o]));
  if (res.status === 'UNSATISFIED') return false;
  if (res.status === 'COMPLETE') {
    for (const e of req.evidence) {
      if (e.source.snapshot.mode !== 'CURRENT' || e.necessity !== 'REQUIRED') continue;
      const o = obs.get(e.id);
      if (!o || o.observed.state !== 'PRESENT' || !o.observed.validators?.some((v) => v.strength === 'STRONG')) return false;
    }
    return true;
  }
  for (const u of res.unresolved) {
    const e = req.evidence.find((x) => x.id === u.evidenceId);
    if (!e || e.necessity !== 'OPTIONAL') return false;
    const o = obs.get(u.evidenceId);
    if (!o || o.observed.state !== 'ABSENT' || !o.observed.authorityRevision || !o.observed.validators?.some((v) => v.strength === 'STRONG')) return false;
  }
  return true;
}

export function createDurableResolutionCoordinator({ catalog, store, resolverConfiguration, resolveFresh }) {
  if (!catalog || typeof catalog.authorityFor !== 'function') fail('catalog with authorityFor required');
  if (!store || typeof store.readReuseSlot !== 'function') fail('store with reuse slots required');
  const config = defineResolverConfiguration(resolverConfiguration);
  const configDigest = resolverConfigDigest(config);
  if (typeof resolveFresh !== 'function') fail('resolveFresh(requirement, preObservations) required');

  async function observeAll(requirement) {
    const req = defineContextRequirement(requirement);
    const out = [];
    for (const e of req.evidence) {
      const authority = catalog.authorityFor({ kind: e.source.kind, ref: e.source.ref });
      const seen = await authority.observe({ kind: e.source.kind, ref: e.source.ref });
      if (!seen || typeof seen.snapshotRef !== 'string' || !seen.snapshotRef.trim()) {
        out.push(defineSourceObservation({ evidenceId: e.id, source: { kind: e.source.kind, ref: e.source.ref, snapshot: { mode: e.source.snapshot.mode, ...(e.source.snapshot.mode === 'EXACT' ? { ref: e.source.snapshot.ref } : {}) } }, observed: { state: 'UNAVAILABLE', authorityRef: `${e.source.kind}:${e.source.ref}` } }));
        continue;
      }
      const validators = Array.isArray(seen.validators) && seen.validators.length ? seen.validators : [{ kind: 'REVISION', value: seen.snapshotRef, strength: 'STRONG' }];
      out.push(defineSourceObservation({
        evidenceId: e.id,
        source: { kind: e.source.kind, ref: e.source.ref, snapshot: { mode: e.source.snapshot.mode, ...(e.source.snapshot.mode === 'EXACT' ? { ref: e.source.snapshot.ref } : {}) } },
        observed: { state: 'PRESENT', snapshotRef: seen.snapshotRef, validators, authorityRef: `${e.source.kind}:${e.source.ref}`, ...(seen.authorityRevision ? { authorityRevision: seen.authorityRevision } : { authorityRevision: seen.snapshotRef }) },
      }));
    }
    return out;
  }

  async function resolve(requirement, { derivationInputs = [] } = {}) {
    const req = defineContextRequirement(requirement);
    const pre = await observeAll(req);
    const key = reuseKey({ requirementId: req.requirementId, resolverConfigDigest: configDigest, sourceObservations: pre, derivationInputs });
    const slot = await store.readReuseSlot(key);
    if (slot) {
      const receipt = await store.readReceipt(slot.receiptRef);
      const resolution = await store.readResolution(receipt.resolutionArtifactRef);
      if (receipt.reuseKey !== key || receipt.requirementId !== req.requirementId) fail('cached receipt key mismatch');
      const post = await observeAll(req);
      const fence = evaluateReceiptCurrentness({ ...receipt }, post);
      if (fence.status !== 'CURRENT') throw new DurabilityFailure({ reason: 'STALE_DURING_RESOLUTION', detail: `cache-hit post-observation drift: ${fence.changedEvidenceIds.join(',')}` });
      const prePost = evaluateReceiptCurrentness({ ...receipt, sourceObservations: pre }, pre);
      void prePost;
      return { outcome: 'REUSED', reuseKey: key, resolution, receipt, preObservations: pre, postObservations: post };
    }
    const fresh = await resolveFresh(req, pre);
    const resolution = defineContextResolution(fresh, req);
    if (!isReusableResolution(resolution, req, pre)) throw new DurabilityFailure({ reason: 'NOT_REUSABLE', detail: `resolution status ${resolution.status} is not publishable as reusable` });
    const lineage = resolution.items.map((item) => ({ itemDigest: item.itemDigest, sourceObservationIds: [item.evidenceId], provenanceRefs: item.provenance.map((p) => p.ref) }));
    const artifactRef = await store.putResolution(resolution);
    const receipt = defineContextResolutionReceipt({
      reuseKey: key, requirementId: req.requirementId, resolutionId: resolution.resolutionId,
      materializationId: resolution.materialization.id, resolutionArtifactRef: artifactRef,
      resolverConfigDigest: configDigest, sourceObservations: pre, derivationInputs, itemLineage: lineage,
    });
    const receiptRef = await store.putReceipt(receipt);
    const post = await observeAll(req);
    const fence = evaluateReceiptCurrentness({ ...receipt }, post);
    if (fence.status !== 'CURRENT') throw new DurabilityFailure({ reason: 'STALE_DURING_RESOLUTION', detail: `fresh post-observation drift: ${fence.changedEvidenceIds.join(',')}` });
    await store.publishReuseSlot(key, resolution.resolutionId, receiptRef);
    return { outcome: 'PUBLISHED', reuseKey: key, resolution, receipt: { ...receipt, receiptRef }, receiptRef, preObservations: pre, postObservations: post };
  }

  return Object.freeze({ resolverConfiguration: config, resolverConfigDigest: configDigest, observeAll, resolve });
}
