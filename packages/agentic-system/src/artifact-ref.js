function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

export function parseApplicationArtifactRef(raw, label = "ApplicationArtifactRef") {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${label} must be an object`);
  const parsed = {
    ref: requireText(raw.ref, `${label}.ref`)
  };
  if (raw.path != null) parsed.path = requireText(raw.path, `${label}.path`);
  return Object.freeze(parsed);
}

export const ApplicationArtifactRefSchema = Object.freeze({
  parse(raw) {
    return parseApplicationArtifactRef(raw);
  }
});
