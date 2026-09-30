import { defineContextRequirement, defineContextResolution } from './context-contract.js';
import { observationDigest } from './resolution-durability.js';

const fail = (m) => { throw new TypeError(m); };
function text(v, l) { if (typeof v !== 'string' || !v.trim()) fail(`${l} must be nonempty text`); return v; }

export function createOracleContextResolver({ sourceCatalog, retrievalPlanner, durability = null, resolverConfiguration = null } = {}) {
  if (!sourceCatalog || typeof sourceCatalog.authorityFor !== 'function' || typeof sourceCatalog.validateCandidate !== 'function') fail('sourceCatalog with authorityFor/validateCandidate required');
  if (!retrievalPlanner || typeof retrievalPlanner.plan !== 'function' || typeof retrievalPlanner.execute !== 'function') fail('retrievalPlanner with plan()/execute() required');
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
    // D1: candidate collection is delegated to the delivered planner execution,
    // which applies per-work reservations and types every provider failure.
    const executed = await retrievalPlanner.execute(requirement, { remainingBudget: { ...requirement.budget }, existingEdges: [] });
    const evidenceIds = new Set(requirement.evidence.map((e) => e.id));
    const byEvidence = new Map();
    for (const c of executed.candidates) {
      if (!evidenceIds.has(c.evidenceId)) fail(`planner returned candidate for unknown evidence: ${c.evidenceId}`);
      if (!byEvidence.has(c.evidenceId)) byEvidence.set(c.evidenceId, []);
      byEvidence.get(c.evidenceId).push(c);
    }
    // D6: planner and execution reasons are preserved verbatim; MISSING only
    // covers evidence that has neither a candidate nor a typed reason.
    const unresolved = executed.unresolved.map((u) => ({ evidenceId: u.evidenceId, reason: u.reason }));
    for (const e of requirement.evidence) {
      if (!byEvidence.has(e.id) && !unresolved.some((u) => u.evidenceId === e.id)) unresolved.push({ evidenceId: e.id, reason: 'MISSING' });
    }
    // D3: planner order, rank per evidence; the planner already bounded items by budget.maxItems.
    const itemsFor = (dropped) => {
      const out = [];
      for (const e of requirement.evidence) {
        if (dropped.has(e.id)) continue;
        (byEvidence.get(e.id) ?? []).forEach((c, rank) => out.push({ evidenceId: c.evidenceId, rank, source: c.source, currentness: { validators: c.validators }, provenance: c.provenance, content: c.content }));
      }
      return out;
    };
    const statusFor = (list) => list.some((u) => requirement.evidence.find((e) => e.id === u.evidenceId)?.necessity === 'REQUIRED') ? 'UNSATISFIED' : list.length ? 'PARTIAL' : 'COMPLETE';
    // D2: reservation-based provider calls from the delivered execute() output, never floored.
    const providerCalls = executed.planned.reserved.providerCalls;
    const build = (items, list, materializedBytes) => defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: statusFor(list), items, unresolved: list, consumed: { items: items.length, materializedBytes, providerCalls, resolutionSteps: 1 } }, requirement);
    // D5 overflow order: lowest-priority (latest) OPTIONAL evidence first, then REQUIRED evidence.
    const dropOrder = [...requirement.evidence.filter((e) => e.necessity === 'OPTIONAL').reverse(), ...requirement.evidence.filter((e) => e.necessity === 'REQUIRED').reverse()]
      .filter((e) => byEvidence.has(e.id)).map((e) => e.id);
    const dropped = new Set();
    let items, finalUnresolved, sized;
    for (;;) {
      items = itemsFor(dropped);
      finalUnresolved = [...unresolved, ...[...dropped].map((evidenceId) => ({ evidenceId, reason: 'BUDGET_EXHAUSTED' }))];
      try {
        // D4 pass 1: the contract computes the exact materialization size under the full byte budget.
        sized = build(items, finalUnresolved, requirement.budget.maxMaterializedBytes);
        break;
      } catch (error) {
        if (!(error instanceof TypeError) || error.message !== 'consumed below materialization/step' || dropped.size === dropOrder.length) throw error;
        dropped.add(dropOrder[dropped.size]);
      }
    }
    // D4 pass 2: report exactly the contract-computed materialization bytes (identity excludes consumed).
    const resolution = build(items, finalUnresolved, sized.materialization.bytes);
    const failures = executed.failures.map((f) => ({ evidenceId: f.evidenceId, providerId: f.providerId, reason: f.reason, detail: f.detail }));
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
    return { outcome: 'FRESH', resolution, preObservations: pre, postObservations: post, reuseKey: null, receiptRef: null, failures };
  }

  return Object.freeze({ resolve, preObserve });
}
