import { invariant, requireText } from "./contracts.js";
import { TraceSpanKind } from "./tracing.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function validateTracer(tracer) {
  invariant(tracer && typeof tracer === "object", "cognition tracing requires tracer");
  invariant(typeof tracer.runSpan === "function", "cognition tracing tracer requires runSpan()");
  invariant(typeof tracer.current === "function", "cognition tracing tracer requires current()");
  return tracer;
}

function boundedText(value, maximum = 256) {
  if (value == null) return null;
  const text = String(value);
  return Object.freeze({
    value: text.length <= maximum ? text : text.slice(0, maximum),
    chars: text.length,
    truncated: text.length > maximum
  });
}

async function emitResultSpan(tracer, name, attributes) {
  return tracer.runSpan(
    TraceSpanKind.MEMORY_RESULT,
    name,
    async () => null,
    { attributes }
  );
}

function memoryResultAttributes(operation, record) {
  return Object.freeze({
    operation,
    memoryId: record?.id ?? null,
    revision: record?.revision ?? null,
    memoryKind: record?.kind ?? null,
    status: record?.status ?? null
  });
}

function retrievalResultAttributes(result, source) {
  const hits = Array.isArray(result?.hits) ? result.hits : [];
  return Object.freeze({
    source,
    semantics: result?.semantics ?? null,
    rankingModel: result?.rankingModel ?? null,
    count: hits.length,
    hits: hits.map((hit) => Object.freeze({
      rank: hit?.rank ?? null,
      memoryId: hit?.memory?.id ?? null,
      score: hit?.relevance?.score ?? null,
      source: hit?.relevance?.source ?? null
    }))
  });
}

function evolutionResultAttributes(result, operation) {
  return Object.freeze({
    operation,
    proposalId: result?.id ?? null,
    status: result?.status ?? null,
    evolutionKind: result?.kind ?? result?.proposal?.kind ?? null,
    resultMemoryId: result?.resultMemory?.id ?? null,
    relationIds: Array.isArray(result?.relations) ? result.relations.map((relation) => relation.id) : [],
    archivedMemoryIds: clone(result?.archivedMemoryIds ?? []),
    appliedSteps: Array.isArray(result?.appliedSteps) ? result.appliedSteps.length : 0
  });
}

export function instrumentCognitionContextBlocks(blocks = [], tracer) {
  invariant(Array.isArray(blocks), "cognition tracing context blocks must be an array");
  const resolvedTracer = validateTracer(tracer);

  return Object.freeze(blocks.map((block) => {
    invariant(block && typeof block === "object", "cognition tracing context block is required");
    if (typeof block.resolve !== "function") return block;
    const name = requireText(block.name, "cognition tracing context block name");
    return Object.freeze({
      ...block,
      async resolve(metadata) {
        return resolvedTracer.runSpan(
          TraceSpanKind.CONTEXT_RESOLVE,
          `context.${name}`,
          () => block.resolve(metadata),
          {
            callId: metadata?.callId ?? null,
            attributes: {
              block: name,
              trust: block.trust ?? null,
              turn: metadata?.turn ?? null,
              judgment: metadata?.judgment?.name ?? null
            }
          }
        );
      }
    });
  }));
}

export function createTracedSemanticMemoryPort(memory, tracer) {
  invariant(memory && typeof memory === "object", "cognition tracing memory port is required");
  const resolvedTracer = validateTracer(tracer);
  for (const method of ["remember", "get", "list", "update", "archive"]) {
    invariant(typeof memory[method] === "function", `cognition tracing memory port requires ${method}()`);
  }

  return Object.freeze({
    async remember(input) {
      return resolvedTracer.runSpan(TraceSpanKind.MEMORY_WRITE, "memory.remember", async () => {
        const result = await memory.remember(input);
        await emitResultSpan(resolvedTracer, "memory.remember.result", memoryResultAttributes("REMEMBER", result));
        return result;
      }, { attributes: { operation: "REMEMBER", kind: input?.kind ?? null } });
    },

    async get(id, options = {}) {
      return resolvedTracer.runSpan(TraceSpanKind.MEMORY_READ, "memory.get", () => memory.get(id, options), {
        attributes: { operation: "GET", memoryId: id ?? null, includeArchived: options?.includeArchived === true }
      });
    },

    async list(options = {}) {
      return resolvedTracer.runSpan(TraceSpanKind.MEMORY_READ, "memory.list", () => memory.list(options), {
        attributes: {
          operation: "LIST",
          includeArchived: options?.includeArchived === true,
          limit: options?.limit ?? null,
          kinds: clone(options?.kinds ?? null),
          tags: clone(options?.tags ?? null)
        }
      });
    },

    async update(id, patch) {
      return resolvedTracer.runSpan(TraceSpanKind.MEMORY_WRITE, "memory.update", async () => {
        const result = await memory.update(id, patch);
        await emitResultSpan(resolvedTracer, "memory.update.result", memoryResultAttributes("UPDATE", result));
        return result;
      }, {
        attributes: {
          operation: "UPDATE",
          memoryId: id ?? null,
          expectedRevision: patch?.expectedRevision ?? null
        }
      });
    },

    async archive(id, options = {}) {
      return resolvedTracer.runSpan(TraceSpanKind.MEMORY_WRITE, "memory.archive", async () => {
        const result = await memory.archive(id, options);
        await emitResultSpan(resolvedTracer, "memory.archive.result", memoryResultAttributes("ARCHIVE", result));
        return result;
      }, {
        attributes: {
          operation: "ARCHIVE",
          memoryId: id ?? null,
          expectedRevision: options?.expectedRevision ?? null
        }
      });
    }
  });
}

