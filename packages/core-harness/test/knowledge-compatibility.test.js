import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeKind, buildKnowledgeView } from "../src/index.js";

test("legacy knowledge without explicit scope remains candidate-scoped", () => {
  const candidate = { id: "candidate", version: "v0" };
  const state = {
    currentCandidate: candidate,
    persistentMemory: {
      knowledge: [
        {
          id: "legacy-k1",
          kind: KnowledgeKind.HYPOTHESIS,
          statement: "legacy memory",
          evidence: [],
          candidate,
          at: "2026-09-11T00:00:00.000Z"
        }
      ],
      lineage: [{ candidate }]
    }
  };

  const current = buildKnowledgeView(state);
  assert.deepEqual(current.active.map((item) => item.id), ["legacy-k1"]);

  state.currentCandidate = { id: "candidate", version: "v1" };
  const next = buildKnowledgeView(state);
  assert.equal(next.active.length, 0);
});
