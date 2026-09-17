import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BlackboardStatus,
  createApplicationOrchestrator,
  createDecisionOutcomeBackendQaPilot,
  createJsonBlackboardStore,
  createJsonDecisionOutcomeSummaryStore
} from "../src/index.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function workItem(id = "BB-029-PILOT") {
  return {
    id,
    work: "Deliver one Backend/QA remediation with a bounded decision/outcome summary.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function submission() {
  return {
    kind: "BACKEND_QA_WORKFLOW",
    version: 1,
    stage: "QA_COMPLETED",
    acceptedRevision: "rev-2",
    workflowSpec: {
      backendObjective: {
        id: "cache-remediation",
        task: "Repair the QA-observed stale cache behavior.",
        repository: { ref: "repo://backend", revision: "rev-1" }
      },
      qaObjective: { id: "cache-remediation-qa" }
    },
    workflowAttempt: 1,
    acceptedBackendHandoff: { revision: "rev-2", artifacts: [] },
    backendAcceptanceDecision: { id: "decision:backend", digest: "sha256:backend" },
    qaAcceptanceDecision: { id: "decision:qa", digest: "sha256:qa" },
    artifactRefs: ["workspace://rev-2/cache.js"],
    evidenceRefs: ["decision:backend", "decision:qa"]
  };
}

function chain() {
  return {
    deliberationRef: { kind: "DELIBERATION", id: "delib-1" },
    actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1", revision: 3 },
    evaluationRef: { kind: "EVALUATION", id: "qa-eval-v2" },
    intentRef: { kind: "MEMORY", id: "memory-intent-1", revision: 1 },
    reflectionRef: { kind: "MEMORY", id: "memory-reflection-1", revision: 1 },
    groundingRef: { kind: "GROUNDING", id: "ground-1" },
    alignmentRef: { kind: "INTENT_REFLECTION_ALIGNMENT", id: "align-1" },
    counterEvidenceRefs: [{ kind: "EVALUATION", id: "qa-eval-v2" }]
  };
}

function artifactMap() {
  return new Map([
    ["DELIBERATION:delib-1", {
      id: "delib-1",
      artifactRef: { kind: "DELIBERATION", id: "delib-1" },
      judgment: {
        hypothesis: "Cache key is not invalidated after write.",
        alternatives: ["Invalidate after write", "Shorten TTL", "Bypass cache for the affected read"],
        selected: "Invalidate after write",
        rationale: "Targets the observed stale-read path without globally reducing cache effectiveness.",
        uncertainty: "The write path may have a second invalidation owner."
      },
      actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1" }
    }],
    ["ACTION_INTENT:intent-1", {
      id: "intent-1",
      artifactRef: { kind: "ACTION_INTENT", id: "intent-1" },
      deliberationRef: { kind: "DELIBERATION", id: "delib-1" },
      action: { target: "CAPABILITY", name: "repo.patch", input: { file: "cache.js" } },
      status: "EXECUTED",
      authorization: {
        decision: "ALLOW",
        reason: "Scoped remediation is authorized.",
        evidenceRefs: [{ kind: "EVALUATION", id: "qa-eval-v1" }],
        policy: { name: "backend-remediation-policy", revision: "3" }
      },
      outcomeRefs: [
        { kind: "EFFECT_OPERATION", id: "effect-1" },
        { kind: "REPOSITORY_REVISION", id: "rev-2" }
      ],
      revision: 3
    }],
    ["EFFECT_OPERATION:effect-1", {
      operationId: "effect-1",
      status: "CONFIRMED",
      actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1" },
      resultRef: { kind: "REPOSITORY_REVISION", id: "rev-2" }
    }],
    ["EVALUATION:qa-eval-v2", {
      id: "qa-eval-v2",
      validity: "VALID",
      verdict: "GAP",
      candidate: { id: "repo://backend", version: "rev-2" },
      findings: ["A second write path is still stale."]
    }],
    ["MEMORY:memory-intent-1", {
      id: "memory-intent-1",
      kind: "INTENT",
      status: "ACTIVE",
      revision: 1,
      content: "Fix stale cache behavior in this remediation attempt."
    }],
    ["MEMORY:memory-reflection-1", {
      id: "memory-reflection-1",
      kind: "REFLECTION",
      status: "ACTIVE",
      revision: 1,
      content: "The selected invalidation fixes one path but the QA regression still reports a second stale path.",
      sourceRefs: [
        { kind: "MEMORY", id: "memory-intent-1", revision: 1 },
        { kind: "EVALUATION", id: "qa-eval-v2" },
        { kind: "EXTERNAL", id: "grounding:ground-1" }
      ]
    }],
    ["GROUNDING:ground-1", {
      id: "ground-1",
      artifactRef: { kind: "GROUNDING", id: "ground-1" },
      sourceSnapshots: [
        { ref: { kind: "MEMORY", id: "memory-intent-1", revision: 1 }, revision: 1, digest: "sha256:intent" },
        { ref: { kind: "EVALUATION", id: "qa-eval-v2" }, revision: null, digest: "sha256:evaluation" }
      ],
      verdict: "GROUNDED"
    }],
    ["INTENT_REFLECTION_ALIGNMENT:align-1", {
      id: "align-1",
      artifactRef: { kind: "INTENT_REFLECTION_ALIGNMENT", id: "align-1" },
      intentRef: { kind: "MEMORY", id: "memory-intent-1", revision: 1 },
      reflectionRef: { kind: "MEMORY", id: "memory-reflection-1", revision: 1 },
      groundingRef: { kind: "GROUNDING", id: "ground-1" },
      evaluationRefs: [{ kind: "EVALUATION", id: "qa-eval-v2" }],
      status: "DIVERGED",
      divergence: 0.75
    }]
  ]);
}

