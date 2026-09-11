import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  FeedbackKind,
  KnowledgeKind,
  KnowledgeRelationType,
  KnowledgeScope,
  VariationOutcome,
  createAVOHarness,
  createInMemorySessionStore
} from "../src/index.js";

function createHarness(strategy = { async run() { return null; } }) {
  return createAVOHarness({
    strategy,
    environment: {
      async observe({ request }) {
        return { observed: request ?? null };
      },
      async act({ candidate, action }) {
        if (action?.mutated === false) {
          return { mutated: false, candidate, result: { noop: true } };
        }
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: { applied: action.nextVersion }
        };
      }
    },
    objective: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.PASS
        };
      }
    },
    sessionStore: createInMemorySessionStore(),
    contextProjector: {
      async project() {
        return null;
      }
    },
    supervisor: {
      async inspect() {
        return null;
      }
    },
    dosagePolicy: {
      async decide() {
        return { enabled: false, reason: "disabled for persistent-memory tests" };
      }
    }
  });
}

async function start(harness, sessionId = "s1") {
  await harness.start({
    sessionId,
    work: { objective: "exercise persistent memory" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

test("feedback is a grounded projection and candidate filtering excludes stale feedback", async () => {
  const harness = createHarness();
  await start(harness);

  const oldObservation = await harness.observe("s1", { phase: "v0" });
  await harness.act("s1", { nextVersion: "v1" });
  const newObservation = await harness.observe("s1", { phase: "v1" });
  await harness.evaluate("s1");

  const all = await harness.feedback("s1", { limit: 20 });
  const current = await harness.feedback("s1", { currentCandidateOnly: true, limit: 20 });

  assert.ok(all.some((item) => item.id === `observation:${oldObservation.id}`));
  assert.ok(all.some((item) => item.id === `observation:${newObservation.id}`));
  assert.ok(all.some((item) => item.kind === FeedbackKind.ACTION_RESULT));
  assert.ok(all.some((item) => item.kind === FeedbackKind.EVALUATION));

  assert.equal(current.some((item) => item.id === `observation:${oldObservation.id}`), false);
  assert.equal(current.some((item) => item.id === `observation:${newObservation.id}`), true);
});

test("candidate-scoped knowledge expires from the active view while session knowledge persists", async () => {
  const harness = createHarness();
  await start(harness);

  const observation = await harness.observe("s1", { inspect: "candidate" });
  const feedbackRef = `observation:${observation.id}`;

  const candidateFinding = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.FINDING,
    statement: "v0 has the observed property",
    feedbackRefs: [feedbackRef]
  });
  const sessionHypothesis = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "the search space may contain a cheaper direction",
    scope: KnowledgeScope.SESSION
  });

  let view = await harness.knowledgeView("s1");
  assert.deepEqual(view.active.map((item) => item.id), [candidateFinding.id, sessionHypothesis.id]);

  await harness.act("s1", { nextVersion: "v1" });
  view = await harness.knowledgeView("s1");

  assert.equal(view.active.some((item) => item.id === candidateFinding.id), false);
  assert.equal(view.active.some((item) => item.id === sessionHypothesis.id), true);
  assert.equal((await harness.knowledge("s1")).length, 2);
});

test("lineage knowledge can be corrected after a commit without erasing history", async () => {
  const harness = createHarness();
  await start(harness);

  const original = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "direction A is promising",
    scope: KnowledgeScope.LINEAGE,
    tags: ["direction-a"]
  });

  await harness.act("s1", { nextVersion: "v1" });
  const evaluation = await harness.evaluate("s1");
  await harness.promote("s1");

  const corrected = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.DECISION,
    statement: "direction A should be abandoned after the committed result",
    scope: KnowledgeScope.LINEAGE,
    feedbackRefs: [`evaluation:${evaluation.id}`],
    relations: [{ type: KnowledgeRelationType.SUPERSEDES, targetId: original.id }],
    tags: ["direction-a"]
  });

  const view = await harness.knowledgeView("s1", { tags: ["direction-a"] });
  const history = await harness.knowledge("s1");

  assert.equal(history.length, 2);
  assert.deepEqual(view.active.map((item) => item.id), [corrected.id]);
  assert.equal(view.counts.superseded, 1);
});

test("ungrounded assertions cannot supersede active knowledge", async () => {
  const harness = createHarness();
  await start(harness);

  const original = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "retain until corrected with evidence",
    scope: KnowledgeScope.SESSION
  });

  await assert.rejects(
    () => harness.recordKnowledge("s1", {
      kind: KnowledgeKind.DECISION,
      statement: "erase the old claim",
      scope: KnowledgeScope.SESSION,
      relations: [{ type: KnowledgeRelationType.SUPERSEDES, targetId: original.id }]
    }),
    /superseding knowledge requires evidence or feedbackRefs/
  );

  const view = await harness.knowledgeView("s1");
  assert.deepEqual(view.active.map((item) => item.id), [original.id]);
});

test("contradictory active knowledge is surfaced instead of choosing a winner", async () => {
  const harness = createHarness();
  await start(harness);

  const left = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "A is faster",
    scope: KnowledgeScope.SESSION
  });
  const right = await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "A is slower",
    scope: KnowledgeScope.SESSION,
    relations: [{ type: KnowledgeRelationType.CONTRADICTS, targetId: left.id }]
  });

  const view = await harness.knowledgeView("s1");
  assert.equal(view.active.length, 2);
  assert.equal(view.conflicts.length, 1);
  assert.deepEqual(new Set([view.conflicts[0].leftId, view.conflicts[0].rightId]), new Set([left.id, right.id]));
});

test("knowledge provenance cannot reference feedback that does not exist", async () => {
  const harness = createHarness();
  await start(harness);

  await assert.rejects(
    () => harness.recordKnowledge("s1", {
      kind: KnowledgeKind.FINDING,
      statement: "ungrounded claim",
      feedbackRefs: ["observation:missing"]
    }),
    /feedback reference not found/
  );
});

test("agent queries K and feedback through model-callable APIs instead of receiving the raw stores", async () => {
  let seenInput = null;
  const harness = createHarness({
    async run({ input, invoke }) {
      seenInput = input;
      const feedback = await invoke(AVOCapability.QUERY_FEEDBACK, { limit: 10 });
      const knowledge = await invoke(AVOCapability.QUERY_KNOWLEDGE, { limit: 10 });
      return {
        feedbackCount: feedback.length,
        knowledgeCount: knowledge.active.length
      };
    }
  });
  await start(harness);

  await harness.observe("s1", { inspect: true });
  await harness.recordKnowledge("s1", {
    kind: KnowledgeKind.HYPOTHESIS,
    statement: "retain this session hypothesis",
    scope: KnowledgeScope.SESSION
  });

  const result = await harness.vary("s1");

  assert.equal(result.result.feedbackCount > 0, true);
  assert.equal(result.result.knowledgeCount, 1);
  assert.equal(result.variation.outcome, VariationOutcome.NO_CHANGE);
  assert.equal("persistentMemory" in seenInput, false);
  assert.equal(seenInput.memory.feedbackCapability, AVOCapability.QUERY_FEEDBACK);
  assert.equal(seenInput.memory.knowledgeCapability, AVOCapability.QUERY_KNOWLEDGE);
});
