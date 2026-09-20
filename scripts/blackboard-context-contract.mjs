import fs from "node:fs";

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function overlap(a,b) {
  if (a === b) return true;
  const prefix = p => p.endsWith("/**") ? p.slice(0,-3) : null;
  const ap=prefix(a), bp=prefix(b);
  return (ap && (b===ap || b.startsWith(ap+"/"))) || (bp && (a===bp || a.startsWith(bp+"/")));
}

export function assertWorkContext(spec) {
  const fail = (m) => { throw new Error(`WORK_CONTEXT_INVALID: ${m}`); };
  if (spec?.kind !== "WORK_CONTEXT_SPEC" || spec?.version !== 1) fail("kind/version");
  if (!spec.itemId || !Number.isInteger(spec.generation) || spec.generation < 1) fail("item/generation");
  if (!["REVIEW","IMPLEMENT","RESEARCH","SYNTHESIZE"].includes(spec.action?.kind)) fail("action.kind");
  if (spec.pipeline != null && !["RESEARCH_SA","IMPLEMENTATION_WORKER"].includes(spec.pipeline)) fail("pipeline");
  if (spec.pipeline === "IMPLEMENTATION_WORKER") {
    if (typeof spec.semanticArtifactRef !== "string" || !spec.semanticArtifactRef.endsWith(".json"))
      fail("IMPLEMENTATION_WORKER requires semanticArtifactRef JSON");
    if (!spec.requiredInputRefs.includes(spec.semanticArtifactRef))
      fail("semanticArtifactRef must be a required input");
  }
  if (spec.stage != null && (typeof spec.stage !== "string" || !spec.stage.trim())) fail("stage");
  for (const k of ["read","write","forbiddenWrite"]) if (!Array.isArray(spec.sourceScope?.[k])) fail(`sourceScope.${k}`);
  for (const w of spec.sourceScope.write) for (const x of spec.sourceScope.forbiddenWrite) if (overlap(w,x)) fail(`write/forbidden overlap: ${w} <> ${x}`);
  if (["RESEARCH","SYNTHESIZE"].includes(spec.action.kind) && spec.sourceScope.write.length)
    fail("Research/SA may not write product source");
  if (spec.action.kind === "REVIEW") {
    if (spec.sourceScope.write.length) fail("REVIEW may not write source");
    if (!spec.reviewTarget?.repository || !spec.reviewTarget?.candidateHeadSha) fail("REVIEW requires immutable review target");
    if (!Array.isArray(spec.reviewTarget.allowedPostTargetEnvelopePaths)) fail("REVIEW requires allowed envelope paths");
  }
  if (spec.action.kind === "IMPLEMENT") {
    if (!spec.authority?.implementationDecisionRef) fail("IMPLEMENT requires decision ref");
    if (!spec.authority?.subjectContextRef || !spec.authority?.subjectCandidateHeadSha) fail("IMPLEMENT requires exact decision subject");
    if (!spec.parentContextRef || spec.authority.subjectContextRef !== spec.parentContextRef) fail("IMPLEMENT decision subject must equal parent context");
  }
  for (const k of ["requiredCurrentSystemRefs","requiredInputRefs","auditRefs"]) if (!Array.isArray(spec[k])) fail(k);
  return spec;
}

export function assertGeneration(parent, child) {
  if (!parent || child.parentContextRef == null || child.generation !== parent.generation + 1)
    throw new Error("WORK_CONTEXT_INVALID: generation lineage");
  return true;
}

export function requiredRefs(spec) {
  return [...new Set([...spec.requiredCurrentSystemRefs, ...spec.requiredInputRefs])];
}
