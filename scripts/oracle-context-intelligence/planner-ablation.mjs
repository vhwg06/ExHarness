// Oracle planner ablation harness.
//
// Compares retrieval planning arms through the delivered SourceCatalog /
// RetrievalPlanner path over a frozen, mechanically derived cohort at one exact
// git snapshot. Every read goes through `git show` / `git ls-tree` at that
// revision; there is no working-tree read path.
//
// Fixture clients (clearly labelled fixtures, not Zoekt/LSP):
// - lexical: deterministic token-overlap scoring over snapshot .js contents.
// - symbol: exported-identifier index over snapshot .js files.
// - graph: the delivered authoritative graph client over the same git reader.
//
// Arms: A0 DETERMINISTIC_V1, A1 lexical-only, A2 symbol-only (both via the
// delivered unavailableProviders option), A3 RRF_FUSION_V1, A4 GRAPH_EXPANDED_V1.
//
// CLI:
//   node planner-ablation.mjs --snapshot <sha> [--out <file>]   run (default)
//   node planner-ablation.mjs --mode validate --report <file>   re-reduce, exit!=0 on mismatch
//   node planner-ablation.mjs --mode cohort [--write] [--snapshot <sha>]  regenerate cohort
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceCatalog } from '../../packages/oracle/src/source-catalog.js';
import { createRetrievalPlanner } from '../../packages/oracle/src/retrieval-planner.js';
import { createLexicalSearchProvider } from '../../packages/oracle/src/providers/lexical-search.js';
import { createSemanticCodeProvider } from '../../packages/oracle/src/providers/semantic-code.js';
import { createContextGraphProvider } from '../../packages/oracle/src/providers/context-graph.js';
import { createAuthoritativeGraphClient } from '../../packages/oracle/src/context-graph.js';
import {
  createFusionRetrievalPlanner,
  createGraphExpandedRetrievalPlanner,
  PlanningStrategyId
} from '../../packages/oracle/src/planning-strategies.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const COHORT_PATH = path.join(HERE, 'planner-ablation-cohort.json');

export const COHORT_KIND = 'ORACLE_PLANNER_ABLATION_COHORT_V1';
export const REPORT_KIND = 'ORACLE_PLANNER_ABLATION_V1';
export const REPOSITORY_REF = 'exharness';
export const CORPUS_ROOTS = ['packages/oracle/src', 'packages/agentic-system/src'];
export const COHORT_K = 3;
export const COHORT_BUDGET = Object.freeze({ maxItems: 3, maxProviderCalls: 3, maxMaterializedBytes: 24576, maxResolutionSteps: 1 });
export const COHORT_THRESHOLDS = Object.freeze({ minMeanRecallGain: 0.05, maxBytesRatio: 1.25, perQueryNonInferior: true });
export const RECALL_DEFINITION =
  'Recall@k = |top-k selected distinct itemRefs intersect relevant| / min(k, |relevant|); ' +
  'MRR = 1/rank of first relevant itemRef in top-k else 0; k = budget.maxItems (3).';

