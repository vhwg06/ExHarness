// Seeded paired-bootstrap reducer. Input is kernel-normalized attempt summaries; quality is never
// recomputed here. NOT_EVALUATED attempts are excluded from every rate and counted by reason.
import { ARMS, Arm } from "./arms.js";
import { DECISION_RULE } from "./registration.js";

export const REPORT_KIND = "AGENT_TOOLS_VALUE_REPORT_V1";
export const Verdict = Object.freeze({ SUPERIOR: "SUPERIOR", INFERIOR: "INFERIOR", INCONCLUSIVE: "INCONCLUSIVE", NOT_EVALUATED: "NOT_EVALUATED" });
export const CLAIM_BOUNDARY = "Results hold only for this owned eight-fixture suite, these arms, fixed factors and the reported tool versions on this host. A tool without an adapter or executable is NOT_EVALUATED, never a success or failure; grok results do not stand in for Codex, Kiro or agy. INCONCLUSIVE is a valid outcome.";
const DIRECT_ARMS = Object.freeze([Arm.DIRECT_RETRY, Arm.DIRECT_SINGLE]);

const round = (value) => (value === null ? null : Math.round(value * 1e6) / 1e6);

function seedToInt(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash >>> 0;
}

/** mulberry32: small deterministic PRNG so identical seeds give identical resamples. */
export function createRng(seed) {
  let state = seedToInt(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired bootstrap of the mean of deltas; percentile interval at `confidence`. */
export function pairedBootstrap(deltas, { seed, samples = DECISION_RULE.bootstrapSamples, confidence = DECISION_RULE.confidence }) {
  if (deltas.length === 0) return { pairs: 0, meanDelta: null, lower: null, upper: null, verdict: Verdict.INCONCLUSIVE, reason: "NO_EVALUATED_PAIRS" };
  const rng = createRng(seed);
  const means = new Array(samples);
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < deltas.length; index += 1) total += deltas[Math.floor(rng() * deltas.length)];
    means[sample] = total / deltas.length;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lower = means[Math.floor(alpha * samples)];
  const upper = means[Math.min(samples - 1, Math.ceil((1 - alpha) * samples) - 1)];
  const meanDelta = deltas.reduce((total, value) => total + value, 0) / deltas.length;
  const verdict = lower > 0 ? Verdict.SUPERIOR : upper < 0 ? Verdict.INFERIOR : Verdict.INCONCLUSIVE;
  return { pairs: deltas.length, meanDelta: round(meanDelta), lower: round(lower), upper: round(upper), verdict, reason: null };
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// False success: a direct arm whose last invocation exited 0, or a supervised ACCEPTED, while the
// independent hidden evaluation REJECTED the candidate.
const isFalseSuccess = (attempt) => attempt.quality === "REJECTED" && attempt.claimedSuccess === true;

function armMetrics(attempts) {
  const evaluated = attempts.filter((attempt) => attempt.quality !== "NOT_EVALUATED");
  const notEvaluated = {};
  for (const attempt of attempts.filter((item) => item.quality === "NOT_EVALUATED")) {
    const reason = attempt.notEvaluatedReason ?? "UNSPECIFIED";
    notEvaluated[reason] = (notEvaluated[reason] ?? 0) + 1;
  }
  const accepted = evaluated.filter((attempt) => attempt.quality === "ACCEPTED").length;
  const tokenKnown = evaluated.filter((attempt) => typeof attempt.usage?.inputTokens === "number" && typeof attempt.usage?.outputTokens === "number");
  const costKnown = evaluated.filter((attempt) => typeof attempt.usage?.providerCostUsd === "number");
  return {
    attempts: attempts.length,
    evaluated: evaluated.length,
    notEvaluated: Object.fromEntries(Object.entries(notEvaluated).sort(([a], [b]) => (a < b ? -1 : 1))),
    accepted,
    acceptanceRate: evaluated.length ? round(accepted / evaluated.length) : null,
    falseSuccessRate: evaluated.length ? round(evaluated.filter(isFalseSuccess).length / evaluated.length) : null,
    medianDurationMs: median(evaluated.map((attempt) => attempt.durationMs)),
    invocations: evaluated.reduce((total, attempt) => total + attempt.invocations, 0),
    medianInvocations: median(evaluated.map((attempt) => attempt.invocations)),
    coveredTokens: {
      attemptsWithTokens: tokenKnown.length,
      coverage: evaluated.length ? round(tokenKnown.length / evaluated.length) : null,
      inputTokens: tokenKnown.length ? tokenKnown.reduce((total, attempt) => total + attempt.usage.inputTokens, 0) : null,
      outputTokens: tokenKnown.length ? tokenKnown.reduce((total, attempt) => total + attempt.usage.outputTokens, 0) : null
    },
    providerCostUsd: costKnown.length ? round(costKnown.reduce((total, attempt) => total + attempt.usage.providerCostUsd, 0)) : null
  };
}

function compare(attempts, other, seed) {
  const key = (attempt) => `${attempt.taskId}\u0000${attempt.repeatIndex}`;
  const supervised = new Map(attempts.filter((a) => a.arm === Arm.EXHARNESS_SUPERVISED && a.quality !== "NOT_EVALUATED").map((a) => [key(a), a]));
  const deltas = [];
  const pairs = attempts
    .filter((a) => a.arm === other && a.quality !== "NOT_EVALUATED" && supervised.has(key(a)))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  for (const attempt of pairs) deltas.push((supervised.get(key(attempt)).quality === "ACCEPTED" ? 1 : 0) - (attempt.quality === "ACCEPTED" ? 1 : 0));
  return { versus: other, ...pairedBootstrap(deltas, { seed: `${seed}:${other}` }) };
}

/**
 * Reduces attempts (from one or more tools) into AGENT_TOOLS_VALUE_REPORT_V1. `tools` may carry
 * per-tool context: { registrationDigest, toolVersion, status, notEvaluatedReason, usdCap, plannedAttempts }.
 * The same seed and inputs always produce byte-identical JSON.
 */
export function reduceAttempts({ attempts, seed, tools = {} }) {
  if (!Array.isArray(attempts)) throw new TypeError("reduceAttempts requires attempts");
  const toolIds = [...new Set([...attempts.map((attempt) => attempt.tool), ...Object.keys(tools)])].sort();
  const report = { kind: REPORT_KIND, version: 1, seed: String(seed), decisionRule: DECISION_RULE, claimBoundary: CLAIM_BOUNDARY, tools: {} };
  for (const toolId of toolIds) {
    const context = tools[toolId] ?? {};
    const own = attempts.filter((attempt) => attempt.tool === toolId);
    if (context.status === Verdict.NOT_EVALUATED) {
      report.tools[toolId] = {
        status: Verdict.NOT_EVALUATED, notEvaluatedReason: context.notEvaluatedReason ?? "UNSPECIFIED", toolVersion: context.toolVersion ?? null,
        registrationDigest: context.registrationDigest ?? null, plannedAttempts: context.plannedAttempts ?? null, arms: {}, comparisons: {}, usdCap: context.usdCap ?? "NOT_SET"
      };
      continue;
    }
    const arms = {};
    for (const arm of ARMS) arms[arm] = armMetrics(own.filter((attempt) => attempt.arm === arm));
    const comparisons = {};
    for (const other of DIRECT_ARMS) comparisons[other] = compare(own, other, `${seed}:${toolId}`);
    report.tools[toolId] = {
      status: "EVALUATED", notEvaluatedReason: null, toolVersion: context.toolVersion ?? null, registrationDigest: context.registrationDigest ?? null,
      plannedAttempts: context.plannedAttempts ?? own.length, arms, comparisons, usdCap: context.usdCap ?? "NOT_SET"
    };
  }
  return report;
}

export const serializeReport = (report) => `${JSON.stringify(report, null, 2)}\n`;

/** Human-readable report.md derived only from report.json content. */
export function renderReportMarkdown(report) {
  const lines = ["# Agent-tools value report", "", `Seed: ${report.seed}. Decision rule: 10000-sample paired bootstrap, 95% interval; SUPERIOR if the lower bound > 0, INFERIOR if the upper bound < 0, otherwise INCONCLUSIVE.`, ""];
  for (const [toolId, tool] of Object.entries(report.tools)) {
    lines.push(`## ${toolId}`, "");
    if (tool.status === Verdict.NOT_EVALUATED) {
      lines.push(`NOT_EVALUATED (${tool.notEvaluatedReason}). No attempt was counted as a success or a failure.`, "");
      continue;
    }
    lines.push(`Tool version: ${tool.toolVersion ?? "unknown"}. Registration: ${tool.registrationDigest ?? "n/a"}. USD cap: ${tool.usdCap}.`, "");
    lines.push("| Arm | Evaluated | Accepted | False success | Median ms | Invocations | Token coverage | Not evaluated |", "|---|---|---|---|---|---|---|---|");
    for (const [arm, metrics] of Object.entries(tool.arms)) {
      const skipped = Object.entries(metrics.notEvaluated).map(([reason, count]) => `${reason}:${count}`).join(" ") || "0";
      lines.push(`| ${arm} | ${metrics.evaluated}/${metrics.attempts} | ${metrics.acceptanceRate ?? "n/a"} | ${metrics.falseSuccessRate ?? "n/a"} | ${metrics.medianDurationMs ?? "n/a"} | ${metrics.invocations} | ${metrics.coveredTokens.coverage ?? "n/a"} | ${skipped} |`);
    }
    lines.push("");
    for (const comparison of Object.values(tool.comparisons)) {
      lines.push(`- EXHARNESS_SUPERVISED vs ${comparison.versus}: ${comparison.verdict} (pairs ${comparison.pairs}, mean delta ${comparison.meanDelta ?? "n/a"}, 95% [${comparison.lower ?? "n/a"}, ${comparison.upper ?? "n/a"}])`);
    }
    lines.push("");
  }
  lines.push("## Claim boundary", "", report.claimBoundary, "");
  return lines.join("\n");
}
