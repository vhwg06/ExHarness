import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SemanticMemoryKind,
  SemanticMemoryRetrievalSemantics,
  SemanticMemorySourceRefKind,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryIntelligencePort,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  defineSemanticMemoryRetriever
} from "../packages/core-harness/src/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NOW = "2026-09-16T12:00:00Z";
const MAX_REPAIR_ATTEMPTS = 3;
const RETRIEVAL_LIMIT = 4;

const stopWords = new Set([
  "a", "an", "and", "after", "for", "from", "in", "of", "on", "the", "to", "with"
]);

function tokens(value) {
  return new Set((String(value).toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 1 && !stopWords.has(token)));
}

function overlapScore(query, record) {
  const queryTokens = tokens(query);
  const recordTokens = tokens(`${record.content} ${(record.tags ?? []).join(" ")}`);
  let overlap = 0;
  for (const token of queryTokens) if (recordTokens.has(token)) overlap += 1;
  return overlap;
}

function tagValue(record, prefix) {
  const value = (record.tags ?? []).find((tag) => tag.startsWith(`${prefix}:`));
  return value == null ? null : value.slice(prefix.length + 1);
}

function sourceLinked(record) {
  return (record.sourceRefs ?? []).some((ref) =>
    ref.kind === SemanticMemorySourceRefKind.VERIFICATION ||
    ref.kind === SemanticMemorySourceRefKind.EVALUATION
  );
}

function temporallyValid(record, at = NOW) {
  const atMs = Date.parse(at);
  const from = record.temporal?.validFrom == null ? null : Date.parse(record.temporal.validFrom);
  const to = record.temporal?.validTo == null ? null : Date.parse(record.temporal.validTo);
  return (from == null || from <= atMs) && (to == null || atMs <= to);
}

const tasks = Object.freeze([
  {
    id: "held-alpha-timeout-r2",
    project: "alpha",
    repository: "checkout",
    revision: "r2",
    family: "timeout",
    evaluationPolicy: "eval-v1",
    query: "checkout gateway timeout retry failure backoff",
    correctRepair: "retry-jitter"
  },
  {
    id: "held-beta-timeout-r5",
    project: "beta",
    repository: "checkout",
    revision: "r5",
    family: "timeout",
    evaluationPolicy: "eval-v1",
    query: "checkout gateway timeout retry failure circuit breaker",
    correctRepair: "disable-retry"
  },
  {
    id: "held-alpha-auth-r2-policy2",
    project: "alpha",
    repository: "auth",
    revision: "r2",
    family: "token-expiry",
    evaluationPolicy: "eval-v2",
    query: "auth token expiry regression clock skew parse",
    correctRepair: "normalize-clock"
  },
  {
    id: "held-alpha-quota-r7",
    project: "alpha",
    repository: "quota",
    revision: "r7",
    family: "quota-regression",
    evaluationPolicy: "eval-v1",
    query: "tenant quota regression reserve capacity write",
    correctRepair: "reserve-first"
  }
]);

let memoryCounter = 0;
let clockCounter = 0;
const memory = createSemanticMemoryPort({
  provider: createInMemorySemanticMemoryProvider(),
  idFactory: () => `experience-${++memoryCounter}`,
  clock: () => `2026-09-15T10:${String(clockCounter++).padStart(2, "0")}:00Z`
});

const records = [];
async function remember({
  label,
  content,
  kind = SemanticMemoryKind.PROCEDURAL,
  tags,
  importance = 0.6,
  confidence = 0.9,
  temporal = {},
  verificationRef
}) {
  const record = await memory.remember({
    kind,
    content,
    tags: [...tags, `label:${label}`],
    importance,
    confidence,
    temporal,
    sourceRefs: [{ kind: SemanticMemorySourceRefKind.VERIFICATION, id: verificationRef }],
    provenance: { source: "bb037-training-experience", sourceId: label }
  });
  records.push(record);
  return record;
}

