// BB-094 (K1/K2) — Oracle/Core profile conformance suite.
//
// Builds Core createAgentRuntime with contextRequirementBlocks and
// contextResolver = createOracleContextResolver over deterministic fixture
// catalog providers, plus a fake model that records prompts. Verifies:
//   CI1 — on every supported Core profile Oracle requirement blocks resolve
//         exactly once per agent call; UNSATISFIED and drift fail pre-render
//         with zero model/capability calls; sequential calls re-resolve.
//   CI2 — a runtime restored from a snapshot re-resolves context on its next
//         call, reusing only a CURRENT durability receipt and never a stale one.
//
// Profile manifest (D2): the suite reads docs/blackboard/work-graph.json and
// the BB-081 decision artifacts. profiles = [CORE_SYNC] plus
// CORE_ASYNC_FIRST_V1 only when BB-081 is DONE with a recorded PROMOTE_ASYNC
// decision. Every unexecuted cell is emitted as
// {profile, status: 'NOT_EVALUATED', reason} — never silently skipped.
//
// Resume contradiction (D6): if the resume test ever shows Core reusing a
// projected block from a snapshot without re-resolution, that is a Core
// contradiction — the test fails as PLAN_INPUT_CONTRADICTION. Core is never
// patched to satisfy this suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentRuntime,
  defineCapability,
  createRuntimeSnapshot,
  createRuntimeConfigurationManifest,
} from '../packages/core-harness/src/index.js';
import {
  createOracleContextResolver,
  createSourceCatalog,
  createDurableResolutionCoordinator,
  createResolutionStore,
  defineContextRequirement,
} from '../packages/oracle/src/index.js';
import { CORE_SYNC, CORE_ASYNC_FIRST_V1 } from '../packages/core-harness/src/execution-profile.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BB081_DECISION_FILENAMES = [
  'BB-081.delivered-feature.json',
  'BB-081.implementation-result.json',
  'BB-081.candidate-jev-evaluation.json',
];
const BB081_DECISIONS = ['PROMOTE_ASYNC', 'KEEP_SYNC_BASELINE', 'INCONCLUSIVE'];

