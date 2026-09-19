import fs from "node:fs";

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function assertWorkContext(spec) {
  const fail = (m) => { throw new Error(`WORK_CONTEXT_INVALID: ${m}`); };
  if (spec?.kind !== "WORK_CONTEXT_SPEC" || spec?.version !== 1) fail("kind/version");
  if (!spec.itemId || !Number.isInteger(spec.generation) || spec.generation < 1) fail("item/generation");
  if (!["REVIEW","IMPLEMENT"].includes(spec.action?.kind)) fail("action.kind");
  for (const k of ["read","write","forbiddenWrite"]) if (!Array.isArray(spec.sourceScope?.[k])) fail(`sourceScope.${k}`);
  const write = new Set(spec.sourceScope.write);
  const forbidden = new Set(spec.sourceScope.forbiddenWrite);
  for (const p of write) if (forbidden.has(p)) fail(`write/forbidden overlap: ${p}`);
  if (spec.action.kind === "REVIEW" && spec.sourceScope.write.length) fail("REVIEW may not write source");
  if (spec.action.kind === "IMPLEMENT") {
    if (!spec.authority?.implementationDecisionRef) fail("IMPLEMENT requires decision ref");
    if (!spec.parentContextRef) fail("IMPLEMENT requires parent context");
  }
  for (const k of ["requiredCurrentSystemRefs","requiredInputRefs","auditRefs"]) if (!Array.isArray(spec[k])) fail(k);
  return spec;
}

export function requiredRefs(spec) {
  return [...new Set([...spec.requiredCurrentSystemRefs, ...spec.requiredInputRefs])];
}