const alphaTimeoutTechnique = await remember({
  label: "alpha-timeout-technique",
  content: "checkout gateway timeout retry with bounded jitter backoff and reset backoff after success",
  tags: [
    "project:alpha", "repo:checkout", "family:timeout", "evaluation:eval-v1",
    "scope:technique", "repair:retry-jitter"
  ],
  importance: 0.72,
  confidence: 0.96,
  verificationRef: "verification:alpha-timeout-r1"
});

await remember({
  label: "alpha-timeout-r1-fact",
  content: "checkout timeout retry limit is nine for revision r1",
  kind: SemanticMemoryKind.EPISODIC,
  tags: [
    "project:alpha", "repo:checkout", "family:timeout", "evaluation:eval-v1",
    "scope:revision", "revision:r1", "repair:increase-limit"
  ],
  importance: 0.9,
  confidence: 0.95,
  verificationRef: "verification:alpha-timeout-r1-fact"
});

const betaTimeoutFact = await remember({
  label: "beta-timeout-r5-fact",
  content: "checkout gateway timeout retry failure uses circuit breaker and disable retry for this revision",
  kind: SemanticMemoryKind.EPISODIC,
  tags: [
    "project:beta", "repo:checkout", "family:timeout", "evaluation:eval-v1",
    "scope:revision", "revision:r5", "repair:disable-retry"
  ],
  importance: 0.98,
  confidence: 0.98,
  verificationRef: "verification:beta-timeout-r5"
});

await remember({
  label: "gamma-timeout-technique",
  content: "checkout gateway timeout retry failure circuit breaker disable retry aggressive fallback",
  tags: [
    "project:gamma", "repo:checkout", "family:timeout", "evaluation:eval-v1",
    "scope:technique", "repair:gamma-breaker"
  ],
  importance: 1,
  confidence: 1,
  verificationRef: "verification:gamma-timeout"
});

await remember({
  label: "alpha-auth-policy1",
  content: "auth token expiry regression parse by extending grace window",
  tags: [
    "project:alpha", "repo:auth", "family:token-expiry", "evaluation:eval-v1",
    "scope:technique", "repair:grace-window"
  ],
  importance: 0.85,
  confidence: 0.94,
  verificationRef: "verification:alpha-auth-policy1"
});

await remember({
  label: "alpha-auth-stale-policy2",
  content: "auth token expiry regression clock skew parse by clamping old offset",
  tags: [
    "project:alpha", "repo:auth", "family:token-expiry", "evaluation:eval-v2",
    "scope:technique", "repair:clamp-offset"
  ],
  importance: 0.95,
  confidence: 0.98,
  temporal: { validTo: "2026-09-10T00:00:00Z" },
  verificationRef: "verification:alpha-auth-stale-policy2"
});

await remember({
  label: "alpha-quota-reserve",
  content: "tenant quota regression reserve capacity before write",
  tags: [
    "project:alpha", "repo:quota", "family:quota-regression", "evaluation:eval-v1",
    "scope:technique", "repair:reserve-first"
  ],
  importance: 0.88,
  confidence: 0.95,
  verificationRef: "verification:alpha-quota-reserve"
});

await remember({
  label: "alpha-quota-compensate",
  content: "tenant quota regression write then compensate capacity",
  tags: [
    "project:alpha", "repo:quota", "family:quota-regression", "evaluation:eval-v1",
    "scope:technique", "repair:compensate-after-write"
  ],
  importance: 0.87,
  confidence: 0.95,
  verificationRef: "verification:alpha-quota-compensate"
});

const archivedQuota = await remember({
  label: "alpha-quota-archived",
  content: "tenant quota regression skip reservation legacy shortcut",
  tags: [
    "project:alpha", "repo:quota", "family:quota-regression", "evaluation:eval-v1",
    "scope:technique", "repair:skip-reservation"
  ],
  importance: 1,
  confidence: 1,
  verificationRef: "verification:alpha-quota-archived"
});
await memory.archive(archivedQuota.id, { provenance: { source: "bb037-reconciler" } });

