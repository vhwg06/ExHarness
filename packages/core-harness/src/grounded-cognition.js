import { randomUUID } from "node:crypto";

import { KnowledgeKind, candidateKey, invariant, requireText } from "./contracts.js";
import { assertEvaluationInputsFresh } from "./evaluation-freshness.js";
import { ExHarnessErrorCode, GroundingBoundaryError } from "./errors.js";
import { KnowledgeScope } from "./knowledge.js";
import {
  SemanticMemoryKind,
  SemanticMemorySourceRefKind,
  SemanticMemoryStatus,
  defineSemanticMemoryDraft
} from "./semantic-memory.js";
import { digestValue } from "./trust.js";

export const GroundedCognitionArtifactKind = Object.freeze({
  GROUNDING: "GROUNDING",
  INTENT_REFLECTION_ALIGNMENT: "INTENT_REFLECTION_ALIGNMENT"
});

export const GroundingVerdict = Object.freeze({
  GROUNDED: "GROUNDED",
  REJECTED: "REJECTED"
});

export const IntentReflectionAlignmentStatus = Object.freeze({
  ALIGNED: "ALIGNED",
  DIVERGED: "DIVERGED",
  INDETERMINATE: "INDETERMINATE"
});

const GroundingExternalPrefix = "grounding:";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeSourceRef(ref) {
  invariant(ref && typeof ref === "object" && !Array.isArray(ref), "grounding source ref must be an object");
  invariant(Object.values(SemanticMemorySourceRefKind).includes(ref.kind), "grounding source ref kind is invalid");
  return Object.freeze({
    kind: ref.kind,
    id: requireText(ref.id, "grounding source ref id")
  });
}

function normalizeSourceRefs(refs) {
  invariant(Array.isArray(refs), "grounding sourceRefs must be an array");
  const seen = new Set();
  return Object.freeze(refs.map((ref) => {
    const normalized = normalizeSourceRef(ref);
    const key = `${normalized.kind}:${normalized.id}`;
    invariant(!seen.has(key), `duplicate grounding source ref: ${key}`);
    seen.add(key);
    return normalized;
  }));
}

function normalizeGroundingResult(value) {
  invariant(value && typeof value === "object", "grounding verifier result is required");
  invariant(Object.values(GroundingVerdict).includes(value.verdict), "grounding verdict is invalid");
  const confidence = value.confidence ?? null;
  invariant(
    confidence == null || (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1),
    "grounding confidence must be between 0 and 1 or null"
  );
  return Object.freeze({
    verdict: value.verdict,
    reason: requireText(value.reason, "grounding reason"),
    confidence
  });
}

function normalizeAlignmentResult(value) {
  invariant(value && typeof value === "object", "intent/reflection aligner result is required");
  invariant(
    Object.values(IntentReflectionAlignmentStatus).includes(value.status),
    "intent/reflection alignment status is invalid"
  );
  const divergence = value.divergence ?? null;
  invariant(
    divergence == null || (Number.isFinite(divergence) && divergence >= 0 && divergence <= 1),
    "intent/reflection divergence must be between 0 and 1 or null"
  );
  if (value.status !== IntentReflectionAlignmentStatus.INDETERMINATE) {
    invariant(divergence != null, "determinate intent/reflection alignment requires divergence");
  }
  return Object.freeze({
    status: value.status,
    divergence,
    reason: requireText(value.reason, "intent/reflection alignment reason")
  });
}

export function defineGroundingVerifier({ name, revision = "1", verify } = {}) {
  invariant(typeof verify === "function", "grounding verifier requires verify()");
  return Object.freeze({
    name: requireText(name, "grounding verifier name"),
    revision: requireText(revision, "grounding verifier revision"),
    verify
  });
}

export function defineIntentReflectionAligner({ name, revision = "1", compare } = {}) {
  invariant(typeof compare === "function", "intent/reflection aligner requires compare()");
  return Object.freeze({
    name: requireText(name, "intent/reflection aligner name"),
    revision: requireText(revision, "intent/reflection aligner revision"),
    compare
  });
}

export function createInMemoryCognitionArtifactStore({ artifacts = [] } = {}) {
  invariant(Array.isArray(artifacts), "cognition artifact seed must be an array");
  const stored = new Map();
  for (const artifact of artifacts) {
    invariant(artifact && typeof artifact === "object", "cognition artifact is required");
    const id = requireText(artifact.id, "cognition artifact id");
    invariant(!stored.has(id), `duplicate cognition artifact: ${id}`);
    stored.set(id, clone(artifact));
  }
  return Object.freeze({
    async append(artifact) {
      invariant(artifact && typeof artifact === "object", "cognition artifact is required");
      const id = requireText(artifact.id, "cognition artifact id");
      invariant(!stored.has(id), `cognition artifact already exists: ${id}`);
      stored.set(id, clone(artifact));
      return clone(artifact);
    },
    async read(id) {
      return clone(stored.get(requireText(id, "cognition artifact id")) ?? null);
    },
    async list() {
      return Object.freeze(clone([...stored.values()]));
    }
  });
}

