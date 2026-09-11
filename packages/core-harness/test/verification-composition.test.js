import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  VerificationSourceKind,
  VerificationStatus,
  assessVerificationArtifacts,
  createAVOHarness,
  createAgentRuntime,
  createInMemorySessionStore,
  defineVerificationPolicy
} from "../src/index.js";

function artifact({ id, claim, status, source }) {
  return {
    id,
    candidate: { id: "candidate", version: "v1" },
    claim,
    status,
    evidence: [`evidence:${id}`],
    source
  };
}

function quietRuntimePorts() {
  return {
    contextProjector: { async project() { return null; } },
    supervisor: { async inspect() { return null; } },
    dosagePolicy: {
      async decide() {
        return { enabled: false, reason: "not needed for verification composition test" };
      }
    }
  };
}

test("repeating one verifier does not satisfy independent-source requirements", () => {
  const policy = defineVerificationPolicy({
    requirements: [{ claim: "correctness", minSources: 2 }]
  });

  const assessment = assessVerificationArtifacts({
    policy,
    artifacts: [
      artifact({
        id: "v1",
        claim: "correctness",
        status: VerificationStatus.PASS,
        source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.tests" }
      }),
      artifact({
        id: "v2",
        claim: "correctness",
        status: VerificationStatus.PASS,
        source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.tests" }
      })
    ]
  });

  assert.equal(assessment.ready, false);
  assert.deepEqual(assessment.unmetRequirements, [
    { claim: "correctness", minSources: 2, observedSources: 1 }
  ]);
});

test("conflicting verification artifacts remain visible and block readiness", () => {
  const assessment = assessVerificationArtifacts({
    policy: defineVerificationPolicy(),
    artifacts: [
      artifact({
        id: "pass",
        claim: "safe-to-promote",
        status: VerificationStatus.PASS,
        source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.static" }
      }),
      artifact({
        id: "fail",
        claim: "safe-to-promote",
        status: VerificationStatus.FAIL,
        source: { kind: VerificationSourceKind.MANUAL, name: "reviewer-a" }
      })
    ]
  });

  assert.equal(assessment.ready, false);
  assert.deepEqual(assessment.conflicts, ["safe-to-promote"]);
  assert.ok(assessment.reasons.some((reason) => reason.code === "CONFLICT"));
  assert.ok(assessment.reasons.some((reason) => reason.code === "FAILURE"));
});

test("AVO objective cannot pass before declared verification requirements are ready", async () => {
  let objectiveCalls = 0;
  const store = createInMemorySessionStore();
  const agent = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.ACT, { nextVersion: "v1" });
        const evaluation = await invoke(AVOCapability.EVALUATE);
        await assert.rejects(() => invoke(AVOCapability.PROMOTE), /did not pass evaluation/);
        return evaluation;
      }
    }
  });

  const harness = createAVOHarness({
    agent,
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
        objectiveCalls += 1;
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    verificationPolicy: {
      requirements: [{ claim: "correctness", minSources: 2 }]
    },
    sessionStore: store,
    ...quietRuntimePorts()
  });

  await harness.start({
    sessionId: "incomplete",
    work: { objective: "prove readiness before promotion" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("incomplete");
  assert.equal(objectiveCalls, 0);
  assert.equal(variation.result.verdict, EvaluationVerdict.GAP);
  assert.equal(variation.result.metadata.verificationAssessment.ready, false);
  assert.equal((await harness.lineage("incomplete")).length, 1);
});

test("independent sources satisfy policy and objective receives the assessment", async () => {
  let receivedAssessment = null;
  const store = createInMemorySessionStore();
  const agent = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.ACT, { nextVersion: "v1" });
        return null;
      }
    }
  });

  const harness = createAVOHarness({
    agent,
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
      async evaluate({ verificationAssessment }) {
        receivedAssessment = verificationAssessment;
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    verificationPolicy: {
      requirements: [{ claim: "correctness", minSources: 2 }]
    },
    sessionStore: store,
    ...quietRuntimePorts()
  });

  await harness.start({
    sessionId: "ready",
    work: { objective: "require orthogonal verification" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  await harness.vary("ready");

  await harness.recordVerification("ready", {
    candidate: { id: "candidate", version: "v1" },
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: ["manual-review"],
    source: { kind: VerificationSourceKind.MANUAL, name: "reviewer-a" }
  });
  await harness.recordVerification("ready", {
    candidate: { id: "candidate", version: "v1" },
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: ["static-analysis"],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "verify.static" }
  });

  const evaluation = await harness.evaluate("ready");
  assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
  assert.equal(receivedAssessment.ready, true);
  assert.equal(receivedAssessment.claims[0].passSources.length, 2);
  assert.equal(evaluation.metadata.verificationAssessment.ready, true);

  const promotion = await harness.promote("ready");
  assert.equal(promotion.candidate.version, "v1");
  assert.equal(promotion.verificationIds.length, 2);
});
