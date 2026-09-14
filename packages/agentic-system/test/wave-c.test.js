import assert from "node:assert/strict";
import test from "node:test";
import {
  AVOCapability,
  EvaluationVerdict,
  VerificationStatus,
  verificationCapabilityName
} from "../../core-harness/src/index.js";
import * as agenticSystem from "../src/index.js";
import {
  BackendCompletionAction,
  BackendEvidenceClaim,
  BackendRunAction,
  BackendWorkStatus,
  QaCompletionAction,
  QaEvidenceClaim,
  QaRunAction,
  QaWorkStatus,
  createBackendWorker,
  createQaHandoffFromBackendRun,
  createQaWorker,
  defineBackendObjective,
  defineQaObjective,
  makeQaWorkOrder,
  resolveQaContext,
  runBackendThenQaObjective,
  runQaObjective
} from "../src/index.js";

function backendObjective() {
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

function qaObjective() {
  return defineQaObjective({
    id: "health-endpoint-qa",
    task: "Verify the new health endpoint and regression-check the existing users behavior.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: [
      "GET /health returns the expected healthy response",
      "GET /users preserves the existing response contract"
    ]
  });
}

function repositoryReader() {
  return {
    async readFile({ repositoryRef, revision, path }) {
      return {
        content: `// source ${path}\n`,
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

function backendVerifiers() {
  return [
    verifier("backend-typecheck", BackendEvidenceClaim.TYPECHECK),
    verifier("backend-tests", BackendEvidenceClaim.TESTS)
  ];
}

function qaVerifiers() {
  return [
    verifier("qa-behavior", QaEvidenceClaim.BEHAVIOR),
    verifier("qa-regression", QaEvidenceClaim.REGRESSION)
  ];
}

function backendStrategy({ runTests = true } = {}) {
  return {
    async run({ invoke }) {
      const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
      await invoke(verificationCapabilityName("backend-typecheck"));
      if (runTests) await invoke(verificationCapabilityName("backend-tests"));
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
      await invoke(AVOCapability.PROMOTE);
      return {
        status: BackendWorkStatus.APPLIED,
        summary: "Applied Backend change.",
        revision: action.candidate.version,
        artifacts: action.result.artifacts,
        gaps: [],
        blockers: []
      };
    }
  };
}

function qaStrategy({ mutate = false, status = QaWorkStatus.VERIFIED } = {}) {
  return {
    async run({ input, invoke }) {
      assert.equal(input.work.kind, "QA");
      assert.equal(input.work.context.upstream.revision, "rev-2");
      assert.equal(input.work.context.artifacts.length, 2);
      assert.match(input.work.context.artifacts[0].content, /resolved artifact/);

      if (mutate) {
        await invoke(AVOCapability.ACT, { kind: "MUTATE_QA_TARGET" });
      }

      await invoke(verificationCapabilityName("qa-behavior"));
      await invoke(verificationCapabilityName("qa-regression"));
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);

      return {
        status,
        summary: status === QaWorkStatus.ISSUES_FOUND ? "Regression issue found." : "QA checks passed.",
        verifiedRevision: "rev-2",
        inspectedArtifacts: [{ ref: "fake://worker-claimed-artifact" }],
        evidence: [{ fake: "worker evidence must be discarded" }],
        issues: status === QaWorkStatus.ISSUES_FOUND ? ["/users response changed"] : [],
        blockers: []
      };
    }
  };
}

function acceptedBackendRun() {
  return {
    order: { id: "health-endpoint:backend" },
    result: {
      revision: "rev-2",
      artifacts: [
        { ref: "workspace://rev-2/src/server.js", path: "src/server.js" },
        { ref: "workspace://rev-2/test/server.test.js", path: "test/server.test.js" }
      ]
    },
    completion: {
      action: BackendCompletionAction.ACCEPT,
      decision: {
        id: "decision:backend-accept",
        digest: "sha256:backend-accept"
      }
    }
  };
}

function artifactReader({ seen = [] } = {}) {
  const contents = new Map([
    ["workspace://rev-2/src/server.js", "resolved artifact: server\n"],
    ["workspace://rev-2/test/server.test.js", "resolved artifact: tests\n"]
  ]);
  return {
    async readArtifact(request) {
      seen.push(request);
      if (!contents.has(request.ref)) throw new Error(`artifact not found: ${request.ref}`);
      return {
        content: contents.get(request.ref),
        sourceRef: `application-artifact:${request.ref}`
      };
    }
  };
}

test("S7 adds a real non-mutating QA role with role-specific evidence semantics", async () => {
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());
  const qaWorker = createQaWorker({ strategy: qaStrategy(), verifiers: qaVerifiers() });

  const run = await runQaObjective(qaObjective(), {
    handoff,
    artifactReader: artifactReader(),
    qaWorker
  });

  assert.equal(run.result.status, QaWorkStatus.VERIFIED);
  assert.equal(run.result.verifiedRevision, "rev-2");
  assert.deepEqual(run.result.inspectedArtifacts, handoff.artifacts);
  assert.equal(run.result.evidence.length, 2);
  assert.deepEqual(
    run.result.evidence.map((artifact) => artifact.metadata.claim).sort(),
    [QaEvidenceClaim.BEHAVIOR, QaEvidenceClaim.REGRESSION].sort()
  );
  assert.ok(!run.result.evidence.some((artifact) => artifact.metadata.claim === BackendEvidenceClaim.MUTATION));
  assert.equal(run.completion.action, QaCompletionAction.ACCEPT);
  assert.equal(run.decision.action, QaRunAction.RETURN);
});

test("S7 keeps QA non-mutating instead of forcing Backend Worker semantics into a generic Worker", async () => {
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());
  const order = makeQaWorkOrder(qaObjective(), handoff);
  const context = await resolveQaContext(order, { artifactReader: artifactReader() });
  const qaWorker = createQaWorker({ strategy: qaStrategy({ mutate: true }), verifiers: qaVerifiers() });

  await assert.rejects(
    () => qaWorker.execute(order, context),
    /QaWorker ExHarness execution failed: QaWorker is non-mutating and cannot invoke environment actions/
  );

  assert.equal("createWorker" in agenticSystem, false);
  assert.equal("createOrchestrator" in agenticSystem, false);
  assert.equal("WorkOrderSchema" in agenticSystem, false);
});

test("S7 keeps QA issue handling role-specific and deterministic", async () => {
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());
  const qaWorker = createQaWorker({
    strategy: qaStrategy({ status: QaWorkStatus.ISSUES_FOUND }),
    verifiers: qaVerifiers()
  });

  const run = await runQaObjective(qaObjective(), {
    handoff,
    artifactReader: artifactReader(),
    qaWorker
  });

  assert.equal(run.completion.action, QaCompletionAction.CONTINUE);
  assert.equal(run.decision.action, QaRunAction.CONTINUE);
  assert.deepEqual(run.result.issues, ["/users response changed"]);
});

