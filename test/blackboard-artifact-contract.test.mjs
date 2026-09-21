import test from "node:test";
import assert from "node:assert/strict";
import { assertSemanticArtifact, assertBlackboardArtifact } from "../scripts/blackboard-artifact-contract.mjs";

const input={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"IMPLEMENTATION_INPUT",artifactId:"I-1",status:"ACCEPTED",
  subject:{id:"capability.x",title:"Capability X"},
  semantics:{
    desiredOutcome:"Capability X preserves authority boundary Y.",currentState:"The current system stops before X.",
    requiredBehaviors:[{id:"RB-1",statement:"X produces a stable domain result."}],
    invariants:[{id:"INV-1",statement:"Authority Y remains outside X."}],
    acceptanceCriteria:[{id:"AC-1",statement:"Recovery preserves the same semantic result."}],
    outOfScope:[],affectedCapabilities:["capability.x"],affectedContracts:["ContractX"]
  },
  provenance:{sourceArtifactRefs:[],evidenceRefs:["evidence:1"],currentSystemRefs:["docs/living/system/state.md"],acceptance:{kind:"INDEPENDENT_REVIEW",ref:"decision:D1"}}
};

test("accepted implementation input is semantic and valid",()=>assert.equal(assertSemanticArtifact(input),input));
test("procedural command field is rejected",()=>assert.throws(()=>assertSemanticArtifact({...input,semantics:{...input.semantics,commands:["npm test"]}}),/forbidden field/));
test("source scope cannot leak into semantic artifact",()=>assert.throws(()=>assertSemanticArtifact({...input,semantics:{...input.semantics,sourceScope:{write:["x"]}}}),/forbidden field/));
test("implementation input must be accepted",()=>assert.throws(()=>assertSemanticArtifact({...input,status:"PROPOSED"}),/status must be ACCEPTED/));

const readiness={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"READINESS_DECISION",artifactId:"RD-1",status:"RECORDED",
  subject:{itemId:"BB-X",semanticArtifactRef:"input.json"},verdict:"ACCEPT",provenance:{evidenceRefs:["e:review"]}
};

const resultArtifact={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"IMPLEMENTATION_RESULT",artifactId:"R-1",status:"PRODUCED",
  subject:{itemId:"BB-X",semanticArtifactRef:"input.json",sourceBaseline:"base-sha",candidateRef:"candidate-sha",executionAuthorityRef:"readiness.json"},
  observations:{
    changedSurfaces:["src/x.js"],
    verificationRuns:[{id:"V-1",command:"npm test",status:"PASSED",evidenceRefs:["e:test"]}],
    observedFacts:[{id:"OF-1",statement:"The focused test exited successfully.",evidenceRefs:["e:test"]}],
    evidenceRefs:["e:test"]
  },
  provenance:{inputRefs:["input.json","readiness.json"],evidenceRefs:["e:test"]}
};

const judgmentArtifact={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
  subject:{itemId:"BB-X",semanticArtifactRef:"input.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"base-sha"},
  assessments:{
    criteria:[{id:"AC-1",status:"SATISFIED",reason:"Observed behavior matches the criterion.",evidenceRefs:["e:test"]}],
    invariants:[{id:"INV-1",status:"SATISFIED",reason:"The candidate preserves the boundary.",evidenceRefs:["e:diff"]}]
  },
  findings:[],verdict:"ACCEPT",provenance:{evidenceRefs:["e:test","e:diff"]}
};

test("readiness decision binds work directly without helper-context identity",()=>assert.equal(assertBlackboardArtifact(readiness),readiness));
test("implementation result records facts and exact execution authority",()=>assert.equal(assertBlackboardArtifact(resultArtifact),resultArtifact));
test("implementation result cannot claim a verdict",()=>assert.throws(()=>assertBlackboardArtifact({...resultArtifact,verdict:"ACCEPT"}),/unexpected field|forbidden field/));
test("independent judgment may accept only fully satisfied assessments",()=>assert.equal(assertBlackboardArtifact(judgmentArtifact),judgmentArtifact));
test("judgment subject rejects helper-context identity",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,subject:{...judgmentArtifact.subject,judgmentContextRef:"current.json"}}),/unexpected field/));
test("accept judgment with a finding fails closed",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,findings:[{id:"F-1",type:"IMPLEMENTATION_FINDING",severity:"P1",statement:"Broken.",evidenceRefs:["e"]}]}),/ACCEPT requires/));
test("FINDINGS judgment requires a concrete finding",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,verdict:"FINDINGS"}),/requires at least one finding/));
test("CONTEXT_STALE is not a valid finding type",()=>assert.throws(()=>assertBlackboardArtifact({...judgmentArtifact,verdict:"FINDINGS",findings:[{id:"F-1",type:"CONTEXT_STALE",severity:"P1",statement:"Old context.",evidenceRefs:["e"]}]}),/finding.type/));


const implementationSpec={
  kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"IMPLEMENTATION_SPEC",artifactId:"integration-c-implementation-spec",status:"ACCEPTED",
  subject:{id:"capability.x",title:"Capability X"},
  semanticInputRef:"docs/blackboard/artifacts/implementation-input/x.json",
  objective:"Implement X without widening authority.",
  architectureDecisions:["X owns HOW only."],
  sourceSeams:{requiredExisting:["src/existing.js"],expectedNew:["src/x.js"],expectedTests:["test/x.test.js"]},
  implementationSlices:[{id:"S1",output:"X implementation",requirements:["preserve authority boundary"]}],
  hardInvariants:["X cannot schedule unrelated work."],
  acceptanceCriteria:["X is reconstructable after restart."],
  mandatoryNegativeTests:["stale authority cannot execute."],
  forbidden:["global scheduler"],
  activation:{mode:"ALLOCATE_ON_GROUNDED_TRIGGER",prerequisiteSubjects:["capability.y"],baselinePolicy:"Resolve exact current source baseline at allocation.",routingAuthority:false},
  provenance:{originWorkId:"BB-049",sourceRef:"git:"+"a".repeat(40)+":docs/living/work-artifacts/BB-049/implementation.json",sourceBlobSha:"b".repeat(40)}
};

test("implementation spec preserves worker-ready HOW without becoming routing authority",()=>assert.equal(assertBlackboardArtifact(implementationSpec),implementationSpec));
test("implementation spec cannot become routing authority",()=>assert.throws(()=>assertBlackboardArtifact({...implementationSpec,activation:{...implementationSpec.activation,routingAuthority:true}}),/cannot be routing authority/));
test("implementation spec preserves origin work id as provenance only",()=>assert.throws(()=>assertBlackboardArtifact({...implementationSpec,provenance:{...implementationSpec.provenance,originWorkId:"integration-c"}}),/originWorkId/));
