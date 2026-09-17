import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WorkSelectionSignalSource,
  createBoundedProjectWorkSelector,
  createJsonWorkSelectionDecisionStore
} from "../src/index.js";

const POLICY = Object.freeze({
  name: "bounded-project-selection",
  revision: "1",
  configurationRef: "config://bb031/reference-v1",
  selectionBudget: 5,
  maxDeferrals: 3,
  retryCeiling: 2,
  plateauWindow: 2
});

const ITEM = Object.freeze({
  id: "A",
  work: "Work A",
  status: "READY",
  dependsOn: [],
  remainingWork: [],
  blockers: [],
  artifactRefs: [],
  evidenceRefs: [],
  followUpRefs: [],
  reviewRequirements: [],
  reviews: [],
  findings: []
});

const HANDOFF = Object.freeze({
  version: 1,
  projectId: "project-bb031-freshness",
  rootItemId: "intent-root",
  intent: {
    id: "intent-root",
    source: "USER",
    objective: "Keep project work selection bounded and fresh.",
    bullets: ["Do not reuse stale scheduling evidence."],
    constraints: ["Blackboard remains lifecycle authority."]
  },
  workGraph: [ITEM],
  lifecycle: {
    eligibleWork: [ITEM],
    claimedWork: [],
    pendingReview: [],
    reviewing: [],
    pendingReconciliation: [],
    blockedWork: [],
    doneWork: []
  },
  references: { artifacts: [], evidence: [] }
});

function signal(value, source, evidenceRef = null) {
  return { value, source, ...(evidenceRef == null ? {} : { evidenceRef }) };
}

function measurement(overrides = {}) {
  return {
    itemId: "A",
    userPriority: "P1",
    mandatoryObligations: [],
    deferrals: 0,
    signals: {
      userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED, "estimate://A/impact-v1"),
      defectSeverity: signal(3, WorkSelectionSignalSource.OBSERVED, "evidence://A/severity-v1"),
      dependencyUnblocks: signal(1, WorkSelectionSignalSource.OBSERVED, "board://A/dependents-v1"),
      evidenceConfidence: signal(0.9, WorkSelectionSignalSource.OBSERVED, "evidence://A/confidence-v1"),
      cost: signal(1, WorkSelectionSignalSource.OBSERVED, "run://A/cost-v1")
    },
    ...overrides
  };
}

function handoffSurface() {
  return {
    async read() {
      return structuredClone(HANDOFF);
    }
  };
}

async function withSelectors(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb031-freshness-"));
  try {
    const decisionStore = createJsonWorkSelectionDecisionStore({ path: join(directory, "decisions") });
    const selector = createBoundedProjectWorkSelector({
      handoffSurface: handoffSurface(),
      decisionStore,
      policy: POLICY
    });
    await run({ decisionStore, selector });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const BASE_BUDGET = Object.freeze({ limit: 5, observedSpent: 0 });

test("BB-031 freshness accepts only the same Board plus current scheduling inputs", async () => {
  await withSelectors(async ({ selector }) => {
    const measurements = [measurement()];
    const proposed = await selector.propose({ measurements, budget: BASE_BUDGET });

    assert.equal(proposed.decision.freshnessSubject?.version, 1);
    await selector.assertFresh(proposed.decisionRef, {
      measurements,
      budget: BASE_BUDGET
    });

    await assert.rejects(
      () => selector.assertFresh(proposed.decisionRef),
      /current scheduling measurements are required/
    );
  });
});

test("BB-031 freshness fails when measurement or evidence input changes while Board is unchanged", async () => {
  await withSelectors(async ({ selector }) => {
    const proposed = await selector.propose({
      measurements: [measurement()],
      budget: BASE_BUDGET
    });

    await assert.rejects(
      () => selector.assertFresh(proposed.decisionRef, {
        measurements: [measurement({
          signals: {
            ...measurement().signals,
            evidenceConfidence: signal(0.6, WorkSelectionSignalSource.OBSERVED, "evidence://A/confidence-v2")
          }
        })],
        budget: BASE_BUDGET
      }),
      /scheduling measurement\/budget inputs changed/
    );
  });
});

test("BB-031 freshness fails when budget changes while Board is unchanged", async () => {
  await withSelectors(async ({ selector }) => {
    const measurements = [measurement()];
    const proposed = await selector.propose({ measurements, budget: BASE_BUDGET });

    await assert.rejects(
      () => selector.assertFresh(proposed.decisionRef, {
        measurements,
        budget: { limit: 5, observedSpent: 2 }
      }),
      /scheduling measurement\/budget inputs changed/
    );
  });
});

test("BB-031 freshness fails when selector policy/config changes while Board and measurements are unchanged", async () => {
  await withSelectors(async ({ selector, decisionStore }) => {
    const measurements = [measurement()];
    const proposed = await selector.propose({ measurements, budget: BASE_BUDGET });
    const changedPolicySelector = createBoundedProjectWorkSelector({
      handoffSurface: handoffSurface(),
      decisionStore,
      policy: {
        ...POLICY,
        revision: "2",
        configurationRef: "config://bb031/reference-v2",
        maxDeferrals: 4
      }
    });

    await assert.rejects(
      () => changedPolicySelector.assertFresh(proposed.decisionRef, {
        measurements,
        budget: BASE_BUDGET
      }),
      /selector policy\/configuration changed/
    );
  });
});
