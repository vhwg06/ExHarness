import { ImplementationStatus, candidateKey, normalizeCandidate, requireText } from "./contracts.js";
import { CURRENT_STATE_SCHEMA_VERSION } from "./persistence.js";

export function lineageHead(state) {
  return state.persistentMemory.lineage.at(-1) ?? null;
}

export function createPersistentWorkState({ id, work, seedCandidate, now }) {
  requireText(id, "session.id");
  const candidate = normalizeCandidate(seedCandidate);
  const createdAt = now();

  return {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    revision: 0,
    id,
    work: structuredClone(work),
    currentCandidate: candidate,
    persistentMemory: {
      implementations: [
        {
          candidate,
          parent: null,
          lineageBase: null,
          status: ImplementationStatus.BASELINE,
          createdAt,
          promotedAt: createdAt
        }
      ],
      observations: [],
      verifications: [],
      evaluations: [],
      knowledge: [],
      variations: [],
      searchInvestmentDecisions: [],
      evidenceArtifacts: [],
      decisionArtifacts: [],
      attestations: [],
      lineage: [
        {
          kind: "BASELINE",
          candidate,
          parent: null,
          implementationParent: null,
          evaluation: null,
          committedAt: createdAt,
          promotedAt: createdAt
        }
      ]
    },
    trajectory: [],
    supervision: {
      inspections: 0,
      skipped: 0,
      interventions: [],
      lastInspectedEventId: null,
      lastDecision: null
    },
    createdAt,
    updatedAt: createdAt
  };
}

export function findImplementation(state, candidate) {
  const key = candidateKey(candidate);
  return state.persistentMemory.implementations.find((item) => candidateKey(item.candidate) === key) ?? null;
}

export function findLineageEntry(state, candidate) {
  const key = candidateKey(candidate);
  return state.persistentMemory.lineage.find((item) => candidateKey(item.candidate) === key) ?? null;
}

export function publicSnapshot(state) {
  return structuredClone({
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    id: state.id,
    work: state.work,
    candidate: state.currentCandidate,
    progress: {
      implementations: state.persistentMemory.implementations.length,
      verifications: state.persistentMemory.verifications.length,
      evaluations: state.persistentMemory.evaluations.length,
      observations: state.persistentMemory.observations.length,
      knowledge: state.persistentMemory.knowledge.length,
      variations: state.persistentMemory.variations?.length ?? 0,
      searchInvestmentDecisions: state.persistentMemory.searchInvestmentDecisions?.length ?? 0,
      trust: {
        evidence: state.persistentMemory.evidenceArtifacts?.length ?? 0,
        decisions: state.persistentMemory.decisionArtifacts?.length ?? 0,
        attestations: state.persistentMemory.attestations?.length ?? 0
      },
      lineage: {
        count: state.persistentMemory.lineage.length,
        head: lineageHead(state)
      },
      supervision: {
        inspections: state.supervision.inspections,
        skipped: state.supervision.skipped,
        interventions: state.supervision.interventions.length,
        lastDecision: state.supervision.lastDecision
      },
      trajectory: {
        eventCount: state.trajectory.length,
        lastEventId: state.trajectory.at(-1)?.id ?? null
      }
    },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  });
}
