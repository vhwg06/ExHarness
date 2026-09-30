import { createHash } from "node:crypto";
import { ProductHistoryDriftError } from "./product-history.js";

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

export class ProductClosureConflictError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ProductClosureConflictError";
    this.code = "OUTCOME_CAS_CONFLICT";
  }
}

function isRecoveryRequired(error) {
  return error instanceof ProductHistoryDriftError || error?.code === "RECOVERY_REQUIRED";
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

// Currentness-fenced closure. close() resolves the stored projection, then
// holds the product-history guard AND the acceptance guard (fixed order
// history -> acceptance) across the whole sequence: the freshness re-read,
// writing the immutable ProductOutcomeClaim and the outcome-head CAS. No
// Hn+1 or policy/waiver change can land between check and commit. Historical
// claims are never mutated and never imply current DONE.
export function createProductClosureController({ projectionBuilder, productHistory, acceptanceAuthority, artifactStore, outcomeHeadStore, mutationGuard = null } = {}) {
  invariant(projectionBuilder && typeof projectionBuilder.resolve === "function", "closure controller requires the projection builder");
  invariant(productHistory && typeof productHistory.readChain === "function", "closure controller requires the product history controller (readChain)");
  invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "closure controller requires the acceptance authority");
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "closure controller requires an immutable artifact store");
  invariant(outcomeHeadStore && typeof outcomeHeadStore.current === "function" && typeof outcomeHeadStore.compareAndSwap === "function", "closure controller requires a CAS outcome head store");
  invariant(mutationGuard && typeof mutationGuard.withProduct === "function" && typeof mutationGuard.withAcceptance === "function", "closure controller requires the shared product mutation guard");

  async function close({ projectionRef } = {}) {
    const args = arguments[0] ?? {};
    for (const key of Object.keys(args)) {
      invariant(key === "projectionRef", `close accepts no caller-selected refs; ${key} is not accepted`);
    }
    requireText(projectionRef, "projectionRef");
    const projection = await projectionBuilder.resolve(projectionRef);
    invariant(projection.kind === "PRODUCT_STATE_PROJECTION" && projection.version === 1, "projection kind/version mismatch");
    if (projection.readiness !== "ELIGIBLE_FOR_CLOSURE") {
      throw new ProductClosureNotReadyError("projection is NOT_READY; only ELIGIBLE_FOR_CLOSURE can close");
    }
    const subject = projection.subject;
    const productId = requireText(subject.productId, "projection subject productId");

    return mutationGuard.withProduct(productId, () => mutationGuard.withAcceptance(productId, async () => {
      const observed = await productHistory.readChain({ productId });
      if (
        observed.head == null ||
        observed.generation !== subject.historyGeneration ||
        observed.historyDigest !== subject.historyDigest ||
        observed.commitRef !== subject.historyCommitRef
      ) {
        throw new ProductClosureStaleError("projection history head Hn is stale; a closure-relevant Hn+1 transition requires re-evaluation");
      }
      const acceptance = await acceptanceAuthority.resolveCurrent({ productId });
      if (
        acceptance.policyRef !== subject.policyRef ||
        acceptance.policyRevision !== subject.policyRevision ||
        acceptance.waiverSetDigest !== subject.waiverSetDigest
      ) {
        throw new ProductClosureStaleError("acceptance-policy/waiver head drifted; the old projection subject is non-current");
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
      const head = await outcomeHeadStore.current(subjectKey);
      if (head != null && (head.value.historyGeneration ?? 0) > subject.historyGeneration) {
        throw new ProductClosureStaleError("a newer closure already advanced the outcome head beyond this subject");
      }
      const next = {
        outcomeRef,
        projectionRef,
        historyGeneration: subject.historyGeneration,
        historyDigest: subject.historyDigest,
        policyRevision: subject.policyRevision,
        waiverSetDigest: subject.waiverSetDigest,
      };
      if (!(await outcomeHeadStore.compareAndSwap(subjectKey, head?.revision ?? null, next))) {
        throw new ProductClosureConflictError("product outcome CAS conflict");
      }
      const stored = await outcomeHeadStore.current(subjectKey);
      return freeze({ outcomeRef, outcome: defineProductOutcomeClaim(claim), head: stored });
    }));
  }

  // Resolve the latest immutable claim and revalidate it against the current
  // canonical subject. CURRENT only when the pinned subject still equals
  // current history/policy/waiver state and a pinned rebuild stays eligible.
  // Only history/authority drift (RECOVERY_REQUIRED) maps to NOT_READY; any
  // other error propagates.
  async function currentOutcome({ productId } = {}) {
    requireText(productId, "productId");
    const subjectKey = productOutcomeSubjectKey(productId);
    const head = await outcomeHeadStore.current(subjectKey);
    if (head == null) return freeze({ status: "NO_OUTCOME", outcome: null, outcomeRef: null });
    const raw = await artifactStore.resolve(head.value.outcomeRef);
    const outcome = defineProductOutcomeClaim(raw);
    let history = null;
    try {
      history = await productHistory.current({ productId });
    } catch (error) {
      if (isRecoveryRequired(error)) {
        return freeze({ status: "NOT_READY", reason: "RECOVERY_REQUIRED", outcome, outcomeRef: head.value.outcomeRef });
      }
      throw error;
    }
    const acceptance = await acceptanceAuthority.resolveCurrent({ productId });
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
      rebuilt = await projectionBuilder.rebuild({ subject: pinned });
    } catch (error) {
      if (isRecoveryRequired(error)) {
        return freeze({ status: "NOT_READY", reason: "RECOVERY_REQUIRED", outcome, outcomeRef: head.value.outcomeRef });
      }
      throw error;
    }
    if (rebuilt.projection.readiness !== "ELIGIBLE_FOR_CLOSURE") {
      return freeze({ status: "HISTORICAL", reason: "NO_LONGER_ELIGIBLE", outcome, outcomeRef: head.value.outcomeRef });
    }
    return freeze({ status: "CURRENT", outcome, outcomeRef: head.value.outcomeRef, head });
  }

  return Object.freeze({ close, currentOutcome });
}
