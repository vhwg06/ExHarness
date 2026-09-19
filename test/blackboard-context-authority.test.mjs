import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkContext } from "../scripts/blackboard-context-contract.mjs";
import { nextImplementationContext } from "../scripts/blackboard-context-generate.mjs";
const review={kind:"WORK_CONTEXT_SPEC",version:1,itemId:"BB-X",generation:1,__ref:"g1.json",action:{kind:"REVIEW"},sourceScope:{read:[],write:[],forbiddenWrite:[]},requiredCurrentSystemRefs:[],requiredInputRefs:[],auditRefs:[]};

test("generator cannot turn review into implementation without decision",()=>assert.throws(()=>nextImplementationContext({parent:review,sourceBaseline:{},sourceScope:{read:[],write:[],forbiddenWrite:[]},verification:[]}),/decision required/));
test("implementation context requires parent and decision",()=>assert.throws(()=>assertWorkContext({...review,action:{kind:"IMPLEMENT"},authority:{implementationDecisionRef:"d"}}),/parent context/));
