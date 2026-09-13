import { invariant } from "./contracts.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const z = Math.exp(value);
  return z / (1 + z);
}

function minmax(values) {
  if (values.size === 0) return new Map();
  const entries = [...values.values()];
  const lo = Math.min(...entries);
  const hi = Math.max(...entries);
  if (hi - lo < 1e-12) return new Map([...values.keys()].map((key) => [key, 0]));
  return new Map([...values].map(([key, value]) => [key, (value - lo) / (hi - lo)]));
}

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function tokens(text) {
  return new Set(String(text ?? "").toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

export function baseLevelActivation(accessLog = [], now = Date.now() / 1000, decay = 0.5) {
  let total = 0;
  for (const entry of accessLog) {
    if (entry?.channel === "injected") continue;
    const ts = Number(entry?.ts);
    if (!Number.isFinite(ts)) continue;
    const dt = Math.max(now - ts, 1);
    total += dt ** (-decay);
  }
  return total <= 0 ? -10 : Math.log(total);
}

export function defineNooaRetrievalConfig({
  topK = 5,
  nDense = 20,
  nSparse = 20,
  minSimilarity = 0,
  hops = 1,
  perHopDecay = 0.5,
  perHopFanout = 8,
  activationFloor = 0.001,
  spreadGamma = 0.25,
  lambdaEmbed = 0.8,
  baseLevelDecay = 0.5,
  relevance = 0.6,
  recency = 0.2,
  importance = 0.2
} = {}) {
  invariant(Number.isInteger(topK) && topK > 0, "NOOA retrieval topK must be positive");
  invariant(Number.isInteger(nDense) && nDense > 0, "NOOA retrieval nDense must be positive");
  invariant(Number.isInteger(nSparse) && nSparse > 0, "NOOA retrieval nSparse must be positive");
  invariant(Number.isInteger(hops) && hops >= 0, "NOOA retrieval hops must be non-negative");
  return Object.freeze({
    topK, nDense, nSparse, minSimilarity, hops, perHopDecay, perHopFanout,
    activationFloor, spreadGamma, lambdaEmbed, baseLevelDecay,
    weights: Object.freeze({ relevance, recency, importance })
  });
}

function cueSet(memory) {
  if (Array.isArray(memory.cues)) return new Set(memory.cues.map((cue) => String(cue).toLowerCase()));
  return new Set([...tokens(memory.title), ...tokens(memory.content), ...(memory.tags ?? []).map((tag) => String(tag).toLowerCase())]);
}

/**
 * NOOA-fidelity retrieval adapter.
 * Store contract intentionally mirrors NOOA retrieval primitives instead of inventing ExHarness ranking semantics:
 *   dense(query, limit), sparse(query, limit), get(id), neighbors(id), touch(id, accessRecord)
 * Dense hits are { memoryId, score }; sparse hits may be ids or { memoryId, score }.
 */
export function createNooaMemoryRetriever({ store, config = {}, now = () => Date.now() / 1000 } = {}) {
  invariant(store && typeof store === "object", "NOOA retrieval requires store");
  invariant(typeof store.dense === "function", "NOOA retrieval store requires dense()");
  invariant(typeof store.sparse === "function", "NOOA retrieval store requires sparse()");
  invariant(typeof store.get === "function", "NOOA retrieval store requires get()");
  const cfg = defineNooaRetrievalConfig(config);

  async function pipeline(query, { hops = cfg.hops } = {}) {
    const denseHits = await store.dense(query, cfg.nDense);
    const sparseHits = await store.sparse(query, cfg.nSparse);
    const candidates = new Map();

    for (const hit of denseHits ?? []) {
      if (hit.score < cfg.minSimilarity) continue;
      candidates.set(hit.memoryId, { cos: hit.score, source: "dense" });
    }
    for (const raw of sparseHits ?? []) {
      const memoryId = typeof raw === "string" ? raw : raw.memoryId;
      if (!memoryId) continue;
      const existing = candidates.get(memoryId);
      if (existing) existing.source = "both";
      else candidates.set(memoryId, { cos: Number(raw.score ?? 0), source: "sparse" });
    }
    if (candidates.size === 0) return [];

    const memories = new Map();
    const relRaw = new Map();
    const recRaw = new Map();
    const impRaw = new Map();
    const queryCues = tokens(query);
    const timestamp = now();

    for (const [memoryId, candidate] of candidates) {
      const memory = await store.get(memoryId);
      if (!memory) continue;
      memories.set(memoryId, memory);
      const contextOverlap = jaccard(queryCues, cueSet(memory));
      relRaw.set(memoryId, cfg.lambdaEmbed * candidate.cos + (1 - cfg.lambdaEmbed) * contextOverlap);
      recRaw.set(memoryId, sigmoid(baseLevelActivation(memory.accessLog ?? [], timestamp, cfg.baseLevelDecay)));
      impRaw.set(memoryId, clamp01(Number(memory.importance ?? 0) / 10));
    }

    const rel = minmax(relRaw);
    const rec = minmax(recRaw);
    const imp = minmax(impRaw);
    const activation = new Map();
    const diagnostics = new Map();
    for (const memoryId of memories.keys()) {
      const base = cfg.weights.relevance * (rel.get(memoryId) ?? 0)
        + cfg.weights.recency * (rec.get(memoryId) ?? 0)
        + cfg.weights.importance * (imp.get(memoryId) ?? 0);
      activation.set(memoryId, base);
      diagnostics.set(memoryId, {
        source: candidates.get(memoryId)?.source ?? "spread",
        cos: candidates.get(memoryId)?.cos ?? 0,
        rel: rel.get(memoryId) ?? 0,
        rec: rec.get(memoryId) ?? 0,
        imp: imp.get(memoryId) ?? 0,
        spread: 0
      });
    }

    if (hops > 0 && typeof store.neighbors === "function") {
      let frontier = new Map(activation);
      for (let hop = 1; hop <= hops; hop += 1) {
        const next = new Map();
        const decay = cfg.perHopDecay ** hop;
        for (const [memoryId, sourceActivation] of frontier) {
          const edges = [...(await store.neighbors(memoryId) ?? [])]
            .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))
            .slice(0, cfg.perHopFanout);
          for (const edge of edges) {
            const targetId = edge.targetId ?? edge.target_id;
            if (!targetId) continue;
            const typeWeight = edge.causal === true ? 1 : 0.6;
            const contribution = decay * sourceActivation * Number(edge.weight ?? 0) * typeWeight;
            if (contribution < cfg.activationFloor) continue;
            if (!memories.has(targetId)) {
              const target = await store.get(targetId);
              if (!target) continue;
              memories.set(targetId, target);
              diagnostics.set(targetId, { source: "spread", cos: 0, rel: 0, rec: 0, imp: 0, spread: 0 });
            }
            const extra = cfg.spreadGamma * contribution;
            activation.set(targetId, (activation.get(targetId) ?? 0) + extra);
            diagnostics.get(targetId).spread += extra;
            next.set(targetId, (next.get(targetId) ?? 0) + contribution);
          }
        }
        frontier = next;
        if (frontier.size === 0) break;
      }
    }

    return [...activation]
      .sort((a, b) => b[1] - a[1])
      .map(([memoryId, score], rank) => ({ memoryId, score, rank, diagnostics: diagnostics.get(memoryId) }));
  }

  return Object.freeze({
    name: "nooa-memory-retrieval",
    version: "1",
    async retrieve({ mode, query, limit = cfg.topK }) {
      // NOOA search is lexical/term-oriented and does not graph-hop; recall uses associative spread.
      const ranked = mode === "SEARCH"
        ? await pipeline(query, { hops: 0 })
        : await pipeline(query, { hops: cfg.hops });
      const selected = ranked.slice(0, limit);
      if (typeof store.touch === "function") {
        const ts = now();
        for (const hit of selected) {
          await store.touch(hit.memoryId, {
            ts,
            channel: "recalled",
            query: query.slice(0, 200),
            score: hit.score,
            rank: hit.rank,
            components: hit.diagnostics
          });
        }
      }
      return selected.map((hit) => ({
        memoryId: hit.memoryId,
        score: hit.score,
        reasons: [
          `source:${hit.diagnostics.source}`,
          `rel:${hit.diagnostics.rel.toFixed(4)}`,
          `rec:${hit.diagnostics.rec.toFixed(4)}`,
          `imp:${hit.diagnostics.imp.toFixed(4)}`,
          `spread:${hit.diagnostics.spread.toFixed(4)}`
        ]
      }));
    },
    explain(query, options = {}) {
      return pipeline(query, { hops: options.hops ?? cfg.hops });
    },
    config() {
      return structuredClone(cfg);
    }
  });
}
