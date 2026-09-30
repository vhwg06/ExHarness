// Planner ablation harness tests (PL1, PL3).
// The harness executes every arm through SourceCatalog/planner execute() over a
// frozen git snapshot with a mechanically derived cohort, and the preregistered
// reducer deterministically returns RECOMMEND_<strategy>, KEEP_DETERMINISTIC_V1
// or INCONCLUSIVE_NON_DISCRIMINATING. All git reads use `git show`/`git ls-tree`
// at an exact revision; the working tree is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARMS,
  COHORT_THRESHOLDS,
  REPORT_KIND,
  REPO_ROOT,
  COHORT_PATH,
  buildCohort,
  createGitSnapshotReader,
  createLexicalFixtureClient,
  loadCohort,
  reduceDecision,
  runAblation,
  validateReport
} from '../scripts/oracle-context-intelligence/planner-ablation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(root, REPO_ROOT);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const head = () => git('rev-parse', 'HEAD').trim();

let cached = null;
async function fullReport() {
  cached ??= await runAblation({ snapshotRef: head() });
  return cached;
}

test('ablation runs every arm through the planner at HEAD with the committed cohort digest', async () => {
  const committed = loadCohort(COHORT_PATH);
  const report = await fullReport();
  assert.equal(report.kind, REPORT_KIND);
  assert.equal(report.snapshotRef, head());
  assert.equal(report.cohortDigest, committed.cohortDigest);
  assert.equal(report.arms.length, 5);
  assert.deepEqual(report.arms.map(arm => arm.armId), ['A0', 'A1', 'A2', 'A3', 'A4']);
  assert.equal(report.perQuery.length, committed.queries.length);
  assert.ok(report.perQuery.length > 0);
  for (const entry of report.perQuery) {
    assert.ok(entry.componentId && entry.query && Array.isArray(entry.relevant) && entry.relevant.length > 0);
    assert.deepEqual(Object.keys(entry.results), ['A0', 'A1', 'A2', 'A3', 'A4']);
    for (const [armId, result] of Object.entries(entry.results)) {
      assert.ok(Array.isArray(result.selected), `${armId} selected`);
      assert.equal(new Set(result.selected).size, result.selected.length, `${armId} distinct`);
      assert.ok(result.recall >= 0 && result.recall <= 1, `${armId} recall bounds`);
      assert.ok(result.mrr >= 0 && result.mrr <= 1, `${armId} mrr bounds`);
      assert.ok(Number.isFinite(result.materializedBytes) && result.materializedBytes >= 0);
      assert.ok(result.providerCalls > 0, `${armId} executed planned work through the planner`);
      assert.ok(Array.isArray(result.unresolved));
    }
  }
  // Every arm executed planned work through the planner (A0/A3/A4 reserve two
  // units, A1/A2 one unit, A4 adds graph expansion calls).
  for (const arm of report.arms) assert.ok(arm.totalProviderCalls > 0, `${arm.armId} providerCalls`);
  assert.ok(['KEEP_DETERMINISTIC_V1', 'INCONCLUSIVE_NON_DISCRIMINATING'].includes(report.decision.outcome) ||
    report.decision.outcome.startsWith('RECOMMEND_'));
  assert.equal(report.decision.modelAssistedPlanning, 'NOT_EVALUATED');
});

test('validate mode reproduces the recorded decision', async () => {
  const report = await fullReport();
  const decision = validateReport(report);
  assert.equal(decision.outcome, report.decision.outcome);
});

test('forced-identical selections across all arms yield INCONCLUSIVE_NON_DISCRIMINATING, never RECOMMEND', () => {
  const selected = ['packages/oracle/src/context-contract.js'];
  const results = Object.fromEntries(ARMS.map(arm => [arm.armId, { selected: [...selected], recall: 0.5, mrr: 0.5, materializedBytes: 100, providerCalls: 1, unresolved: [] }]));
  const arms = ARMS.map(arm => ({ armId: arm.armId, strategyId: arm.strategyId, meanRecall: 0.5, meanMrr: 0.5, meanBytes: 100 }));
  const decision = reduceDecision({
    arms,
    perQuery: [{ componentId: 'c', query: 'q', relevant: [...selected], results }]
  }, COHORT_THRESHOLDS);
  assert.equal(decision.outcome, 'INCONCLUSIVE_NON_DISCRIMINATING');
  assert.equal(decision.modelAssistedPlanning, 'NOT_EVALUATED');
});

