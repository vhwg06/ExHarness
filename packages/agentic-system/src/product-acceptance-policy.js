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

export function productAcceptanceSubjectKey(productId) {
  return "product-acceptance-head:" + digestOf({ productId: requireText(productId, "productId") });
}

export function defineProductAcceptancePolicy(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "ProductAcceptancePolicy required");
  if (raw.kind != null || raw.version != null) invariant(raw.kind === "PRODUCT_ACCEPTANCE_POLICY" && raw.version === 1, "ProductAcceptancePolicy kind/version mismatch");
  const productId = requireText(raw.productId, "ProductAcceptancePolicy.productId");
  invariant(Number.isInteger(raw.revision) && raw.revision >= 1, "ProductAcceptancePolicy.revision invalid");
  requireText(raw.policyId, "ProductAcceptancePolicy.policyId");
  const criterionRefs = [...(raw.criterionRefs ?? [])].map((r, i) => requireText(r, `ProductAcceptancePolicy.criterionRefs[${i}]`));
  invariant(criterionRefs.length > 0, "ProductAcceptancePolicy requires acceptance criteria");
  return freeze({ kind: "PRODUCT_ACCEPTANCE_POLICY", version: 1, productId, revision: raw.revision, policyId: raw.policyId, criterionRefs: [...criterionRefs].sort() });
}

export function defineProductAcceptanceWaiver(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "ProductAcceptanceWaiver required");
  if (raw.kind != null || raw.version != null) invariant(raw.kind === "PRODUCT_ACCEPTANCE_WAIVER" && raw.version === 1, "ProductAcceptanceWaiver kind/version mismatch");
  const productId = requireText(raw.productId, "ProductAcceptancePolicy.productId");
  const waiverId = requireText(raw.waiverId, "ProductAcceptanceWaiver.waiverId");
  const waives = [...(raw.waives ?? [])].map((w, i) => requireText(w, `ProductAcceptanceWaiver.waives[${i}]`));
  const criterionRefs = [...(raw.criterionRefs ?? [])].map((r, i) => requireText(r, `ProductAcceptanceWaiver.criterionRefs[${i}]`));
  return freeze({ kind: "PRODUCT_ACCEPTANCE_WAIVER", version: 1, productId, waiverId, waives: [...waives].sort(), criterionRefs: [...criterionRefs].sort() });
}

export function waiverSetDigestFor(waiverRefs) {
  return digestOf({ waiverRefs: [...waiverRefs].sort() });
}