function validateArtifactStore(store) {
  invariant(store && typeof store === "object", "grounded cognition artifact store is required");
  for (const method of ["append", "read", "list"]) {
    invariant(typeof store[method] === "function", `grounded cognition artifact store requires ${method}()`);
  }
  return store;
}

function collectionForSource(state, kind) {
  if (kind === SemanticMemorySourceRefKind.OBSERVATION) return state.persistentMemory?.observations ?? [];
  if (kind === SemanticMemorySourceRefKind.VERIFICATION) return state.persistentMemory?.verifications ?? [];
  if (kind === SemanticMemorySourceRefKind.EVALUATION) return state.persistentMemory?.evaluations ?? [];
  return null;
}

function groundingExternalId(id) {
  return `${GroundingExternalPrefix}${id}`;
}

function groundingArtifactIdFromMemory(record) {
  const ref = record.sourceRefs.find(
    (item) => item.kind === SemanticMemorySourceRefKind.EXTERNAL && item.id.startsWith(GroundingExternalPrefix)
  );
  return ref == null ? null : ref.id.slice(GroundingExternalPrefix.length);
}

export function createGroundedCognitionPort({
  memory,
  sessionStore,
  groundingVerifier,
  aligner = null,
  artifactStore = createInMemoryCognitionArtifactStore(),
  resolveSource = null,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(memory && typeof memory.remember === "function" && typeof memory.get === "function", "grounded cognition requires memory remember/get");
  invariant(sessionStore && typeof sessionStore.load === "function", "grounded cognition requires sessionStore.load()");
  const verifier = defineGroundingVerifier(groundingVerifier);
  const resolvedAligner = aligner == null ? null : defineIntentReflectionAligner(aligner);
  const artifacts = validateArtifactStore(artifactStore);
  invariant(resolveSource == null || typeof resolveSource === "function", "grounded cognition resolveSource must be a function or null");
  invariant(typeof clock === "function", "grounded cognition clock must be a function");
  invariant(typeof idFactory === "function", "grounded cognition idFactory must be a function");

  async function loadState(sessionId) {
    const id = requireText(sessionId, "grounded cognition sessionId");
    const state = await sessionStore.load(id);
    invariant(state, `session not found: ${id}`);
    return state;
  }

  function requireFreshEvaluationSources(state, sourceRefs, { required }) {
    const evaluationRefs = sourceRefs.filter((ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION);
    if (required && evaluationRefs.length === 0) {
      throw new GroundingBoundaryError(
        ExHarnessErrorCode.GROUNDING_REQUIRED,
        "grounded reflection requires a source ref to a fresh persisted evaluation"
      );
    }
    for (const ref of evaluationRefs) {
      const evaluation = (state.persistentMemory?.evaluations ?? []).find((item) => item.id === ref.id) ?? null;
      if (!evaluation) {
        throw new GroundingBoundaryError(
          ExHarnessErrorCode.GROUNDING_REQUIRED,
          `grounding evaluation source not found: ${ref.id}`
        );
      }
      invariant(
        candidateKey(evaluation.candidate) === candidateKey(state.currentCandidate),
        `grounding evaluation does not target current candidate: ${ref.id}`
      );
      try {
        assertEvaluationInputsFresh(state, evaluation, { purpose: "semantic grounding" });
      } catch (error) {
        throw new GroundingBoundaryError(
          ExHarnessErrorCode.GROUNDING_REQUIRED,
          `grounding evaluation is stale: ${ref.id}`,
          { evaluationId: ref.id },
          error
        );
      }
    }
    return evaluationRefs;
  }

  async function resolveSourceSnapshot(state, ref) {
    let value = null;
    if (ref.kind === SemanticMemorySourceRefKind.MEMORY) {
      value = await memory.get(ref.id, { includeArchived: true });
    } else {
      const collection = collectionForSource(state, ref.kind);
      if (collection != null) value = collection.find((item) => item.id === ref.id) ?? null;
    }
    if (value == null && resolveSource != null) {
      value = await resolveSource(clone(ref), clone(state));
    }
    if (value == null) {
      throw new GroundingBoundaryError(
        ExHarnessErrorCode.GROUNDING_REQUIRED,
        `grounding source not found: ${ref.kind}:${ref.id}`
      );
    }
    return Object.freeze({
      ref: clone(ref),
      revision: Number.isInteger(value.revision) ? value.revision : null,
      digest: digestValue(value),
      value: clone(value)
    });
  }

  async function resolveSourceSnapshots(state, refs) {
    const snapshots = [];
    for (const ref of refs) snapshots.push(await resolveSourceSnapshot(state, ref));
    return Object.freeze(snapshots);
  }

  function snapshotIdentity(snapshots) {
    return snapshots.map((item) => ({
      ref: item.ref,
      revision: item.revision,
      digest: item.digest
    }));
  }

  async function derive(kind, input) {
    invariant([SemanticMemoryKind.REFLECTION, SemanticMemoryKind.INTENT].includes(kind), "grounded cognition kind is invalid");
    invariant(input && typeof input === "object", "grounded cognition derivation input is required");
    const sourceRefs = normalizeSourceRefs(input.sourceRefs ?? []);
    invariant(sourceRefs.length > 0, "grounded cognition requires persisted source refs");
    const draft = defineSemanticMemoryDraft({
      kind,
      content: input.content,
      tags: input.tags ?? [],
      importance: input.importance,
      confidence: input.confidence,
      temporal: input.temporal ?? {},
      sourceRefs,
      provenance: input.provenance
    });

    const before = await loadState(input.sessionId);
    requireFreshEvaluationSources(before, sourceRefs, { required: kind === SemanticMemoryKind.REFLECTION });
    const sourceSnapshots = await resolveSourceSnapshots(before, sourceRefs);
    const proposal = Object.freeze({
      sessionId: before.id,
      candidate: clone(before.currentCandidate),
      kind,
      content: draft.content,
      tags: draft.tags,
      importance: draft.importance,
      confidence: draft.confidence,
      temporal: draft.temporal,
      sourceRefs: draft.sourceRefs,
      sourceSnapshots: Object.freeze(snapshotIdentity(sourceSnapshots))
    });
    const verification = normalizeGroundingResult(await verifier.verify(Object.freeze({
      proposal: clone(proposal),
      sources: Object.freeze(sourceSnapshots.map((item) => clone(item.value)))
    })));
    if (verification.verdict !== GroundingVerdict.GROUNDED) {
      throw new GroundingBoundaryError(
        ExHarnessErrorCode.GROUNDING_REJECTED,
        verification.reason,
        { kind, verifier: { name: verifier.name, revision: verifier.revision } }
      );
    }

    const after = await loadState(input.sessionId);
    requireFreshEvaluationSources(after, sourceRefs, { required: kind === SemanticMemoryKind.REFLECTION });
    const currentSnapshots = await resolveSourceSnapshots(after, sourceRefs);
    invariant(
      JSON.stringify(snapshotIdentity(currentSnapshots)) === JSON.stringify(snapshotIdentity(sourceSnapshots)),
      "grounding source snapshot changed before semantic memory activation; re-ground"
    );

    const groundingId = requireText(idFactory(), "grounding artifact id");
    const grounding = Object.freeze({
      id: groundingId,
      artifactRef: Object.freeze({ kind: GroundedCognitionArtifactKind.GROUNDING, id: groundingId }),
      at: requireText(clock(), "grounding clock value"),
      sessionId: before.id,
      candidate: clone(before.currentCandidate),
      semanticMemoryKind: kind,
      proposalDigest: digestValue(proposal),
      sourceSnapshots: Object.freeze(snapshotIdentity(sourceSnapshots)),
      verifier: Object.freeze({ name: verifier.name, revision: verifier.revision }),
      verdict: verification.verdict,
      reason: verification.reason,
      confidence: verification.confidence
    });
    await artifacts.append(grounding);

    const groundingRef = Object.freeze({
      kind: SemanticMemorySourceRefKind.EXTERNAL,
      id: groundingExternalId(groundingId)
    });
    const remembered = await memory.remember({
      ...clone(draft),
      sourceRefs: [...draft.sourceRefs, groundingRef],
      provenance: draft.provenance
    });
    return Object.freeze({ memory: clone(remembered), grounding: clone(grounding) });
  }

  async function alignIntentReflection({ intentId, reflectionId } = {}) {
    invariant(resolvedAligner, "intent/reflection alignment requires an aligner");
    const intent = await memory.get(requireText(intentId, "intent memory id"));
    const reflection = await memory.get(requireText(reflectionId, "reflection memory id"));
    invariant(intent?.kind === SemanticMemoryKind.INTENT, "intent/reflection alignment requires ACTIVE INTENT memory");
    invariant(reflection?.kind === SemanticMemoryKind.REFLECTION, "intent/reflection alignment requires ACTIVE REFLECTION memory");
    invariant(intent.status === SemanticMemoryStatus.ACTIVE, "intent memory must be active");
    invariant(reflection.status === SemanticMemoryStatus.ACTIVE, "reflection memory must be active");

    const groundingId = groundingArtifactIdFromMemory(reflection);
    invariant(groundingId, "reflection is missing its grounding artifact ref");
    const grounding = await artifacts.read(groundingId);
    invariant(grounding?.kind === undefined || grounding?.artifactRef?.kind === GroundedCognitionArtifactKind.GROUNDING, "reflection grounding artifact is invalid");
    invariant(grounding?.verdict === GroundingVerdict.GROUNDED, "reflection grounding artifact is not grounded");

    const intentSource = grounding.sourceSnapshots.find(
      (item) => item.ref.kind === SemanticMemorySourceRefKind.MEMORY && item.ref.id === intent.id
    ) ?? null;
    invariant(intentSource, "reflection grounding must include the intent as an exact memory source");
    invariant(intentSource.revision === intent.revision, "reflection was grounded against a stale intent revision");
    const evaluationRefs = grounding.sourceSnapshots
      .filter((item) => item.ref.kind === SemanticMemorySourceRefKind.EVALUATION)
      .map((item) => clone(item.ref));
    invariant(evaluationRefs.length > 0, "reflection grounding must include evaluation evidence");

    const result = normalizeAlignmentResult(await resolvedAligner.compare(Object.freeze({
      intent: clone(intent),
      reflection: clone(reflection),
      grounding: clone(grounding)
    })));
    const id = requireText(idFactory(), "intent/reflection alignment id");
    const alignment = Object.freeze({
      id,
      artifactRef: Object.freeze({ kind: GroundedCognitionArtifactKind.INTENT_REFLECTION_ALIGNMENT, id }),
      at: requireText(clock(), "intent/reflection alignment clock value"),
      intentRef: Object.freeze({ kind: SemanticMemorySourceRefKind.MEMORY, id: intent.id, revision: intent.revision }),
      reflectionRef: Object.freeze({ kind: SemanticMemorySourceRefKind.MEMORY, id: reflection.id, revision: reflection.revision }),
      groundingRef: clone(grounding.artifactRef),
      evaluationRefs: Object.freeze(evaluationRefs),
      aligner: Object.freeze({ name: resolvedAligner.name, revision: resolvedAligner.revision }),
      status: result.status,
      divergence: result.divergence,
      reason: result.reason
    });
    await artifacts.append(alignment);
    return clone(alignment);
  }

  return Object.freeze({
    deriveIntent(input) {
      return derive(SemanticMemoryKind.INTENT, input);
    },
    deriveReflection(input) {
      return derive(SemanticMemoryKind.REFLECTION, input);
    },
    alignIntentReflection,
    groundingVerifier: Object.freeze({ name: verifier.name, revision: verifier.revision }),
    aligner: resolvedAligner == null
      ? null
      : Object.freeze({ name: resolvedAligner.name, revision: resolvedAligner.revision }),
    artifacts() {
      return artifacts.list();
    }
  });
}

export function alignmentToKnowledgeDraft(alignment, {
  scope = KnowledgeScope.LINEAGE,
  tags = []
} = {}) {
  invariant(alignment && typeof alignment === "object", "intent/reflection alignment is required");
  invariant(
    alignment.artifactRef?.kind === GroundedCognitionArtifactKind.INTENT_REFLECTION_ALIGNMENT,
    "intent/reflection alignment artifact kind is invalid"
  );
  invariant(Object.values(KnowledgeScope).includes(scope), "intent/reflection alignment knowledge scope is invalid");
  const divergenceText = alignment.divergence == null ? "indeterminate" : alignment.divergence.toFixed(3);
  return Object.freeze({
    kind: KnowledgeKind.FINDING,
    statement: `intent/reflection semantic divergence=${divergenceText}: ${alignment.reason}`,
    scope,
    evidence: Object.freeze([clone(alignment)]),
    feedbackRefs: Object.freeze([]),
    relations: Object.freeze([]),
    tags: Object.freeze([
      "semantic-calibration",
      "intent-reflection-alignment",
      alignment.status.toLowerCase(),
      ...tags
    ])
  });
}

export function semanticDivergenceSignals(history) {
  invariant(history && typeof history === "object", "search investment history is required");
  const signals = [];
  for (const knowledge of history.groundedKnowledge ?? []) {
    for (const evidence of knowledge.evidence ?? []) {
      if (evidence?.artifactRef?.kind !== GroundedCognitionArtifactKind.INTENT_REFLECTION_ALIGNMENT) continue;
      signals.push(Object.freeze({
        knowledgeId: knowledge.id ?? null,
        alignmentId: evidence.id,
        intentRef: clone(evidence.intentRef),
        reflectionRef: clone(evidence.reflectionRef),
        status: evidence.status,
        divergence: evidence.divergence,
        reason: evidence.reason
      }));
    }
  }
  return Object.freeze(signals);
}
