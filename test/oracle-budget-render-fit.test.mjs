// Oracle context-budget render fit: the derived requirement budget plus the
// Core-measured block envelope never exceeds the profile rendered ceiling.
// Hermetic: no filesystem writes, no network, no credentials; all content is
// inline and every render goes through Core renderAgentContext.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as O from '../packages/oracle/src/index.js';
import { defineContextBudgetProfile, deriveRequirementBudget, deriveNextStepBudget } from '../packages/oracle/src/context-budget.js';
import { defineContextBlock, defineContextSelection, defineContextPolicy, renderAgentContext } from '../packages/core-harness/src/context.js';
import { defineContextRequirementBlock, resolveContextRequirementBlocks } from '../packages/core-harness/src/context-resolution.js';

const BLOCK_NAME = 'oracle-budget';
const BLOCK_DESCRIPTION = 'Budget render-fit probe block';

function profileInput() {
  return {
    kind: 'CONTEXT_BUDGET_PROFILE',
    version: 1,
    modelProfileRef: 'render-fit-probe',
    renderedCharCeiling: 8192,
    reservedChars: 1024,
    blockEnvelopeChars: 512,
    maxItems: 8,
    maxProviderCalls: 8,
    maxResolutionSteps: 2,
    tokenizer: null,
  };
}

const CONTENTS = {
  ascii: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ',
  quotes: 'She said "hello"\nand left.\tTab here\\backslash\'quote\' "again"\r\nnext line. ',
  bmp: 'café naïve résumé 日本語テスト 한글 テスト Греческий текст. ',
  astral: '😀🎉🚀🌟💡🧪📦🔍⚙️🧠',
};
const REPEAT = { ascii: 30, quotes: 30, bmp: 40, astral: 90 };
const contentFor = (id) => CONTENTS[id].repeat(REPEAT[id]);

function authority() {
  return { sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: 'rev-1' }) };
}
function provider(contents = {}) {
  const providerId = 'p-budget-fit';
  return {
    descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations: ['READ_EXACT'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) {
      const content = Object.hasOwn(contents, work.evidenceId) ? contents[work.evidenceId] : contentFor(work.evidenceId);
      return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'rev-1', itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: 'rev-1', strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `repo@rev-1:${work.sourceConstraint.itemRef}` }], content, providerEvidence: { providerId, operation: work.operation } }];
    },
  };
}
const evidence = (id, necessity = 'REQUIRED') => ({ id, necessity, need: 'budget render-fit need', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' }, itemRefs: [`${id}.js`] }, requiredProvenance: [] });
function setup(contents = {}) {
  const catalog = O.createSourceCatalog({ providers: [provider(contents)], snapshotAuthorities: [authority()] });
  const retrievalPlanner = O.createRetrievalPlanner({ catalog });
  return O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner });
}
function requirementFor(ids, budget) {
  return { consumerRef: 'budget-fit', semanticNeed: 'fit the rendered ceiling', evidence: ids.map((id) => evidence(id)), budget };
}
async function renderThroughCore(resolver, profile, req) {
  const block = defineContextRequirementBlock({
    name: BLOCK_NAME, description: BLOCK_DESCRIPTION, trust: 'UNTRUSTED',
    requirement: structuredClone(req),
    project(result) { return result.resolution.items; },
  });
  const port = { resolve: (r, metadata) => resolver.resolve(r, metadata) };
  const fixed = await resolveContextRequirementBlocks({ blocks: [block], selectedNames: [BLOCK_NAME], resolver: port, metadata: {} });
  const rendered = await renderAgentContext({
    blocks: fixed,
    selection: defineContextSelection({ blocks: [BLOCK_NAME] }),
    policy: defineContextPolicy({ maxSerializedChars: profile.renderedCharCeiling }),
  });
  return { rendered, length: JSON.stringify(rendered).length };
}
function assertRenderFit(profile, { measuredEnvelopeChars, renderedChars }) {
  if (profile.blockEnvelopeChars < measuredEnvelopeChars) {
    throw new RangeError(`render-fit rejected: declared blockEnvelopeChars ${profile.blockEnvelopeChars} is below the Core-measured envelope ${measuredEnvelopeChars}`);
  }
  if (renderedChars > profile.renderedCharCeiling) {
    throw new RangeError(`render-fit rejected: rendered ${renderedChars} chars exceeds renderedCharCeiling ${profile.renderedCharCeiling}`);
  }
}
async function measureEnvelope() {
  const empty = defineContextBlock({ name: BLOCK_NAME, description: BLOCK_DESCRIPTION, trust: 'UNTRUSTED', value: [] });
  const rendered = await renderAgentContext({
    blocks: [empty],
    selection: defineContextSelection({ blocks: [BLOCK_NAME] }),
    policy: defineContextPolicy({ maxSerializedChars: 8192 }),
  });
  return JSON.stringify(rendered).length;
}

