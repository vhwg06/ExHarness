import test from "node:test";
import assert from "node:assert/strict";
import {
  EvaluationValidity,
  EvaluationVerdict,
  ImplementationStatus,
  createCoreHarness,
  createInMemorySessionStore
} from "../src/index.js";

function fixture() {
  let id = 0;
  let time = 0;
  const sessionStore = createInMemorySessionStore();

  const harness = createCoreHarness({
    environment: {
      async observe() {
        return null;
      },
      async act({ candidate, action }) {
        if (!action.mutate) return { mutated: false, result: null };
        return {
          mutated: true,
          candidate: {
            id: candidate.id,
            version: action.nextVersion
          }
        };
      }
    },
    evaluator: {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.PASS
        };
      }
    },
    sessionStore,
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
        return { enabled: false, reason: "not needed for lineage tests" };
      }
    },
    idFactory: () => `id-${++id}`,
    clock: () => `2026-09-11T03:00:${String(++time).padStart(2, "0")}Z`
  });

  return harness;
}

const work = { objective: "improve an opaque candidate" };
const seed = { id: "candidate", version: "v0" };

test("working ancestry and committed lineage ancestry remain distinct", async () => {
  const harness = fixture();
  await harness.start({ sessionId: "s1", work, seedCandidate: seed });

  await harness.act("s1", { mutate: true, nextVersion: "v1" });
  await harness.act("s1", { mutate: true, nextVersion: "v2" });

  const history = await harness.candidateHistory("s1");
  assert.deepEqual(history.map((item) => item.candidate.version), ["v0", "v1", "v2"]);

  assert.equal(history[0].parent, null);
  assert.equal(history[0].lineageBase, null);

  assert.deepEqual(history[1].parent, { id: "candidate", version: "v0" });
  assert.deepEqual(history[1].lineageBase, { id: "candidate", version: "v0" });

  assert.deepEqual(history[2].parent, { id: "candidate", version: "v1" });
  assert.deepEqual(history[2].lineageBase, { id: "candidate", version: "v0" });
  assert.equal(history[2].status, ImplementationStatus.WORKING);

  assert.equal((await harness.lineage("s1")).length, 1);
});

test("promotion commits P_t -> P_t+1 while preserving the local repair parent", async () => {
  const harness = fixture();
  await harness.start({ sessionId: "s1", work, seedCandidate: seed });
  await harness.act("s1", { mutate: true, nextVersion: "v1" });
  await harness.act("s1", { mutate: true, nextVersion: "v2" });
  const evaluation = await harness.evaluate("s1");

  const promotion = await harness.promote("s1");

  assert.deepEqual(promotion.parent, { id: "candidate", version: "v0" });
  assert.deepEqual(promotion.implementationParent, { id: "candidate", version: "v1" });
  assert.equal(promotion.evaluation, evaluation.id);
  assert.equal(promotion.committedAt, promotion.promotedAt);

  const lineage = await harness.lineage("s1");
  assert.deepEqual(lineage.map((item) => item.candidate.version), ["v0", "v2"]);
  assert.deepEqual(lineage[1].parent, { id: "candidate", version: "v0" });
});

test("a new search branch uses the latest committed candidate as its lineage base", async () => {
  const harness = fixture();
  await harness.start({ sessionId: "s1", work, seedCandidate: seed });

  await harness.act("s1", { mutate: true, nextVersion: "v1" });
  await harness.evaluate("s1");
  await harness.promote("s1");

  const next = await harness.act("s1", { mutate: true, nextVersion: "v2" });
  assert.deepEqual(next.lineageBase, { id: "candidate", version: "v1" });

  const history = await harness.candidateHistory("s1");
  assert.deepEqual(history.at(-1).lineageBase, { id: "candidate", version: "v1" });
});

test("candidateHistory is the semantic API while implementationHistory remains compatible", async () => {
  const harness = fixture();
  await harness.start({ sessionId: "s1", work, seedCandidate: seed });
  await harness.act("s1", { mutate: true, nextVersion: "v1" });

  assert.deepEqual(
    await harness.candidateHistory("s1"),
    await harness.implementationHistory("s1")
  );
});
