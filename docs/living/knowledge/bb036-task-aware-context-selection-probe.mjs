const policy = Object.freeze({
  maxFiles: 3,
  maxContextChars: 8000,
  minimumCandidateScore: 6,
  oversizedChars: 6000,
  oversizedPenalty: 6,
  docsPenalty: 2
});

const repository = Object.freeze({
  ref: "repo://bb036-fixture",
  revision: "fixture-v1",
  files: [
    { path: "src/server.js", chars: 1800, symbols: ["router", "health", "users", "get"], available: true },
    { path: "test/server.test.js", chars: 2200, symbols: ["health", "users", "regression", "get"], available: true },
    { path: "src/healthcheck-cache.js", chars: 14000, symbols: ["health", "cache", "metrics"], available: true },
    { path: "docs/health.md", chars: 900, symbols: ["health", "documentation"], available: true },
    { path: "src/quota/service.js", chars: 2800, symbols: ["quota", "admission", "limit", "tenant"], available: true },
    { path: "src/quota/policy.js", chars: 2100, symbols: ["quota", "policy", "limit", "region"], available: true },
    { path: "test/quota.test.js", chars: 2400, symbols: ["quota", "limit", "regression", "tenant"], available: true },
    { path: "src/auth/token.js", chars: 1700, symbols: ["token", "jwt", "auth", "parse", "expiry"], available: true },
    { path: "test/auth-token.test.js", chars: 2100, symbols: ["token", "jwt", "auth", "regression", "expiry"], available: true },
    { path: "src/token-cache.js", chars: 10000, symbols: ["token", "cache", "metrics"], available: true },
    { path: "src/store/blackboard-store.js", chars: 3200, symbols: ["blackboard", "transaction", "revision", "stale", "writer", "lock"], available: true },
    { path: "test/blackboard-store.test.js", chars: 2600, symbols: ["blackboard", "stale", "writer", "lock", "concurrency"], available: true },
    { path: "docs/lock-guide.md", chars: 1000, symbols: ["lock", "guide"], available: true },
    { path: "src/lock-metrics.js", chars: 9000, symbols: ["lock", "metrics"], available: true },
    { path: "src/payment/client.js", chars: 2300, symbols: ["payment", "refund", "timeout", "client"], available: false },
    { path: "test/payment.test.js", chars: 2200, symbols: ["payment", "refund", "timeout", "regression"], available: true }
  ]
});

const tasks = Object.freeze([
  {
    id: "train-health",
    split: "train",
    task: "Add GET health endpoint and preserve existing users behavior regression",
    declaredFiles: ["src/server.js"],
    requiredFiles: ["src/server.js", "test/server.test.js"]
  },
  {
    id: "train-quota",
    split: "train",
    task: "Enforce tenant quota limit using admission policy and keep regression coverage",
    declaredFiles: ["src/quota/service.js"],
    requiredFiles: ["src/quota/service.js", "src/quota/policy.js", "test/quota.test.js"]
  },
  {
    id: "train-token",
    split: "train",
    task: "Fix JWT token expiry parsing and preserve auth regression behavior",
    declaredFiles: ["src/auth/token.js"],
    requiredFiles: ["src/auth/token.js", "test/auth-token.test.js"]
  },
  {
    id: "held-lock",
    split: "heldout",
    task: "Prevent stale Blackboard writer lock overwrite and add concurrency regression coverage",
    declaredFiles: ["src/store/blackboard-store.js"],
    requiredFiles: ["src/store/blackboard-store.js", "test/blackboard-store.test.js"]
  },
  {
    id: "held-health",
    split: "heldout",
    task: "Change users health route behavior and add regression coverage",
    declaredFiles: ["src/server.js"],
    requiredFiles: ["src/server.js", "test/server.test.js"]
  },
  {
    id: "held-payment-unavailable",
    split: "heldout",
    task: "Fix payment refund timeout and add regression coverage",
    declaredFiles: ["src/payment/client.js"],
    requiredFiles: ["src/payment/client.js", "test/payment.test.js"]
  }
]);

const stopWords = new Set(["add", "and", "the", "a", "an", "existing", "behavior", "fix", "using", "keep", "prevent", "change"]);
const byPath = new Map(repository.files.map((file) => [file.path, file]));

function tokens(value) {
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 1 && !stopWords.has(token)));
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function pathTokens(path) {
  return tokens(path.replace(/[/\.\-]/g, " "));
}

function baseScore(file, query, withSymbols) {
  const pathOverlap = intersectionSize(pathTokens(file.path), query);
  const symbolOverlap = intersectionSize(new Set(file.symbols), query);
  return (2 * pathOverlap) + (withSymbols ? 3 * symbolOverlap : 0);
}

