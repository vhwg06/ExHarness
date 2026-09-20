import test from "node:test";
import assert from "node:assert/strict";
import { assertSemanticArtifact } from "../scripts/blackboard-artifact-contract.mjs";

const input={
  kind:"BLACKBOARD_ARTIFACT",
  version:1,
  artifactType:"IMPLEMENTATION_INPUT",
  artifactId:"I-1",
  status:"ACCEPTED",
  subject:{id:"capability.x",title:"Capability X"},
  semantics:{
    desiredOutcome:"Capability X preserves authority boundary Y.",
    currentState:"The current system stops before X.",
    requiredBehaviors:[{id:"RB-1",statement:"X produces a stable domain result."}],
    invariants:[{id:"INV-1",statement:"Authority Y remains outside X."}],
    acceptanceCriteria:[{id:"AC-1",statement:"Recovery preserves the same semantic result."}],
    outOfScope:[],
    affectedCapabilities:["capability.x"],
    affectedContracts:["ContractX"]
  },
  provenance:{
    sourceArtifactRefs:[],
    evidenceRefs:["evidence:1"],
    currentSystemRefs:["docs/living/system/state.md"],
    acceptance:{kind:"INDEPENDENT_REVIEW",ref:"decision:D1"}
  }
};

test("accepted implementation input is semantic and valid",()=>assert.equal(assertSemanticArtifact(input),input));
test("procedural command field is rejected",()=>assert.throws(()=>assertSemanticArtifact({...input,semantics:{...input.semantics,commands:["npm test"]}}),/non-semantic|procedural/));
test("source scope cannot leak into semantic artifact",()=>assert.throws(()=>assertSemanticArtifact({...input,semantics:{...input.semantics,sourceScope:{write:["x"]}}}),/procedural/));
test("implementation input must be accepted",()=>assert.throws(()=>assertSemanticArtifact({...input,status:"PROPOSED"}),/status must be ACCEPTED/));
