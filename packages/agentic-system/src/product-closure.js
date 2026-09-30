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

export function productOutcomeSubjectKey(productId) {
  return "product-outcome-head:" + digestOf({ productId: requireText(productId, "productId") });
}

export class ProductClosureStaleError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ProductClosureStaleError";
    this.code = "STALE_PROJECTION";
  }
}

export class ProductClosureNotReadyError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ProductClosureNotReadyError";
    this.code = "NOT_READY";
  }
}

export function defineProductOutcomeClaim(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "ProductOutcomeClaim required");
  invariant(raw.kind === "PRODUCT_OUTCOME_CLAIM" && raw.version === 1, "ProductOutcomeClaim kind/version mismatch");
  requireText(raw.productId, "ProductOutcomeClaim.productId");
  requireText(raw.projectionRef, "ProductOutcomeClaim.projectionRef");
  invariant(raw.subject && typeof raw.subject === "object", "ProductOutcomeClaim.subject required");
  invariant(raw.readiness === "ELIGIBLE_FOR_CLOSURE", "ProductOutcomeClaim requires ELIGIBLE_FOR_CLOSURE");
  return freeze(raw);
}

// Currentness-fenced closure. close() resolves the stored projection, holds
// the project history and acceptance guards, re-reads the exact
// generation/digest/policy revision/waiverSetDigest, requires equality with
// the pinned subject plus ELIGIBLE_FOR_CLOSURE, writes one immutable
// ProductOutcomeClaim and CAS-advances the latest-outcome head. Historical
// claims are never mutated and never imply current DONE.
export function createProductClosureController({ projectionBuilder, productHistory, acceptanceAuthority, artifactStore, outcomeHeadStore } = {}) {
  invariant(projectionBuilder && typeof projectionBuilder.resolve === "function", "closure controller requires the projection builder");
  invariant(productHistory && typeof productHistory.current === "function", "closure controller requires the product history controller");
  invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "closure controller requires the acceptance authority");
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "closure controller requires an immutable artifact store");
  invariant(outcomeHeadStore && typeof outcomeHeadStore.current === "function" && typeof outcomeHeadStore.compareAndSwap === "function", "closure controller requires a CAS outcome head store");

  async function guardedFreshness(productId, subject) {
    const run = async () => {
      const history = await productHistory.current({ productId });
      const acceptance = await acceptanceAuthority.resolveCurrent({ productId });
      return { history, acceptance };
    };
    // Hold the history key while re-reading so no Hn+1 can commit mid-check.
    if (typeof productHistory.withProductGuard === "function") return productHistory.withProductGuard({ productId }, run);
    return run();
  }

  async function close({ projectionRef } = {}) {
    requireText(projectionRef, "projectionRef");
    const projection = await projectionBuilder.resolve(projectionRef);
    invariant(projection.kind === "PRODUCT_STATE_PROJECTION" && projection.version === 1, "projection kind/version mismatch");
    if (projection.readiness !== "ELIGIBLE_FOR_CLOSURE") {
      throw new ProductClosureNotReadyError("projection is NOT_READY; only ELIGIBLE_FOR_CLOSURE can close");
    }
    const subject = projection.subject;
    const productId = requireText(subject.productId, "projection subject productId");

    const { history, acceptance } = await guardedFreshness(productId, subject);
    if (
      history == null ||
      history.generation !== subject.historyGeneration ||
      history.historyDigest !== subject.historyDigest ||
      history.commitRef !== subject.historyCommitRef
    ) {
      throw new ProductClosureStaleError("projection history head Hn is stale; a closure-relevant Hn+1 transition requires re-evaluation");
    }
    if (
      acceptance.policyRef !== subject.policyRef ||
      acceptance.policyRevision !== subject.policyRevision ||
      acceptance.waiverSetDigest !== subject.waiverSetDigest
    ) {
      throw new ProductClosureStaleError("acceptance-policy/waiver head drifted; the old projection subject is non-current");
    }
    // Second guarded re-read immediately before commit: any Hn+1 or policy
    // drift that landed before the final commit still rejects the stale basis.
    const recheck = await guardedFreshness(productId, subject);
    if (
      recheck.history.generation !== subject.historyGeneration ||
      recheck.history.historyDigest !== subject.historyDigest
    ) {
      throw new ProductClosureStaleError("product history advanced before the final closure commit");
    }
    if (
      recheck.acceptance.policyRevision !== subject.policyRevision ||
      recheck.acceptance.waiverSetDigest !== subject.waiverSetDigest
    ) {
      throw new ProductClosureStaleError("acceptance policy advanced before the final closure commit");
    }

    const claim = {
      kind: "PRODUCT_OUTCOME_CLAIM",
      version: 1,
      productId,
      projectionRef,
      subject: structuredClone(subject),
      readiness: projection.readiness,
      activeSetDigest: projection.activeSetDigest,
    };
    const outcomeRef = await artifactStore.put("product-outcome-claim", structuredClone(claim));
    const subjectKey = productOutcomeSubjectKey(productId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const head = await outcomeHeadStore.current(subjectKey);
      const next = {
        outcomeRef,
        projectionRef,
        historyGeneration: subject.historyGeneration,
        historyDigest: subject.historyDigest,
        policyRevision: subject.policyRevision,
        waiverSetDigest: subject.waiverSetDigest,
      };
      if (await outcomeHeadStore.compareAndSwap(subjectKey, head?.revision ?? null, next)) {
        const stored = await outcomeHeadStore.current(subjectKey);
        return freeze({ outcomeRef, outcome: defineProductOutcomeClaim(claim), head: stored });
      }
    }
    throw new TypeError("product outcome CAS contention");
  }

  // Resolve the latest immutable claim and revalidate it against the current
  // canonical subject. CURRENT only when the pinned subject still equals
  // current history/policy/waiver state and a fresh rebuild stays eligible.
  async function currentOutcome({ productId } = {}) {
    requireText(productId, "productId");
    const subjectKey = productOutcomeSubjectKey(productId);
    const head = await outcomeHeadStore.current(subjectKey);
    if (head == null) return freeze({ status: "NO_OUTCOME", outcome: null, outcomeRef: null });
    const raw = await artifactStore.resolve(head.value.outcomeRef);
    const outcome = defineProductOutcomeClaim(raw);
    let history = null;
    let acceptance = null;
    try {
      history = await productHistory.current({ productId });
      acceptance = await acceptanceAuthority.resolveCurrent({ productId });
    } catch {
      return freeze({ status: "NOT_READY", reason: "RECOVERY_REQUIRED", outcome, outcomeRef: head.value.outcomeRef });
    }
    const pinned = outcome.subject;
    const matches =
      history != null &&
      history.generation === pinned.historyGeneration &&
      history.historyDigest === pinned.historyDigest &&
      acceptance.policyRef === pinned.policyRef &&
      acceptance.policyRevision === pinned.policyRevision &&
      acceptance.waiverSetDigest === pinned.waiverSetDigest;
    if (!matches) {
      return freeze({ status: "HISTORICAL", reason: "PRODUCT_DRIFT", outcome, outcomeRef: head.value.outcomeRef });
    }
    let rebuilt = null;
    try {
      rebuilt = await projectionBuilder.build({ productId, rootIntentRef: pinned.rootIntentRef });
    } catch {
      return freeze({ status: "NOT_READY", reason: "REBUILD_FAILED", outcome, outcomeRef: head.value.outcomeRef });
    }
    if (rebuilt.projection.readiness !== "ELIGIBLE_FOR_CLOSURE") {
      return freeze({ status: "HISTORICAL", reason: "NO_LONGER_ELIGIBLE", outcome, outcomeRef: head.value.outcomeRef });
    }
    return freeze({ status: "CURRENT", outcome, outcomeRef: head.value.outcomeRef, head });
  }

  return Object.freeze({ close, currentOutcome });
}
