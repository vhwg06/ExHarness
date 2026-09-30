import { defineContextRequirement, defineContextResolution } from './context-contract.js';
import { observationDigest } from './resolution-durability.js';

const fail = (m) => { throw new TypeError(m); };
function text(v, l) { if (typeof v !== 'string' || !v.trim()) fail(`${l} must be nonempty text`); return v; }

// Progressive resolution: only these unresolved reasons may be re-attempted by
// an explicit next step. STALE, AMBIGUOUS, UNSUPPORTED, CURRENTNESS_UNVERIFIABLE
// and MISSING are terminal for the evidence and never re-planned.
export const PROGRESSION_RETRIABLE_REASONS = Object.freeze(['BUDGET_EXHAUSTED', 'SOURCE_FAILURE', 'DEFERRED']);
const RETRIABLE = new Set(PROGRESSION_RETRIABLE_REASONS);

export class ProgressionRefused extends Error {
  constructor(reason, detail) {
    super(`progression refused (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'ProgressionRefused';
    this.reason = reason;
  }
}

// Pin one delivered facade result so an application can hand that exact step to
// Core's once-per-call injected resolver port without any Core change.
export function createPinnedResolver(result) {
  const resolution = result?.resolution ?? null;
  if (!resolution || typeof resolution.requirementId !== 'string') fail('pinned resolver needs a facade result with resolution');
  async function resolve(requirement, metadata = {}) {
    void metadata;
    const req = defineContextRequirement(requirement);
    if (req.requirementId !== resolution.requirementId) fail(`pinned resolution answers a different requirement: ${resolution.requirementId}`);
    return resolution;
  }
  return Object.freeze({ resolve });
}

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

  // Explicit bounded next step over an exact prior facade result. Re-attempts
  // only evidence whose previous unresolved reason is retriable, under the
  // remaining cumulative budget, chained by index and previousResolutionId.
  async function resolveNext(rawRequirement, previousResult) {
    const requirement = defineContextRequirement(rawRequirement);
    const previousResolution = previousResult?.resolution ?? null;
    const previousObservations = previousResult?.preObservations ?? null;
    if (!previousResolution || !Array.isArray(previousObservations)) fail('previous facade result with resolution and preObservations required');
    if (previousResolution.requirementId !== requirement.requirementId) fail(`previous result answers a different requirement: ${previousResolution.requirementId}`);
    if (previousResolution.status === 'COMPLETE') throw new ProgressionRefused('ALREADY_COMPLETE', 'previous resolution is COMPLETE');
    const remaining = {
      maxItems: requirement.budget.maxItems - previousResolution.consumed.items,
      maxMaterializedBytes: requirement.budget.maxMaterializedBytes - previousResolution.consumed.materializedBytes,
      maxProviderCalls: requirement.budget.maxProviderCalls - previousResolution.consumed.providerCalls,
      maxResolutionSteps: requirement.budget.maxResolutionSteps - previousResolution.consumed.resolutionSteps,
    };
    if (remaining.maxResolutionSteps < 1) throw new ProgressionRefused('STEPS_EXHAUSTED', 'no resolution steps remain');
    const retriable = previousResolution.unresolved.filter((u) => RETRIABLE.has(u.reason));
    if (!retriable.length) throw new ProgressionRefused('NOTHING_RETRIABLE', 'no unresolved evidence with a retriable reason');
    // Pre-observe all evidence; previously resolved evidence must still match
    // the previous pre-observations or the step fails closed on drift.
    const pre = await preObserve(requirement);
    const priorDigests = new Map(previousObservations.map((o) => [o.evidenceId, observationDigest(o)]));
    const resolvedIds = new Set(previousResolution.items.map((i) => i.evidenceId));
    for (const o of pre) {
      if (!resolvedIds.has(o.evidenceId)) continue;
      if (priorDigests.get(o.evidenceId) !== observationDigest(o)) {
        const err = new Error(`previously resolved source changed before next step: ${o.evidenceId}`);
        err.name = 'DurabilityFailure';
        err.reason = 'STALE_DURING_RESOLUTION';
        throw err;
      }
    }
    // Operational sub-requirement: only retriable evidence, budgeted at the
    // true remaining values. Zeros are raised to 1 for requirement validity
    // while execute() still plans under the exact remaining budget. The
    // sub-requirement never becomes resolution identity.
    const retriableIds = new Set(retriable.map((u) => u.evidenceId));
    const subBudget = Object.fromEntries(Object.entries(remaining).map(([k, v]) => [k, Math.max(1, v)]));
    const subRequirement = defineContextRequirement({
      consumerRef: requirement.consumerRef,
      semanticNeed: requirement.semanticNeed,
      evidence: requirement.evidence.filter((e) => retriableIds.has(e.id)),
      budget: subBudget,
    });
    const executed = await retrievalPlanner.execute(subRequirement, { remainingBudget: { ...remaining } });
    const evidenceIds = new Set(subRequirement.evidence.map((e) => e.id));
    const byEvidence = new Map();
    for (const c of executed.candidates) {
      if (!evidenceIds.has(c.evidenceId)) fail(`planner returned candidate for unknown evidence: ${c.evidenceId}`);
      if (!retriableIds.has(c.evidenceId)) fail(`planner returned candidate for non-retried evidence: ${c.evidenceId}`);
      if (!byEvidence.has(c.evidenceId)) byEvidence.set(c.evidenceId, []);
      byEvidence.get(c.evidenceId).push(c);
    }
    const freshUnresolved = executed.unresolved.map((u) => ({ evidenceId: u.evidenceId, reason: u.reason }));
    for (const e of subRequirement.evidence) {
      if (!byEvidence.has(e.id) && !freshUnresolved.some((u) => u.evidenceId === e.id)) freshUnresolved.push({ evidenceId: e.id, reason: 'MISSING' });
    }
    const freshById = new Map(freshUnresolved.map((u) => [u.evidenceId, u.reason]));
    // Prior items verbatim first, then new items only for re-attempted evidence
    // in requirement evidence order with rank per evidence.
    const newItems = [];
    for (const e of requirement.evidence) {
      if (!retriableIds.has(e.id)) continue;
      (byEvidence.get(e.id) ?? []).forEach((c, rank) => newItems.push({ evidenceId: c.evidenceId, rank, source: c.source, currentness: { validators: c.validators }, provenance: c.provenance, content: c.content }));
    }
    const items = [...previousResolution.items, ...newItems];
    const carried = new Map(previousResolution.unresolved.map((u) => [u.evidenceId, u.reason]));
    const unresolved = [];
    for (const e of requirement.evidence) {
      if (retriableIds.has(e.id)) {
        if (!byEvidence.has(e.id)) unresolved.push({ evidenceId: e.id, reason: freshById.get(e.id) });
      } else if (carried.has(e.id)) {
        unresolved.push({ evidenceId: e.id, reason: carried.get(e.id) });
      }
    }
    const statusFor = (list) => list.some((u) => requirement.evidence.find((e) => e.id === u.evidenceId)?.necessity === 'REQUIRED') ? 'UNSATISFIED' : list.length ? 'PARTIAL' : 'COMPLETE';
    // Cumulative consumption: previous counters plus this step's deltas. Exact
    // bytes come from the contract two-pass method; the delivered chaining
    // check binds index and previousResolutionId and rejects any decrease or
    // budget excess. No overflow dropping: excess fails closed here.
    const stepIndex = previousResolution.step.index + 1;
    const deltas = {
      items: previousResolution.consumed.items + newItems.length,
      providerCalls: previousResolution.consumed.providerCalls + executed.planned.reserved.providerCalls,
      resolutionSteps: previousResolution.consumed.resolutionSteps + 1,
    };
    const build = (materializedBytes) => defineContextResolution({
      requirementId: requirement.requirementId,
      step: { index: stepIndex, previousResolutionId: previousResolution.resolutionId },
      status: statusFor(unresolved), items, unresolved,
      consumed: { ...deltas, materializedBytes },
    }, requirement, previousResolution);
    let sized;
    try {
      sized = build(requirement.budget.maxMaterializedBytes);
    } catch (error) {
      if (!(error instanceof TypeError) || error.message !== 'consumed below materialization/step') throw error;
      fail('materializedBytes budget exceeded');
    }
    const resolution = build(sized.materialization.bytes);
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

  return Object.freeze({ resolve, resolveNext, preObserve });
}
