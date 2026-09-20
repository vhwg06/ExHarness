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
  for (const k of ["requiredCurrentSystemRefs","requiredInputRefs","auditRefs"]) if (!Array.isArray(spec[k])) fail(k);
  if (spec.pipeline === "IMPLEMENTATION_WORKER") {
    if (typeof spec.semanticArtifactRef !== "string" || !spec.semanticArtifactRef.endsWith(".json"))
      fail("IMPLEMENTATION_WORKER requires semanticArtifactRef JSON");
    if (!spec.requiredInputRefs.includes(spec.semanticArtifactRef))
      fail("semanticArtifactRef must be a required input");
    if (!["EXECUTION","JUDGMENT"].includes(spec.lane))
      fail("IMPLEMENTATION_WORKER requires lane EXECUTION or JUDGMENT");
    if (spec.lane === "EXECUTION") {
      if (spec.action.kind !== "IMPLEMENT") fail("EXECUTION lane requires IMPLEMENT action");
      if (!["INITIAL","REPAIR"].includes(spec.executionMode)) fail("EXECUTION lane requires executionMode INITIAL or REPAIR");
    }
    if (spec.lane === "JUDGMENT") {
      if (spec.action.kind !== "REVIEW") fail("JUDGMENT lane requires REVIEW action");
      if (!["READINESS","CANDIDATE"].includes(spec.judgmentKind)) fail("JUDGMENT lane requires judgmentKind READINESS or CANDIDATE");
      if (spec.judgmentKind === "CANDIDATE") {
        if (typeof spec.implementationResultRef !== "string" || !spec.implementationResultRef.endsWith(".json"))
          fail("candidate JUDGMENT requires implementationResultRef");
        if (!spec.requiredInputRefs.includes(spec.implementationResultRef))
          fail("implementationResultRef must be a required input");
      }
    }
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
    if (!spec.authority?.subjectContextRef || !spec.authority?.subjectCandidateHeadSha) fail("IMPLEMENT requires exact authority subject");
    if (!spec.parentContextRef || spec.authority.subjectContextRef !== spec.parentContextRef) fail("IMPLEMENT authority subject must equal parent context");
    if (spec.pipeline === "IMPLEMENTATION_WORKER" && spec.executionMode === "REPAIR") {
      if (!spec.authority?.repairJudgmentRef) fail("REPAIR requires repair judgment ref");
    } else if (!spec.authority?.implementationDecisionRef) {
      fail("IMPLEMENT requires decision ref");
    }
  }
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
