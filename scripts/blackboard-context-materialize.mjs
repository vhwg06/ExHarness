import fs from "node:fs";
import { assertWorkContext } from "./blackboard-context-contract.mjs";
import { assertSemanticArtifact } from "./blackboard-artifact-contract.mjs";
import { resolveContext } from "./blackboard-context-resolver.mjs";

export const CONTEXT_PROFILES=Object.freeze({
  RICH_CODING_HARNESS:"RICH_CODING_HARNESS",
  GENERIC_INTERACTIVE:"GENERIC_INTERACTIVE",
  WEAK_BOUNDED:"WEAK_BOUNDED"
});

export function materializeContext(spec,{root=".",profile=CONTEXT_PROFILES.GENERIC_INTERACTIVE}={}){
  assertWorkContext(spec);
  if(!Object.values(CONTEXT_PROFILES).includes(profile))throw new Error(`CONTEXT_PROFILE_INVALID: ${profile}`);
  const artifact=spec.semanticArtifactRef
    ? assertSemanticArtifact(JSON.parse(fs.readFileSync(`${root}/${spec.semanticArtifactRef}`,"utf8")))
    : null;

  const common={
    itemId:spec.itemId,
    generation:spec.generation,
    pipeline:spec.pipeline,
    stage:spec.stage,
    action:spec.action.kind,
    lane:spec.lane??null,
    executionMode:spec.executionMode??null,
    judgmentKind:spec.judgmentKind??null,
    implementationResultRef:spec.implementationResultRef??null,
    semanticArtifactRef:spec.semanticArtifactRef??null,
    semanticArtifact:artifact,
    invariants:[...(spec.hardInvariants??[])],
    expectedOutputs:[...(spec.expectedOutputs??[])],
    claimPolicy:spec.lane==="EXECUTION"
      ?"OBSERVATIONS_ONLY_NO_CORRECTNESS_CLAIM"
      :spec.lane==="JUDGMENT"
        ?"INDEPENDENT_JUDGMENT_NO_SOURCE_MUTATION"
        :null
  };

  if(profile===CONTEXT_PROFILES.RICH_CODING_HARNESS){
    return {...common,profile,currentSystemRefs:[...spec.requiredCurrentSystemRefs],inputRefs:[...spec.requiredInputRefs],sourceScope:spec.sourceScope,verification:[...(spec.verification??[])],exploration:"SELF_DIRECTED_WITHIN_SCOPE"};
  }

  const resolved=resolveContext(spec,{root});
  if(profile===CONTEXT_PROFILES.GENERIC_INTERACTIVE){
    return {...common,profile,resolvedRefs:resolved.resolved,sourceScope:spec.sourceScope,verification:[...(spec.verification??[])],exploration:"BOUNDED_BY_DECLARED_REFS_AND_SCOPE"};
  }

  return {...common,profile,resolvedRefs:resolved.resolved,boundedExecution:{readScope:[...spec.sourceScope.read],writeScope:[...spec.sourceScope.write],forbiddenWrite:[...spec.sourceScope.forbiddenWrite],verification:[...(spec.verification??[])]},exploration:"EXPLICIT_ONLY"};
}

if(process.argv[1]?.endsWith("blackboard-context-materialize.mjs")){
  const specPath=process.argv[2];
  const profile=process.argv[3]??CONTEXT_PROFILES.GENERIC_INTERACTIVE;
  if(!specPath)throw new Error("usage: node scripts/blackboard-context-materialize.mjs <context-spec.json> [profile]");
  const spec=JSON.parse(fs.readFileSync(specPath,"utf8"));
  console.log(JSON.stringify(materializeContext(spec,{profile}),null,2));
}