test('render-fit envelope: the profile declares at least the Core-measured empty-block envelope', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const measured = await measureEnvelope();
  console.log(`measured block envelope: ${measured} chars; declared blockEnvelopeChars: ${profile.blockEnvelopeChars}`);
  assert.ok(measured > 0);
  assertRenderFit(profile, { measuredEnvelopeChars: measured, renderedChars: measured });
});

test('render-fit fixtures resolve at the derived budget and render within the ceiling', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const budget = deriveRequirementBudget(profile);
  assert.deepEqual(budget, { maxItems: 8, maxMaterializedBytes: 6656, maxProviderCalls: 8, maxResolutionSteps: 2 });
  const measured = await measureEnvelope();
  const resolver = setup();
  for (const id of ['ascii', 'quotes', 'bmp', 'astral']) {
    const req = requirementFor([id], budget);
    const first = await resolver.resolve(req);
    assert.equal(first.resolution.status, 'COMPLETE', `${id} must resolve completely so its content is really rendered`);
    const { length } = await renderThroughCore(resolver, profile, req);
    console.log(`fixture ${id}: materialized=${first.resolution.materialization.bytes}B rendered=${length} chars ceiling=${profile.renderedCharCeiling}`);
    assertRenderFit(profile, { measuredEnvelopeChars: measured, renderedChars: length });
    const remaining = deriveNextStepBudget(profile, first.resolution);
    assert.deepEqual(remaining, {
      maxItems: budget.maxItems - first.resolution.consumed.items,
      maxMaterializedBytes: budget.maxMaterializedBytes - first.resolution.consumed.materializedBytes,
      maxProviderCalls: budget.maxProviderCalls - first.resolution.consumed.providerCalls,
      maxResolutionSteps: budget.maxResolutionSteps - first.resolution.consumed.resolutionSteps,
    });
  }
});

test('render-fit rejects a declared blockEnvelopeChars smaller than the measured Core envelope', async () => {
  const measured = await measureEnvelope();
  const bad = defineContextBudgetProfile({ ...profileInput(), blockEnvelopeChars: measured - 1 });
  assert.ok(bad.blockEnvelopeChars < measured);
  assert.throws(() => assertRenderFit(bad, { measuredEnvelopeChars: measured, renderedChars: measured }), /below the Core-measured envelope/);
});

test('render-fit fails any fixture whose Core-rendered block exceeds the ceiling', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const measured = await measureEnvelope();
  const oversized = defineContextBlock({ name: BLOCK_NAME, description: BLOCK_DESCRIPTION, trust: 'UNTRUSTED', value: ['x'.repeat(profile.renderedCharCeiling)] });
  const rendered = await renderAgentContext({
    blocks: [oversized],
    selection: defineContextSelection({ blocks: [BLOCK_NAME] }),
    policy: defineContextPolicy({ maxSerializedChars: profile.renderedCharCeiling * 4 }),
  });
  const length = JSON.stringify(rendered).length;
  assert.ok(length > profile.renderedCharCeiling, 'oversized control must really exceed the ceiling');
  assert.throws(() => assertRenderFit(profile, { measuredEnvelopeChars: measured, renderedChars: length }), /exceeds renderedCharCeiling/);
});

// Materialization of a single item is the fixed item overhead plus the
// serialized content, so one probe resolve learns the overhead and the
// near-bound content size follows by arithmetic, confirmed by execution.
async function materializationOverhead(budget, evidenceId) {
  const probe = 'QQQ';
  const resolver = setup({ [evidenceId]: probe });
  const first = await resolver.resolve(requirementFor([evidenceId], budget));
  assert.equal(first.resolution.status, 'COMPLETE');
  return first.resolution.materialization.bytes - Buffer.byteLength(JSON.stringify(probe), 'utf8');
}

test('render-fit near-bound ascii fixture fills the derived byte budget and renders within the ceiling', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const budget = deriveRequirementBudget(profile);
  const overhead = await materializationOverhead(budget, 'near-ascii');
  const serialized = budget.maxMaterializedBytes - 16 - overhead;
  const content = 'x'.repeat(serialized - 2);
  const resolver = setup({ 'near-ascii': content });
  const req = requirementFor(['near-ascii'], budget);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'COMPLETE');
  const bytes = first.resolution.materialization.bytes;
  assert.ok(bytes > budget.maxMaterializedBytes - 64 && bytes <= budget.maxMaterializedBytes, `near-bound bytes ${bytes} must sit within 64B of ${budget.maxMaterializedBytes}`);
  const measured = await measureEnvelope();
  const { length } = await renderThroughCore(resolver, profile, req);
  console.log(`fixture near-ascii: materialized=${bytes}B rendered=${length} chars ceiling=${profile.renderedCharCeiling}`);
  assertRenderFit(profile, { measuredEnvelopeChars: measured, renderedChars: length });
});