// Canonical acceptance-policy authority. Immutable policy/waiver artifacts sit
// behind one CAS head per product that pins the exact policy ref/revision plus
// the complete applicable waiver set. No public method accepts caller
// waiverRefs: the resolver derives the full set from canonical authority.
export function createProductAcceptanceAuthority({ artifactStore, headStore, mutationGuard } = {}) {
  invariant(artifactStore && typeof artifactStore.put === "function" && typeof artifactStore.resolve === "function", "acceptance authority requires an immutable artifact store");
  invariant(headStore && typeof headStore.current === "function" && typeof headStore.compareAndSwap === "function", "acceptance authority requires a CAS head store");
  const guard = mutationGuard ?? null;
  if (guard != null) invariant(typeof guard.withAcceptance === "function" || typeof guard.withProduct === "function", "acceptance authority requires a product acceptance guard");

  async function withGuard(productId, action) {
    if (guard == null) return action();
    if (typeof guard.withAcceptance === "function") return guard.withAcceptance(productId, action);
    return guard.withProduct(`acceptance:${productId}`, action);
  }

  async function readHead(productId) {
    const subjectKey = productAcceptanceSubjectKey(productId);
    const head = await headStore.current(subjectKey);
    return { subjectKey, head };
  }

  async function publishPolicy({ productId, policy }) {
    requireText(productId, "productId");
    invariant(policy && typeof policy === "object", "policy required");
    return withGuard(productId, async () => {
      const { subjectKey, head } = await readHead(productId);
      const currentRevision = head?.value?.policyRevision ?? 0;
      const defined = defineProductAcceptancePolicy({ ...policy, productId, revision: policy.revision ?? currentRevision + 1 });
      invariant(defined.revision === currentRevision + 1, "acceptance policy revision must advance by one");
      const policyRef = await artifactStore.put("product-acceptance-policy", structuredClone(defined));
      const waiverRefs = [...(head?.value?.waiverRefs ?? [])].sort();
      const next = {
        policyRef,
        policyRevision: defined.revision,
        waiverRefs,
        waiverSetDigest: waiverSetDigestFor(waiverRefs),
        generation: (head?.value?.generation ?? 0) + 1,
      };
      invariant(await headStore.compareAndSwap(subjectKey, head?.revision ?? null, next), "ProductAcceptanceHead CAS conflict");
      const stored = await headStore.current(subjectKey);
      return freeze({ subjectKey, policyRef, policy: defined, head: stored });
    });
  }

  async function publishWaiver({ productId, waiver }) {
    requireText(productId, "productId");
    invariant(waiver && typeof waiver === "object", "waiver required");
    return withGuard(productId, async () => {
      const { subjectKey, head } = await readHead(productId);
      invariant(head != null, "acceptance policy must exist before a waiver can apply");
      const defined = defineProductAcceptanceWaiver({ ...waiver, productId });
      const waiverRef = await artifactStore.put("product-acceptance-waiver", structuredClone(defined));
      const waiverRefs = [...new Set([...(head.value.waiverRefs ?? []), waiverRef])].sort();
      const next = {
        policyRef: head.value.policyRef,
        policyRevision: head.value.policyRevision,
        waiverRefs,
        waiverSetDigest: waiverSetDigestFor(waiverRefs),
        generation: head.value.generation + 1,
      };
      invariant(await headStore.compareAndSwap(subjectKey, head.revision, next), "ProductAcceptanceHead CAS conflict");
      const stored = await headStore.current(subjectKey);
      return freeze({ subjectKey, waiverRef, waiver: defined, head: stored });
    });
  }

  async function resolveCurrent({ productId } = {}) {
    requireText(productId, "productId");
    const { subjectKey, head } = await readHead(productId);
    invariant(head != null, `no acceptance policy for ${productId}`);
    const policyRaw = await artifactStore.resolve(head.value.policyRef);
    const policy = defineProductAcceptancePolicy(policyRaw);
    invariant(policy.productId === productId && policy.revision === head.value.policyRevision, "acceptance head/policy mismatch");
    const waiverRefs = [...head.value.waiverRefs].sort();
    invariant(JSON.stringify(waiverRefs) === JSON.stringify([...new Set(waiverRefs)]), "acceptance waiver set must be deduplicated");
    invariant(waiverSetDigestFor(waiverRefs) === head.value.waiverSetDigest, "acceptance waiverSetDigest mismatch");
    const waivers = [];
    for (const ref of waiverRefs) {
      const raw = await artifactStore.resolve(ref);
      invariant(raw, `acceptance waiver is unavailable: ${ref}`);
      const defined = defineProductAcceptanceWaiver(raw);
      invariant(defined.productId === productId, "acceptance waiver product mismatch");
      waivers.push({ ref, waiver: defined });
    }
    return freeze({
      subjectKey,
      headRevision: head.revision,
      generation: head.value.generation,
      policyRef: head.value.policyRef,
      policyRevision: head.value.policyRevision,
      policy,
      waiverRefs,
      waivers: waivers.map((w) => w.waiver),
      waiverSetDigest: head.value.waiverSetDigest,
    });
  }

  async function withCurrentPolicyGuard({ productId, expectedPolicyRevision, expectedWaiverSetDigest } = {}, action) {
    requireText(productId, "productId");
    invariant(Number.isInteger(expectedPolicyRevision), "expectedPolicyRevision required");
    requireText(expectedWaiverSetDigest, "expectedWaiverSetDigest");
    invariant(typeof action === "function", "guard action required");
    return withGuard(productId, async () => {
      const state = await resolveCurrent({ productId });
      if (state.policyRevision !== expectedPolicyRevision || state.waiverSetDigest !== expectedWaiverSetDigest) {
        throw new TypeError(`acceptance policy is no longer current for ${productId}`);
      }
      return action(state);
    });
  }

  return Object.freeze({ publishPolicy, publishWaiver, resolveCurrent, withCurrentPolicyGuard });
}