test('a candidate with one per-query recall below A0 is not recommended even with a higher mean', () => {
  const mkResults = (a0, a3) => ({
    A0: { selected: ['r.js'], recall: a0, mrr: a0, materializedBytes: 100, providerCalls: 1, unresolved: [] },
    A1: { selected: ['other.js'], recall: 0, mrr: 0, materializedBytes: 100, providerCalls: 1, unresolved: [] },
    A2: { selected: ['third.js'], recall: 0, mrr: 0, materializedBytes: 100, providerCalls: 1, unresolved: [] },
    A3: { selected: ['r.js'], recall: a3, mrr: a3, materializedBytes: 100, providerCalls: 1, unresolved: [] },
    A4: { selected: ['fourth.js'], recall: 0, mrr: 0, materializedBytes: 100, providerCalls: 1, unresolved: [] }
  });
  const perQuery = [
    { componentId: 'q1', query: 'q1', relevant: ['r.js'], results: mkResults(0.5, 0.4) },
    { componentId: 'q2', query: 'q2', relevant: ['r.js'], results: mkResults(0.5, 1.0) }
  ];
  const arms = [
    { armId: 'A0', strategyId: 'DETERMINISTIC_V1', meanRecall: 0.5, meanMrr: 0.5, meanBytes: 100 },
    { armId: 'A1', strategyId: 'DETERMINISTIC_V1', meanRecall: 0.5, meanMrr: 0.5, meanBytes: 100 },
    { armId: 'A2', strategyId: 'DETERMINISTIC_V1', meanRecall: 0.5, meanMrr: 0.5, meanBytes: 100 },
    // Higher mean (0.7 > 0.5) but inferior on q1: must not be recommended.
    { armId: 'A3', strategyId: 'RRF_FUSION_V1', meanRecall: 0.7, meanMrr: 0.7, meanBytes: 100 },
    { armId: 'A4', strategyId: 'GRAPH_EXPANDED_V1', meanRecall: 0, meanMrr: 0, meanBytes: 100 }
  ];
  const decision = reduceDecision({ arms, perQuery }, COHORT_THRESHOLDS);
  assert.notEqual(decision.outcome, 'RECOMMEND_RRF_FUSION_V1');
  assert.equal(decision.outcome, 'KEEP_DETERMINISTIC_V1');
});

test('validate with a tampered decision fails', async () => {
  const report = await fullReport();
  const recorded = report.decision.outcome;
  const tamperedOutcome = recorded === 'RECOMMEND_RRF_FUSION_V1' ? 'KEEP_DETERMINISTIC_V1' : 'RECOMMEND_RRF_FUSION_V1';
  assert.throws(() => validateReport({ ...report, decision: { ...report.decision, outcome: tamperedOutcome } }),
    error => error.code === 'ABLATION_DECISION_MISMATCH');
});

test('a tampered cohort (edited relevant set) fails with COHORT_DIGEST_MISMATCH', async () => {
  const committed = loadCohort(COHORT_PATH);
  const tampered = JSON.parse(JSON.stringify(committed));
  tampered.queries[0].relevant.push('packages/oracle/src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-ablation-'));
  const tempCohort = path.join(dir, 'cohort.json');
  fs.writeFileSync(tempCohort, JSON.stringify(tampered));
  try {
    await assert.rejects(runAblation({ snapshotRef: head(), cohortPath: tempCohort }),
      error => error.code === 'COHORT_DIGEST_MISMATCH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cohort regeneration at the frozen snapshot is byte-stable', async () => {
  const committed = loadCohort(COHORT_PATH);
  const regenerated = await buildCohort({ snapshotRef: committed.snapshotRef });
  assert.deepEqual(regenerated.queries, committed.queries);
  assert.deepEqual(regenerated.excluded, committed.excluded);
  assert.equal(regenerated.cohortDigest, committed.cohortDigest);
});

test('the reader uses git show only: a working-tree-only change does not affect results', async () => {
  // A throwaway repository, so the real checkout is never modified while other tests run.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-ablation-reader-'));
  try {
    const tmpGit = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    tmpGit('init', '-q');
    fs.mkdirSync(path.join(dir, 'packages/oracle/src'), { recursive: true });
    const target = 'packages/oracle/src/context-contract.js';
    const committed = 'export function defineContextRequirement(raw) { return raw; }\n';
    fs.writeFileSync(path.join(dir, target), committed);
    tmpGit('add', '-A');
    tmpGit('-c', 'user.email=fixture@local', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'fixture');
    const revision = tmpGit('rev-parse', 'HEAD').trim();
    const marker = 'WORKING_TREE_ONLY_MARKER_9f8e7d6c5b4a';
    fs.appendFileSync(path.join(dir, target), `\n// ${marker} working tree only marker\n`);
    const reader = createGitSnapshotReader({ repositoryRoot: dir });
    const blob = await reader.readFile({ revision, path: target });
    assert.equal(blob.content, committed);
    assert.ok(!blob.content.includes(marker));
    assert.deepEqual(await reader.listFiles({ revision, roots: ['packages/oracle/src'] }), [target]);
    const lexical = createLexicalFixtureClient({ reader, snapshotRef: revision, corpusRoots: ['packages/oracle/src'] });
    const response = await lexical.search({ query: 'working tree only marker', maxItems: 3 });
    assert.ok(response.hits.every(hit => !hit.snippet.includes(marker)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
