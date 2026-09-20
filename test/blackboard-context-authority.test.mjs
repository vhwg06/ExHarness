import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext } from "../scripts/blackboard-context-contract.mjs";
import { nextImplementationContext, nextCandidateJudgmentContext, nextRepairContext } from "../scripts/blackboard-context-generate.mjs";

const review={
  kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",
  action:{kind:"REVIEW"},
  sourceScope:{read:[],write:[],forbiddenWrite:[]},
  requiredCurrentSystemRefs:[],requiredInputRefs:[]
};
const workerReview={
  ...review,
  pipeline:"IMPLEMENTATION_WORKER",
  lane:"JUDGMENT",
  judgmentKind:"READINESS",
  semanticArtifactRef:"artifact.json",
  requiredInputRefs:["artifact.json"]
};

test("generator cannot turn review into implementation without decision",()=>assert.throws(
  ()=>nextImplementationContext({parent:review,sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),
  /decision required/
));

test("current readiness context transitions to execution without context lineage",()=>{
  const out=nextImplementationContext({
    parent:workerReview,decisionRef:"readiness.json",
    sourceBaseline:{repository:"r",revision:"x"},
    sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
    verification:["npm test"]
  });
  assert.equal(out.semanticArtifactRef,"artifact.json");
  assert.equal(out.lane,"EXECUTION");
  assert.equal(out.executionMode,"INITIAL");
  assert.equal(out.action.kind,"IMPLEMENT");
  assert.deepEqual(out.authority,{ref:"readiness.json"});
  assert.ok(out.requiredInputRefs.includes("readiness.json"));
  assert.equal("generation" in out,false);
  assert.equal("parentContextRef" in out,false);
});

test("execution transitions by overwriting current helper context with candidate judgment",()=>{
  const execution=nextImplementationContext({
    parent:workerReview,decisionRef:"readiness.json",
    sourceBaseline:{repository:"r",revision:"x"},
    sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
    verification:["npm test"]
  });
  const judgment=nextCandidateJudgmentContext({
    parent:execution,
    implementationResultRef:"result.json",
    candidateHeadSha:"candidate-sha"
  });
  assert.equal(judgment.lane,"JUDGMENT");
  assert.equal(judgment.judgmentKind,"CANDIDATE");
  assert.equal(judgment.action.kind,"REVIEW");
  assert.equal(judgment.implementationResultRef,"result.json");
  assert.deepEqual(judgment.sourceScope.write,[]);
  assert.ok(judgment.requiredInputRefs.includes("result.json"));
  assert.equal("authority" in judgment,false);
});

test("FINDINGS judgment alone can open bounded repair execution",()=>{
  const execution=nextImplementationContext({
    parent:workerReview,decisionRef:"readiness.json",
    sourceBaseline:{repository:"r",revision:"x"},
    sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
    verification:["npm test"]
  });
  const candidateJudgment=nextCandidateJudgmentContext({
    parent:execution,implementationResultRef:"result.json",candidateHeadSha:"candidate-sha"
  });
  const judgmentArtifact={
    kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
    subject:{itemId:"BB-X",semanticArtifactRef:"artifact.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"x"},
    assessments:{
      criteria:[{id:"AC-1",status:"FINDING",reason:"Behavior mismatch.",evidenceRefs:["e"]}],
      invariants:[{id:"INV-1",status:"SATISFIED",reason:"Boundary preserved.",evidenceRefs:["e"]}]
    },
    findings:[{id:"F-1",type:"IMPLEMENTATION_FINDING",severity:"P1",statement:"Repair the exact behavior mismatch.",evidenceRefs:["e"]}],
    verdict:"FINDINGS",
    provenance:{evidenceRefs:["e"]}
  };
  const repair=nextRepairContext({
    parent:candidateJudgment,judgmentRef:"judgment.json",judgment:judgmentArtifact,
    sourceBaseline:{repository:"r",revision:"candidate-sha"},
    sourceScope:{read:["src/**"],write:["src/x.js"],forbiddenWrite:["docs/living/**"]},
    verification:["npm test"]
  });
  assert.equal(repair.lane,"EXECUTION");
  assert.equal(repair.executionMode,"REPAIR");
  assert.deepEqual(repair.authority,{ref:"judgment.json"});
  assert.ok(repair.requiredInputRefs.includes("judgment.json"));
});

test("ACCEPT judgment cannot authorize repair",()=>{
  const parent={
    ...workerReview,judgmentKind:"CANDIDATE",
    implementationResultRef:"result.json",requiredInputRefs:["artifact.json","result.json"],
    reviewTarget:{repository:"r",candidateHeadSha:"candidate-sha"}
  };
  const accept={
    kind:"BLACKBOARD_ARTIFACT",version:1,artifactType:"JUDGMENT",artifactId:"J-1",status:"RECORDED",
    subject:{itemId:"BB-X",semanticArtifactRef:"artifact.json",implementationResultRef:"result.json",candidateRef:"candidate-sha",sourceBaseline:"x"},
    assessments:{
      criteria:[{id:"AC-1",status:"SATISFIED",reason:"Satisfied.",evidenceRefs:["e"]}],
      invariants:[{id:"INV-1",status:"SATISFIED",reason:"Preserved.",evidenceRefs:["e"]}]
    },
    findings:[],verdict:"ACCEPT",provenance:{evidenceRefs:["e"]}
  };
  assert.throws(()=>nextRepairContext({
    parent,judgmentRef:"j.json",judgment:accept,
    sourceBaseline:{repository:"r",revision:"candidate-sha"},
    sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]
  }),/requires FINDINGS judgment/);
});

test("implementation worker fails without semantic artifact",()=>{
  const parent={...review,pipeline:"IMPLEMENTATION_WORKER",lane:"JUDGMENT",judgmentKind:"READINESS",requiredInputRefs:[]};
  assert.throws(()=>nextImplementationContext({
    parent,decisionRef:"d.json",
    sourceBaseline:{repository:"r",revision:"x"},
    sourceScope:{read:[],write:["scripts/x"],forbiddenWrite:["packages/**"]},verification:[]
  }),/semanticArtifactRef|semantic artifact|WORK_CONTEXT_INVALID/);
});

test("helper context itself cannot become authority subject",()=>{
  const invalid={...workerReview,action:{kind:"IMPLEMENT"},lane:"EXECUTION",executionMode:"INITIAL",authority:{ref:"decision.json",subjectContextRef:"current.json"}};
  assert.throws(()=>assertWorkContext(invalid),/authority.ref|unexpected|WORK_CONTEXT_INVALID/);
});
