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
  if (!spec.itemId) fail("item");
  if ("generation" in spec) fail("generation is not allowed on helpful context");
  if ("parentContextRef" in spec) fail("parentContextRef is not allowed on helpful context");
  if ("staleWhen" in spec) fail("staleWhen is not allowed; current context is updated explicitly");
  if ("auditRefs" in spec) fail("auditRefs are not allowed; context loads only delivery refs");
  if (!["REVIEW","IMPLEMENT","RESEARCH","SYNTHESIZE"].includes(spec.action?.kind)) fail("action.kind");
  if (spec.pipeline != null && !["RESEARCH_SA","IMPLEMENTATION_WORKER"].includes(spec.pipeline)) fail("pipeline");
  for (const k of ["requiredCurrentSystemRefs","requiredInputRefs"]) if (!Array.isArray(spec[k])) fail(k);
  if (spec.pipeline === "IMPLEMENTATION_WORKER") {
    if (typeof spec.semanticArtifactRef !== "string" || !spec.semanticArtifactRef.endsWith(".json"))
      fail("IMPLEMENTATION_WORKER requires semanticArtifactRef JSON");
    if (!spec.requiredInputRefs.includes(spec.semanticArtifactRef))
      fail("semanticArtifactRef must be a required input");
    if (spec.implementationSpecRef != null) {
      if (typeof spec.implementationSpecRef !== "string" || !spec.implementationSpecRef.endsWith(".json"))
        fail("implementationSpecRef must be JSON");
      if (!spec.requiredInputRefs.includes(spec.implementationSpecRef))
        fail("implementationSpecRef must be a required input");
    }
    if (!["EXECUTION","JUDGMENT"].includes(spec.lane))
      fail("IMPLEMENTATION_WORKER requires lane EXECUTION or JUDGMENT");
    if (spec.lane === "EXECUTION") {
      if (spec.action.kind !== "IMPLEMENT") fail("EXECUTION lane requires IMPLEMENT action");
      if (!["INITIAL","REPAIR"].includes(spec.executionMode)) fail("EXECUTION lane requires executionMode INITIAL or REPAIR");
      if (spec.judgmentKind != null) fail("EXECUTION lane may not declare judgmentKind");
      if (!spec.authority?.ref) fail("EXECUTION lane requires exact authority.ref");
      if (Object.keys(spec.authority).length !== 1) fail("EXECUTION authority may contain only ref");
    }
    if (spec.lane === "JUDGMENT") {
      if (spec.action.kind !== "REVIEW") fail("JUDGMENT lane requires REVIEW action");
      if (!["READINESS","CANDIDATE"].includes(spec.judgmentKind)) fail("JUDGMENT lane requires judgmentKind READINESS or CANDIDATE");
      if (spec.executionMode != null) fail("JUDGMENT lane may not declare executionMode");
      if (spec.authority != null) fail("JUDGMENT lane may not carry execution authority");
      if (spec.judgmentKind === "READINESS" && spec.implementationResultRef != null)
        fail("readiness JUDGMENT may not bind implementation result");
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
    if (spec.judgmentKind === "CANDIDATE" && (!spec.reviewTarget?.repository || !spec.reviewTarget?.candidateHeadSha))
      fail("candidate REVIEW requires exact review target");
  }
  return spec;
}

export function requiredRefs(spec) {
  return [...new Set([...spec.requiredCurrentSystemRefs, ...spec.requiredInputRefs])];
}
