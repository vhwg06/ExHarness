import { invariant, sameCandidate } from "./contracts.js";
import { collectFeedback, queryFeedback } from "./feedback.js";
import {
  KnowledgeScope,
  buildKnowledgeView,
  normalizeKnowledgeDraft,
  validateKnowledgeLinks
} from "./knowledge.js";

function lineageHeadCandidate(state) {
  return structuredClone(state.persistentMemory.lineage.at(-1)?.candidate ?? null);
}

function buildKnowledgePreview(state, draft) {
  return {
    id: "__pending_knowledge__",
    candidate: structuredClone(state.currentCandidate),
    lineageBase: draft.scope === KnowledgeScope.LINEAGE ? lineageHeadCandidate(state) : null,
    ...structuredClone(draft)
  };
}

export function createMemoryFacade(core) {
  invariant(core && typeof core.workState === "function", "memory facade requires core.workState()");
  invariant(core && typeof core.recordKnowledge === "function", "memory facade requires core.recordKnowledge()");

  return Object.freeze({
    async feedback(sessionId, query = {}) {
      const state = await core.workState(sessionId);
      return queryFeedback(state, query);
    },

    async knowledgeView(sessionId) {
      const state = await core.workState(sessionId);
      return buildKnowledgeView(state);
    },

    async recordKnowledge(sessionId, record) {
      const state = await core.workState(sessionId);
      const draft = normalizeKnowledgeDraft(record);
      const preview = buildKnowledgePreview(state, draft);
      const feedbackIds = new Set(collectFeedback(state).map((item) => item.id));

      validateKnowledgeLinks({
        item: preview,
        records: state.persistentMemory.knowledge,
        feedbackIds
      });

      const stored = await core.recordKnowledge(sessionId, {
        ...structuredClone(draft),
        lineageBase: structuredClone(preview.lineageBase)
      });

      if (draft.scope === KnowledgeScope.CANDIDATE) {
        invariant(
          sameCandidate(stored.candidate, state.currentCandidate),
          "candidate-scoped knowledge must bind to the current candidate"
        );
      }

      return stored;
    }
  });
}