test('render-fit near-bound quotes fixture fills the derived byte budget and renders within the ceiling', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const budget = deriveRequirementBudget(profile);
  const overhead = await materializationOverhead(budget, 'near-quotes');
  const serialized = budget.maxMaterializedBytes - 16 - overhead;
  // One frag serializes to 6 chars plus the single pair of wrapping quotes,
  // so units divide the quoteless target by 6. Every frag char
  // escape-expands (quote, backslash, newline); the plain tail is fewer than
  // 6 chars and only closes the exact byte target.
  const frag = '"\\\n';
  const units = Math.floor((serialized - 2) / 6);
  const tail = serialized - 2 - units * 6;
  const content = frag.repeat(units) + 'x'.repeat(tail);
  const resolver = setup({ 'near-quotes': content });
  const req = requirementFor(['near-quotes'], budget);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'COMPLETE');
  const bytes = first.resolution.materialization.bytes;
  assert.ok(bytes > budget.maxMaterializedBytes - 64 && bytes <= budget.maxMaterializedBytes, `near-bound bytes ${bytes} must sit within 64B of ${budget.maxMaterializedBytes}`);
  const measured = await measureEnvelope();
  const { length } = await renderThroughCore(resolver, profile, req);
  console.log(`fixture near-quotes: materialized=${bytes}B rendered=${length} chars ceiling=${profile.renderedCharCeiling}`);
  assertRenderFit(profile, { measuredEnvelopeChars: measured, renderedChars: length });
});

test('render-fit one byte over budget resolves BUDGET_EXHAUSTED with no items', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const budget = deriveRequirementBudget(profile);
  const overhead = await materializationOverhead(budget, 'over');
  const serialized = budget.maxMaterializedBytes + 1 - overhead;
  const resolver = setup({ over: 'x'.repeat(serialized - 2) });
  const first = await resolver.resolve(requirementFor(['over'], budget));
  assert.equal(first.resolution.items.length, 0);
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'over', reason: 'BUDGET_EXHAUSTED' }]);
  assert.equal(first.resolution.status, 'UNSATISFIED');
});

test('over-budget context reports BUDGET_EXHAUSTED with whole items dropped and kept content byte-identical', async () => {
  const profile = defineContextBudgetProfile(profileInput());
  const budget = deriveRequirementBudget(profile);
  const big = 'Z'.repeat(4000);
  const bigProvider = () => {
    const providerId = 'p-budget-overflow';
    return {
      descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations: ['READ_EXACT'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
      async retrieve(work) {
        const content = work.evidenceId === 'keep' ? 'kept-content' : big;
        return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'rev-1', itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: 'rev-1', strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `repo@rev-1:${work.sourceConstraint.itemRef}` }], content, providerEvidence: { providerId, operation: work.operation } }];
      },
    };
  };
  const catalog = O.createSourceCatalog({ providers: [bigProvider()], snapshotAuthorities: [authority()] });
  const real = O.createRetrievalPlanner({ catalog });
  const generous = { plan: real.plan.bind(real), execute: (r, opts) => real.execute({ consumerRef: r.consumerRef, semanticNeed: r.semanticNeed, evidence: r.evidence, budget: { ...r.budget, maxMaterializedBytes: 100000 } }, opts) };
  const resolver = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: generous });
  const req = { consumerRef: 'budget-fit', semanticNeed: 'overflow', evidence: [evidence('keep'), evidence('drop-a', 'OPTIONAL'), evidence('drop-b', 'OPTIONAL')], budget };
  const tight = await resolver.resolve(req);
  assert.ok(['PARTIAL', 'UNSATISFIED'].includes(tight.resolution.status));
  const dropped = tight.resolution.unresolved.filter((u) => u.reason === 'BUDGET_EXHAUSTED').map((u) => u.evidenceId).sort();
  assert.ok(dropped.length >= 1, 'over-budget evidence must be BUDGET_EXHAUSTED');
  assert.ok(!tight.resolution.items.some((i) => dropped.includes(i.evidenceId)), 'dropped evidence contributes no partial item');
  for (const item of tight.resolution.items) {
    assert.equal(item.evidenceId, 'keep');
    assert.equal(item.content, 'kept-content');
    assert.equal(item.content.length, 'kept-content'.length);
    assert.ok(Buffer.from(item.content, 'utf8').equals(Buffer.from('kept-content', 'utf8')), 'kept content byte-identical, never truncated');
  }
  const wide = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: real });
  const full = await wide.resolve({ ...req, budget: { ...budget, maxMaterializedBytes: 100000 } });
  const fullKept = full.resolution.items.filter((i) => i.evidenceId === 'keep');
  assert.deepEqual(tight.resolution.items, fullKept);
});
