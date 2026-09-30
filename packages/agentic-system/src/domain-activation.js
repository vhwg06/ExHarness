import { activationKey, activationKeyId, isObligationCurrent } from "./domain-activation-source.js";

// Level-triggered, domain-local activation. Activation is NOT scheduling: it only
// reconciles one exact canonical work identity {projectId,workId,owningDomain}. It never
// ranks work, chooses a next role/domain, selects policy/strategy/runtime, or creates,
// mutates or makes current a CrossDomainObligation. Wake-up hints carry no authority:
// the principal comes from host configuration, obligation provenance from the WorkContract,
// and policy/strategy/runtime from the DomainExecutionController.
export const ActivationOutcome = Object.freeze({
  EXECUTED: "EXECUTED",
  NOOP: "NOOP",
  REJECTED: "REJECTED"
});
export const ActivationReason = Object.freeze({
  DOMAIN_MISMATCH: "DOMAIN_MISMATCH",
  NOT_ACTIONABLE: "NOT_ACTIONABLE",
  CONTRACT_MISMATCH: "CONTRACT_MISMATCH",
  OBLIGATION_NOT_CURRENT: "OBLIGATION_NOT_CURRENT",
  OBLIGATION_DRIFT_AFTER_RELEASE: "OBLIGATION_DRIFT_AFTER_RELEASE",
  CLAIM_CONTENDED: "CLAIM_CONTENDED",
  DUPLICATE_IN_FLIGHT: "DUPLICATE_IN_FLIGHT"
});

function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
const outcome = (value) => Object.freeze(structuredClone(value));

export function createDomainActivation({
  owningDomain,
  principalContext,
  source,
  claimController,
  executionController,
  obligationCurrentness = null,
  readBlackboard = null
}) {
  const domain = requireText(owningDomain, "activation owningDomain");
  invariant(principalContext !== undefined, "activation requires host-configured principalContext");
  invariant(source && typeof source.read === "function", "activation requires canonical source.read()");
  invariant(claimController && typeof claimController.claim === "function" && typeof claimController.release === "function", "activation requires organization claim controller");
  invariant(executionController && typeof executionController.execute === "function", "activation requires DomainExecutionController.execute()");
  if (obligationCurrentness != null) invariant(typeof obligationCurrentness.current === "function", "obligation currentness reader requires current()");
  const hostPrincipal = structuredClone(principalContext);
  // Disposable latency state: collapses concurrent identical keys inside this host only.
  const inFlight = new Map();

  async function obligationCurrent(contract) {
    if (!contract.crossDomainObligationRef) return true;
    invariant(obligationCurrentness, "cross-domain work requires an obligation currentness reader");
    return isObligationCurrent(await obligationCurrentness.current(contract.crossDomainObligationRef), contract);
  }

  async function claimedElsewhere(itemId) {
    if (typeof readBlackboard !== "function") return false;
    const item = (await readBlackboard()).items.find((entry) => entry.id === itemId);
    return item != null && !["READY", "REOPENED"].includes(item.status);
  }

  async function reconcileOnce(key) {
    // D3B admission: configured host domain === key domain === WorkContract.owningDomain.
    if (key.owningDomain !== domain) return outcome({ state: ActivationOutcome.REJECTED, reason: ActivationReason.DOMAIN_MISMATCH, key });
    // D3A: every reconcile rereads the canonical WorkContract before claim.
    const canonical = await source.read(key);
    if (canonical == null) return outcome({ state: ActivationOutcome.NOOP, reason: ActivationReason.NOT_ACTIONABLE, key });
    const { contract } = canonical;
    if (contract.owningDomain !== domain || contract.boardItemId !== key.workId || contract.projectId !== key.projectId) {
      return outcome({ state: ActivationOutcome.REJECTED, reason: ActivationReason.CONTRACT_MISMATCH, key });
    }
    // D3C pre-claim: the exact obligation revision bound by the WorkContract must be ACTIVE.
    if (!(await obligationCurrent(contract))) return outcome({ state: ActivationOutcome.NOOP, reason: ActivationReason.OBLIGATION_NOT_CURRENT, key, contractRef: contract.contractRef });

    let claimed;
    try {
      claimed = await claimController.claim({ itemId: key.workId, principalContext: structuredClone(hostPrincipal) });
    } catch (error) {
      if (await claimedElsewhere(key.workId)) return outcome({ state: ActivationOutcome.NOOP, reason: ActivationReason.CLAIM_CONTENDED, key });
      throw error;
    }
    invariant(claimed.contract.contractRef === contract.contractRef, "claimed WorkContract differs from canonical activation read");
    const released = await claimController.release({ itemId: key.workId, claimGeneration: claimed.item.claimGeneration, principalContext: structuredClone(hostPrincipal) });

    // D3C post-release: reread the same exact subject immediately before execute. Drift yields
    // no attempt; canonical invalidation/release fencing remains owned by dependency invalidation.
    if (!(await obligationCurrent(contract))) {
      return outcome({ state: ActivationOutcome.NOOP, reason: ActivationReason.OBLIGATION_DRIFT_AFTER_RELEASE, key, contractRef: contract.contractRef, claimGeneration: released.claimGeneration, receiptRef: released.receiptRef });
    }
    // Only the released-claim identity is passed; the controller owns policy/strategy/runtime.
    const result = await executionController.execute({ itemId: key.workId, claimGeneration: released.claimGeneration, receiptRef: released.receiptRef });
    return outcome({
      state: ActivationOutcome.EXECUTED,
      key,
      contractRef: contract.contractRef,
      claimGeneration: released.claimGeneration,
      receiptRef: released.receiptRef,
      execution: { state: result.state, replayed: result.replayed, executionAttemptId: result.executionAttemptId, bindingRef: result.bindingRef, completionDecisionRef: result.completionDecisionRef, publicationReceiptRef: result.publicationReceiptRef, judgmentBundleRef: result.judgmentBundleRef }
    });
  }

  return Object.freeze({
    owningDomain: domain,
    async reconcile(rawKey) {
      const key = activationKey(rawKey);
      const id = activationKeyId(key);
      const running = inFlight.get(id);
      if (running) {
        await running.catch(() => {});
        return outcome({ state: ActivationOutcome.NOOP, reason: ActivationReason.DUPLICATE_IN_FLIGHT, key });
      }
      const promise = reconcileOnce(key);
      inFlight.set(id, promise);
      try { return await promise; } finally { inFlight.delete(id); }
    }
  });
}
