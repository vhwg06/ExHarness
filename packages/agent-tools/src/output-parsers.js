// Per-tool output parsers. Token usage is reported only when the tool itself reports it; otherwise
// every token field is null with an explicit unavailableReason. Nothing is estimated from text.

export const UsageUnavailableReason = Object.freeze({
  CODEX_USAGE_NOT_REPORTED: "CODEX_USAGE_NOT_REPORTED",
  CODEX_STREAM_TRUNCATED: "CODEX_STREAM_TRUNCATED",
  KIRO_TEXT_OUTPUT_NO_USAGE: "KIRO_TEXT_OUTPUT_NO_USAGE",
  AGY_USAGE_NOT_REPORTED: "AGY_USAGE_NOT_REPORTED",
  GROK_USAGE_NOT_REPORTED: "GROK_USAGE_NOT_REPORTED",
  GROK_JSON_TRUNCATED: "GROK_JSON_TRUNCATED",
  TIMED_OUT: "TIMED_OUT",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  UNKNOWN_TOOL: "UNKNOWN_TOOL"
});

export function nullUsage(source, unavailableReason) {
  return { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null, source, unavailableReason };
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Codex `exec --json` stream. Counts events by type; sums usage only over `turn.completed` events
 * whose usage carries integer input_tokens and output_tokens. Optional fields stay null unless every
 * counted turn reported them.
 */
export function parseCodexJsonl(stdout, { truncated = false } = {}) {
  const counts = {};
  let invalidLines = 0;
  const turns = [];
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let event;
    try { event = JSON.parse(line); } catch { invalidLines += 1; continue; }
    if (!event || typeof event !== "object" || typeof event.type !== "string") { invalidLines += 1; continue; }
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    const usage = event.usage;
    if (event.type === "turn.completed" && usage && isCount(usage.input_tokens) && isCount(usage.output_tokens)) turns.push(usage);
  }
  const toolEvents = { counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))), invalidLines };
  if (turns.length === 0) {
    return { toolEvents, usage: nullUsage("codex.turn.completed", truncated ? UsageUnavailableReason.CODEX_STREAM_TRUNCATED : UsageUnavailableReason.CODEX_USAGE_NOT_REPORTED) };
  }
  const sum = (field) => turns.reduce((total, usage) => total + usage[field], 0);
  const optional = (field) => (turns.every((usage) => isCount(usage[field])) ? sum(field) : null);
  return {
    toolEvents,
    usage: {
      inputTokens: sum("input_tokens"),
      cachedInputTokens: optional("cached_input_tokens"),
      outputTokens: sum("output_tokens"),
      reasoningOutputTokens: optional("reasoning_output_tokens"),
      source: "codex.turn.completed",
      unavailableReason: null
    }
  };
}

/** Kiro 2.24 non-interactive output as run by the BB-097 adapter is plain text. */
export function parseKiroOutput() {
  return { toolEvents: null, usage: nullUsage("kiro.stdout", UsageUnavailableReason.KIRO_TEXT_OUTPUT_NO_USAGE) };
}

/** agy has no structured stdout; its --log-file is stored only as a digest plus excerpt. */
export function parseAgyOutput() {
  return { toolEvents: null, usage: nullUsage("agy.stdout", UsageUnavailableReason.AGY_USAGE_NOT_REPORTED) };
}

/** Extracts the first balanced JSON object from stdout; null when none parses. */
function firstGrokJson(stdout) {
  const raw = String(stdout ?? "");
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const text = raw.slice(start, index + 1);
        try {
          const value = JSON.parse(text);
          return { value: value && typeof value === "object" ? value : null, text };
        } catch { return { value: null, text, invalid: true }; }
      }
    }
  }
  return { value: null, text: null, invalid: true };
}

/**
 * Grok `--output-format json` object. Token fields are observed integers from usage (zero is
 * observed); totalCostUsd is the observed finite Number(total_cost_usd). Anything absent stays
 * null with GROK_USAGE_NOT_REPORTED (or GROK_JSON_TRUNCATED for a truncated stream); nothing
 * is estimated. Codex/Kiro/agy usage objects keep their six fields; only grok carries
 * totalCostUsd.
 */
export function parseGrokJson(stdout, { truncated = false } = {}) {
  const found = firstGrokJson(stdout);
  const value = found?.value ?? null;
  const usage = value?.usage && typeof value.usage === "object" ? value.usage : null;
  const inputTokens = usage && isCount(usage.input_tokens) ? usage.input_tokens : null;
  const outputTokens = usage && isCount(usage.output_tokens) ? usage.output_tokens : null;
  if (inputTokens === null || outputTokens === null) {
    return {
      toolEvents: null,
      usage: {
        ...nullUsage("grok.output.json", truncated ? UsageUnavailableReason.GROK_JSON_TRUNCATED : UsageUnavailableReason.GROK_USAGE_NOT_REPORTED),
        totalCostUsd: null
      }
    };
  }
  const cost = Number(value.total_cost_usd);
  const invalidJson = found.invalid === true || String(stdout ?? "").trim() !== String(found.text).trim();
  return {
    toolEvents: {
      num_turns: Number.isInteger(value.num_turns) ? value.num_turns : null,
      stopReason: typeof value.stopReason === "string" ? value.stopReason : null,
      invalidJson
    },
    usage: {
      inputTokens,
      cachedInputTokens: isCount(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : null,
      outputTokens,
      reasoningOutputTokens: isCount(usage.reasoning_tokens) ? usage.reasoning_tokens : null,
      source: "grok.output.json",
      unavailableReason: null,
      totalCostUsd: Number.isFinite(cost) ? cost : null
    }
  };
}

/** Dispatches on tool id and invocation status. */
export function parseToolOutput(toolId, invocation) {
  if (invocation.status === "TOOL_UNAVAILABLE") return { toolEvents: null, usage: nullUsage(`${toolId}.invocation`, UsageUnavailableReason.TOOL_UNAVAILABLE) };
  if (invocation.timedOut === true || invocation.status === "TIMED_OUT") {
    const partial = toolId === "codex" ? parseCodexJsonl(invocation.stdout, { truncated: true }).toolEvents : null;
    return { toolEvents: partial, usage: nullUsage(`${toolId}.invocation`, UsageUnavailableReason.TIMED_OUT) };
  }
  if (toolId === "codex") return parseCodexJsonl(invocation.stdout, { truncated: invocation.truncated?.stdout === true });
  if (toolId === "kiro") return parseKiroOutput();
  if (toolId === "agy") return parseAgyOutput();
  if (toolId === "grok") return parseGrokJson(invocation.stdout, { truncated: invocation.truncated?.stdout === true });
  return { toolEvents: null, usage: nullUsage(`${toolId}.invocation`, UsageUnavailableReason.UNKNOWN_TOOL) };
}