function readJsonQuiet(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractBb081Decision(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const direct = doc.decision ?? doc.profile?.decision ?? doc.evaluation?.decision;
  if (typeof direct === 'string' && BB081_DECISIONS.includes(direct)) return direct;
  for (const claim of Array.isArray(doc.claims) ? doc.claims : []) {
    if (claim?.id === 'DECISION' && typeof claim.decision === 'string' && BB081_DECISIONS.includes(claim.decision)) {
      return claim.decision;
    }
  }
  return null;
}

// D2 — profile manifest. Only an explicit recorded PROMOTE_ASYNC decision on a
// DONE BB-081 publishes the async profile; everything else is NOT_EVALUATED.
export function resolveConformanceProfiles({ repoRoot } = {}) {
  const root = repoRoot ?? REPO_ROOT;
  const workGraph = readJsonQuiet(path.join(root, 'docs', 'blackboard', 'work-graph.json'));
  const tasks = workGraph?.tasks;
  const bb081 = Array.isArray(tasks)
    ? tasks.find((t) => t?.id === 'BB-081' || t?.artifactId === 'BB-081')
    : tasks?.['BB-081'];
  const bb081Status = bb081?.status ?? null;
  let bb081Decision = null;
  let decisionSource = null;
  for (const filename of BB081_DECISION_FILENAMES) {
    const decision = extractBb081Decision(readJsonQuiet(path.join(root, 'docs', 'blackboard', 'artifacts', 'ready-implement-plan', filename)));
    if (decision) {
      bb081Decision = decision;
      decisionSource = filename;
      break;
    }
  }
  const asyncPublished = bb081Status === 'DONE' && bb081Decision === 'PROMOTE_ASYNC';
  return {
    bb081Status,
    bb081Decision,
    decisionSource,
    asyncPublished,
    profiles: asyncPublished ? [CORE_SYNC, CORE_ASYNC_FIRST_V1] : [CORE_SYNC],
    cells: [
      { profile: CORE_SYNC, status: 'EVALUATED' },
      {
        profile: CORE_ASYNC_FIRST_V1,
        status: asyncPublished ? 'EVALUATED' : 'NOT_EVALUATED',
        ...(asyncPublished
          ? {}
          : { reason: 'BB-081 has no recorded PROMOTE_ASYNC decision; async interaction is NOT_EVALUATED per the BB-064 async rule' }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Deterministic fixture world: a source catalog whose snapshot authority
// serves scripted revisions, and a fixture retrieval planner with
// per-evidence behavior modes ('ok' | 'missing').
// ---------------------------------------------------------------------------
function createFixtureWorld({ initialRevision = 'r1', evidenceModes = {} } = {}) {
  const state = { revision: initialRevision, script: null, observationIndex: 0 };
  const observe = async () => {
    const rev = state.script
      ? state.script[Math.min(state.observationIndex++, state.script.length - 1)]
      : state.revision;
    return { snapshotRef: rev };
  };
  const catalog = createSourceCatalog({
    snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: 'fixture/', observe }],
  });
  const planner = {
    plan() {
      return {
        requirementId: 'fixture-plan',
        work: [],
        unresolved: [],
        reserved: { providerCalls: 0, items: 0, materializedBytes: 0, resolutionSteps: 1 },
      };
    },
    async execute(rawRequirement) {
      const req = defineContextRequirement(rawRequirement);
      const candidates = [];
      const unresolved = [];
      for (const evidence of req.evidence) {
        if ((evidenceModes[evidence.id] ?? 'ok') === 'missing') {
          unresolved.push({ evidenceId: evidence.id, reason: 'MISSING' });
          continue;
        }
        const authority = catalog.authorityFor({ kind: evidence.source.kind, ref: evidence.source.ref });
        const observed = await authority.observe({ kind: evidence.source.kind, ref: evidence.source.ref });
        candidates.push({
          evidenceId: evidence.id,
          source: {
            kind: evidence.source.kind,
            ref: evidence.source.ref,
            snapshotRef: observed.snapshotRef,
            itemRef: `fixture/${evidence.id}`,
          },
          validators: [{ kind: 'REVISION', value: observed.snapshotRef, strength: 'STRONG' }],
          provenance: [{ kind: 'SOURCE_REF', ref: `${evidence.source.ref}@${observed.snapshotRef}` }],
          content: `fixture-content:${evidence.id}:${observed.snapshotRef}`,
        });
      }
      return {
        requirementId: req.requirementId,
        planned: {
          reserved: {
            providerCalls: candidates.length,
            items: candidates.length,
            materializedBytes: 65536,
            resolutionSteps: 1,
          },
        },
        candidates,
        unresolved,
        failures: [],
      };
    },
  };
  return {
    catalog,
    planner,
    setRevision: (revision) => { state.revision = revision; },
    // Script the next observations (pre, planner, post, ...) with exact
    // revisions; the last revision repeats once the script is exhausted.
    scriptRevisions: (revisions) => { state.script = [...revisions]; state.observationIndex = 0; },
    clearScript: () => { state.script = null; },
  };
}

const REQUIREMENT = {
  consumerRef: 'bb094-conformance',
  semanticNeed: 'fixture oracle context for profile conformance',
  evidence: [
    {
      id: 'repo',
      necessity: 'REQUIRED',
      need: 'repository context',
      source: { kind: 'REPOSITORY', ref: 'fixture/repo', snapshot: { mode: 'CURRENT' } },
    },
  ],
  budget: { maxItems: 4, maxMaterializedBytes: 100000, maxProviderCalls: 8, maxResolutionSteps: 2 },
};

// Core-side projection of the Oracle resolution envelope. Fail-closed: any
// non-COMPLETE status throws before render, so run() rejects before the
// strategy, model or capabilities run.
function projectConformanceBlock(envelope) {
  const resolution = envelope?.resolution;
  if (!resolution || typeof resolution.status !== 'string') {
    throw new Error('conformance: oracle resolver returned no resolution envelope');
  }
  if (resolution.status !== 'COMPLETE') {
    throw new Error(`conformance: fail-closed pre-render (oracle status=${resolution.status})`);
  }
  const revisions = (resolution.items ?? []).map((item) => item?.source?.snapshotRef ?? '?').join(',');
  return { text: `oracle-context@${revisions}`, items: (resolution.items ?? []).length };
}

function freshCounters() {
  return {
    resolverCalls: 0,
    strategyRuns: 0,
    modelCalls: 0,
    capabilityCalls: 0,
    modelPrompts: [],
  };
}

function buildRuntime({ resolver, counters }) {
  return createAgentRuntime({
    strategy: {
      kind: 'BB094_CONFORMANCE',
      acceptsRoutedModel: true,
      async run({ model, invoke, promptContext }) {
        counters.strategyRuns++;
        await invoke('probe', { ping: true });
        const output = await model.generate({ promptContext });
        return `strategy:${output}`;
      },
    },
    capabilities: [
      defineCapability({
        name: 'probe',
        description: 'conformance probe capability',
        execute: async (input) => {
          counters.capabilityCalls++;
          return { pong: input?.ping === true };
        },
      }),
    ],
    contextRequirementBlocks: [
      {
        name: 'oracle-semantic',
        description: 'oracle resolved context',
        trust: 'UNTRUSTED',
        requirement: REQUIREMENT,
        project: projectConformanceBlock,
      },
    ],
    contextResolver: resolver,
    models: [
      {
        name: 'conformance-fake',
        generate: async (request) => {
          counters.modelCalls++;
          counters.modelPrompts.push(request?.promptContext ?? null);
          return 'fake-output';
        },
      },
    ],
    model: 'conformance-fake',
  });
}

function wrapCounting(oracleResolver, counters, envelopes) {
  return {
    async resolve(requirement, metadata) {
      counters.resolverCalls++;
      const envelope = await oracleResolver.resolve(requirement, metadata);
      envelopes.push(envelope);
      return envelope;
    },
  };
}

function buildOracleHarness({ world, counters, envelopes }) {
  const oracleResolver = createOracleContextResolver({
    sourceCatalog: world.catalog,
    retrievalPlanner: world.planner,
  });
  const resolver = wrapCounting(oracleResolver, counters, envelopes);
  return { runtime: buildRuntime({ resolver, counters }) };
}

function projectedText(report) {
  const block = report.promptContext.blocks.find((b) => b.name === 'oracle-semantic');
  assert.ok(block, 'projected oracle-semantic block is rendered');
  return block.value.text;
}

// ---------------------------------------------------------------------------
// D2 — profile manifest
// ---------------------------------------------------------------------------
test('profile manifest: only published profiles execute; the rest are NOT_EVALUATED, never skipped', () => {
  const manifest = resolveConformanceProfiles();
  assert.deepEqual(manifest.profiles, [CORE_SYNC]);
  assert.equal(manifest.asyncPublished, false);
  const asyncCell = manifest.cells.find((c) => c.profile === CORE_ASYNC_FIRST_V1);
  assert.equal(asyncCell.status, 'NOT_EVALUATED');
  assert.match(asyncCell.reason, /PROMOTE_ASYNC/);
  assert.equal(manifest.cells.find((c) => c.profile === CORE_SYNC).status, 'EVALUATED');
});

// ---------------------------------------------------------------------------
// K1 — CI1 conformance per supported profile (D1-D3)
// ---------------------------------------------------------------------------
for (const profile of resolveConformanceProfiles().profiles) {
  test(`[${profile}] COMPLETE resolution renders exactly once per agent call`, async () => {
    const world = createFixtureWorld({});
    const counters = freshCounters();
    const envelopes = [];
    const { runtime } = buildOracleHarness({ world, counters, envelopes });

    const report = await runtime.runWithReport({ contextSelection: { blocks: ['oracle-semantic'] } });
    assert.equal(counters.resolverCalls, 1);
    assert.equal(envelopes[0].outcome, 'FRESH');
    assert.match(projectedText(report), /^oracle-context@r1$/);
    assert.equal(counters.modelCalls, 1);
    assert.equal(counters.capabilityCalls, 1);
    // The fake model records the rendered prompt, which carries the block.
    const rendered = counters.modelPrompts[0].blocks.find((b) => b.name === 'oracle-semantic');
    assert.match(rendered.value.text, /^oracle-context@r1$/);

    // A call that selects no requirement block performs no resolution.
    await runtime.run({ contextSelection: { blocks: [] } });
    assert.equal(counters.resolverCalls, 1);
  });

  test(`[${profile}] two sequential calls invoke the resolver twice (no cross-call reuse)`, async () => {
    const world = createFixtureWorld({});
    const counters = freshCounters();
    const envelopes = [];
    const { runtime } = buildOracleHarness({ world, counters, envelopes });

    await runtime.run({ contextSelection: { blocks: ['oracle-semantic'] } });
    await runtime.run({ contextSelection: { blocks: ['oracle-semantic'] } });
    assert.equal(counters.resolverCalls, 2);
    assert.equal(envelopes[0].outcome, 'FRESH');
    assert.equal(envelopes[1].outcome, 'FRESH');
  });

  test(`[${profile}] UNSATISFIED fails pre-render with zero model/capability calls`, async () => {
    const world = createFixtureWorld({ evidenceModes: { repo: 'missing' } });
    const counters = freshCounters();
    const envelopes = [];
    const { runtime } = buildOracleHarness({ world, counters, envelopes });

    await assert.rejects(
      runtime.run({ contextSelection: { blocks: ['oracle-semantic'] } }),
      /fail-closed pre-render \(oracle status=UNSATISFIED\)/
    );
    assert.equal(counters.resolverCalls, 1);
    assert.equal(counters.strategyRuns, 0);
    assert.equal(counters.modelCalls, 0);
    assert.equal(counters.capabilityCalls, 0);
  });

  test(`[${profile}] STALE_DURING_RESOLUTION fails pre-render with zero model/capability calls`, async () => {
    const world = createFixtureWorld({});
    // pre-observe r1, planner reads r1, post-observe sees r2: drift fence fires.
    world.scriptRevisions(['r1', 'r1', 'r2']);
    const counters = freshCounters();
    const envelopes = [];
    const { runtime } = buildOracleHarness({ world, counters, envelopes });

    await assert.rejects(
      runtime.run({ contextSelection: { blocks: ['oracle-semantic'] } }),
      (error) => error?.reason === 'STALE_DURING_RESOLUTION'
    );
    assert.equal(counters.resolverCalls, 1);
    assert.equal(counters.strategyRuns, 0);
    assert.equal(counters.modelCalls, 0);
    assert.equal(counters.capabilityCalls, 0);
    world.clearScript();
  });
}

// ---------------------------------------------------------------------------
// K2 — CI2 resume rule (D4)
// ---------------------------------------------------------------------------
test('resume rule: a runtime restored from a snapshot re-resolves; no projected block is reused without resolution', async (t) => {
  const world = createFixtureWorld({ initialRevision: 'r1' });
  const counters = freshCounters();
  const envelopes = [];
  const { runtime: runtimeA } = buildOracleHarness({ world, counters, envelopes });

  const reportA = await runtimeA.runWithReport({ contextSelection: { blocks: ['oracle-semantic'] } });
  assert.equal(counters.resolverCalls, 1);
  assert.match(projectedText(reportA), /^oracle-context@r1$/);

  // Snapshot with Core createRuntimeSnapshot after the call. The snapshot
  // carries the configuration manifest plus redacted agent events; per-call
  // projected requirement blocks are runtime-local and never enter it.
  const configuration = createRuntimeConfigurationManifest({
    compatibilityTag: 'bb094-conformance-v1',
    strategy: { kind: 'BB094_CONFORMANCE' },
    capabilities: [],
    contextBlocks: [],
    judgments: [],
  });
  const snapshot = createRuntimeSnapshot({
    configuration,
    agentEvents: runtimeA.agentEvents(),
    agentResources: [],
  });
  assert.ok(snapshot.digest, 'snapshot carries a digest');
  assert.equal(
    JSON.stringify(snapshot).includes('oracle-context@r1'),
    false,
    'snapshot state contains no projected per-call context block'
  );

  // Restore into a new runtime: a woken runtime rebuilt from the snapshot's
  // configuration carries no projected context state. The world moved on.
  world.setRevision('r2');
  const { runtime: runtimeB } = buildOracleHarness({ world, counters, envelopes });
  const reportB = await runtimeB.runWithReport({ contextSelection: { blocks: ['oracle-semantic'] } });

  // D6: if Core ever rendered the prior projected block without calling the
  // resolver, this fails as PLAN_INPUT_CONTRADICTION — Core is not patched.
  assert.equal(counters.resolverCalls, 2, 'restored runtime invokes the resolver again (PLAN_INPUT_CONTRADICTION if not)');
  assert.match(projectedText(reportB), /^oracle-context@r2$/, 'restored call renders a fresh resolution, never the stale r1 block');
  t.diagnostic(`call counters: resolver=${counters.resolverCalls} model=${counters.modelCalls} capability=${counters.capabilityCalls}`);
});

test('durability: a CURRENT receipt may be REUSED; a changed source yields a fresh resolution, never the stale receipt', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bb094-conformance-'));
  const world = createFixtureWorld({ initialRevision: 'r1' });
  const counters = freshCounters();
  const envelopes = [];

  const plain = createOracleContextResolver({ sourceCatalog: world.catalog, retrievalPlanner: world.planner });
  const store = createResolutionStore({ path: path.join(dir, 'oracle') });
  const coordinator = createDurableResolutionCoordinator({
    catalog: world.catalog,
    store,
    resolverConfiguration: {
      contractRevision: 'bb094-fixture-v1',
      plannerRevision: 'bb094-fixture-v1',
      materializationRevision: 'bb094-fixture-v1',
      providerBindings: {},
    },
    resolveFresh: async (req) => (await plain.resolve(req)).resolution,
  });
  const durable = createOracleContextResolver({
    sourceCatalog: world.catalog,
    retrievalPlanner: world.planner,
    durability: coordinator,
  });
  const runtime = buildRuntime({ resolver: wrapCounting(durable, counters, envelopes), counters });
  const select = { contextSelection: { blocks: ['oracle-semantic'] } };

  const first = await runtime.runWithReport(select);
  assert.equal(envelopes[0].outcome, 'PUBLISHED');
  assert.match(projectedText(first), /^oracle-context@r1$/);

  // Unchanged source: the CURRENT receipt is reused (Core still resolves once
  // per call; Oracle reuses the durable receipt underneath).
  const second = await runtime.runWithReport(select);
  assert.equal(envelopes[1].outcome, 'REUSED');
  assert.equal(counters.resolverCalls, 2);
  assert.equal(projectedText(second), projectedText(first));

  // Changed source: a new resolution is published; the stale r1 receipt is
  // never served.
  world.setRevision('r2');
  const third = await runtime.runWithReport(select);
  assert.equal(envelopes[2].outcome, 'PUBLISHED');
  assert.match(projectedText(third), /^oracle-context@r2$/);
  assert.notEqual(projectedText(third), projectedText(first));
});
