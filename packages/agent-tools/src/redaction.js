// Secret redaction for agent-tool run traces. Redaction runs before any trace byte is written:
// on the full captured text before excerpting, on argv and on log excerpts. Digests are computed
// over raw bytes elsewhere and are one-way.

export const REDACTED = "[REDACTED]";
export const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL)/i;
export const MIN_SECRET_LENGTH = 8;
export const SECRET_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/g
]);

/** Environment values that must never appear in a trace (longest first so overlaps redact fully). */
export function secretValues(env = process.env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH && SECRET_ENV_NAME.test(name)) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

/** Builds a redactor bound to one secret set: { redact(text), containsSecret(text), values }. */
export function createRedactor({ env = process.env } = {}) {
  const values = secretValues(env);
  const redact = (text) => {
    let out = String(text ?? "");
    for (const value of values) out = out.split(value).join(REDACTED);
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
    return out;
  };
  const containsSecret = (text) => {
    const value = String(text ?? "");
    if (values.some((secret) => value.includes(secret))) return true;
    return SECRET_PATTERNS.some((pattern) => new RegExp(pattern.source).test(value));
  };
  return Object.freeze({ redact, containsSecret, values: Object.freeze(values) });
}

/** One-shot redaction: redact(text, { env }). */
export function redact(text, { env = process.env } = {}) {
  return createRedactor({ env }).redact(text);
}

/**
 * Redacts a captured stream and keeps at most the last `maxChars` characters. When the capture was
 * truncated, the trailing partial line is dropped first so a secret cut at the boundary cannot leak
 * a recognisable prefix.
 */
export function redactedExcerpt(text, { redactor, truncated = false, maxChars = 4000 }) {
  let value = String(text ?? "");
  if (truncated) {
    const newline = value.lastIndexOf("\n");
    value = newline >= 0 ? value.slice(0, newline + 1) : "";
  }
  const cleaned = redactor.redact(value);
  return cleaned.length > maxChars ? cleaned.slice(-maxChars) : cleaned;
}
