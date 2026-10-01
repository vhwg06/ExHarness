import { createHash } from "node:crypto";
import { waiverSetDigestFor } from "./product-acceptance-policy.js";

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

// Deterministic disposable reduction of the PINNED canonical subject.
//
// The active claim, obligation, release and quality set is derived by folding
// the validated ProductHistory chain from genesis up to the pinned head
// generation. Each commit's transitionRefs name immutable artifacts; those
// refs are resolved to their immutable content and a later commit supersedes
// what earlier ones established for the same identity key (claim subject,
// obligation key, release/quality environment slot).
//
// Resolvers may only resolve one given ref to its immutable content. No
// resolver may enumerate "the current set": any list*/current* resolver
// contract is rejected at construction, and build() accepts only
// {productId, rootIntentRef}.
export function createProductStateProjectionBuilder({ productHistory, acceptanceAuthority, artifactStore, artifactResolvers = null, mutationGuard = null } = {}) {
  invariant(productHistory && typeof productHistory.readChain === "function", "projection builder requires the product history controller (readChain)");
  invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "projection builder requires the acceptance authority");
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "projection builder requires an immutable artifact store");
  invariant(mutationGuard && typeof mutationGuard.withProduct === "function" && typeof mutationGuard.withAcceptance === "function", "projection builder requires the shared product mutation guard");
  if (artifactResolvers != null) {
    for (const forbidden of ["listSemanticClaims", "listObligations", "currentRelease", "currentQuality"]) {
      invariant(artifactResolvers[forbidden] == null, `ProductStateProjection never enumerates live state; resolver ${forbidden} cannot prove completeness`);
    }
  }

  async function resolveArtifact(ref) {
    requireText(ref, "artifact ref");
    if (artifactResolvers?.resolveArtifact != null) return artifactResolvers.resolveArtifact(ref);
    return artifactStore.resolve(ref);
  }

  // Fold validated chain commits (genesis first) into the active set. Later
  // commits supersede earlier ones for the same identity key.
  async function foldChain(chain) {
    const claims = new Map();
    const obligations = new Map();
    const releases = new Map();
    const qualities = new Map();
    for (const entry of chain) {
      const refs = entry?.commit?.transitionRefs ?? [];
      for (const ref of refs) {
        const content = await resolveArtifact(ref);
        invariant(content && typeof content === "object", `history transition artifact is unavailable: ${ref}`);
        if (content.kind === "SEMANTIC_CLAIM") {
          claims.set(content.subjectKey ?? ref, { ref, content: freeze(content) });
        } else if (content.kind === "CROSS_DOMAIN_OBLIGATION") {
          obligations.set(content.obligationKey ?? content.subjectKey ?? ref, { ref, content: freeze(content) });
        } else if (content.kind === "DEPLOYMENT_RELEASE") {
          releases.set(content.environmentRef ?? "default-release", { ref, content: freeze(content) });
        } else if (content.kind === "QUALITY_ACCEPTANCE") {
          qualities.set(content.environmentRef ?? "default-quality", { ref, content: freeze(content) });
        }
        // Acceptance-policy/waiver revision markers carry no active product
        // state; their currentness is pinned from the acceptance authority.
      }
    }
    return { claims, obligations, releases, qualities };
  }

  function reduce({ claims, obligations, releases, qualities }, acceptance) {
    const waived = new Set();
    for (const waiver of acceptance.waivers ?? []) {
      for (const code of waiver.waives ?? []) waived.add(code);
      for (const criterion of waiver.criterionRefs ?? []) waived.add(`criterion:${criterion}`);
    }
    const blockers = [];
    const claimRefs = [];
    for (const { ref, content } of [...claims.values()].sort((a, b) => a.ref.localeCompare(b.ref))) {
      claimRefs.push(ref);
      const rejected = content.status === "QUALITY_REJECTED" || content.status === "REJECTED" || content.verdict === "QUALITY_REJECTED";
      if (rejected && !waived.has(`claim:${ref}`) && !waived.has("QUALITY_REJECTED")) {
        blockers.push({ code: "REJECTED_CLAIM", ref });
      }
    }
    const obligationRefs = [];
    for (const { ref, content } of [...obligations.values()].sort((a, b) => a.ref.localeCompare(b.ref))) {
      obligationRefs.push(ref);
      const blocking = content.status === "BLOCKING" || content.status === "ACTIVE" || content.blocking === true;
      const satisfied = content.status === "SATISFIED" || content.satisfied === true;
      if (blocking && !satisfied && !waived.has(`obligation:${ref}`)) {
        blockers.push({ code: "BLOCKING_OBLIGATION", ref });
      }
    }
    const releaseRefs = [...releases.values()].map((v) => v.ref).sort();
    const releaseRef = releaseRefs[0] ?? null;
    if (releaseRef == null) {
      if (!waived.has("NO_RELEASE")) blockers.push({ code: "NO_RELEASE" });
    }
    const qualityRefs = [...qualities.values()].map((v) => v.ref).sort();
    const qualityAcceptanceRef = qualityRefs[0] ?? null;
    if (qualityAcceptanceRef == null) {
      if (!waived.has("NO_QUALITY_ACCEPTANCE")) blockers.push({ code: "NO_QUALITY_ACCEPTANCE" });
    } else {
      const primary = [...qualities.values()].sort((a, b) => a.ref.localeCompare(b.ref))[0];
      const namesRelease = primary?.content?.releaseRef;
      if (namesRelease && releaseRefs.length > 0 && !releaseRefs.includes(namesRelease)) {
        if (!waived.has("NO_QUALITY_ACCEPTANCE")) blockers.push({ code: "NO_QUALITY_ACCEPTANCE", ref: primary.ref });
      }
    }
    blockers.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
    const readiness = blockers.length === 0 ? "ELIGIBLE_FOR_CLOSURE" : "NOT_READY";
    const activeSetDigest = digestOf({
      claims: [...claimRefs].sort(),
      obligations: [...obligationRefs].sort(),
      releaseRefs,
      qualityRefs,
      blockers,
    });
    return { blockers, claimRefs: [...claimRefs].sort(), obligationRefs: [...obligationRefs].sort(), releaseRefs, releaseRef, qualityRefs, qualityAcceptanceRef, readiness, activeSetDigest };
  }

  async function storeResult({ productId, rootIntentRef, historyGeneration, historyDigest, historyCommitRef, policyRef, policyRevision, waiverRefs, waiverSetDigest, reduced }) {
    const subject = freeze({
      kind: "PRODUCT_PROJECTION_SUBJECT",
      version: 1,
      productId,
      rootIntentRef,
      historyGeneration,
      historyDigest,
      historyCommitRef,
      policyRef,
      policyRevision,
      waiverRefs: [...waiverRefs].sort(),
      waiverSetDigest,
    });
    const projection = freeze({
      kind: "PRODUCT_STATE_PROJECTION",
      version: 1,
      subject,
      readiness: reduced.readiness,
      activeSetDigest: reduced.activeSetDigest,
      blockers: reduced.blockers,
      claimRefs: reduced.claimRefs,
      obligationRefs: reduced.obligationRefs,
      releaseRefs: reduced.releaseRefs,
      releaseRef: reduced.releaseRef,
      qualityAcceptanceRefs: reduced.qualityRefs,
      qualityAcceptanceRef: reduced.qualityAcceptanceRef,
    });
    const subjectRef = await artifactStore.put("product-projection-subject", structuredClone(subject));
    const projectionRef = await artifactStore.put("product-state-projection", structuredClone(projection));
    return freeze({ subjectRef, subject, projectionRef, projection });
  }

  async function build({ productId, rootIntentRef } = {}) {
    const args = arguments[0] ?? {};
    for (const key of Object.keys(args)) {
      invariant(key === "productId" || key === "rootIntentRef", `ProductStateProjection accepts no caller-selected completeness refs; ${key} is not accepted`);
    }
    requireText(productId, "productId");
    requireText(rootIntentRef, "rootIntentRef");
    // ONE held guard scope, fixed order history -> acceptance: head read,
    // chain fold, artifact resolution and the acceptance read cannot mix Hn
    // with later state.
    return mutationGuard.withProduct(productId, () => mutationGuard.withAcceptance(productId, async () => {
      const observed = await productHistory.readChain({ productId });
      invariant(observed.head != null, `no product history for ${productId}`);
      const acceptance = await acceptanceAuthority.resolveCurrent({ productId });
      const folded = await foldChain(observed.chain);
      const reduced = reduce(folded, acceptance);
      return storeResult({
        productId,
        rootIntentRef,
        historyGeneration: observed.generation,
        historyDigest: observed.historyDigest,
        historyCommitRef: observed.commitRef,
        policyRef: acceptance.policyRef,
        policyRevision: acceptance.policyRevision,
        waiverRefs: acceptance.waiverRefs,
        waiverSetDigest: acceptance.waiverSetDigest,
        reduced,
      });
    }));
  }

  // Deterministic pinned rebuild: re-derive the projection for an exact
  // stored subject (history generation/digest/commit plus policy/waiver
  // pins), ignoring any newer live state. Byte-identical for the same
  // subject: same readiness, activeSetDigest and blockers.
  async function rebuild({ subject } = {}) {
    invariant(subject && typeof subject === "object", "rebuild requires the pinned projection subject");
    invariant(subject.kind === "PRODUCT_PROJECTION_SUBJECT" && subject.version === 1, "projection subject kind/version mismatch");
    const productId = requireText(subject.productId, "subject productId");
    const rootIntentRef = requireText(subject.rootIntentRef, "subject rootIntentRef");
    const observed = await productHistory.readChain({ productId });
    const index = observed.chain.findIndex((entry) => entry.ref === subject.historyCommitRef);
    invariant(index >= 0, "pinned history commit is not in the canonical chain");
    invariant(observed.chain[index].commit.generation === subject.historyGeneration, "pinned history generation mismatch");
    invariant(observed.chain[index].commit.historyDigest === subject.historyDigest, "pinned history digest mismatch");
    const policyRaw = await resolveArtifact(subject.policyRef);
    invariant(policyRaw?.kind === "PRODUCT_ACCEPTANCE_POLICY" && policyRaw.productId === productId, "pinned acceptance policy mismatch");
    invariant(policyRaw.revision === subject.policyRevision, "pinned policy revision mismatch");
    const waivers = [];
    for (const ref of [...subject.waiverRefs].sort()) {
      const raw = await resolveArtifact(ref);
      invariant(raw?.kind === "PRODUCT_ACCEPTANCE_WAIVER" && raw.productId === productId, `pinned waiver mismatch: ${ref}`);
      waivers.push(raw);
    }
    invariant(waiverSetDigestFor([...subject.waiverRefs].sort()) === subject.waiverSetDigest, "pinned waiverSetDigest mismatch");
    const acceptancePinned = { policyRef: subject.policyRef, policyRevision: subject.policyRevision, waiverRefs: [...subject.waiverRefs].sort(), waiverSetDigest: subject.waiverSetDigest, waivers, policy: policyRaw };
    const folded = await foldChain(observed.chain.slice(0, index + 1));
    const reduced = reduce(folded, acceptancePinned);
    return storeResult({
      productId,
      rootIntentRef,
      historyGeneration: subject.historyGeneration,
      historyDigest: subject.historyDigest,
      historyCommitRef: subject.historyCommitRef,
      policyRef: subject.policyRef,
      policyRevision: subject.policyRevision,
      waiverRefs: subject.waiverRefs,
      waiverSetDigest: subject.waiverSetDigest,
      reduced,
    });
  }

  async function resolve(projectionRef) {
    requireText(projectionRef, "projectionRef");
    const raw = await artifactStore.resolve(projectionRef);
    invariant(raw, `ProductStateProjection is unavailable: ${projectionRef}`);
    invariant(raw.kind === "PRODUCT_STATE_PROJECTION" && raw.version === 1, "ProductStateProjection kind/version mismatch");
    return freeze(raw);
  }

  return Object.freeze({ build, rebuild, resolve });
}
