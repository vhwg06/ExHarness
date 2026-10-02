// ORACLE_CORE_INTERACTION_V1 — frozen Oracle/Core interaction protocol (BB-094, D5).
//
// The protocol is a frozen, validated manifest: it defines the Oracle arms,
// the Core arms and the evaluated / NOT_EVALUATED cell matrix, but it runs no
// experiment. The interaction experiment itself runs in BB-095.
//
// Async rule (BB-064): CORE_ASYNC_FIRST_V1 cells are EVALUATED only when
// BB-081 is DONE with a recorded PROMOTE_ASYNC decision. Otherwise they are
// recorded NOT_EVALUATED with a reason — never silently skipped and never
// executed on assumption.
//
// Usage:
//   node scripts/oracle-context-intelligence/core-interaction-protocol.mjs --mode validate
//   node scripts/oracle-context-intelligence/core-interaction-protocol.mjs --mode validate \
//     --work-graph /tmp/fixture/work-graph.json --decision-dir /tmp/fixture/decisions
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'ORACLE_CORE_INTERACTION_V1';
const VERSION = 1;

// Fixed factors copied verbatim from ORACLE_CONTEXT_BENCHMARK_V1
// (scripts/oracle-context-intelligence/benchmark-profile.mjs). The interaction
// protocol reuses the benchmark's frozen factors; it defines arms, not runs.
const FIXED_FACTORS = Object.freeze([
  'model snapshot and provider route',
  'task + task digest',
  'prompt/instruction',
  'initial workspace/source snapshot',
  'Core execution profile',
  'capability/tool surface',
  'model/runtime/resource ceilings',
  'artifact extraction',
  'independent evaluator',
  'repeat/sample schedule',
  'pricing/accounting semantics',
]);

const ORACLE_ARMS = Object.freeze({
  O1_FOUNDATION: Object.freeze({ oracleProfile: 'BB-060..064 deterministic foundation', role: 'baseline' }),
  O2_CANDIDATE: Object.freeze({ oracleProfile: 'candidate under test', role: 'treatment' }),
});

const CORE_ARMS = Object.freeze({
  CORE_SYNC: Object.freeze({ coreProfile: 'synchronous agent runtime', role: 'supported' }),
  CORE_ASYNC_FIRST_V1: Object.freeze({ coreProfile: 'async-first agent runtime (BB-081)', role: 'supported only after PROMOTE_ASYNC' }),
});

const BB081_DECISION_FILENAMES = Object.freeze([
  'BB-081.delivered-feature.json',
  'BB-081.implementation-result.json',
  'BB-081.candidate-jev-evaluation.json',
]);

const DECISIONS = Object.freeze(['PROMOTE_ASYNC', 'KEEP_SYNC_BASELINE', 'INCONCLUSIVE']);

