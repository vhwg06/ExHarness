import { createHash } from "node:crypto";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
const digestOf = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const freeze = (value) => Object.freeze(structuredClone(value));

export function productHistorySubjectKey(productId) {
  return "product-history-head:" + digestOf({ productId: requireText(productId, "productId") });
}

export class ProductHistoryDriftError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ProductHistoryDriftError";
    this.code = "RECOVERY_REQUIRED";
  }
}

export class ProductHistoryConflictError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ProductHistoryConflictError";
    this.code = "PRODUCT_HISTORY_CONFLICT";
  }
}

// Shared project mutation guard. One instance can be shared by product history,
// acceptance-policy authority, deployment release and QA publishers. Keys are
// namespaced so history (`product-history:<id>`) and acceptance
// (`product-acceptance:<id>`) guards can be held simultaneously, while the same
// key serializes. Also implements `withEnvironment` so it can be dropped into
// the delivered deployment release controller as its mutationGuard.
export function createProductMutationGuard() {
  const tails = new Map();
  async function withKey(key, action) {
    requireText(key, "guard key");
    invariant(typeof action === "function", "guard action is required");
    const previous = tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    tails.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  }
  return Object.freeze({
    withKey,
    withProduct: (productId, action) => withKey(`product-history:${requireText(productId, "productId")}`, action),
    withAcceptance: (productId, action) => withKey(`product-acceptance:${requireText(productId, "productId")}`, action),
    withEnvironment: (environmentRef, action) => withKey(`env:${requireText(environmentRef, "environmentRef")}`, action),
  });
}

const CLOSURE_RELEVANT_KINDS = new Set([
  "SEMANTIC_PUBLICATION",
  "OBLIGATION_TRANSITION",
  "RELEASE_PUBLICATION",
  "QUALITY_ACCEPTANCE",
  "ACCEPTED_PRODUCT_REVISION",
  "ACCEPTANCE_POLICY_REVISION",
  "WAIVER_REVISION",
]);

function assertClosureRelevant(kind) {
  requireText(kind, "transitionKind");
  invariant(
    CLOSURE_RELEVANT_KINDS.has(kind),
    `transitionKind ${kind} is not closure-relevant; execution policy/strategy/attempt changes do not advance product history`
  );
  return kind;
}

function historyDigestFor({ productId, generation, previousDigest, transitionKind, transitionRefs, authorityHeads }) {
  return digestOf({ productId, generation, previousDigest, transitionKind, transitionRefs, authorityHeads });
}

export function defineProductHistoryCommit(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "ProductHistoryCommit required");
  invariant(raw.kind === "PRODUCT_HISTORY_COMMIT" && raw.version === 1, "ProductHistoryCommit kind/version mismatch");
  const productId = requireText(raw.productId, "ProductHistoryCommit.productId");
  invariant(Number.isInteger(raw.generation) && raw.generation >= 1, "ProductHistoryCommit.generation invalid");
  assertClosureRelevant(raw.transitionKind);
  invariant(Array.isArray(raw.transitionRefs), "ProductHistoryCommit.transitionRefs must be an array");
  for (const [i, ref] of raw.transitionRefs.entries()) requireText(ref, `ProductHistoryCommit.transitionRefs[${i}]`);
  invariant(raw.authorityHeads && typeof raw.authorityHeads === "object" && !Array.isArray(raw.authorityHeads), "ProductHistoryCommit.authorityHeads required");
  if (raw.generation === 1) {
    invariant(raw.previousCommitRef == null, "genesis commit has no predecessor");
    invariant(raw.previousDigest == null, "genesis commit has no previous digest");
  } else {
    requireText(raw.previousCommitRef, "ProductHistoryCommit.previousCommitRef");
    invariant(typeof raw.previousDigest === "string" && raw.previousDigest.length > 0, "ProductHistoryCommit.previousDigest required");
  }
  const expected = historyDigestFor({
    productId,
    generation: raw.generation,
    previousDigest: raw.previousDigest ?? null,
    transitionKind: raw.transitionKind,
    transitionRefs: [...raw.transitionRefs],
    authorityHeads: canonical(raw.authorityHeads),
  });
  invariant(raw.historyDigest === expected, "ProductHistoryCommit.historyDigest mismatch");
  return freeze(raw);
}

