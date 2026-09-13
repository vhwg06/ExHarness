import { randomUUID } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { SemanticMemoryEvolutionPartialCommitError } from "./errors.js";
import {
  SemanticMemoryKind,
  SemanticMemorySourceRefKind,
  SemanticMemoryStatus,
  defineSemanticMemoryDraft,
  defineSemanticMemoryProvenance
} from "./semantic-memory.js";
import { SemanticMemoryRelationType } from "./semantic-memory-graph.js";

export const SemanticMemoryEvolutionKind = Object.freeze({
  MERGE: "MERGE",
  RECONCILE: "RECONCILE",
  SUPERSEDE: "SUPERSEDE",
  ABSTRACT: "ABSTRACT",
  REINFORCE: "REINFORCE",
  FORGET: "FORGET"
});

export const SemanticMemoryEvolutionStatus = Object.freeze({
  VALIDATED: "VALIDATED",
  COMMITTED: "COMMITTED"
});

export const SemanticMemoryEvolutionAtomicity = "CAS_GUARDED_MULTI_STEP";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeSource(source) {
  invariant(source && typeof source === "object" && !Array.isArray(source), "semantic memory evolution source is required");
  const expectedRevision = source.expectedRevision;
  invariant(Number.isInteger(expectedRevision) && expectedRevision > 0, "semantic memory evolution expectedRevision must be positive");
  return Object.freeze({
    memoryId: requireText(source.memoryId, "semantic memory evolution source memoryId"),
    expectedRevision
  });
}

function normalizeSources(sources, kind) {
  invariant(Array.isArray(sources), "semantic memory evolution sources must be an array");
  const normalized = sources.map(normalizeSource);
  const ids = new Set(normalized.map((source) => source.memoryId));
  invariant(ids.size === normalized.length, "semantic memory evolution sources cannot contain duplicates");
  const minimum = kind === SemanticMemoryEvolutionKind.MERGE || kind === SemanticMemoryEvolutionKind.RECONCILE ? 2 : 1;
  const maximum = kind === SemanticMemoryEvolutionKind.REINFORCE || kind === SemanticMemoryEvolutionKind.FORGET ? 1 : Infinity;
  invariant(normalized.length >= minimum && normalized.length <= maximum, `semantic memory evolution ${kind} source count is invalid`);
  return Object.freeze(normalized);
}

