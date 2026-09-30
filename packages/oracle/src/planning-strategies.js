import { defineContextRequirement, contextItemDigest } from './context-contract.js';
import { ProviderFailure, ProviderOperation } from './provider-contract.js';
import { createRetrievalPlanner } from './retrieval-planner.js';

/**
 * Opt-in retrieval planning strategies. Both factories keep the delivered {plan, execute}
 * interface, delegate every reservation to the base DETERMINISTIC_V1 planner and validate every
 * provider candidate through the SourceCatalog. createRetrievalPlanner stays the default.
 */
export const PlanningStrategyId = Object.freeze({
  DETERMINISTIC_V1: 'DETERMINISTIC_V1',
  RRF_FUSION_V1: 'RRF_FUSION_V1',
  GRAPH_EXPANDED_V1: 'GRAPH_EXPANDED_V1'
});
export const RRF_K = 60;
export const GRAPH_EXPANSION_REF_PREFIX = 'context-graph://';

const fail = message => { throw new TypeError(message); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function requireCatalog(catalog, label) {
  if (!catalog || typeof catalog.compatible !== 'function' || typeof catalog.validateCandidate !== 'function' || typeof catalog.provider !== 'function') fail(`${label} requires SourceCatalog`);
}
function requireBase(base, label) {
  if (!base || typeof base.plan !== 'function' || typeof base.execute !== 'function') fail(`${label} base planner requires plan() and execute()`);
  return base;
}
const itemKey = candidate => candidate.source.itemRef ?? candidate.source.ref;
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Runs one reserved work unit with exactly the DETERMINISTIC_V1 acceptance rules: candidate array,
 * item reservation, SourceCatalog validation (EXACT/CURRENT), reserved operation and byte reservation.
 */
async function runWork(catalog, requirement, work) {
  const registration = catalog.provider(work.providerId);
  const raw = await registration.retrieve(work);
  if (!Array.isArray(raw)) fail('provider must return candidate array');
  if (raw.length > work.reservedBudget.items) throw new ProviderFailure({ reason: 'BUDGET_EXHAUSTED', providerId: work.providerId, evidenceId: work.evidenceId, detail: 'provider item reservation exceeded' });
  let bytes = 0; const accepted = [];
  for (const candidate of raw) {
    const normalized = await catalog.validateCandidate(candidate, { requirement, providerId: work.providerId });
    if (normalized.providerEvidence.operation !== work.operation) fail('provider operation differs from reserved work');
    const item = { evidenceId: normalized.evidenceId, rank: 0, source: normalized.source, currentness: { validators: normalized.validators }, provenance: normalized.provenance, content: normalized.content };
    bytes += Buffer.byteLength(JSON.stringify({ ...item, itemDigest: contextItemDigest(item) }), 'utf8') + 2;
    accepted.push(normalized);
  }
  if (bytes > work.reservedBudget.materializedBytes) throw new ProviderFailure({ reason: 'BUDGET_EXHAUSTED', providerId: work.providerId, evidenceId: work.evidenceId, detail: 'provider byte reservation exceeded' });
  return accepted;
}
const failureOf = (evidenceId, work, error) => ({ evidenceId, providerId: work.providerId, reason: error instanceof ProviderFailure ? error.reason : 'SOURCE_FAILURE', detail: error.message });

/** RRF_FUSION_V1 (D2): run every reserved work unit, fuse by sum of 1/(RRF_K + rank), ties by itemRef. */
export function createFusionRetrievalPlanner({ catalog, base } = {}) {
  requireCatalog(catalog, 'RRF_FUSION_V1');
  const basePlanner = requireBase(base ?? createRetrievalPlanner({ catalog }), 'RRF_FUSION_V1');
  const plan = (requirement, options = {}) => basePlanner.plan(requirement, options);
  async function execute(requirement, options = {}) {
    const r = defineContextRequirement(requirement), planned = plan(r, options), candidates = [], unresolved = [...planned.unresolved], failures = [];
    const grouped = new Map(); for (const work of planned.work) { if (!grouped.has(work.evidenceId)) grouped.set(work.evidenceId, []); grouped.get(work.evidenceId).push(work); }
    const fusion = [];
    for (const evidence of r.evidence) {
      if (unresolved.some(x => x.evidenceId === evidence.id)) continue;
      let lastReason = 'MISSING'; const successfulRefs = new Set(), perWork = [];
      for (const work of grouped.get(evidence.id) ?? []) {
        try {
          const accepted = await runWork(catalog, r, work);
          if (accepted.length) { perWork.push({ work, accepted }); if (work.operation === ProviderOperation.READ_EXACT) successfulRefs.add(work.sourceConstraint.itemRef); }
        } catch (error) { const failure = failureOf(evidence.id, work, error); failures.push(failure); lastReason = failure.reason; }
      }
      let success = perWork.length > 0;
      if (evidence.source.itemRefs?.length && successfulRefs.size !== evidence.source.itemRefs.length) success = false;
      if (!success) { unresolved.push({ evidenceId: evidence.id, reason: lastReason }); continue; }
      if (evidence.source.itemRefs?.length) { for (const { accepted } of perWork) candidates.push(...accepted); continue; }
      const fused = new Map();
      perWork.forEach(({ work, accepted }, workIndex) => accepted.forEach((candidate, index) => {
        const key = itemKey(candidate), contribution = 1 / (RRF_K + index + 1);
        const entry = fused.get(key);
        if (entry) { entry.score += contribution; entry.providers.push(work.providerId); }
        else fused.set(key, { key, score: contribution, candidate, workIndex, providers: [work.providerId] });
      }));
      const ordered = [...fused.values()].sort((a, b) => (b.score - a.score) || compareText(a.key, b.key));
      candidates.push(...ordered.map(entry => entry.candidate));
      fusion.push({ evidenceId: evidence.id, order: ordered.map(({ key, score, providers }) => ({ itemRef: key, score, providers })) });
    }
    return freeze({ requirementId: r.requirementId, planned, candidates, unresolved, failures, strategyId: PlanningStrategyId.RRF_FUSION_V1, fusion });
  }
  return Object.freeze({ plan, execute, strategyId: PlanningStrategyId.RRF_FUSION_V1 });
}

function unreservedBudget(requirement, planned, remainingBudget) {
  const remaining = { ...requirement.budget, ...(remainingBudget ?? {}) };
  return {
    providerCalls: remaining.maxProviderCalls - planned.reserved.providerCalls,
    items: remaining.maxItems - planned.reserved.items,
    materializedBytes: remaining.maxMaterializedBytes - planned.reserved.materializedBytes
  };
}

/**
 * GRAPH_EXPANDED_V1 (D3): the base result unchanged, plus at most one TRAVERSE_GRAPH IMPORTS hop per
 * resolved REPOSITORY evidence, anchored at that evidence's top base candidate, reserved only from
 * budget the base plan left unreserved, and validated by SourceCatalog against a derived requirement.
 */
export function createGraphExpandedRetrievalPlanner({ catalog, base, graphProviderId = 'context-graph', repositoryRef = null } = {}) {
  requireCatalog(catalog, 'GRAPH_EXPANDED_V1');
  const basePlanner = requireBase(base ?? createRetrievalPlanner({ catalog }), 'GRAPH_EXPANDED_V1');
  if (typeof graphProviderId !== 'string' || !graphProviderId.trim()) fail('GRAPH_EXPANDED_V1 graphProviderId must be nonempty text');
  const plan = (requirement, options = {}) => basePlanner.plan(requirement, options);
  async function execute(requirement, options = {}) {
    const r = defineContextRequirement(requirement), result = await basePlanner.execute(r, options);
    const registration = catalog.provider(graphProviderId);
    const expansions = [], candidates = [...result.candidates], failures = [...result.failures];
    if (!registration || !registration.descriptor.sourceKinds.includes('CONTEXT_GRAPH') || !registration.descriptor.operations.includes(ProviderOperation.TRAVERSE_GRAPH)) {
      return freeze({ ...result, candidates, failures, strategyId: PlanningStrategyId.GRAPH_EXPANDED_V1, expansions: [{ status: 'SKIPPED', reason: 'NO_GRAPH_PROVIDER' }] });
    }
    const free = unreservedBudget(r, result.planned, options.remainingBudget);
    const resolved = new Set(result.candidates.map(c => c.evidenceId));
    for (const evidence of r.evidence) {
      if (evidence.source.kind !== 'REPOSITORY' || evidence.source.itemRefs?.length || !resolved.has(evidence.id)) continue;
      const anchor = result.candidates.find(c => c.evidenceId === evidence.id && c.source.itemRef);
      if (!anchor) { expansions.push({ evidenceId: evidence.id, status: 'SKIPPED', reason: 'NO_ANCHOR' }); continue; }
      const bytes = Math.min(8192, free.materializedBytes);
      if (free.providerCalls < 1 || free.items < 1 || bytes < 1) { expansions.push({ evidenceId: evidence.id, status: 'SKIPPED', reason: 'BUDGET_EXHAUSTED' }); continue; }
      const graphRepository = repositoryRef ?? evidence.source.ref;
      const derivedEvidence = { id: `${evidence.id}#graph`, necessity: 'OPTIONAL', need: evidence.need, source: { kind: 'CONTEXT_GRAPH', ref: `${GRAPH_EXPANSION_REF_PREFIX}${graphRepository}/IMPORTS/1/${anchor.source.itemRef}`, snapshot: structuredClone(evidence.source.snapshot) } };
      let derived;
      try { derived = defineContextRequirement({ consumerRef: r.consumerRef, semanticNeed: r.semanticNeed, evidence: [...r.evidence, derivedEvidence], budget: r.budget }); }
      catch (error) { expansions.push({ evidenceId: evidence.id, status: 'SKIPPED', reason: 'INVALID_DERIVED_REQUIREMENT', detail: error.message }); continue; }
      const work = { evidenceId: derivedEvidence.id, providerId: graphProviderId, operation: ProviderOperation.TRAVERSE_GRAPH, sourceConstraint: { kind: 'CONTEXT_GRAPH', ref: derivedEvidence.source.ref, snapshot: structuredClone(evidence.source.snapshot), itemRef: null }, semanticNeed: evidence.need, reservedBudget: { providerCalls: 1, items: 1, materializedBytes: bytes } };
      free.providerCalls -= 1; free.items -= 1; free.materializedBytes -= bytes;
      try {
        const accepted = await runWork(catalog, derived, work);
        const known = new Set(candidates.map(itemKey));
        const added = accepted.filter(c => !known.has(itemKey(c)));
        candidates.push(...added);
        expansions.push({ evidenceId: evidence.id, status: 'EXPANDED', anchor: anchor.source.itemRef, derivedEvidenceId: derivedEvidence.id, derivedRequirementId: derived.requirementId, work, added: added.map(itemKey) });
      } catch (error) {
        const failure = failureOf(derivedEvidence.id, work, error); failures.push(failure);
        expansions.push({ evidenceId: evidence.id, status: 'FAILED', anchor: anchor.source.itemRef, reason: failure.reason, detail: failure.detail });
      }
    }
    return freeze({ ...result, candidates, failures, strategyId: PlanningStrategyId.GRAPH_EXPANDED_V1, expansions });
  }
  return Object.freeze({ plan, execute, strategyId: PlanningStrategyId.GRAPH_EXPANDED_V1 });
}
