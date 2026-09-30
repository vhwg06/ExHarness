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

const FORBIDDEN_INPUTS = new Set(["claimRefs", "obligationRefs", "qualityRefs", "waiverRefs", "releaseRefs", "selectedRefs"]);

// Deterministic disposable reduction of the complete canonical subject. The
// only accepted input is {productId, rootIntentRef}: every claim, obligation,
// release, quality and waiver ref is derived from canonical history and the
// canonical acceptance authority, never from caller selection.
export function createProductStateProjectionBuilder({ productHistory, acceptanceAuthority, artifactResolvers, artifactStore } = {}) {
  invariant(productHistory && typeof productHistory.current === "function", "projection builder requires the product history controller");
  invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "projection builder requires the acceptance authority");
  invariant(artifactResolvers && typeof artifactResolvers === "object", "projection builder requires artifact resolvers");
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "projection builder requires an immutable artifact store");

  async function build({ productId, rootIntentRef } = {}) {
    requireText(productId, "productId");
    requireText(rootIntentRef, "rootIntentRef");
    for (const key of Object.keys(arguments[0] ?? {})) {
      invariant(!FORBIDDEN_INPUTS.has(key), `ProductStateProjection accepts no caller-selected completeness refs; ${key} is not accepted`);
    }

    const read = async () => {
      const history = await productHistory.current({ productId });
      invariant(history != null, `no product history for ${productId}`);
      const acceptance = await acceptanceAuthority.resolveCurrent({ productId });
      return { history, acceptance };
    };
    const { history, acceptance } = typeof productHistory.withProductGuard === "function"
      ? await productHistory.withProductGuard({ productId }, read)
      : await read();

    const claims = artifactResolvers.listSemanticClaims
      ? freeze((await artifactResolvers.listSemanticClaims(productId)) ?? []) : [];
    const obligations = artifactResolvers.listObligations
      ? freeze((await artifactResolvers.listObligations(productId)) ?? []) : [];
    const release = artifactResolvers.currentRelease
      ? await artifactResolvers.currentRelease(productId) : null;
    const quality = artifactResolvers.currentQuality
      ? await artifactResolvers.currentQuality(productId) : null;

    const waived = new Set();
    for (const waiver of acceptance.waivers ?? []) {
      for (const code of waiver.waives ?? []) waived.add(code);
      for (const criterion of waiver.criterionRefs ?? []) waived.add(`criterion:${criterion}`);
    }

    const blockers = [];
    const claimRefs = [];
    for (const claim of claims) {
      requireText(claim.ref, "claim ref");
      claimRefs.push(claim.ref);
      const rejected = claim.status === "QUALITY_REJECTED" || claim.status === "REJECTED" || claim.verdict === "QUALITY_REJECTED";
      if (rejected && !waived.has(`claim:${claim.ref}`) && !waived.has("QUALITY_REJECTED")) {
        blockers.push({ code: "REJECTED_CLAIM", ref: claim.ref });
      }
    }
    const obligationRefs = [];
    for (const obligation of obligations) {
      requireText(obligation.ref, "obligation ref");
      obligationRefs.push(obligation.ref);
      const blocking = obligation.status === "BLOCKING" || obligation.status === "ACTIVE" || obligation.blocking === true;
      const satisfied = obligation.status === "SATISFIED" || obligation.satisfied === true;
      if (blocking && !satisfied && !waived.has(`obligation:${obligation.ref}`)) {
        blockers.push({ code: "BLOCKING_OBLIGATION", ref: obligation.ref });
      }
    }
    const releaseRef = release?.releaseRef ?? null;
    if (releaseRef == null) {
      if (!waived.has("NO_RELEASE")) blockers.push({ code: "NO_RELEASE" });
    }
    const qualityRef = quality?.acceptanceRef ?? null;
    const qualityCurrent = quality?.current === true;
    if (qualityRef == null || !qualityCurrent) {
      if (!waived.has("NO_QUALITY_ACCEPTANCE")) blockers.push({ code: "NO_QUALITY_ACCEPTANCE", ...(qualityRef ? { ref: qualityRef } : {}) });
    }

    blockers.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
    const readiness = blockers.length === 0 ? "ELIGIBLE_FOR_CLOSURE" : "NOT_READY";
    const activeSetDigest = digestOf({
      claims: [...claimRefs].sort(),
      obligations: [...obligationRefs].sort(),
      releaseRef,
      qualityRef,
      blockers,
    });

    const subject = freeze({
      kind: "PRODUCT_PROJECTION_SUBJECT",
      version: 1,
      productId,
      rootIntentRef,
      historyGeneration: history.generation,
      historyDigest: history.historyDigest,
      historyCommitRef: history.commitRef,
      policyRef: acceptance.policyRef,
      policyRevision: acceptance.policyRevision,
      waiverRefs: [...acceptance.waiverRefs].sort(),
      waiverSetDigest: acceptance.waiverSetDigest,
    });
    const projection = freeze({
      kind: "PRODUCT_STATE_PROJECTION",
      version: 1,
      subject,
      readiness,
      activeSetDigest,
      blockers,
      claimRefs: [...claimRefs].sort(),
      obligationRefs: [...obligationRefs].sort(),
      releaseRef,
      qualityAcceptanceRef: qualityRef,
    });
    const subjectRef = await artifactStore.put("product-projection-subject", structuredClone(subject));
    const projectionRef = await artifactStore.put("product-state-projection", structuredClone(projection));
    return freeze({ subjectRef, subject, projectionRef, projection });
  }

  async function resolve(projectionRef) {
    requireText(projectionRef, "projectionRef");
    const raw = await artifactStore.resolve(projectionRef);
    invariant(raw, `ProductStateProjection is unavailable: ${projectionRef}`);
    invariant(raw.kind === "PRODUCT_STATE_PROJECTION" && raw.version === 1, "ProductStateProjection kind/version mismatch");
    return freeze(raw);
  }

  return Object.freeze({ build, resolve });
}
