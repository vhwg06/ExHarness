import test from "node:test";
import assert from "node:assert/strict";
import {
  EvaluationValidity,
  EvaluationVerdict,
  VerificationSourceKind,
  VerificationStatus,
  createAVOHarness,
  createInMemorySessionStore
} from "../src/index.js";

test("new verification evidence invalidates a previous PASS before promotion", async () => {
  const harness = createAVOHarness({
    strategy: { async run() { return null; } },
    environment: {
      async observe() { return null; },
      async act({ candidate, action }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: null
        };
      }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    verificationPolicy: {
      requirements: [{ claim: "correctness", minSources: 1 }]
    },
    sessionStore: createInMemorySessionStore(),
    contextProjector: { async project() { return null; } },
    supervisor: { async inspect() { return null; } },
    dosagePolicy: {
      async decide() {
        return { enabled: false, reason: "not needed for freshness test" };
      }
    }
  });

  await harness.start({
    sessionId: "verification-freshness",
    work: { objective: "do not promote against stale evidence" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  await harness.act("verification-freshness", { nextVersion: "v1" });

  await harness.recordVerification("verification-freshness", {
    candidate: { id: "candidate", version: "v1" },
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: ["initial-check"],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.initial" }
  });

  const pass = await harness.evaluate("verification-freshness");
  assert.equal(pass.verdict, EvaluationVerdict.PASS);

  await harness.recordVerification("verification-freshness", {
    candidate: { id: "candidate", version: "v1" },
    claim: "correctness",
    status: VerificationStatus.FAIL,
    evidence: ["later-contradiction"],
    source: { kind: VerificationSourceKind.MANUAL, name: "reviewer-a" }
  });

  await assert.rejects(
    () => harness.promote("verification-freshness"),
    /verification artifacts changed since evaluation; re-evaluate before promotion/
  );

  const reevaluation = await harness.evaluate("verification-freshness");
  assert.equal(reevaluation.verdict, EvaluationVerdict.GAP);
  assert.equal(reevaluation.metadata.verificationAssessment.ready, false);
  assert.deepEqual(reevaluation.metadata.verificationAssessment.conflicts, ["correctness"]);

  await assert.rejects(
    () => harness.promote("verification-freshness"),
    /did not pass evaluation/
  );
});