const retriever = defineSemanticMemoryRetriever({
  name: "bb037-lexical-fixture",
  version: "1",
  async retrieve({ query, limit }) {
    return records
      .map((record) => ({
        memoryId: record.id,
        score: overlapScore(query, record),
        reasons: ["fixture-token-overlap"]
      }))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score || left.memoryId.localeCompare(right.memoryId))
      .slice(0, limit);
  }
});

const retrieval = createSemanticMemoryRetrievalPort({
  memory,
  retriever,
  policy: { maxItems: 16, maxSerializedChars: 16_384 }
});

const intelligence = createSemanticMemoryIntelligencePort({
  memory,
  retrieval,
  graph: null,
  policy: {
    candidateLimit: 12,
    resultLimit: RETRIEVAL_LIMIT,
    maxSerializedChars: 16_384,
    graphDepth: 0,
    weights: { provider: 0.55, importance: 0.2, confidence: 0.15, recency: 0.1, graph: 0 }
  },
  clock: () => NOW
});

function repairKey(record) {
  return tagValue(record, "repair");
}

function applicability(record, task) {
  if (!sourceLinked(record)) return { applicable: false, reason: "MISSING_SOURCE_LINK" };
  if (!temporallyValid(record)) return { applicable: false, reason: "TEMPORALLY_STALE" };
  if (tagValue(record, "project") !== task.project) return { applicable: false, reason: "PROJECT_MISMATCH" };
  if (tagValue(record, "repo") !== task.repository) return { applicable: false, reason: "REPOSITORY_MISMATCH" };
  if (tagValue(record, "family") !== task.family) return { applicable: false, reason: "TASK_FAMILY_MISMATCH" };
  if (tagValue(record, "evaluation") !== task.evaluationPolicy) return { applicable: false, reason: "EVALUATION_POLICY_MISMATCH" };
  const scope = tagValue(record, "scope");
  if (scope === "revision" && tagValue(record, "revision") !== task.revision) {
    return { applicable: false, reason: "REVISION_MISMATCH" };
  }
  if (scope !== "revision" && scope !== "technique") return { applicable: false, reason: "UNKNOWN_SCOPE" };
  return { applicable: true, reason: scope === "revision" ? "EXACT_REVISION" : "TRANSFERABLE_TECHNIQUE" };
}

async function noMemorySelection() {
  return {
    semantics: null,
    selected: null,
    visible: [],
    retrievalChars: 0,
    diagnostics: ["NO_MEMORY_BASELINE"]
  };
}

async function lexicalSelection(task) {
  const result = await retrieval.search({ query: task.query, limit: RETRIEVAL_LIMIT });
  assert.equal(result.semantics, SemanticMemoryRetrievalSemantics);
  return {
    semantics: result.semantics,
    selected: result.hits[0]?.memory ?? null,
    visible: result.hits.map((hit) => hit.memory.id),
    retrievalChars: JSON.stringify(result).length,
    diagnostics: []
  };
}

async function associativeSelection(task) {
  const result = await intelligence.search({ query: task.query, validAt: NOW });
  assert.equal(result.semantics, SemanticMemoryRetrievalSemantics);
  return {
    semantics: result.semantics,
    selected: result.hits[0]?.memory ?? null,
    visible: result.hits.map((hit) => hit.memory.id),
    retrievalChars: JSON.stringify(result).length,
    diagnostics: []
  };
}

