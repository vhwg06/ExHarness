import assert from "node:assert/strict";
import test from "node:test";
import {
  AVOCapability,
  VerificationStatus,
  createEvidenceArtifact,
  environmentRefFromValue,
  subjectFromValue,
  verificationCapabilityName
} from "../../core-harness/src/index.js";
import {
  BackendAdvisorAction,
  BackendCompletionAction,
  BackendCompletionReason,
  BackendEvidenceClaim,
  BackendRunAction,
  BackendWorkStatus,
  assessBackendCompletion,
  createBackendAdvisor,
  createBackendWorker,
  defineBackendObjective,
  runBackendObjective
} from "../src/index.js";

function objective() {
  return defineBackendObjective({
    id: "health-endpoint",
    task: "Add a GET /health endpoint without changing the existing /users behavior.",
    repository: {
      ref: "repo://example-backend",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: ["preserve the existing /users response contract"]
  });
}

function repositoryReader() {
  return {
    async readFile({ repositoryRef, revision, path }) {
      return {
        content: `// ${path}\n`,
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function workspace() {
  return {
    async act({ candidate }) {
      return {
        mutated: true,
        candidate: { id: candidate.id, version: "rev-2" },
        result: {
          artifacts: [
            { ref: "workspace://rev-2/src/server.js", path: "src/server.js" },
            { ref: "workspace://rev-2/test/server.test.js", path: "test/server.test.js" }
          ]
        }
      };
    }
  };
}

function verifier(name, claim, status = VerificationStatus.PASS) {
  return {
    name,
    async verify() {
      return {
        claim,
        status,
        evidence: status === VerificationStatus.INCONCLUSIVE ? [] : [`${name}:${status.toLowerCase()}`],
        summary: `${name} ${status.toLowerCase()}`
      };
    }
  };
}

function backendVerifiers({ tests = VerificationStatus.PASS } = {}) {
  return [
    verifier("backend-typecheck", BackendEvidenceClaim.TYPECHECK),
    verifier("backend-tests", BackendEvidenceClaim.TESTS, tests)
  ];
}

function appliedStrategy({ runTypecheck = true, runTests = true, gaps = [] } = {}) {
  return {
    async run({ invoke }) {
      const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
      if (runTypecheck) await invoke(verificationCapabilityName("backend-typecheck"));
      if (runTests) await invoke(verificationCapabilityName("backend-tests"));
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
      return {
        status: BackendWorkStatus.APPLIED,
        summary: "Applied Backend change.",
        revision: action.candidate.version,
        artifacts: action.result.artifacts,
        evidence: [{ fake: "worker prose must not become evidence" }],
        gaps,
        blockers: []
      };
    }
  };
}

function evidenceArtifact(claim, verificationStatus) {
  const subject = subjectFromValue({ revision: "rev-2" }, { type: "backend-candidate" });
  const environment = environmentRefFromValue({ runner: "test" }, { name: "test" });
  return createEvidenceArtifact({
    subject,
    kind: "VERIFICATION",
    producer: { identity: `test:${claim}`, roles: ["verifier"] },
    environment,
    content: { claim, status: verificationStatus },
    metadata: { claim, verificationStatus },
    generatedAt: "2026-09-14T00:00:00.000Z"
  });
}

function appliedResult({ evidence, gaps = [], artifacts = [{ ref: "workspace://rev-2/src/server.js" }] }) {
  return {
    status: BackendWorkStatus.APPLIED,
    summary: "Applied Backend change.",
    revision: "rev-2",
    artifacts,
    evidence,
    gaps,
    blockers: []
  };
}

test("S5 accepts only grounded Backend mutation + typecheck + tests evidence", async () => {
  const worker = createBackendWorker({
    strategy: appliedStrategy(),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });

  const run = await runBackendObjective(objective(), {
    repositoryReader: repositoryReader(),
    backendWorker: worker
  });

  assert.equal(run.result.evidence.length, 3);
  assert.ok(run.result.evidence.every((artifact) => artifact.type === "EVIDENCE"));
  assert.equal(run.completion.action, BackendCompletionAction.ACCEPT);
  assert.equal(run.completion.decision.boundary, "ACCEPTANCE");
  assert.equal(run.decision.action, BackendRunAction.RETURN);
  assert.ok(!run.result.evidence.some((artifact) => artifact.fake));
});

test("S5 missing required evidence deterministically CONTINUEs without pretending success", async () => {
  const worker = createBackendWorker({
    strategy: appliedStrategy({ runTests: false }),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });

  let advisorCalls = 0;
  const advisor = createBackendAdvisor({
    async assess() {
      advisorCalls += 1;
      throw new Error("advisor must not be used for deterministic missing evidence");
    }
  });

  const run = await runBackendObjective(objective(), {
    repositoryReader: repositoryReader(),
    backendWorker: worker,
    backendAdvisor: advisor
  });

  assert.equal(run.completion.action, BackendCompletionAction.CONTINUE);
  assert.deepEqual(run.completion.missingEvidenceClaims, [BackendEvidenceClaim.TESTS]);
  assert.ok(run.completion.reasons.includes(BackendCompletionReason.MISSING_EVIDENCE));
  assert.equal(run.decision.action, BackendRunAction.CONTINUE);
  assert.equal(run.advisory, null);
  assert.equal(advisorCalls, 0);
});

test("S5 failed Backend verification is a deterministic FAIL", () => {
  const result = appliedResult({
    evidence: [
      evidenceArtifact(BackendEvidenceClaim.MUTATION, "PASS"),
      evidenceArtifact(BackendEvidenceClaim.TYPECHECK, "PASS"),
      evidenceArtifact(BackendEvidenceClaim.TESTS, "FAIL")
    ]
  });

  const completion = assessBackendCompletion(result, { generatedAt: "2026-09-14T00:00:01.000Z" });

  assert.equal(completion.action, BackendCompletionAction.FAIL);
  assert.deepEqual(completion.failedEvidenceClaims, [BackendEvidenceClaim.TESTS]);
  assert.ok(completion.reasons.includes(BackendCompletionReason.FAILED_EVIDENCE));
});

test("S5 unresolved semantic gaps remain CONTINUE after all objective Backend checks pass", () => {
  const result = appliedResult({
    evidence: [
      evidenceArtifact(BackendEvidenceClaim.MUTATION, "PASS"),
      evidenceArtifact(BackendEvidenceClaim.TYPECHECK, "PASS"),
      evidenceArtifact(BackendEvidenceClaim.TESTS, "PASS")
    ],
    gaps: [{ id: "gap-compat", summary: "Compatibility risk depends on an unstated client expectation." }]
  });

  const completion = assessBackendCompletion(result, { generatedAt: "2026-09-14T00:00:01.000Z" });

  assert.equal(completion.action, BackendCompletionAction.CONTINUE);
  assert.ok(completion.reasons.includes(BackendCompletionReason.UNRESOLVED_GAPS));
});

test("S6 invokes BackendAdvisor only for the observed unresolved-gap judgment boundary", async () => {
  let advisorCalls = 0;
  const advisor = createBackendAdvisor({
    async assess({ result, completion }) {
      advisorCalls += 1;
      assert.equal(completion.action, BackendCompletionAction.CONTINUE);
      assert.equal(result.gaps[0].id, "gap-compat");
      return {
        action: BackendAdvisorAction.RETRY_IMPLEMENTATION,
        gapIds: ["gap-compat"],
        rationale: "Reduce the compatibility risk by preserving the previous response shape exactly."
      };
    }
  });

  const worker = createBackendWorker({
    strategy: appliedStrategy({
      gaps: [{ id: "gap-compat", summary: "Compatibility risk depends on an unstated client expectation." }]
    }),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });

  const run = await runBackendObjective(objective(), {
    repositoryReader: repositoryReader(),
    backendWorker: worker,
    backendAdvisor: advisor
  });

  assert.equal(advisorCalls, 1);
  assert.equal(run.advisory.action, BackendAdvisorAction.RETRY_IMPLEMENTATION);
  assert.equal(run.decision.action, BackendRunAction.RETRY);
  assert.equal(run.completion.action, BackendCompletionAction.CONTINUE);
});

test("S6 rejects Advisor proposals that escape the bounded gap set", async () => {
  const advisor = createBackendAdvisor({
    async assess() {
      return {
        action: BackendAdvisorAction.ESCALATE,
        gapIds: ["invented-gap"],
        rationale: "Escalate an invented issue."
      };
    }
  });

  const worker = createBackendWorker({
    strategy: appliedStrategy({ gaps: [{ id: "gap-real", summary: "A real unresolved semantic gap." }] }),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });

  await assert.rejects(
    () => runBackendObjective(objective(), {
      repositoryReader: repositoryReader(),
      backendWorker: worker,
      backendAdvisor: advisor
    }),
    /BackendAdvisor proposal references unknown gap: invented-gap/
  );
});