export const ARMS = Object.freeze([
  { armId: 'A0', strategyId: PlanningStrategyId.DETERMINISTIC_V1, planner: 'DETERMINISTIC_V1', options: {} },
  { armId: 'A1', strategyId: PlanningStrategyId.DETERMINISTIC_V1, planner: 'DETERMINISTIC_V1', options: { unavailableProviders: ['semantic-code'] } },
  { armId: 'A2', strategyId: PlanningStrategyId.DETERMINISTIC_V1, planner: 'DETERMINISTIC_V1', options: { unavailableProviders: ['lexical-search'] } },
  { armId: 'A3', strategyId: PlanningStrategyId.RRF_FUSION_V1, planner: 'RRF_FUSION_V1', options: {} },
  { armId: 'A4', strategyId: PlanningStrategyId.GRAPH_EXPANDED_V1, planner: 'GRAPH_EXPANDED_V1', options: {} }
]);
const CANDIDATE_ARM_IDS = ['A3', 'A4'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Git snapshot reader: exact-revision blobs only, never the working tree.
export function createGitSnapshotReader({ repositoryRoot = REPO_ROOT } = {}) {
  const run = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return {
    kind: 'GIT_SNAPSHOT_READER',
    async listFiles({ revision, roots }) {
      return run(['ls-tree', '-r', '--name-only', revision, '--', ...roots]).split('\n').filter(Boolean);
    },
    async readFile({ revision, path: file }) {
      return { content: run(['show', `${revision}:${file}`]), sourceRef: `${file}@${revision}` };
    }
  };
}

// Shared in-memory blob cache so lexical, symbol and graph fixtures read each
// snapshot blob once per run.
export function withBlobCache(reader) {
  const blobs = new Map();
  return {
    async listFiles(args) { return reader.listFiles(args); },
    async readFile(args) {
      const key = `${args.revision ?? ''}\0${args.path}`;
      if (!blobs.has(key)) blobs.set(key, await reader.readFile(args));
      return blobs.get(key);
    }
  };
}

export function cohortDigestOf({ snapshotRef, corpusRoots, queries, excluded }) {
  return createHash('sha256').update(canonical({ snapshotRef, corpusRoots, queries, excluded })).digest('hex');
}

export function loadCohort(cohortPath = COHORT_PATH) {
  return JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
}

// Cohort derivation: for each registry component, query = contractRefs joined by
// one space; relevant = sorted concrete .js sourceRoots that exist at the
// snapshot and lie under corpusRoots. Components without one are excluded. The
// registry is read at the snapshot via git show, never from the working tree.
export async function buildCohort({ snapshotRef, repositoryRoot = REPO_ROOT, corpusRoots = CORPUS_ROOTS } = {}) {
  if (typeof snapshotRef !== 'string' || !snapshotRef.trim()) throw new TypeError('snapshotRef must be nonempty text');
  const reader = createGitSnapshotReader({ repositoryRoot });
  const registry = JSON.parse((await reader.readFile({ revision: snapshotRef, path: 'docs/blackboard/component-registry.json' })).content);
  const existing = new Set(await reader.listFiles({ revision: snapshotRef, roots: [...corpusRoots] }));
  const underCorpus = file => corpusRoots.some(root => file === root || file.startsWith(`${root}/`));
  const queries = [];
  const excluded = [];
  for (const component of registry.components) {
    const profile = component.contextProfile;
    const query = [...profile.contractRefs].join(' ');
    const relevant = [...new Set(profile.sourceRoots)]
      .filter(source => source.endsWith('.js') && !source.includes('*') && underCorpus(source) && existing.has(source))
      .sort();
    if (relevant.length === 0) {
      excluded.push({ componentId: component.id, reason: 'no concrete .js sourceRoots under corpusRoots that exist at snapshotRef' });
    } else {
      queries.push({ componentId: component.id, query, relevant });
    }
  }
  const cohort = {
    kind: COHORT_KIND,
    snapshotRef,
    repositoryRef: REPOSITORY_REF,
    corpusRoots: [...corpusRoots],
    k: COHORT_K,
    budget: { ...COHORT_BUDGET },
    thresholds: { ...COHORT_THRESHOLDS },
    recallDefinition: RECALL_DEFINITION,
    queries,
    excluded,
    cohortDigest: ''
  };
  cohort.cohortDigest = cohortDigestOf(cohort);
  return cohort;
}

// Cohort integrity: regenerate at the committed snapshotRef and compare the
// committed queries/excluded/digest. A hand-edited relevant set fails here.
export async function assertCohortIntegrity({ cohort, repositoryRoot = REPO_ROOT } = {}) {
  if (!cohort || cohort.kind !== COHORT_KIND) throw new TypeError('ORACLE_PLANNER_ABLATION_COHORT_V1 cohort required');
  const regenerated = await buildCohort({ snapshotRef: cohort.snapshotRef, repositoryRoot, corpusRoots: cohort.corpusRoots });
  const mismatch = (label, a, b) => {
    const error = new Error(`cohort integrity mismatch (${label}) at ${cohort.snapshotRef}: committed cohort differs from regenerated cohort`);
    error.code = 'COHORT_DIGEST_MISMATCH';
    error.detail = { label, committed: a, regenerated: b };
    throw error;
  };
  if (canonical(cohort.queries) !== canonical(regenerated.queries)) mismatch('queries', cohort.queries, regenerated.queries);
  if (canonical(cohort.excluded) !== canonical(regenerated.excluded)) mismatch('excluded', cohort.excluded, regenerated.excluded);
  if (cohort.cohortDigest !== regenerated.cohortDigest) mismatch('cohortDigest', cohort.cohortDigest, regenerated.cohortDigest);
  return regenerated;
}

// Lowercased camelCase sub-token split shared by query and file identifiers.
export function splitSubTokens(text) {
  return String(text)
    .split(/[^A-Za-z0-9]+/)
    .flatMap(part => part.split(/(?=[A-Z][a-z])|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/))
    .map(token => token.toLowerCase())
    .filter(Boolean);
}

const fileIdentifiers = content => (content.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).flatMap(splitSubTokens);

// FIXTURE lexical client (not Zoekt/LSP): deterministic token-overlap score over
// snapshot .js file contents. Score = number of distinct query sub-tokens
// present in the file, ties broken by path. Returns the top maxItems hits with
// score > 0 and snippets of at most 1200 chars. Snapshot-bound: the REVISION
// validator is always the frozen snapshotRef.
export function createLexicalFixtureClient({ reader, snapshotRef, corpusRoots }) {
  let corpus = null;
  async function loadCorpus() {
    if (!corpus) {
      const files = (await reader.listFiles({ revision: snapshotRef, roots: [...corpusRoots] }))
        .filter(file => file.endsWith('.js')).sort();
      corpus = [];
      for (const file of files) {
        const { content, sourceRef } = await reader.readFile({ revision: snapshotRef, path: file });
        corpus.push({ path: file, content, sourceRef, tokens: new Set(fileIdentifiers(content)) });
      }
    }
    return corpus;
  }
  return {
    kind: 'FIXTURE_TOKEN_OVERLAP',
    async search({ query, maxItems }) {
      const files = await loadCorpus();
      const queryTokens = [...new Set(splitSubTokens(query))];
      const scored = [];
      for (const file of files) {
        let score = 0;
        for (const token of queryTokens) if (file.tokens.has(token)) score++;
        if (score > 0) scored.push({ path: file.path, sourceRef: file.sourceRef, snippet: file.content.slice(0, 1200), score });
      }
      scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { snapshotRef, hits: scored.slice(0, maxItems) };
    }
  };
}

const EXPORT_DECLARATION = [
  /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
];
function exportedNames(content) {
  const names = new Set();
  for (const pattern of EXPORT_DECLARATION) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of content.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const specifier of match[1].split(',')) {
      const name = specifier.trim().split(/\s+/).pop();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

// FIXTURE symbol client (not Zoekt/LSP): exported-identifier index over snapshot
// .js files (export function/class/const/let/var NAME, export { A, B as C }).
// Exact match on whole query tokens, ordered first by query-token order then by
// path, capped at maxItems. workspaceSymbols/findReferences return empty.
export function createSymbolFixtureClient({ reader, snapshotRef, corpusRoots }) {
  let index = null;
  async function loadIndex() {
    if (!index) {
      const files = (await reader.listFiles({ revision: snapshotRef, roots: [...corpusRoots] }))
        .filter(file => file.endsWith('.js')).sort();
      index = [];
      for (const file of files) {
        const { content, sourceRef } = await reader.readFile({ revision: snapshotRef, path: file });
        for (const name of exportedNames(content).sort()) {
          index.push({ name, path: file, sourceRef, content: content.slice(0, 800) });
        }
      }
    }
    return index;
  }
  return {
    kind: 'FIXTURE_EXPORT_INDEX',
    async lookupSymbol({ query, maxItems }) {
      const entries = await loadIndex();
      const tokens = String(query).split(/\s+/).filter(Boolean);
      const symbols = [];
      const seen = new Set();
      for (const token of tokens) {
        for (const entry of entries.filter(candidate => candidate.name === token).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
          const key = `${entry.name}\0${entry.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            symbols.push({ name: entry.name, path: entry.path, sourceRef: entry.sourceRef, content: entry.content, score: 1 });
          }
        }
      }
      return { snapshotRef, symbols: symbols.slice(0, maxItems) };
    },
    async workspaceSymbols() { return { snapshotRef, symbols: [] }; },
    async findReferences() { return { snapshotRef, symbols: [] }; }
  };
}

export function createAblationCatalog({ reader, snapshotRef, corpusRoots }) {
  const searchClient = createLexicalFixtureClient({ reader, snapshotRef, corpusRoots });
  const symbolClient = createSymbolFixtureClient({ reader, snapshotRef, corpusRoots });
  const graphClient = createAuthoritativeGraphClient({ snapshotReader: reader, repositoryRef: REPOSITORY_REF, roots: [...corpusRoots] });
  const catalog = createSourceCatalog({
    providers: [
      createLexicalSearchProvider({ searchClient }),
      createSemanticCodeProvider({ symbolClient }),
      createContextGraphProvider({ graphClient })
    ]
  });
  return { catalog, searchClient, symbolClient, graphClient };
}

function plannerFor({ arm, catalog }) {
  if (arm.planner === 'RRF_FUSION_V1') return createFusionRetrievalPlanner({ catalog });
  if (arm.planner === 'GRAPH_EXPANDED_V1') return createGraphExpandedRetrievalPlanner({ catalog, repositoryRef: REPOSITORY_REF });
  return createRetrievalPlanner({ catalog });
}

function scoreQuery({ executed, relevant, k }) {
  const selected = [...new Set(executed.candidates.map(candidate => candidate.source.itemRef).filter(ref => ref !== null))];
  const topk = selected.slice(0, k);
  const hits = topk.filter(ref => relevant.includes(ref));
  const recall = hits.length / Math.min(k, relevant.length);
  const first = topk.findIndex(ref => relevant.includes(ref));
  const mrr = first === -1 ? 0 : 1 / (first + 1);
  const materializedBytes = executed.candidates.reduce((sum, candidate) => sum + Buffer.byteLength(JSON.stringify(candidate), 'utf8'), 0);
  const expansionCalls = (executed.expansions ?? []).filter(expansion => expansion.status === 'EXPANDED' || expansion.status === 'FAILED').length;
  return {
    selected,
    recall,
    mrr,
    materializedBytes,
    providerCalls: executed.planned.work.length + expansionCalls,
    unresolved: executed.unresolved.map(entry => entry.reason)
  };
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

// Preregistered reducer (pure function of the report arms/perQuery plus the
// cohort thresholds). Candidate arms are A3/A4 only; A1/A2 are diagnostic.
// A candidate is eligible iff every query recall is >= A0, mean recall beats A0
// by minMeanRecallGain, and mean bytes stay within maxBytesRatio of A0. The best
// eligible arm by mean recall then MRR wins; otherwise KEEP_DETERMINISTIC_V1.
// Identical selections across every arm for every query are INCONCLUSIVE.
export function reduceDecision({ arms, perQuery }, thresholds = COHORT_THRESHOLDS) {
  if (!Array.isArray(arms) || !Array.isArray(perQuery)) throw new TypeError('reduceDecision requires {arms, perQuery}');
  const byId = Object.fromEntries(arms.map(arm => [arm.armId, arm]));
  const baseline = byId.A0;
  if (!baseline) throw new TypeError('reduceDecision requires the A0 baseline arm');
  const snapshot = armId => Object.fromEntries(perQuery.map(entry => [entry.componentId, entry.results[armId]]));
  const armIds = arms.map(arm => arm.armId);
  const discriminating = perQuery.some(entry => {
    const first = JSON.stringify(entry.results[armIds[0]]?.selected ?? null);
    return armIds.slice(1).some(armId => JSON.stringify(entry.results[armId]?.selected ?? null) !== first);
  });
  const numbers = {
    baseline: { armId: 'A0', meanRecall: baseline.meanRecall, meanMrr: baseline.meanMrr, meanBytes: baseline.meanBytes },
    candidates: Object.fromEntries(CANDIDATE_ARM_IDS.filter(id => byId[id]).map(id => [id, {
      strategyId: byId[id].strategyId,
      meanRecall: byId[id].meanRecall,
      meanMrr: byId[id].meanMrr,
      meanBytes: byId[id].meanBytes,
      recallGain: byId[id].meanRecall - baseline.meanRecall,
      bytesRatio: baseline.meanBytes === 0 ? 0 : byId[id].meanBytes / baseline.meanBytes
    }])),
    thresholds: { ...thresholds }
  };
  if (!discriminating) {
    return { outcome: 'INCONCLUSIVE_NON_DISCRIMINATING', reason: 'every arm selected identical ordered itemRefs for every query', numbers, modelAssistedPlanning: 'NOT_EVALUATED' };
  }
  const baselineByQuery = snapshot('A0');
  const eligible = [];
  for (const armId of CANDIDATE_ARM_IDS) {
    const candidate = byId[armId];
    if (!candidate) continue;
    const candidateByQuery = snapshot(armId);
    if (thresholds.perQueryNonInferior !== false) {
      const inferior = perQuery.some(entry => candidateByQuery[entry.componentId].recall < baselineByQuery[entry.componentId].recall);
      if (inferior) continue;
    }
    if (!(candidate.meanRecall - baseline.meanRecall >= thresholds.minMeanRecallGain)) continue;
    if (!(candidate.meanBytes <= thresholds.maxBytesRatio * baseline.meanBytes)) continue;
    eligible.push(candidate);
  }
  if (eligible.length === 0) {
    return { outcome: 'KEEP_DETERMINISTIC_V1', reason: 'no candidate arm met per-query non-inferiority, mean recall gain and byte-ratio gates', numbers, modelAssistedPlanning: 'NOT_EVALUATED' };
  }
  eligible.sort((a, b) => b.meanRecall - a.meanRecall || b.meanMrr - a.meanMrr);
  return { outcome: `RECOMMEND_${eligible[0].strategyId}`, reason: 'candidate arm passed all preregistered gates', numbers, modelAssistedPlanning: 'NOT_EVALUATED' };
}

export async function runAblation({ snapshotRef = null, cohort = null, cohortPath = COHORT_PATH, repositoryRoot = REPO_ROOT } = {}) {
  const committed = cohort ?? loadCohort(cohortPath);
  await assertCohortIntegrity({ cohort: committed, repositoryRoot });
  const effective = snapshotRef ?? committed.snapshotRef;
  const reader = withBlobCache(createGitSnapshotReader({ repositoryRoot }));
  const { catalog } = createAblationCatalog({ reader, snapshotRef: effective, corpusRoots: committed.corpusRoots });
  const perQuery = [];
  for (const entry of committed.queries) {
    // EXACT snapshot pins every arm to the frozen revision; the requirement is
    // built per query from the effective ref.
    const requirement = {
      consumerRef: 'planner-ablation',
      semanticNeed: entry.query,
      evidence: [{
        id: 'q',
        necessity: 'REQUIRED',
        need: entry.query,
        source: { kind: 'REPOSITORY', ref: REPOSITORY_REF, snapshot: { mode: 'EXACT', ref: effective } }
      }],
      budget: { ...committed.budget }
    };
    const results = {};
    for (const arm of ARMS) {
      const executed = await plannerFor({ arm, catalog }).execute(requirement, arm.options);
      results[arm.armId] = scoreQuery({ executed, relevant: entry.relevant, k: committed.k });
    }
    perQuery.push({ componentId: entry.componentId, query: entry.query, relevant: [...entry.relevant], results });
  }
  const arms = ARMS.map(arm => {
    const recalls = perQuery.map(entry => entry.results[arm.armId].recall);
    const mrrs = perQuery.map(entry => entry.results[arm.armId].mrr);
    const bytes = perQuery.map(entry => entry.results[arm.armId].materializedBytes);
    return {
      armId: arm.armId,
      strategyId: arm.strategyId,
      planner: arm.planner,
      meanRecall: mean(recalls),
      meanMrr: mean(mrrs),
      meanBytes: mean(bytes),
      totalProviderCalls: perQuery.reduce((sum, entry) => sum + entry.results[arm.armId].providerCalls, 0)
    };
  });
  const decision = reduceDecision({ arms, perQuery }, committed.thresholds);
  return { kind: REPORT_KIND, snapshotRef: effective, cohortDigest: committed.cohortDigest, arms, perQuery, decision };
}

// Validate mode: re-reduce a recorded report with its own thresholds and fail
// when the recorded decision differs.
export function validateReport(report) {
  if (!report || report.kind !== REPORT_KIND) throw new TypeError('ORACLE_PLANNER_ABLATION_V1 report required');
  const expected = reduceDecision({ arms: report.arms, perQuery: report.perQuery }, report.decision?.thresholds ?? COHORT_THRESHOLDS);
  if (expected.outcome !== report.decision?.outcome) {
    const error = new Error(`validate mismatch: recorded ${report.decision?.outcome} but re-reduction gives ${expected.outcome}`);
    error.code = 'ABLATION_DECISION_MISMATCH';
    error.detail = { recorded: report.decision?.outcome, expected: expected.outcome };
    throw error;
  }
  return expected;
}

function parseArgs(argv) {
  const args = { mode: 'run', snapshot: null, out: null, report: null, write: false, cohort: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--mode') args.mode = argv[++i];
    else if (token === '--snapshot') args.snapshot = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--report') args.report = argv[++i];
    else if (token === '--write') args.write = true;
    else if (token === '--cohort') args.cohort = argv[++i];
    else throw new TypeError(`unknown argument ${token}`);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.mode === 'cohort') {
    const snapshot = args.snapshot ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const cohort = await buildCohort({ snapshotRef: snapshot });
    const target = args.cohort ?? COHORT_PATH;
    if (args.write) {
      fs.writeFileSync(target, `${JSON.stringify(cohort, null, 2)}\n`);
      process.stderr.write(`wrote ${target} digest ${cohort.cohortDigest}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(cohort, null, 2)}\n`);
    }
    return;
  }
  if (args.mode === 'validate') {
    if (!args.report) throw new TypeError('--mode validate requires --report <file>');
    const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
    const decision = validateReport(report);
    process.stdout.write(`${JSON.stringify({ ok: true, outcome: decision.outcome })}\n`);
    return;
  }
  if (args.mode !== 'run') throw new TypeError(`unknown mode ${args.mode}`);
  const committed = loadCohort(args.cohort ?? COHORT_PATH);
  const report = await runAblation({ snapshotRef: args.snapshot ?? committed.snapshotRef, cohort: committed });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    fs.writeFileSync(args.out, text);
    process.stderr.write(`wrote ${args.out} decision ${report.decision.outcome}\n`);
  } else {
    process.stdout.write(text);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