async function boundedSelection(task) {
  const tags = [
    `project:${task.project}`,
    `repo:${task.repository}`,
    `family:${task.family}`,
    `evaluation:${task.evaluationPolicy}`
  ];
  const result = await intelligence.search({ query: task.query, tags, validAt: NOW });
  assert.equal(result.semantics, SemanticMemoryRetrievalSemantics);
  const admitted = [];
  const rejected = [];
  for (const hit of result.hits) {
    const check = applicability(hit.memory, task);
    if (check.applicable) admitted.push({ hit, reason: check.reason });
    else rejected.push({ memoryId: hit.memory.id, reason: check.reason });
  }
  const repairs = [...new Set(admitted.map(({ hit }) => repairKey(hit.memory)).filter(Boolean))];
  const conflict = repairs.length > 1;
  const selected = conflict ? null : admitted[0]?.hit.memory ?? null;
  return {
    semantics: result.semantics,
    selected,
    visible: result.hits.map((hit) => hit.memory.id),
    retrievalChars: JSON.stringify(result).length,
    diagnostics: [
      ...rejected.map((entry) => `${entry.reason}:${entry.memoryId}`),
      ...(conflict ? [`CONTRADICTORY_REPAIRS:${repairs.sort().join("|")}`] : []),
      ...(selected == null && !conflict ? ["NO_APPLICABLE_EXPERIENCE"] : [])
    ]
  };
}

function simulate(task, selection) {
  const selected = selection.selected;
  const selectedRepair = selected == null ? null : repairKey(selected);
  const selectedProject = selected == null ? null : tagValue(selected, "project");
  const applicable = selected == null ? null : applicability(selected, task).applicable;
  let attempts = 2;
  let negativeTransfer = false;
  if (selected != null && applicable && selectedRepair === task.correctRepair) attempts = 1;
  else if (selected != null) {
    attempts = 3;
    negativeTransfer = true;
  }
  return {
    taskId: task.id,
    selectedMemoryId: selected?.id ?? null,
    selectedRepair,
    repairAttempts: attempts,
    repeatFailures: Math.max(0, attempts - 1),
    finalCorrect: attempts <= MAX_REPAIR_ATTEMPTS,
    negativeTransfer,
    crossProjectRecall: selectedProject != null && selectedProject !== task.project,
    staleOrWrongScopeRecall: selected != null && applicable === false,
    retrievalChars: selection.retrievalChars,
    visibleMemoryIds: selection.visible,
    diagnostics: selection.diagnostics,
    acceptanceAuthority: false
  };
}

const modes = Object.freeze({
  none: noMemorySelection,
  lexical: lexicalSelection,
  associative: associativeSelection,
  bounded: boundedSelection
});

const runs = [];
for (const task of tasks) {
  const results = {};
  for (const [mode, select] of Object.entries(modes)) results[mode] = simulate(task, await select(task));
  runs.push({ task: { ...task }, modes: results });
}

const quotaTags = ["project:alpha", "repo:quota", "family:quota-regression", "evaluation:eval-v1"];
const archivedCheck = await retrieval.search({ query: tasks[3].query, tags: quotaTags, limit: 12 });
assert.equal(archivedCheck.semantics, SemanticMemoryRetrievalSemantics);
assert.equal(archivedCheck.hits.some((hit) => hit.memory.id === archivedQuota.id), false);
assert.equal(archivedCheck.ranking.droppedArchived >= 1, true);

function summarize(mode) {
  const rows = runs.map((run) => run.modes[mode]);
  const sum = (field) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  return {
    tasks: rows.length,
    repairAttempts: sum("repairAttempts"),
    meanRepairAttempts: Number((sum("repairAttempts") / rows.length).toFixed(2)),
    repeatFailures: sum("repeatFailures"),
    finalCorrect: rows.filter((row) => row.finalCorrect).length,
    negativeTransfers: rows.filter((row) => row.negativeTransfer).length,
    crossProjectRecalls: rows.filter((row) => row.crossProjectRecall).length,
    staleOrWrongScopeRecalls: rows.filter((row) => row.staleOrWrongScopeRecall).length,
    retrievalChars: sum("retrievalChars"),
    acceptanceAuthorityViolations: rows.filter((row) => row.acceptanceAuthority).length
  };
}