function normalizeOutput(kind, output, provenance, sources) {
  const createsMemory = [
    SemanticMemoryEvolutionKind.MERGE,
    SemanticMemoryEvolutionKind.RECONCILE,
    SemanticMemoryEvolutionKind.SUPERSEDE,
    SemanticMemoryEvolutionKind.ABSTRACT
  ].includes(kind);
  if (!createsMemory) {
    invariant(output == null, `semantic memory evolution ${kind} cannot declare output memory`);
    return null;
  }
  invariant(output && typeof output === "object", `semantic memory evolution ${kind} requires output memory`);
  const derivedRefs = sources.map((source) => ({
    kind: SemanticMemorySourceRefKind.MEMORY,
    id: source.memoryId
  }));
  const extraRefs = Array.isArray(output.sourceRefs) ? output.sourceRefs : [];
  const refs = [];
  const seen = new Set();
  for (const ref of [...derivedRefs, ...extraRefs]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  const draft = defineSemanticMemoryDraft({
    ...clone(output),
    kind: kind === SemanticMemoryEvolutionKind.ABSTRACT
      ? SemanticMemoryKind.REFLECTION
      : output.kind,
    sourceRefs: refs,
    provenance
  });
  return draft;
}

function normalizePatch(kind, patch) {
  if (kind !== SemanticMemoryEvolutionKind.REINFORCE) {
    invariant(patch == null, `semantic memory evolution ${kind} cannot declare reinforcement patch`);
    return null;
  }
  invariant(patch && typeof patch === "object", "semantic memory evolution REINFORCE requires patch");
  invariant(patch.importance !== undefined || patch.confidence !== undefined, "semantic memory evolution REINFORCE requires importance or confidence");
  invariant(patch.content == null && patch.tags == null && patch.temporal == null, "semantic memory evolution REINFORCE may only change importance/confidence");
  return Object.freeze({
    ...(patch.importance === undefined ? {} : { importance: patch.importance }),
    ...(patch.confidence === undefined ? {} : { confidence: patch.confidence })
  });
}

function defaultArchiveSources(kind) {
  return [
    SemanticMemoryEvolutionKind.MERGE,
    SemanticMemoryEvolutionKind.RECONCILE,
    SemanticMemoryEvolutionKind.SUPERSEDE
  ].includes(kind);
}

export function defineSemanticMemoryEvolutionProposal(input) {
  invariant(input && typeof input === "object", "semantic memory evolution proposal is required");
  invariant(Object.values(SemanticMemoryEvolutionKind).includes(input.kind), "semantic memory evolution kind is invalid");
  const kind = input.kind;
  const provenance = defineSemanticMemoryProvenance(input.provenance);
  const sources = normalizeSources(input.sources, kind);
  const archiveSources = input.archiveSources ?? defaultArchiveSources(kind);
  invariant(typeof archiveSources === "boolean", "semantic memory evolution archiveSources must be boolean");
  if (kind === SemanticMemoryEvolutionKind.ABSTRACT) {
    invariant(archiveSources === false, "semantic memory evolution ABSTRACT cannot archive source memories");
  }
  if (kind === SemanticMemoryEvolutionKind.REINFORCE || kind === SemanticMemoryEvolutionKind.FORGET) {
    invariant(archiveSources === false, `semantic memory evolution ${kind} cannot archive sources as a separate step`);
  }
  return Object.freeze({
    kind,
    sources,
    output: normalizeOutput(kind, input.output ?? null, provenance, sources),
    patch: normalizePatch(kind, input.patch ?? null),
    archiveSources,
    provenance
  });
}

function relationTypeFor(kind) {
  if (kind === SemanticMemoryEvolutionKind.RECONCILE || kind === SemanticMemoryEvolutionKind.SUPERSEDE) {
    return SemanticMemoryRelationType.SUPERSEDES;
  }
  return SemanticMemoryRelationType.DERIVED_FROM;
}

export function createSemanticMemoryEvolutionPort({
  memory,
  graph,
  idFactory = () => randomUUID(),
  clock = () => new Date().toISOString()
} = {}) {
  invariant(memory && typeof memory.get === "function" && typeof memory.remember === "function", "semantic memory evolution requires memory get/remember");
  invariant(typeof memory.update === "function" && typeof memory.archive === "function", "semantic memory evolution requires memory update/archive");
  invariant(graph && typeof graph.relate === "function", "semantic memory evolution requires graph.relate()");
  invariant(typeof idFactory === "function", "semantic memory evolution idFactory must be a function");
  invariant(typeof clock === "function", "semantic memory evolution clock must be a function");

  async function validateSources(proposal) {
    const snapshots = [];
    for (const source of proposal.sources) {
      const record = await memory.get(source.memoryId, { includeArchived: true });
      invariant(record, `semantic memory evolution source not found: ${source.memoryId}`);
      invariant(record.status === SemanticMemoryStatus.ACTIVE, `semantic memory evolution source is not active: ${source.memoryId}`);
      invariant(record.revision === source.expectedRevision, `semantic memory evolution source revision is stale: ${source.memoryId}`);
      snapshots.push(Object.freeze({
        memoryId: record.id,
        revision: record.revision,
        kind: record.kind
      }));
    }
    return Object.freeze(snapshots);
  }

  async function validate(input) {
    const proposal = defineSemanticMemoryEvolutionProposal(input);
    const sources = await validateSources(proposal);
    return Object.freeze({
      id: requireText(idFactory(), "semantic memory evolution proposal id"),
      status: SemanticMemoryEvolutionStatus.VALIDATED,
      validatedAt: requireText(clock(), "semantic memory evolution clock value"),
      atomicity: SemanticMemoryEvolutionAtomicity,
      proposal: clone(proposal),
      sources: clone(sources)
    });
  }

  async function commitValidated(validated) {
    invariant(validated && validated.status === SemanticMemoryEvolutionStatus.VALIDATED, "semantic memory evolution requires a validated proposal");
    const proposalId = requireText(validated.id, "semantic memory evolution proposal id");
    const proposal = defineSemanticMemoryEvolutionProposal(validated.proposal);
    await validateSources(proposal);
    const appliedSteps = [];

    try {
      if (proposal.kind === SemanticMemoryEvolutionKind.REINFORCE) {
        const source = proposal.sources[0];
        const updated = await memory.update(source.memoryId, {
          ...clone(proposal.patch),
          expectedRevision: source.expectedRevision,
          provenance: proposal.provenance
        });
        appliedSteps.push({ kind: "MEMORY_UPDATED", memoryId: updated.id, revision: updated.revision });
        return Object.freeze({
          id: proposalId,
          status: SemanticMemoryEvolutionStatus.COMMITTED,
          committedAt: requireText(clock(), "semantic memory evolution clock value"),
          atomicity: SemanticMemoryEvolutionAtomicity,
          kind: proposal.kind,
          resultMemory: clone(updated),
          relations: Object.freeze([]),
          archivedMemoryIds: Object.freeze([]),
          appliedSteps: Object.freeze(clone(appliedSteps))
        });
      }

      if (proposal.kind === SemanticMemoryEvolutionKind.FORGET) {
        const source = proposal.sources[0];
        const archived = await memory.archive(source.memoryId, {
          expectedRevision: source.expectedRevision,
          provenance: proposal.provenance
        });
        appliedSteps.push({ kind: "MEMORY_ARCHIVED", memoryId: archived.id, revision: archived.revision });
        return Object.freeze({
          id: proposalId,
          status: SemanticMemoryEvolutionStatus.COMMITTED,
          committedAt: requireText(clock(), "semantic memory evolution clock value"),
          atomicity: SemanticMemoryEvolutionAtomicity,
          kind: proposal.kind,
          resultMemory: null,
          relations: Object.freeze([]),
          archivedMemoryIds: Object.freeze([archived.id]),
          appliedSteps: Object.freeze(clone(appliedSteps))
        });
      }

      const created = await memory.remember({
        ...clone(proposal.output),
        provenance: proposal.provenance
      });
      appliedSteps.push({ kind: "MEMORY_CREATED", memoryId: created.id, revision: created.revision });

      const relations = [];
      for (const source of proposal.sources) {
        const relation = await graph.relate({
          fromMemoryId: created.id,
          toMemoryId: source.memoryId,
          type: relationTypeFor(proposal.kind),
          provenance: proposal.provenance
        });
        relations.push(relation);
        appliedSteps.push({ kind: "RELATION_CREATED", relationId: relation.id, revision: relation.revision });
      }

      const archivedMemoryIds = [];
      if (proposal.archiveSources) {
        for (const source of proposal.sources) {
          const archived = await memory.archive(source.memoryId, {
            expectedRevision: source.expectedRevision,
            provenance: proposal.provenance
          });
          archivedMemoryIds.push(archived.id);
          appliedSteps.push({ kind: "MEMORY_ARCHIVED", memoryId: archived.id, revision: archived.revision });
        }
      }

      return Object.freeze({
        id: proposalId,
        status: SemanticMemoryEvolutionStatus.COMMITTED,
        committedAt: requireText(clock(), "semantic memory evolution clock value"),
        atomicity: SemanticMemoryEvolutionAtomicity,
        kind: proposal.kind,
        resultMemory: clone(created),
        relations: Object.freeze(clone(relations)),
        archivedMemoryIds: Object.freeze(archivedMemoryIds),
        appliedSteps: Object.freeze(clone(appliedSteps))
      });
    } catch (error) {
      if (appliedSteps.length === 0) throw error;
      throw new SemanticMemoryEvolutionPartialCommitError({
        proposalId,
        appliedSteps,
        cause: error
      });
    }
  }

  return Object.freeze({
    validate,
    commit: commitValidated,
    async execute(input) {
      return commitValidated(await validate(input));
    }
  });
}