export function createProductHistoryController({ artifactStore, headStore, mutationGuard = createProductMutationGuard(), authorityReaders = null } = {}) {
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "history controller requires an immutable artifact store");
  invariant(headStore && typeof headStore.current === "function" && typeof headStore.compareAndSwap === "function", "history controller requires a CAS head store");
  invariant(mutationGuard && typeof mutationGuard.withProduct === "function", "history controller requires a product mutation guard");
  if (authorityReaders != null) {
    invariant(typeof authorityReaders === "function" || typeof authorityReaders.readAuthorityHeads === "function", "authorityReaders must be a function or expose readAuthorityHeads()");
  }

  async function readLiveHeads(productId) {
    if (authorityReaders == null) return null;
    if (typeof authorityReaders === "function") return freeze((await authorityReaders(productId)) ?? {});
    return freeze((await authorityReaders.readAuthorityHeads(productId)) ?? {});
  }

  function sameHeads(a, b) {
    return JSON.stringify(canonical(a ?? {})) === JSON.stringify(canonical(b ?? {}));
  }

  async function resolveCommit(commitRef) {
    const raw = await artifactStore.resolve(commitRef);
    invariant(raw, `ProductHistoryCommit is unavailable: ${commitRef}`);
    return defineProductHistoryCommit(raw);
  }

  // Walk the immutable chain from genesis to head, validating continuity.
  async function validateChain(headCommitRef) {
    if (headCommitRef == null) return [];
    const chain = [];
    const seen = new Set();
    let ref = headCommitRef;
    while (ref != null) {
      invariant(!seen.has(ref), "product history chain cycle");
      seen.add(ref);
      const commit = await resolveCommit(ref);
      chain.unshift({ ref, commit });
      ref = commit.previousCommitRef ?? null;
    }
    for (let i = 0; i < chain.length; i += 1) {
      const { ref, commit } = chain[i];
      invariant(commit.generation === i + 1, "product history generation gap");
      if (i === 0) {
        invariant(commit.previousCommitRef == null && commit.previousDigest == null, "genesis predecessor mismatch");
      } else {
        invariant(commit.previousCommitRef === chain[i - 1].ref, "product history predecessor ref mismatch");
        invariant(commit.previousDigest === chain[i - 1].commit.historyDigest, "product history predecessor digest mismatch");
      }
      const recomputed = historyDigestFor({
        productId: commit.productId,
        generation: commit.generation,
        previousDigest: commit.previousDigest ?? null,
        transitionKind: commit.transitionKind,
        transitionRefs: [...commit.transitionRefs],
        authorityHeads: canonical(commit.authorityHeads),
      });
      invariant(commit.historyDigest === recomputed, "product history digest mismatch");
      void ref;
    }
    return chain;
  }

  async function readHead(productId) {
    const subjectKey = productHistorySubjectKey(productId);
    const head = await headStore.current(subjectKey);
    if (head == null) return { subjectKey, head: null, commit: null, commitRef: null };
    const commit = await resolveCommit(head.value.commitRef);
    invariant(commit.productId === productId, "ProductHistoryHead points at another product");
    invariant(commit.generation === head.value.generation, "ProductHistoryHead generation mismatch");
    invariant(commit.historyDigest === head.value.historyDigest, "ProductHistoryHead digest mismatch");
    await validateChain(head.value.commitRef);
    return { subjectKey, head, commit, commitRef: head.value.commitRef };
  }

  async function readChainUnlocked(productId) {
    const { subjectKey, head, commit, commitRef } = await readHead(productId);
    if (head == null) return freeze({ subjectKey, head: null, commit: null, commitRef: null, chain: [] });
    const chain = await validateChain(head.value.commitRef);
    const live = await readLiveHeads(productId);
    if (live != null && !sameHeads(commit.authorityHeads, live)) {
      throw new ProductHistoryDriftError(
        `closure-relevant authority drift for ${productId}: canonical history commits to an older state until reconciliation`
      );
    }
    return freeze({
      subjectKey,
      head,
      commit,
      commitRef,
      generation: head.value.generation,
      historyDigest: head.value.historyDigest,
      headRevision: head.revision,
      authorityHeads: commit.authorityHeads,
      chain,
    });
  }

  async function appendLocked({ productId, transitionKind, transitionRefs, authorityHeads }) {
    assertClosureRelevant(transitionKind);
    const refs = [...new Set(transitionRefs.map((r) => requireText(r, "transitionRef")))].sort();
    const heads = freeze(canonical(authorityHeads ?? {}));
    const { subjectKey, head } = await readHead(productId);
    const live = await readLiveHeads(productId);
    if (live != null) {
      invariant(sameHeads(heads, live), "history commit authority observations do not match current closure-relevant authority heads");
    }
    const generation = (head?.value?.generation ?? 0) + 1;
    const previousCommitRef = head?.value?.commitRef ?? null;
    const previousDigest = head?.value?.historyDigest ?? null;
    const historyDigest = historyDigestFor({ productId, generation, previousDigest, transitionKind, transitionRefs: refs, authorityHeads: heads });
    const commit = { kind: "PRODUCT_HISTORY_COMMIT", version: 1, productId, generation, previousCommitRef, previousDigest, transitionKind, transitionRefs: refs, authorityHeads: heads, historyDigest };
    const commitRef = await artifactStore.put("product-history-commit", structuredClone(commit));
    const ok = await headStore.compareAndSwap(subjectKey, head?.revision ?? null, { generation, commitRef, historyDigest });
    if (!ok) throw new ProductHistoryConflictError(`ProductHistoryHead CAS conflict for ${productId}`);
    return freeze({ subjectKey, generation, commitRef, historyDigest, commit: defineProductHistoryCommit(commit) });
  }

  return Object.freeze({
    subjectKey: (productId) => productHistorySubjectKey(productId),

    async appendTransition({ productId, transitionKind, transitionRefs = [], authorityHeads = {} } = {}) {
      requireText(productId, "productId");
      return mutationGuard.withProduct(productId, () => appendLocked({ productId, transitionKind, transitionRefs, authorityHeads }));
    },

    async current({ productId } = {}) {
      requireText(productId, "productId");
      const observed = await readChainUnlocked(productId);
      if (observed.head == null) return null;
      return freeze({
        subjectKey: observed.subjectKey,
        generation: observed.generation,
        commitRef: observed.commitRef,
        historyDigest: observed.historyDigest,
        headRevision: observed.headRevision,
        authorityHeads: observed.authorityHeads,
        transitionKind: observed.commit.transitionKind,
        transitionRefs: observed.commit.transitionRefs,
      });
    },

    // Unguarded validated chain read for the deterministic projection fold.
    // The caller must hold the product history guard across head read, chain
    // fold, artifact resolution and the acceptance read so one projection can
    // never mix Hn with later state. Includes the same fail-closed live
    // authority drift check as current().
    async readChain({ productId } = {}) {
      requireText(productId, "productId");
      return readChainUnlocked(productId);
    },

    // Run action while the product history key is held and the observed head
    // still equals the expected generation/digest. Also fail-closed on live
    // authority drift so a stable projection cannot sit behind newer authority.
    async withCurrentHistoryGuard({ productId, expectedGeneration, expectedDigest } = {}, action) {
      requireText(productId, "productId");
      invariant(Number.isInteger(expectedGeneration), "expectedGeneration required");
      requireText(expectedDigest, "expectedDigest");
      invariant(typeof action === "function", "guard action required");
      return mutationGuard.withProduct(productId, async () => {
        const state = await readHead(productId);
        if (state.head == null || state.head.value.generation !== expectedGeneration || state.head.value.historyDigest !== expectedDigest) {
          throw new ProductHistoryDriftError(`ProductHistoryHead is no longer current for ${productId}`);
        }
        const live = await readLiveHeads(productId);
        if (live != null && !sameHeads(state.commit.authorityHeads, live)) {
          throw new ProductHistoryDriftError(`closure-relevant authority drift for ${productId} during guarded read`);
        }
        return action(freeze({
          subjectKey: state.subjectKey,
          generation: state.head.value.generation,
          commitRef: state.commitRef,
          historyDigest: state.head.value.historyDigest,
          headRevision: state.head.revision,
        }));
      });
    },

    // Hold the product key without an expected-head check (stable projection reads).
    async withProductGuard({ productId } = {}, action) {
      requireText(productId, "productId");
      invariant(typeof action === "function", "guard action required");
      return mutationGuard.withProduct(productId, action);
    },

    // Deterministic reconciliation after a crash between an authority mutation
    // and its history append. Appends exactly one immutable transition whose
    // observations equal the live heads; converges when already current.
    async reconcile({ productId, transitionKind, transitionRefs = [], authorityHeads = {} } = {}) {
      requireText(productId, "productId");
      return mutationGuard.withProduct(productId, async () => {
        const state = await readHead(productId);
        const live = await readLiveHeads(productId);
        const wanted = freeze(canonical(authorityHeads ?? {}));
        if (live != null) {
          invariant(sameHeads(wanted, live), "reconciliation must append the exact live authority observations");
        }
        if (state.head != null && sameHeads(state.commit.authorityHeads, wanted)) {
          return freeze({ reconciled: false, generation: state.head.value.generation, commitRef: state.commitRef, historyDigest: state.head.value.historyDigest });
        }
        const appended = await appendLocked({ productId, transitionKind, transitionRefs, authorityHeads: wanted });
        return freeze({ reconciled: true, ...appended });
      });
    },
  });
}