const summary = Object.fromEntries(Object.keys(modes).map((mode) => [mode, summarize(mode)]));

assert.equal(summary.bounded.finalCorrect, summary.none.finalCorrect);
assert.equal(summary.bounded.repairAttempts < summary.none.repairAttempts, true);
assert.equal(summary.bounded.repeatFailures < summary.none.repeatFailures, true);
assert.equal(summary.bounded.crossProjectRecalls, 0);
assert.equal(summary.bounded.staleOrWrongScopeRecalls, 0);
assert.equal(summary.bounded.negativeTransfers, 0);
assert.equal(summary.bounded.acceptanceAuthorityViolations, 0);
assert.equal(runs[3].modes.bounded.selectedMemoryId, null);
assert.equal(runs[3].modes.bounded.diagnostics.some((item) => item.startsWith("CONTRADICTORY_REPAIRS:")), true);
assert.equal(runs[2].modes.bounded.selectedMemoryId, null);
assert.equal(runs[2].modes.lexical.staleOrWrongScopeRecall, true);
assert.equal(runs[0].modes.bounded.selectedMemoryId, alphaTimeoutTechnique.id);
assert.equal(runs[1].modes.bounded.selectedMemoryId, betaTimeoutFact.id);

const report = {
  experiment: "BB-037 grounded experience reuse deterministic evaluation",
  evidenceClass: "DETERMINISTIC_REFERENCE",
  productionEvidence: false,
  semantics: SemanticMemoryRetrievalSemantics,
  corpus: {
    trainingExperienceRecords: records.length,
    heldOutTasks: tasks.length,
    archivedRecords: 1,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    retrievalLimit: RETRIEVAL_LIMIT
  },
  predeclaredDecisionRule: "NARROW or ADOPT only if bounded reuse reduces held-out repeat failures or repair attempts versus no-memory without worse final correctness, cross-project recall, stale/wrong-scope reuse, or acceptance-authority violations. Fixture evidence cannot authorize a production default.",
  summary,
  archivedFilter: {
    droppedArchived: archivedCheck.ranking.droppedArchived,
    archivedMemoryVisible: archivedCheck.hits.some((hit) => hit.memory.id === archivedQuota.id)
  },
  runs: runs.map((run) => ({
    task: run.task,
    modes: Object.fromEntries(Object.entries(run.modes).map(([mode, row]) => [mode, {
      selectedMemoryId: row.selectedMemoryId,
      selectedRepair: row.selectedRepair,
      repairAttempts: row.repairAttempts,
      repeatFailures: row.repeatFailures,
      finalCorrect: row.finalCorrect,
      negativeTransfer: row.negativeTransfer,
      crossProjectRecall: row.crossProjectRecall,
      staleOrWrongScopeRecall: row.staleOrWrongScopeRecall,
      retrievalChars: row.retrievalChars,
      visibleMemoryIds: row.visibleMemoryIds,
      diagnostics: row.diagnostics,
      acceptanceAuthority: row.acceptanceAuthority
    }]))
  })),
  conclusion: {
    direction: "NARROW",
    reason: "Application-bounded applicability over existing relevance-only memory can reduce repeated fixture remediation while failing closed on policy/revision mismatch, contradictory repairs, archived experience and unrelated projects. The result is deterministic fixture evidence only; representative recurring-failure tasks are required before runtime adoption or default enablement.",
    coreChangeRequired: false,
    runtimeDefaultAuthorized: false
  }
};

const expectedPath = join(root, "artifacts", "bb037-grounded-experience-reuse-eval.json");
const expected = JSON.parse(await readFile(expectedPath, "utf8"));
if (JSON.stringify(report) !== JSON.stringify(expected)) console.error(JSON.stringify(report, null, 2));
assert.deepEqual(report, expected, "BB-037 semantic-memory reuse artifact drifted from deterministic evaluation");