function artifactResolver(artifacts) {
  return {
    async readArtifact({ ref }) {
      const artifact = artifacts.get(`${ref.kind}:${ref.id}`);
      if (artifact == null) throw new Error(`artifact unavailable: ${ref.kind}:${ref.id}`);
      return structuredClone(artifact);
    }
  };
}

function fallbackApplicationReader() {
  return {
    async readArtifact({ ref }) {
      return { content: `fallback:${ref}\n`, sourceRef: `application:${ref}` };
    }
  };
}

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb029-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const summariesPath = join(directory, "decision-outcome");
    const baseOrchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
    await baseOrchestrator.seed([workItem()]);
    const artifacts = artifactMap();
    const resolver = artifactResolver(artifacts);
    const summaryStore = createJsonDecisionOutcomeSummaryStore({ path: summariesPath });
    const pilot = createDecisionOutcomeBackendQaPilot({
      chainProvider: { async resolve() { return chain(); } },
      artifactResolver: resolver,
      summaryStore
    });
    await run({ directory, summariesPath, baseOrchestrator, artifacts, resolver, summaryStore, pilot });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-029 materializes a ref-only decision/outcome summary before QA submission and fresh sessions verify exact source pins", async () => {
  await withFixture(async ({ summariesPath, baseOrchestrator, resolver, pilot }) => {
    const orchestrator = pilot.decorateOrchestrator(baseOrchestrator);
    const claimed = await orchestrator.claim({ itemId: "BB-029-PILOT", owner: "backend-qa-session-a" });
    await orchestrator.submit({
      itemId: "BB-029-PILOT",
      owner: "backend-qa-session-a",
      generation: claimed.result.claimGeneration,
      submission: submission()
    });

    const board = await baseOrchestrator.readBlackboard();
    const item = board.items[0];
    assert.equal(item.status, BlackboardStatus.PENDING_REVIEW);
    assert.match(item.submission.decisionOutcomeSummaryRef, /^decision-outcome:\/\/[0-9a-f]{64}$/);
    assert.ok(item.submission.artifactRefs.includes(item.submission.decisionOutcomeSummaryRef));

    const freshStore = createJsonDecisionOutcomeSummaryStore({ path: summariesPath });
    const freshPilot = createDecisionOutcomeBackendQaPilot({
      chainProvider: { async resolve() { return chain(); } },
      artifactResolver: resolver,
      summaryStore: freshStore
    });
    const freshReader = freshPilot.createApplicationArtifactReader(fallbackApplicationReader());
    const resolved = await freshReader.readArtifact({ ref: item.submission.decisionOutcomeSummaryRef });
    const summary = JSON.parse(resolved.content);
    assert.equal(summary.workItemId, "BB-029-PILOT");
    assert.equal(summary.workflow.baselineRevision, "rev-1");
    assert.equal(summary.workflow.acceptedRevision, "rev-2");
    assert.equal(summary.decision.selected, "Invalidate after write");
    assert.equal(summary.action.authorization.decision, "ALLOW");
    assert.equal(summary.observedOutcome.status, "PARTIAL_FAILURE");
    assert.equal(summary.reflection.status, "DIVERGED");
    assert.equal(summary.authority.summaryIsAcceptanceAuthority, false);
  });
});

