import { crossDomainObligationSubjectKey } from "./cross-domain-obligation.js";
// Canonical activation source. Every scan/read goes back to the persisted Board and
// WorkContract through the delivered organization discovery; nothing here is a queue,
// cursor or event log, and nothing here can claim, execute or mutate currentness.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
const freeze = (value) => Object.freeze(structuredClone(value));

export function activationKey(raw) {
  invariant(raw && typeof raw === "object", "activation key is required");
  // Only the exact identity is read. Any other hint field is inert data.
  return freeze({
    projectId: requireText(raw.projectId, "activation key projectId"),
    workId: requireText(raw.workId, "activation key workId"),
    owningDomain: requireText(raw.owningDomain, "activation key owningDomain")
  });
}
export const activationKeyId = (key) => JSON.stringify([key.projectId, key.workId, key.owningDomain]);

export function createDomainActivationSource({ discovery }) {
  invariant(discovery && typeof discovery.listEligible === "function", "activation source requires organization discovery listEligible()");
  async function eligible(owningDomain) {
    return discovery.listEligible({ owningDomain: requireText(owningDomain, "owningDomain") });
  }
  return Object.freeze({
    // Level-triggered: the domain scan is the complete recovery truth for actionable work.
    async scan({ owningDomain }) {
      const found = await eligible(owningDomain);
      return Object.freeze(found.map(({ contract }) => activationKey({ projectId: contract.projectId, workId: contract.boardItemId, owningDomain: contract.owningDomain })));
    },
    // Exact-key canonical reread; returns null when the work is no longer actionable in that domain.
    async read(rawKey) {
      const key = activationKey(rawKey);
      const found = await eligible(key.owningDomain);
      const match = found.find(({ item, contract }) => item.id === key.workId && contract.projectId === key.projectId);
      return match ? Object.freeze({ item: match.item, contract: match.contract }) : null;
    }
  });
}

export const ObligationCurrentnessStatus = Object.freeze({ ACTIVE: "ACTIVE", ABSENT: "ABSENT" });

// Read-only adapter over delivered cross-domain obligation currentness (product lineage).
// It binds the exact WorkContract-required obligation revision to its subject head; it has
// no write, invalidation or fencing capability.
export function createObligationCurrentnessReader({ resolveObligation, currentHead }) {
  invariant(typeof resolveObligation === "function", "obligation currentness reader requires resolveObligation()");
  invariant(typeof currentHead === "function", "obligation currentness reader requires currentHead()");
  return Object.freeze({
    async current(obligationRef) {
      const ref = requireText(obligationRef, "obligationRef");
      const resolved = await resolveObligation(ref);
      invariant(resolved && typeof resolved.subjectKey === "string", `obligation revision is unavailable: ${ref}`);
      const head = await currentHead(resolved.subjectKey);
      return freeze({
        obligationRef: ref,
        subjectKey: resolved.subjectKey,
        revision: head?.revisionRef ?? null,
        status: head?.status ?? ObligationCurrentnessStatus.ABSENT
      });
    }
  });
}

// Convenience binding for the delivered product lineage store (read surface only).
export function obligationCurrentnessFromLineage({ lineage, subjectKeyOf = crossDomainObligationSubjectKey }) {
  invariant(lineage && typeof lineage.resolve === "function" && typeof lineage.snapshot === "function", "lineage read surface required");
  invariant(typeof subjectKeyOf === "function", "subjectKeyOf(artifact) required");
  return createObligationCurrentnessReader({
    resolveObligation: async (ref) => { const artifact = await lineage.resolve(ref); return { subjectKey: subjectKeyOf(artifact) }; },
    currentHead: async (subjectKey) => (await lineage.snapshot()).heads[subjectKey] ?? null
  });
}

export function isObligationCurrent(observation, contract) {
  return observation.status === ObligationCurrentnessStatus.ACTIVE &&
    observation.revision === contract.crossDomainObligationRef &&
    observation.subjectKey === contract.crossDomainObligationSubjectKey;
}
