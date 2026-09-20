import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { materializeContext, CONTEXT_PROFILES } from "../scripts/blackboard-context-materialize.mjs";

function fixture(){
  const root=mkdtempSync(join(tmpdir(),"bb-materialize-"));
  mkdirSync(join(root,"docs"),{recursive:true});
  const artifact={
    kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"IMPLEMENTATION_INPUT",artifactId:"I-1",status:"ACCEPTED",
    subject:{id:"cap.x",title:"X"},
    semantics:{
      desiredOutcome:"Deliver X.",currentState:"X is absent.",
      requiredBehaviors:[{id:"RB-1",statement:"X behaves deterministically."}],
      invariants:[{id:"INV-1",statement:"Authority remains external."}],
      acceptanceCriteria:[{id:"AC-1",statement:"Recovery preserves X."}],
      outOfScope:[],affectedCapabilities:["cap.x"],affectedContracts:[]
    },
    provenance:{sourceArtifactRefs:[],evidenceRefs:[],currentSystemRefs:["docs/current.md"],acceptance:{kind:"INDEPENDENT_REVIEW",ref:"D1"}}
  };
  writeFileSync(join(root,"artifact.json"),JSON.stringify(artifact));
  writeFileSync(join(root,"docs/current.md"),"current");
  const spec={
    kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:1,pipeline:"IMPLEMENTATION_WORKER",stage:"IMPLEMENTATION_READINESS_REVIEW",
    lane:"JUDGMENT",judgmentKind:"READINESS",
    semanticArtifactRef:"artifact.json",action:{kind:"REVIEW"},reviewTarget:{repository:"r",candidateHeadSha:"abc",allowedPostTargetEnvelopePaths:[]},
    sourceScope:{read:["src/**"],write:[],forbiddenWrite:["**"]},
    requiredCurrentSystemRefs:["docs/current.md"],requiredInputRefs:["artifact.json"],auditRefs:[],
    hardInvariants:["keep authority"],expectedOutputs:["candidate"],verification:["test"]
  };
  return {root,spec,artifact};
}

test("profiles preserve one semantic artifact while changing projection",()=>{
  const {root,spec,artifact}=fixture();
  const rich=materializeContext(spec,{root,profile:CONTEXT_PROFILES.RICH_CODING_HARNESS});
  const generic=materializeContext(spec,{root,profile:CONTEXT_PROFILES.GENERIC_INTERACTIVE});
  const weak=materializeContext(spec,{root,profile:CONTEXT_PROFILES.WEAK_BOUNDED});
  assert.deepEqual(rich.semanticArtifact,artifact);
  assert.deepEqual(generic.semanticArtifact,artifact);
  assert.deepEqual(weak.semanticArtifact,artifact);
  assert.equal(rich.exploration,"SELF_DIRECTED_WITHIN_SCOPE");
  assert.ok(generic.resolvedRefs.length===2);
  assert.deepEqual(weak.boundedExecution.readScope,["src/**"]);
  assert.equal(rich.lane,"JUDGMENT");
  assert.equal(generic.claimPolicy,"INDEPENDENT_JUDGMENT_NO_SOURCE_MUTATION");
});
