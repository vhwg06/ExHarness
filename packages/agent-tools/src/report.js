// AGENT_TOOL_RUN_REPORT_V1: a deterministic, DESCRIPTIVE summary of run traces per tool and arm.
// It never asserts acceptance, superiority or value; comparisons belong to BB-099.

export const AGENT_TOOL_RUN_REPORT_VERSION = "AGENT_TOOL_RUN_REPORT_V1";
const TOKEN_FIELDS = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"];

const sortedCounts = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const bump = (map, key) => map.set(String(key), (map.get(String(key)) ?? 0) + 1);

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeGroup(tool, arm, traces) {
  const status = new Map();
  const exitCodes = new Map();
  const verification = new Map();
  const reasons = new Map();
  const durations = traces.map((trace) => trace.durationMs).filter(Number.isFinite);
  const diff = { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 };
  const tokens = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, null]));
  let coveredTraces = 0;
  let totalCostUsdOverCoveredTraces = null;
  for (const trace of traces) {
    bump(status, trace.status);
    bump(exitCodes, trace.exitCode === null ? "null" : trace.exitCode);
    if (trace.verification.length === 0) bump(verification, "NONE");
    for (const record of trace.verification) bump(verification, record.status);
    for (const key of Object.keys(diff)) diff[key] += trace.diff?.[key] ?? 0;
    const usage = trace.usage;
    // Only traces whose tool reported usage are covered; uncovered traces never contribute zeros.
    if (usage && usage.unavailableReason === null && Number.isInteger(usage.inputTokens) && Number.isInteger(usage.outputTokens)) {
      coveredTraces += 1;
      for (const field of TOKEN_FIELDS) {
        if (Number.isInteger(usage[field])) tokens[field] = (tokens[field] ?? 0) + usage[field];
      }
      // Grok-only: sum the observed finite total_cost_usd over covered traces.
      if (Number.isFinite(usage.totalCostUsd)) totalCostUsdOverCoveredTraces = (totalCostUsdOverCoveredTraces ?? 0) + usage.totalCostUsd;
    } else {
      bump(reasons, usage?.unavailableReason ?? "MISSING_USAGE");
    }
  }
  return {
    tool,
    arm,
    traces: traces.length,
    tasks: new Set(traces.map((trace) => trace.taskId)).size,
    runs: new Set(traces.map((trace) => trace.runId)).size,
    statusCounts: sortedCounts(status),
    exitCodeCounts: sortedCounts(exitCodes),
    timeouts: traces.filter((trace) => trace.timedOut).length,
    verificationStatusCounts: sortedCounts(verification),
    diffTotals: diff,
    durationMs: { min: durations.length ? Math.min(...durations) : null, median: median(durations), max: durations.length ? Math.max(...durations) : null },
    usage: { coveredTraces, uncoveredTraces: traces.length - coveredTraces, totalsOverCoveredTraces: tokens, totalCostUsdOverCoveredTraces, unavailableReasonCounts: sortedCounts(reasons) }
  };
}

/** Groups verified trace records by tool then arm (sorted) and summarizes each group. */
export function summarizeTraces(records) {
  const groups = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.tool, record.arm]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    kind: AGENT_TOOL_RUN_REPORT_VERSION,
    label: "DESCRIPTIVE",
    traceCount: records.length,
    groups: ordered.map(([key, traces]) => {
      const [tool, arm] = JSON.parse(key);
      return summarizeGroup(tool, arm, traces);
    })
  };
}
