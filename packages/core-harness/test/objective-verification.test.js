import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  VerificationSourceKind,
  VerificationStatus,
  createAVOHarness,
  createAgentRuntime,
  createCoreHarness,
  createInMemorySessionStore,
  defineVerifier,
  verificationCapabilityName
} from "../src/index.js";

function quietSupervisor() {
  return { async inspect() { return null; } };
}

function nullProjector() {
  return { async project() { return null; } };
}

function noDosage() {
  return {
    async decide() {
      return { enabled: false, reason: "not relevant to verification contract" };
    }
  };
}

function environment() {
  return {
    async observe() {
      return null;
    },
    async act({ candidate, action }) {
      if (!action?.mutate) return { mutated: false, result: null };
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: null
      };
    }
  };
}

test("manual vigilance can be codified as a candidate-bound verification artifact", async () => {
  const seen = [];
  const store = createInMemorySessionStore();
  const harness = createCoreHarness({
    environment: environment(),
    evaluator: {
      async evaluate(input) {
        seen.push(input.verifications);
        return {
          validity: EvaluationValidity.VALID,
          verdict: input.verifications.some((item) => item.status === VerificationStatus.PASS)
            ? EvaluationVerdict.PASS
            : EvaluationVerdict.GAP
        };
      }
    },
    sessionStore: store,
    supervisor: quietSupervisor(),
    contextProjector: nullProjector(),
    dosagePolicy: noDosage()
  });

  const candidate = { id: "candidate", version: "v0" };
  await harness.start({ sessionId: "manual", work: { objective: "verify explicitly" }, seedCandidate: candidate });

  const artifact = await harness.recordVerification("manual", {
    candidate,
    claim: "the candidate satisfies the manually inspected invariant",
    status: VerificationStatus.PASS,
    evidence: [{ kind: "manual-review", ref: "review-1" }]
  });

  assert.equal(artifact.kind, "VERIFICATION");
  assert.equal(artifact.source.kind, VerificationSourceKind.MANUAL);

  const evaluation = await harness.evaluate("manual");
  assert.deepEqual(evaluation.verificationIds, [artifact.id]);
  assert.equal(seen[0][0].id, artifact.id);
  assert.equal(evaluation.verdict, EvaluationVerdict.PASS);

  await harness.act("manual", { mutate: true, nextVersion: "v1" });
  assert.equal((await harness.verifications("manual", { currentCandidateOnly: true })).length, 0);
  await assert.rejects(
    () => harness.recordVerification("manual", {
      candidate,
      claim: "stale result",
      status: VerificationStatus.PASS,
      evidence: [{ kind: "manual-review", ref: "review-old" }]
    }),
    /must target the current candidate/
  );
});

test("codified verification can be automated as a NOOA-visible harness capability", async () => {
  const verifier = defineVerifier({
    name: "version-is-v1",
    description: "Objectively verify that the current candidate is v1.",
    async verify({ candidate }) {
      const pass = candidate.version === "v1";
      return {
        claim: "candidate version equals v1",
        status: pass ? VerificationStatus.PASS : VerificationStatus.FAIL,
        evidence: [{ kind: "candidate-version", value: candidate.version }],
        summary: pass ? "verified" : "not verified"
      };
    }
  });

  const capabilityName = verificationCapabilityName(verifier.name);
  const agent = createAgentRuntime({
    strategy: {
      async run({ capabilities, invoke }) {
        assert.ok(capabilities.some((item) => item.name === capabilityName));
        await invoke(AVOCapability.ACT, { mutate: true, nextVersion: "v1" });
        const verification = await invoke(capabilityName);
        assert.equal(verification.status, VerificationStatus.PASS);
        assert.equal(verification.source.kind, VerificationSourceKind.CAPABILITY);

        const evaluation = await invoke(AVOCapability.EVALUATE);
        assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
        await invoke(AVOCapability.PROMOTE);
        return { status: "COMMITTED" };
      }
    }
  });

  const harness = createAVOHarness({
    agent,
    verifiers: [verifier],
    environment: environment(),
    objective: {
      async evaluate({ verifications }) {
        const verified = verifications.some((item) =>
          item.claim === "candidate version equals v1" &&
          item.status === VerificationStatus.PASS &&
          item.source.kind === VerificationSourceKind.CAPABILITY
        );
        return {
          validity: EvaluationValidity.VALID,
          verdict: verified ? EvaluationVerdict.PASS : EvaluationVerdict.GAP
        };
      }
    },
    sessionStore: createInMemorySessionStore(),
    supervisor: quietSupervisor(),
    contextProjector: nullProjector(),
    dosagePolicy: noDosage()
  });

  await harness.start({
    sessionId: "automated",
    work: { objective: "turn codified verification into a capability" },
    seedCandidate: { id: "candidate", version: "v0" }
  });

  const variation = await harness.vary("automated");
  assert.equal(variation.lineage.advanced, true);

  const artifacts = await harness.verifications("automated");
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].source.name, capabilityName);

  const evaluations = await harness.evaluations("automated");
  assert.deepEqual(evaluations[0].verificationIds, [artifacts[0].id]);

  const lineage = await harness.lineage("automated");
  assert.deepEqual(lineage.at(-1).verificationIds, [artifacts[0].id]);
});