test("S8 Backend -> QA handoff stores artifact refs and acceptance provenance, not artifact payloads", () => {
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());

  assert.deepEqual(handoff.artifacts, [
    { ref: "workspace://rev-2/src/server.js", path: "src/server.js" },
    { ref: "workspace://rev-2/test/server.test.js", path: "test/server.test.js" }
  ]);
  assert.equal(JSON.stringify(handoff).includes("resolved artifact"), false);
  assert.deepEqual(handoff.acceptanceDecision, {
    id: "decision:backend-accept",
    digest: "sha256:backend-accept"
  });
});

test("S8 Oracle dereferences only declared internal application artifacts and preserves provenance", async () => {
  const seen = [];
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());
  const order = makeQaWorkOrder(qaObjective(), handoff);
  const context = await resolveQaContext(order, { artifactReader: artifactReader({ seen }) });

  assert.deepEqual(seen.map((request) => request.ref), handoff.artifacts.map((artifact) => artifact.ref));
  assert.equal(context.artifacts[0].provenance.sourceClass, "APPLICATION_ARTIFACT");
  assert.equal(context.artifacts[0].provenance.producerWorkOrderId, "health-endpoint:backend");
  assert.deepEqual(context.artifacts[0].provenance.acceptanceDecision, handoff.acceptanceDecision);
  assert.equal(context.artifacts[0].sourceRef, "application-artifact:workspace://rev-2/src/server.js");
});

test("S8 reports the internal artifact source boundary on dereference failure", async () => {
  const handoff = createQaHandoffFromBackendRun(acceptedBackendRun());
  const order = makeQaWorkOrder(qaObjective(), handoff);

  await assert.rejects(
    () => resolveQaContext(order, {
      artifactReader: {
        async readArtifact({ ref }) {
          throw new Error(`gone: ${ref}`);
        }
      }
    }),
    /qa context resolution failed for workspace:\/\/rev-2\/src\/server\.js from application artifact store: gone:/
  );
});

test("Wave C composes accepted Backend work into QA through ref-only artifact handoff", async () => {
  const backendWorker = createBackendWorker({
    strategy: backendStrategy(),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });
  const qaWorker = createQaWorker({ strategy: qaStrategy(), verifiers: qaVerifiers() });

  const run = await runBackendThenQaObjective({
    backendObjective: backendObjective(),
    qaObjective: qaObjective()
  }, {
    repositoryReader: repositoryReader(),
    artifactReader: artifactReader(),
    backendWorker,
    qaWorker
  });

  assert.equal(run.backend.completion.action, BackendCompletionAction.ACCEPT);
  assert.equal(run.backend.decision.action, BackendRunAction.RETURN);
  assert.ok(run.handoff);
  assert.equal(run.qa.completion.action, QaCompletionAction.ACCEPT);
  assert.equal(run.decision.stage, "QA");
  assert.equal(run.decision.action, QaRunAction.RETURN);
});

test("Wave C does not dispatch QA when Backend completion is not accepted", async () => {
  const backendWorker = createBackendWorker({
    strategy: backendStrategy({ runTests: false }),
    workspace: workspace(),
    verifiers: backendVerifiers()
  });
  let qaCalls = 0;

  const run = await runBackendThenQaObjective({
    backendObjective: backendObjective(),
    qaObjective: qaObjective()
  }, {
    repositoryReader: repositoryReader(),
    artifactReader: artifactReader(),
    backendWorker,
    qaWorker: {
      async execute() {
        qaCalls += 1;
        throw new Error("QA must not run before Backend acceptance");
      }
    }
  });

  assert.equal(run.backend.completion.action, BackendCompletionAction.CONTINUE);
  assert.equal(run.handoff, null);
  assert.equal(run.qa, null);
  assert.equal(run.decision.stage, "BACKEND");
  assert.equal(run.decision.action, BackendRunAction.CONTINUE);
  assert.equal(qaCalls, 0);
});

test("S8 rejects a QA semantic need when the accepted Backend handoff lacks its required artifact", () => {
  const handoff = createQaHandoffFromBackendRun({
    ...acceptedBackendRun(),
    result: {
      revision: "rev-2",
      artifacts: [{ ref: "workspace://rev-2/src/server.js", path: "src/server.js" }]
    }
  });

  assert.throws(
    () => makeQaWorkOrder(qaObjective(), handoff),
    /QA handoff missing required artifact path: test\/server\.test\.js/
  );
});
