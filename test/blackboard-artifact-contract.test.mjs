import test from "node:test";
import assert from "node:assert/strict";
import { assertSemanticArtifact, assertBlackboardArtifact } from "../scripts/blackboard-artifact-contract.mjs";

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

const resultArtifact={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"IMPLEMENTATION_RESULT",artifactId:"R-1",status:"PRODUCED",
  subject:{itemId:"BB-X",semanticArtifactRef:"input.json",sourceBaseline:"base-sha",candidateRef:"candidate-sha",producerContextRef:"g2.json"},
  observations:{
    changedSurfaces:["src/x.js"],
    verificationRuns:[{id:"V-1",command:"npm test",status:"PASSED",evidenceRefs:["e:test"]}],
    observedFacts:[{id:"OF-1",statement:"The focused test exited successfully.",evidenceRefs:["e:test"]}],
    evidenceRefs:["e:test"]
  },
  provenance:{inputRefs:["input.json"],evidenceRefs:["e:test"]}
};

const judgmentArtifact={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
  subject:{itemId:"BB-X",semanticArtifactRef:"input.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"base-sha",judgmentContextRef:"g3.json"},
  assessments:{
    criteria:[{id:"AC-1",status:"SATISFIED",reason:"Observed behavior matches the criterion.",evidenceRefs:["e:test"]}],
    invariants:[{id:"INV-1",status:"SATISFIED",reason:"The candidate preserves the boundary.",evidenceRefs:["e:diff"]}]
  },
  findings:[],
  verdict:"ACCEPT",
  provenance:{evidenceRefs:["e:test","e:diff"]}
};

test("implementation result records facts without correctness authority",()=>assert.equal(assertBlackboardArtifact(resultArtifact),resultArtifact));
test("implementation result cannot claim a verdict",()=>assert.throws(()=>assertBlackboardArtifact({...resultArtifact,verdict:"ACCEPT"}),/unexpected field|forbidden field/));
test("implementation result cannot claim safe-to-merge inside observations",()=>assert.throws(()=>assertBlackboardArtifact({...resultArtifact,observations:{...resultArtifact.observations,safeToMerge:true}}),/forbidden field|unexpected field/));
test("independent judgment may accept only fully satisfied assessments",()=>assert.equal(assertBlackboardArtifact(judgmentArtifact),judgmentArtifact));
test("accept judgment with a finding fails closed",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,findings:[{id:"F-1",type:"IMPLEMENTATION_FINDING",severity:"P1",statement:"Broken.",evidenceRefs:["e"]}]}),/ACCEPT requires/));
test("FINDINGS judgment requires a concrete finding",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,verdict:"FINDINGS"}),/requires at least one finding/));
