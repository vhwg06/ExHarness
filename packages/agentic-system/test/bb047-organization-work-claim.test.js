import test from "node:test";
import assert from "node:assert/strict";
import { createOrganizationWorkClaimController, materializeAuthorizedObligations } from "../src/organization-work-claim.js";

function stores(domains=["BACKEND"]) {
  let head={token:"root",generation:0,state:"OPEN"};
  return {
    authorizationStore:{async current(identity){return {identity,authorizedDomains:domains};}},
    claimReleaseStore:{
      async current(){return structuredClone(head);},
      async compareAndSwap(_id,expected,next){if(head.token!==expected)return false; head=structuredClone(next); return true;}
    }
  };
}
const contract={id:"work-1",owningDomain:"BACKEND",workloadType:"feature-delivery",obligationKeys:["api"],inputRefs:["intent"],expectedOutputRefs:["patch"]};

test("non-authorized principal cannot claim another domain",async()=>{
  const s=stores(["BUSINESS_ANALYSIS"]);
  const c=createOrganizationWorkClaimController(s);
  await assert.rejects(()=>c.claim({contract,principal:{identity:"ba-1"},expectedReleaseHead:"root"}),/not authorized for domain BACKEND/);
});
test("authorized claim is generation fenced by CAS head",async()=>{
  const s=stores();
  const c=createOrganizationWorkClaimController(s);
  const claim=await c.claim({contract,principal:{identity:"be-1"},expectedReleaseHead:"root"});
  assert.equal(claim.generation,1);
  assert.equal(claim.state,"CLAIMED");
  await assert.rejects(()=>c.claim({contract,principal:{identity:"be-1"},expectedReleaseHead:"root"}),/claim release head changed/);
});
test("materialization fails closed outside accepted obligation keys",()=>{
  assert.deepEqual(materializeAuthorizedObligations({decision:{obligationKeys:["api"]},requested:["api"]}),["api"]);
  assert.throws(()=>materializeAuthorizedObligations({decision:{obligationKeys:["api"]},requested:["ui"]}),/outside accepted scope/);
});