function rankCandidates(task, withSymbols) {
  const query = tokens(task.task);
  return repository.files
    .filter((file) => file.available)
    .map((file) => ({ path: file.path, score: baseScore(file, query, withSymbols) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function manualSelection(task) {
  return [...task.declaredFiles];
}

function lexicalSelection(task) {
  return rankCandidates(task, false).slice(0, policy.maxFiles).map((entry) => entry.path);
}

function symbolSelection(task) {
  return rankCandidates(task, true).slice(0, policy.maxFiles).map((entry) => entry.path);
}

function boundedSelection(task) {
  const selected = [];
  for (const path of task.declaredFiles) if (!selected.includes(path)) selected.push(path);
  const query = tokens(task.task);
  let contextChars = selected.reduce((sum, path) => sum + (byPath.get(path)?.available ? byPath.get(path).chars : 0), 0);

  const candidates = repository.files
    .filter((file) => file.available && !selected.includes(file.path))
    .map((file) => {
      let score = baseScore(file, query, true);
      if (file.chars > policy.oversizedChars) score -= policy.oversizedPenalty;
      if (file.path.startsWith("docs/")) score -= policy.docsPenalty;
      return { path: file.path, chars: file.chars, score };
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  for (const candidate of candidates) {
    if (selected.length >= policy.maxFiles) break;
    if (candidate.score < policy.minimumCandidateScore) continue;
    if (contextChars + candidate.chars > policy.maxContextChars) continue;
    selected.push(candidate.path);
    contextChars += candidate.chars;
  }

  return selected;
}

function selectionInputChars(mode, task) {
  if (mode === "manual") return JSON.stringify({ task: task.task, declaredFiles: task.declaredFiles }).length;
  const view = repository.files.map((file) => {
    if (mode === "lexical") return { path: file.path, available: file.available };
    if (mode === "symbol") return { path: file.path, symbols: file.symbols, available: file.available };
    return { path: file.path, symbols: file.symbols, chars: file.chars, available: file.available };
  });
  return JSON.stringify({ task: task.task, declaredFiles: task.declaredFiles, repository: view }).length;
}

function validateBoundedProposal(task, selected) {
  const unique = new Set(selected);
  const allKnown = selected.every((path) => byPath.has(path));
  const declaredPreserved = task.declaredFiles.every((path) => unique.has(path));
  const withinFileBudget = selected.length <= policy.maxFiles;
  return allKnown && declaredPreserved && withinFileBudget;
}

function assess(mode, task, selected) {
  const required = new Set(task.requiredFiles);
  const selectedSet = new Set(selected);
  const matchedRequired = task.requiredFiles.filter((path) => selectedSet.has(path));
  const unavailableSelected = selected.filter((path) => byPath.get(path)?.available === false);
  const unavailableRequired = task.requiredFiles.filter((path) => byPath.get(path)?.available === false);
  const contextChars = selected.reduce((sum, path) => sum + (byPath.get(path)?.available ? byPath.get(path).chars : 0), 0);
  const coverage = required.size === 0 ? 1 : matchedRequired.length / required.size;
  const proposalValid = mode !== "bounded" || validateBoundedProposal(task, selected);
  const fixtureTaskPass = proposalValid &&
    matchedRequired.length === required.size &&
    unavailableRequired.length === 0 &&
    contextChars <= policy.maxContextChars;

  return {
    selectedFiles: selected,
    requiredCoverage: Number(coverage.toFixed(4)),
    unnecessaryReads: selected.filter((path) => !required.has(path)).length,
    attemptedReads: selected.length,
    unavailableSelected,
    contextChars,
    selectionInputChars: selectionInputChars(mode, task),
    totalContextPlusSelectionChars: contextChars + selectionInputChars(mode, task),
    proposalValid,
    fixtureTaskPass
  };
}

const selectors = Object.freeze({
  manual: manualSelection,
  lexical: lexicalSelection,
  symbol: symbolSelection,
  bounded: boundedSelection
});

const results = tasks.map((task) => ({
  task: { id: task.id, split: task.split, task: task.task, declaredFiles: task.declaredFiles, requiredFiles: task.requiredFiles },
  modes: Object.fromEntries(Object.entries(selectors).map(([mode, select]) => {
    const selected = select(task);
    return [mode, assess(mode, task, selected)];
  }))
}));

function summarize(split, mode) {
  const rows = results.filter((row) => row.task.split === split).map((row) => row.modes[mode]);
  const count = rows.length;
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  return {
    tasks: count,
    fixtureTaskPasses: rows.filter((row) => row.fixtureTaskPass).length,
    fixtureTaskPassRate: Number((rows.filter((row) => row.fixtureTaskPass).length / count).toFixed(4)),
    meanRequiredCoverage: Number((sum("requiredCoverage") / count).toFixed(4)),
    unnecessaryReads: sum("unnecessaryReads"),
    attemptedReads: sum("attemptedReads"),
    contextChars: sum("contextChars"),
    selectionInputChars: sum("selectionInputChars"),
    totalContextPlusSelectionChars: sum("totalContextPlusSelectionChars"),
    sourceFailureTasks: rows.filter((row) => row.unavailableSelected.length > 0).length
  };
}

const summary = {};
for (const split of ["train", "heldout"]) {
  summary[split] = Object.fromEntries(Object.keys(selectors).map((mode) => [mode, summarize(split, mode)]));
}

const report = {
  experiment: "BB-036 task-aware context selection deterministic probe",
  evidenceClass: "DETERMINISTIC_REFERENCE",
  productionEvidence: false,
  repository: { ref: repository.ref, revision: repository.revision, fileCount: repository.files.length },
  policy,
  predeclaredDecisionRule: "Candidate is interesting only if held-out required-context coverage improves over manual without reducing fixture task pass rate; source unavailability must remain fail-closed. Production adoption requires a representative versioned repository/provider corpus.",
  summary,
  results,
  conclusion: {
    direction: "NARROW",
    reason: "The bounded selector improves held-out coverage and fixture task pass rate over manual, preserves unavailable declared sources as explicit failure, and removes unnecessary/oversized symbol-only reads. Evidence is fixture-only, so it supports an opt-in application-side proposal boundary for further real-corpus evaluation, not a production default.",
    runtimeDecisionPromoted: false
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
