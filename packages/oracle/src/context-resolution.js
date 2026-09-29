import { defineContextRequirement, defineContextResolution } from './context-contract.js';
import { observationDigest } from './resolution-durability.js';

const fail = (m) => { throw new TypeError(m); };
function text(v, l) { if (typeof v !== 'string' || !v.trim()) fail(`${l} must be nonempty text`); return v; }

export function createOracleContextResolver({ sourceCatalog, retrievalPlanner, durability = null, resolverConfiguration = null } = {}) {
  if (!sourceCatalog || typeof sourceCatalog.authorityFor !== 'function' || typeof sourceCatalog.validateCandidate !== 'function') fail('sourceCatalog with authorityFor/validateCandidate required');
  if (!retrievalPlanner || typeof retrievalPlanner.plan !== 'function') fail('retrievalPlanner with plan() required');
  if (durability !== null && (typeof durability !== 'object' || typeof durability.resolve !== 'function')) fail('durability must expose resolve() or be null');

  async function preObserve(requirement) {
    const out = [];
    for (const e of requirement.evidence) {
      const authority = sourceCatalog.authorityFor({ kind: e.source.kind, ref: e.source.ref });
      const seen = await authority.observe({ kind: e.source.kind, ref: e.source.ref });
      if (!seen || typeof seen.snapshotRef !== 'string' || !seen.snapshotRef.trim()) {
        const { defineSourceObservation } = await import('./resolution-durability.js');
        out.push(defineSourceObservation({ evidenceId: e.id, source: { kind: e.source.kind, ref: e.source.ref, snapshot: { mode: e.source.snapshot.mode, ...(e.source.snapshot.mode === 'EXACT' ? { ref: e.source.snapshot.ref } : {}) } }, observed: { state: 'UNAVAILABLE', authorityRef: `${e.source.kind}:${e.source.ref}` } }));
        continue;
      }
      const { defineSourceObservation } = await import('./resolution-durability.js');
      const validators = Array.isArray(seen.validators) && seen.validators.length ? seen.validators : [{ kind: 'REVISION', value: seen.snapshotRef, strength: 'STRONG' }];
      out.push(defineSourceObservation({ evidenceId: e.id, source: { kind: e.source.kind, ref: e.source.ref, snapshot: { mode: e.source.snapshot.mode, ...(e.source.snapshot.mode === 'EXACT' ? { ref: e.source.snapshot.ref } : {}) } }, observed: { state: 'PRESENT', snapshotRef: seen.snapshotRef, validators, authorityRef: `${e.source.kind}:${e.source.ref}`, authorityRevision: seen.authorityRevision ?? seen.snapshotRef } }));
    }
    return out;
  }

  async function resolve(rawRequirement, metadata = {}) {
    const requirement = defineContextRequirement(rawRequirement);
    void metadata;
    const pre = await preObserve(requirement);
    if (durability) {
      try {
        const reused = await durability.resolve(requirement);
        if (reused && (reused.outcome === 'REUSED' || reused.outcome === 'PUBLISHED')) return { ...reused, preObservations: reused.preObservations ?? pre };
      } catch (e) {
        if (e?.name !== 'DurabilityFailure') throw e;
        if (String(e.reason ?? e.message).includes('NOT_REUSABLE') === false) throw e;
      }
    }
    const planned = retrievalPlanner.plan(requirement, { remainingBudget: { ...requirement.budget }, existingEdges: [] });
    const candidates = [];
    for (const work of planned.work ?? []) {
      const registration = sourceCatalog.provider(work.providerId);
      if (!registration) fail(`provider not registered: ${work.providerId}`);
      const raws = await registration.retrieve(work);
      for (const raw of raws) {
        const validated = await sourceCatalog.validateCandidate(raw, { requirement, providerId: work.providerId });
        candidates.push(validated);
      }
    }
    const byEvidence = new Map();
    for (const c of candidates) {
      if (!byEvidence.has(c.evidenceId)) byEvidence.set(c.evidenceId, []);
      byEvidence.get(c.evidenceId).push(c);
    }
    const items = [];
    const unresolved = [];
    for (const e of requirement.evidence) {
      const list = (byEvidence.get(e.id) ?? []).slice(0, 3);
      if (!list.length) {
        unresolved.push({ evidenceId: e.id, reason: 'MISSING' });
        continue;
      }
      list.forEach((c, rank) => items.push({ evidenceId: c.evidenceId, rank, source: c.source, currentness: { validators: c.validators }, provenance: c.provenance, content: c.content }));
    }
    const consumed = { items: Math.max(items.length, 1), materializedBytes: 40000, providerCalls: Math.max(planned.work?.length ?? 1, 1), resolutionSteps: 1 };
    const resolution = defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: unresolved.some((u) => requirement.evidence.find((e) => e.id === u.evidenceId)?.necessity === 'REQUIRED') ? 'UNSATISFIED' : unresolved.length ? 'PARTIAL' : 'COMPLETE', items, unresolved, consumed }, requirement);
    const post = await preObserve(requirement);
    const preDigests = new Map(pre.map((o) => [o.evidenceId, observationDigest(o)]));
    for (const o of post) {
      if (preDigests.get(o.evidenceId) !== observationDigest(o)) {
        const err = new Error(`source drift during resolution: ${o.evidenceId}`);
        err.name = 'DurabilityFailure';
        err.reason = 'STALE_DURING_RESOLUTION';
        throw err;
      }
    }
    return { outcome: 'FRESH', resolution, preObservations: pre, postObservations: post, reuseKey: null, receiptRef: null };
  }

  return Object.freeze({ resolve, preObserve });
}