function readJsonQuiet(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Targeted extraction of a recorded BB-081 async decision. Only explicit
// decision fields at known locations count; an absent decision is null, which
// keeps async NOT_EVALUATED (never assumed).
function extractDecision(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const direct = doc.decision ?? doc.profile?.decision ?? doc.evaluation?.decision;
  if (typeof direct === 'string' && DECISIONS.includes(direct)) return direct;
  const claims = Array.isArray(doc.claims) ? doc.claims : [];
  for (const claim of claims) {
    if (claim?.id === 'DECISION' && typeof claim.decision === 'string' && DECISIONS.includes(claim.decision)) {
      return claim.decision;
    }
  }
  return null;
}

export function findBb081Decision(decisionDir) {
  for (const filename of BB081_DECISION_FILENAMES) {
    const doc = readJsonQuiet(path.join(decisionDir, filename));
    const decision = extractDecision(doc);
    if (decision) return { decision, source: filename };
  }
  return { decision: null, source: null };
}

export function bb081Status(workGraph) {
  const tasks = workGraph?.tasks;
  if (Array.isArray(tasks)) {
    return tasks.find((t) => t?.id === 'BB-081' || t?.artifactId === 'BB-081')?.status ?? null;
  }
  if (tasks && typeof tasks === 'object') {
    return tasks['BB-081']?.status ?? null;
  }
  return null;
}

export function resolveInteractionDesign({ bb081TaskStatus, bb081Decision }) {
  const asyncPublished = bb081TaskStatus === 'DONE' && bb081Decision === 'PROMOTE_ASYNC';
  return {
    asyncPublished,
    design: asyncPublished ? '2x2' : '1x2',
    evaluatedCoreArms: asyncPublished ? ['CORE_SYNC', 'CORE_ASYNC_FIRST_V1'] : ['CORE_SYNC'],
  };
}

const ASYNC_NOT_EVALUATED_REASON =
  'CORE_ASYNC_FIRST_V1 is not a published Core profile: BB-081 is not DONE with a recorded PROMOTE_ASYNC decision (BB-064 async rule).';

export function buildInteractionManifest({ asyncPublished, design, evaluatedCoreArms, bb081TaskStatus, bb081Decision, decisionSource }) {
  const cells = [];
  for (const oracleArm of Object.keys(ORACLE_ARMS)) {
    for (const coreArm of Object.keys(CORE_ARMS)) {
      const evaluated = evaluatedCoreArms.includes(coreArm);
      cells.push(Object.freeze({
        oracleArm,
        coreArm,
        status: evaluated ? 'EVALUATED' : 'NOT_EVALUATED',
        ...(evaluated ? {} : { reason: ASYNC_NOT_EVALUATED_REASON }),
      }));
    }
  }
  return Object.freeze({
    schema: SCHEMA,
    version: VERSION,
    frozen: true,
    fixedFactors: FIXED_FACTORS,
    oracleArms: ORACLE_ARMS,
    coreArms: CORE_ARMS,
    design,
    evaluatedCoreArms: Object.freeze([...evaluatedCoreArms]),
    cells: Object.freeze(cells),
    prohibitions: Object.freeze([
      'no live model or paid execution in validate mode',
      'the protocol defines arms and factors; it runs no experiment (the interaction experiment itself runs in BB-095)',
      'no assumed async promotion: unpublished async cells stay NOT_EVALUATED, never silently skipped',
      'no Core or Oracle source change',
    ]),
    decisionBasis: Object.freeze({
      bb081TaskStatus,
      bb081Decision,
      decisionSource,
      asyncPublished,
    }),
  });
}

export function validateInteractionManifest(manifest, basis) {
  assert.equal(manifest?.schema, SCHEMA, 'manifest schema');
  assert.equal(manifest?.version, VERSION, 'manifest version');
  assert.equal(manifest?.frozen, true, 'manifest must be frozen');
  assert.deepEqual(manifest?.fixedFactors, [...FIXED_FACTORS], 'fixed factors must match ORACLE_CONTEXT_BENCHMARK_V1');
  assert.deepEqual(Object.keys(manifest?.oracleArms ?? {}), ['O1_FOUNDATION', 'O2_CANDIDATE'], 'oracle arms');
  assert.deepEqual(Object.keys(manifest?.coreArms ?? {}), ['CORE_SYNC', 'CORE_ASYNC_FIRST_V1'], 'core arms');
  const expectedDesign = basis.asyncPublished ? '2x2' : '1x2';
  assert.equal(manifest?.design, expectedDesign, 'design must match the resolved async state');
  assert.deepEqual(manifest?.evaluatedCoreArms, basis.evaluatedCoreArms, 'evaluated core arms');
  assert.equal(manifest?.cells?.length, 4, 'cell matrix must cover every oracle x core combination');
  for (const cell of manifest.cells) {
    if (cell.coreArm === 'CORE_ASYNC_FIRST_V1' && !basis.asyncPublished) {
      assert.equal(cell.status, 'NOT_EVALUATED', 'unpublished async cells are NOT_EVALUATED');
      assert.match(cell.reason ?? '', /PROMOTE_ASYNC/, 'NOT_EVALUATED cells carry the async-rule reason');
    } else {
      assert.equal(cell.status, 'EVALUATED', 'published cells are EVALUATED');
      assert.equal(cell.reason ?? null, null, 'evaluated cells carry no reason');
    }
  }
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

const args = process.argv.slice(1);
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = argValue(args, '--mode', 'validate');
  if (mode !== 'validate') {
    console.error(`unknown mode: ${mode}`);
    process.exit(1);
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const workGraphPath = argValue(args, '--work-graph', path.join(repoRoot, 'docs', 'blackboard', 'work-graph.json'));
  const decisionDir = argValue(args, '--decision-dir', path.join(repoRoot, 'docs', 'blackboard', 'artifacts', 'ready-implement-plan'));

  const workGraph = readJsonQuiet(workGraphPath);
  const bb081TaskStatus = bb081Status(workGraph);
  const { decision: bb081Decision, source: decisionSource } = findBb081Decision(decisionDir);
  const resolved = resolveInteractionDesign({ bb081TaskStatus, bb081Decision });
  const manifest = buildInteractionManifest({ ...resolved, bb081TaskStatus, bb081Decision, decisionSource });
  validateInteractionManifest(manifest, resolved);

  console.log(JSON.stringify({
    kind: 'ORACLE_CORE_INTERACTION_VALIDATED',
    schema: SCHEMA,
    version: VERSION,
    design: manifest.design,
    asyncPublished: resolved.asyncPublished,
    evaluatedCells: manifest.cells.filter((c) => c.status === 'EVALUATED').length,
    notEvaluatedCells: manifest.cells.filter((c) => c.status === 'NOT_EVALUATED').length,
    cells: manifest.cells,
    fixedFactors: manifest.fixedFactors.length,
    bb081: { taskStatus: bb081TaskStatus, decision: bb081Decision, decisionSource },
  }, null, 2));
}