test("BB-029 fresh-session summary verification fails closed when an underlying exact ref changes or disappears", async () => {
  await withFixture(async ({ summariesPath, baseOrchestrator, artifacts, resolver, pilot }) => {
    const orchestrator = pilot.decorateOrchestrator(baseOrchestrator);
    const claimed = await orchestrator.claim({ itemId: "BB-029-PILOT", owner: "backend-qa-session-a" });
    await orchestrator.submit({
      itemId: "BB-029-PILOT",
      owner: "backend-qa-session-a",
      generation: claimed.result.claimGeneration,
      submission: submission()
    });
    const ref = (await baseOrchestrator.readBlackboard()).items[0].submission.decisionOutcomeSummaryRef;

    const freshStore = createJsonDecisionOutcomeSummaryStore({ path: summariesPath });
    const freshPilot = createDecisionOutcomeBackendQaPilot({
      chainProvider: { async resolve() { return chain(); } },
      artifactResolver: resolver,
      summaryStore: freshStore
    });
    const reader = freshPilot.createApplicationArtifactReader(fallbackApplicationReader());

    const changed = structuredClone(artifacts.get("EVALUATION:qa-eval-v2"));
    changed.verdict = "PASS";
    artifacts.set("EVALUATION:qa-eval-v2", changed);
    await assert.rejects(() => reader.readArtifact({ ref }), /evaluation changed after summary materialization/);

    artifacts.set("EVALUATION:qa-eval-v2", artifactMap().get("EVALUATION:qa-eval-v2"));
    artifacts.delete("MEMORY:memory-reflection-1");
    await assert.rejects(() => reader.readArtifact({ ref }), /artifact unavailable: MEMORY:memory-reflection-1/);
  });
});

test("BB-029 invalid decision chains block the Board before submission instead of leaving an ambiguous CLAIMED item", async () => {
  await withFixture(async ({ baseOrchestrator, resolver, summaryStore }) => {
    const pilot = createDecisionOutcomeBackendQaPilot({
      chainProvider: {
        async resolve() {
          return { ...chain(), actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1", revision: 99 } };
        }
      },
      artifactResolver: resolver,
      summaryStore
    });
    const orchestrator = pilot.decorateOrchestrator(baseOrchestrator);
    const claimed = await orchestrator.claim({ itemId: "BB-029-PILOT", owner: "backend-qa-session-a" });
    await assert.rejects(
      () => orchestrator.submit({
        itemId: "BB-029-PILOT",
        owner: "backend-qa-session-a",
        generation: claimed.result.claimGeneration,
        submission: submission()
      }),
      /ActionIntent revision mismatch/
    );
    const item = (await baseOrchestrator.readBlackboard()).items[0];
    assert.equal(item.status, BlackboardStatus.BLOCKED);
    assert.equal(item.owner, null);
    assert.match(item.blockers[0], /Decision\/outcome summary materialization failed/);
    assert.equal(item.submission, null);
  });
});