function createTracedRetrievalLike(port, tracer, { source }) {
  invariant(port && typeof port.recall === "function" && typeof port.search === "function", "cognition tracing retrieval port requires recall/search");
  invariant(typeof port.policy === "function", "cognition tracing retrieval port requires policy()");
  const resolvedTracer = validateTracer(tracer);

  async function run(kind, name, operation, options = {}) {
    const query = boundedText(options?.query ?? null);
    return resolvedTracer.runSpan(kind, name, async () => {
      const result = await operation(options);
      await emitResultSpan(resolvedTracer, `${name}.result`, retrievalResultAttributes(result, source));
      return result;
    }, {
      attributes: {
        source,
        query: query?.value ?? null,
        queryChars: query?.chars ?? 0,
        queryTruncated: query?.truncated ?? false,
        tags: clone(options?.tags ?? []),
        kinds: clone(options?.kinds ?? null)
      }
    });
  }

  return Object.freeze({
    policy() {
      return clone(port.policy());
    },
    recall(options = {}) {
      return run(TraceSpanKind.MEMORY_RECALL, `memory.${source.toLowerCase()}.recall`, (value) => port.recall(value), options);
    },
    search(options = {}) {
      return run(TraceSpanKind.MEMORY_SEARCH, `memory.${source.toLowerCase()}.search`, (value) => port.search(value), options);
    }
  });
}

export function createTracedSemanticMemoryRetrievalPort(retrieval, tracer) {
  return createTracedRetrievalLike(retrieval, tracer, { source: "RETRIEVAL" });
}

export function createTracedSemanticMemoryIntelligencePort(intelligence, tracer) {
  return createTracedRetrievalLike(intelligence, tracer, { source: "INTELLIGENCE" });
}

export function createTracedSemanticMemoryEvolutionPort(evolution, tracer) {
  invariant(evolution && typeof evolution === "object", "cognition tracing evolution port is required");
  for (const method of ["validate", "commit", "execute"]) {
    invariant(typeof evolution[method] === "function", `cognition tracing evolution port requires ${method}()`);
  }
  const resolvedTracer = validateTracer(tracer);

  async function run(operation, input, invoke) {
    return resolvedTracer.runSpan(TraceSpanKind.MEMORY_EVOLUTION, `memory.evolution.${operation.toLowerCase()}`, async () => {
      const result = await invoke();
      await emitResultSpan(resolvedTracer, `memory.evolution.${operation.toLowerCase()}.result`, evolutionResultAttributes(result, operation));
      return result;
    }, {
      attributes: {
        operation,
        proposalId: input?.id ?? null,
        evolutionKind: input?.kind ?? input?.proposal?.kind ?? null,
        sourceMemoryIds: Array.isArray(input?.sources)
          ? input.sources.map((source) => source.memoryId)
          : Array.isArray(input?.proposal?.sources)
            ? input.proposal.sources.map((source) => source.memoryId)
            : []
      }
    });
  }

  return Object.freeze({
    validate(input) {
      return run("VALIDATE", input, () => evolution.validate(input));
    },
    commit(validated) {
      return run("COMMIT", validated, () => evolution.commit(validated));
    },
    execute(input) {
      return run("EXECUTE", input, () => evolution.execute(input));
    }
  });
}
