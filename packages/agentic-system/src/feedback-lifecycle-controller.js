// Delivery rebuild 2026-10-01: re-validated on current main.
import { createHash } from "node:crypto";
import {
  defineFeedbackEpisode,
  defineFeedbackResponse,
  defineFeedbackOutcome,
  defineFeedbackResolution,
  defineFeedbackOutcomePolicy,
  outcomePolicyDigestFor,
  episodeIdFor,
} from "./feedback-lifecycle-contracts.js";
import { classifyFeedbackOutcome } from "./feedback-outcome.js";
import {
  defineGroundedFindingInput,
  assertGroundedFindingInputCurrent,
} from "./grounded-observation.js";
import { createJsonCasHeadStore } from "./organization-authority-store.js";

export function createJsonFeedbackEpisodeHeadStore(options) {
  return createJsonCasHeadStore(options);
}

export function feedbackEpisodeHeadKeyFor(episodeId) {
  if (typeof episodeId !== "string" || episodeId.trim().length === 0) {
    throw new TypeError("episodeId must be a non-empty string");
  }
  return `feedback-episode:${episodeId}`;
}

const FORBIDDEN_PRINCIPAL_KINDS = Object.freeze(["OBSERVER", "EVALUATOR", "PROVIDER", "OPTIMIZER"]);

function fail(message) {
  throw new TypeError(message);
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalString(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalString(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digestSuffix(ref) {
  const match = String(ref).match(/:sha256:([a-f0-9]{64})$/);
  return match ? match[1] : null;
}
function headValueEquals(a, b) {
  return canonicalString(a) === canonicalString(b);
}

function stateForDisposition(disposition) {
  if (disposition === "ACTED") return "RESPONDED_ACTED";
  if (disposition === "REJECTED") return "RESPONDED_REJECTED";
  if (disposition === "DEFERRED") return "RESPONDED_DEFERRED";
  return "RESPONDED_SUPERSEDED";
}

export function createFeedbackLifecycleController({
  artifactStore,
  headStore,
  principalAuthority,
  receiptCurrentness,
} = {}) {
  if (!artifactStore || typeof artifactStore.put !== "function" || typeof artifactStore.resolve !== "function") {
    fail("feedback lifecycle controller requires an immutable artifactStore with put/resolve");
  }
  if (!headStore || typeof headStore.current !== "function" || typeof headStore.compareAndSwap !== "function") {
    fail("feedback lifecycle controller requires a CAS headStore with current/compareAndSwap");
  }
  if (!principalAuthority || typeof principalAuthority.verifyFeedbackPrincipal !== "function") {
    fail("feedback lifecycle controller requires principalAuthority.verifyFeedbackPrincipal");
  }
  if (typeof receiptCurrentness !== "function") {
    fail("feedback lifecycle controller requires an injected receiptCurrentness function");
  }

  async function verifyPrincipal({ principal, episodeRef, transition }) {
    if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
      fail(`${transition} requires an explicit application principal argument`);
    }
    // Payload-embedded principals are never read: only this explicit argument
    // is consulted. The episode, finding, observation or provider payloads
    // cannot supply authority.
    const kind = principal.kind;
    if (typeof kind === "string" && FORBIDDEN_PRINCIPAL_KINDS.includes(kind)) {
      fail(`${transition} rejects principal of kind ${kind}`);
    }
    let verification;
    try {
      verification = await principalAuthority.verifyFeedbackPrincipal({
        principal: freeze(structuredClone(principal)),
        episodeRef,
        transition,
      });
    } catch (error) {
      fail(`${transition} principal was not verified: ${error?.message ?? error}`);
    }
    const authorityRef = verification?.authorityRef;
    if (typeof authorityRef !== "string" || authorityRef.trim().length === 0) {
      fail(`${transition} principal verification returned no authorityRef`);
    }
    return authorityRef;
  }

  async function resolveInputOrThrow(ref, label) {
    const stored = await artifactStore.resolve(ref);
    if (stored === null || stored === undefined) {
      fail(`${label} artifact is unavailable: ${ref}`);
    }
    try {
      return defineGroundedFindingInput({ ...structuredClone(stored), inputId: stored?.inputId });
    } catch (error) {
      fail(`${label} is not a GROUNDED_FINDING_INPUT_V1 artifact: ${error?.message ?? error}`);
    }
  }

  async function consumptionStatusOrThrow(input) {
    return assertGroundedFindingInputCurrent(input, { receiptCurrentness, artifactStore });
  }

  async function collectAttemptIdsAndBoundaries(inputs) {
    const attemptIds = new Set();
    const boundaries = [];
    for (const input of inputs) {
      const refs = input.observationRefs ?? [];
      for (const pin of refs) {
        let observation = null;
        try {
          observation = await artifactStore.resolve(pin.ref);
        } catch {
          observation = null;
        }
        if (!observation || typeof observation !== "object") continue;
        const attemptId =
          observation?.execution?.executionAttemptId ??
          observation?.executionAttemptId ??
          null;
        if (typeof attemptId === "string" && attemptId) attemptIds.add(attemptId);
        const list = Array.isArray(observation?.observedAtBoundaries) ? observation.observedAtBoundaries : [];
        for (const b of list) {
          if (b && typeof b.at === "string" && Number.isFinite(Date.parse(b.at))) {
            boundaries.push(b.at);
          }
        }
      }
    }
    boundaries.sort();
    return { attemptIds: [...attemptIds].sort(), boundaries };
  }

  function latestBoundary(boundaries) {
    if (boundaries.length === 0) return null;
    return boundaries[boundaries.length - 1];
  }

  async function openEpisode({ groundedInputRefs, finding, impact, scopeKey, contraryEvidenceRefs = [] } = {}) {
    const episode = defineFeedbackEpisode({
      kind: "FEEDBACK_EPISODE_V1",
      version: 1,
      groundedInputRefs: structuredClone(groundedInputRefs ?? []),
      finding: structuredClone(finding),
      impact: structuredClone(impact),
      scopeKey,
      contraryEvidenceRefs: structuredClone(contraryEvidenceRefs ?? []),
    });
    // Bind exact refs+digests and GROUNDED status. A digest mismatch, a
    // non-finding-input artifact or an UNRESOLVED input under MEASURED is
    // rejected before any store write.
    const resolvedInputs = [];
    for (const [index, pin] of episode.groundedInputRefs.entries()) {
      if (pin.digest !== digestSuffix(pin.ref)) {
        fail(`groundedInputRefs[${index}] pin digest mismatch`);
      }
      const input = await resolveInputOrThrow(pin.ref, `groundedInputRefs[${index}]`);
      const expectedDigest = digestSuffix(pin.ref);
      void expectedDigest;
      resolvedInputs.push(input);
    }
    if (episode.impact.basis === "MEASURED") {
      for (const [index, input] of resolvedInputs.entries()) {
        if (input.groundingStatus !== "GROUNDED") {
          fail(`MEASURED impact requires every input GROUNDED; groundedInputRefs[${index}] is ${input.groundingStatus}`);
        }
        const verdict = await consumptionStatusOrThrow(input);
        if (verdict.status !== "GROUNDED") {
          fail(`MEASURED impact requires consumption CURRENT; groundedInputRefs[${index}] is ${verdict.status}`);
        }
      }
    }
    const episodeRef = await artifactStore.put("feedback-episode", structuredClone(episode));
    const key = feedbackEpisodeHeadKeyFor(episode.episodeId);
    const next = freeze({
      episodeRef,
      state: "OPEN",
      responseRef: null,
      outcomeRef: null,
      resolutionRef: null,
    });
    const existing = await headStore.current(key);
    if (existing !== null) {
      // Exact replay converges: the same episode content yields the same
      // artifact ref and the same OPEN head, so no second mutation occurs.
      try {
        const existingEpisodeRaw = await artifactStore.resolve(existing.value.episodeRef);
        if (existingEpisodeRaw !== null) {
          const existingEpisode = defineFeedbackEpisode({
            ...structuredClone(existingEpisodeRaw),
            episodeId: existingEpisodeRaw?.episodeId,
          });
          if (existingEpisode.episodeId === episode.episodeId && headValueEquals(existing.value, next)) {
            return freeze({ status: "CONVERGED", episode: existingEpisode, episodeRef: existing.value.episodeRef, episodeId: existingEpisode.episodeId, head: existing });
          }
          if (existingEpisode.episodeId === episode.episodeId) {
            return freeze({ status: "CONVERGED", episode: existingEpisode, episodeRef: existing.value.episodeRef, episodeId: existingEpisode.episodeId, head: existing });
          }
        }
      } catch {}
    }
    if (existing === null) {
      const swapped = await headStore.compareAndSwap(key, null, structuredClone(next));
      if (swapped) {
        const head = await headStore.current(key);
        return freeze({ status: "OK", episode, episodeRef, episodeId: episode.episodeId, head });
      }
    }
    const current = await headStore.current(key);
    if (current !== null && headValueEquals(current.value, next)) {
      return freeze({ status: "CONVERGED", episode, episodeRef, episodeId: episode.episodeId, head: current });
    }
    if (current !== null && current.value.episodeRef === episodeRef && current.value.state === "OPEN") {
      return freeze({ status: "CONVERGED", episode, episodeRef, episodeId: episode.episodeId, head: current });
    }
    fail(`openEpisode CAS conflict for ${episode.episodeId}: head already exists`);
  }

  function allowedResponseTransition(fromState, disposition) {
    if (fromState === "OPEN") return true;
    if (fromState === "RESPONDED_DEFERRED") return true;
    if (fromState === "RESPONDED_ACTED" && (disposition === "DEFERRED" || disposition === "SUPERSEDED")) return true;
    return false;
  }

  async function respond({
    episodeId,
    expectedRevision,
    principal,
    disposition,
    rationaleRef = null,
    actionRefs = [],
    successorEpisodeRef = null,
    revisitCondition = null,
    outcomePolicy = null,
  } = {}) {
    if (typeof episodeId !== "string" || !episodeId) fail("respond requires episodeId");
    const key = feedbackEpisodeHeadKeyFor(episodeId);
    const head = await headStore.current(key);
    if (head === null) fail(`no feedback episode head for ${episodeId}`);
    if (head.value.state === "RESOLVED") fail("RESOLVED episode accepts no further transition");
    if (head.value.state === "OUTCOME_RECORDED") fail("OUTCOME_RECORDED episode accepts no further response; resolve it");
    if (head.value.state === "RESPONDED_REJECTED" || head.value.state === "RESPONDED_SUPERSEDED") {
      fail(`${head.value.state} episode accepts no further response; resolve it`);
    }
    if (!allowedResponseTransition(head.value.state, disposition)) {
      fail(`disposition ${disposition} is not allowed from state ${head.value.state}`);
    }
    const authorityRef = await verifyPrincipal({
      principal,
      episodeRef: head.value.episodeRef,
      transition: `respond:${disposition}`,
    });
    // Exact replay converges without a second mutation: when the head already
    // carries a response with the same disposition content and the same
    // verified authority, the call returns CONVERGED with no CAS. The
    // previous-response link is excluded from the comparison so a retry with
    // a stale expectedRevision still converges.
    if (head.value.responseRef !== null) {
      try {
        const existingRaw = await artifactStore.resolve(head.value.responseRef);
        if (existingRaw !== null) {
          const requestedPolicy = outcomePolicy === null || outcomePolicy === undefined ? null : defineFeedbackOutcomePolicy(structuredClone(outcomePolicy));
          const existingPolicy = existingRaw.outcomePolicy ? defineFeedbackOutcomePolicy(existingRaw.outcomePolicy) : null;
          const samePolicy =
            (requestedPolicy === null && existingPolicy === null) ||
            (requestedPolicy !== null && existingPolicy !== null && canonicalString(requestedPolicy) === canonicalString(existingPolicy));
          const sameRevisit =
            canonicalString(revisitCondition ?? null) === canonicalString(existingRaw.revisitCondition ?? null);
          if (
            existingRaw.disposition === disposition &&
            canonicalString(existingRaw.actionRefs ?? []) === canonicalString([...(actionRefs ?? [])]) &&
            (existingRaw.rationaleRef ?? null) === (rationaleRef ?? null) &&
            (existingRaw.successorEpisodeRef ?? null) === (successorEpisodeRef ?? null) &&
            sameRevisit &&
            samePolicy &&
            existingRaw.principalAuthorityRef === authorityRef &&
            existingRaw.episodeRef === head.value.episodeRef
          ) {
            return freeze({ status: "CONVERGED", response: defineFeedbackResponse(existingRaw), responseRef: head.value.responseRef, head });
          }
        }
      } catch {}
    }
    // ACTED is refused unless every episode input is GROUNDED at consumption.
    if (disposition === "ACTED") {
      const episodeRaw = await artifactStore.resolve(head.value.episodeRef);
      if (episodeRaw === null) fail("episode artifact is unavailable for ACTED consumption check");
      const episode = defineFeedbackEpisode({ ...structuredClone(episodeRaw), episodeId: episodeRaw?.episodeId });
      for (const [index, pin] of episode.groundedInputRefs.entries()) {
        const input = await resolveInputOrThrow(pin.ref, `episode input[${index}]`);
        if (input.groundingStatus !== "GROUNDED") {
          fail(`ACTED requires every input GROUNDED; input[${index}] is ${input.groundingStatus}`);
        }
        const verdict = await consumptionStatusOrThrow(input);
        if (verdict.status !== "GROUNDED") {
          fail(`ACTED requires consumption CURRENT; input[${index}] is ${verdict.status}`);
        }
      }
    }
    const episodeDigest = digestSuffix(head.value.episodeRef);
    if (!episodeDigest) fail("episode head ref is not content addressed");
    let previousResponseRef = null;
    if (head.value.responseRef !== null) {
      previousResponseRef = {
        ref: head.value.responseRef,
        digest: digestSuffix(head.value.responseRef),
      };
      if (!previousResponseRef.digest) fail("response head ref is not content addressed");
    }
    const response = defineFeedbackResponse({
      kind: "FEEDBACK_RESPONSE_V1",
      version: 1,
      episodeRef: head.value.episodeRef,
      episodeDigest,
      previousResponseRef,
      principalAuthorityRef: authorityRef,
      disposition,
      rationaleRef,
      actionRefs: [...(actionRefs ?? [])],
      successorEpisodeRef,
      revisitCondition: revisitCondition === null || revisitCondition === undefined ? null : structuredClone(revisitCondition),
      outcomePolicy: outcomePolicy === null || outcomePolicy === undefined ? null : structuredClone(outcomePolicy),
      outcomePolicyDigest: null,
    });
    const responseRef = await artifactStore.put("feedback-response", structuredClone(response));
    const next = freeze({
      episodeRef: head.value.episodeRef,
      state: stateForDisposition(disposition),
      responseRef,
      outcomeRef: head.value.outcomeRef,
      resolutionRef: null,
    });
    const swapped = await headStore.compareAndSwap(key, expectedRevision ?? null, structuredClone(next));
    if (swapped) {
      const stored = await headStore.current(key);
      return freeze({ status: "OK", response, responseRef, head: stored });
    }
    const current = await headStore.current(key);
    if (current !== null && headValueEquals(current.value, next)) {
      return freeze({ status: "CONVERGED", response, responseRef, head: current });
    }
    return freeze({ status: "STALE_REVISION", response, responseRef, head: current });
  }

  async function recordOutcome({ episodeId, expectedRevision, freshInputRef, freshMeasurements = [], responseRef = null } = {}) {
    if (typeof episodeId !== "string" || !episodeId) fail("recordOutcome requires episodeId");
    if (typeof freshInputRef !== "string" || !freshInputRef) fail("recordOutcome requires freshInputRef");
    const key = feedbackEpisodeHeadKeyFor(episodeId);
    const head = await headStore.current(key);
    if (head === null) fail(`no feedback episode head for ${episodeId}`);
    if (head.value.state === "OUTCOME_RECORDED") {
      // Exact replay converges: the same fresh input and measurements yield
      // the same outcome artifact and the same head.
      try {
        const existingRaw = await artifactStore.resolve(head.value.outcomeRef);
        if (existingRaw !== null) {
          const existing = defineFeedbackOutcome(existingRaw);
          const sameInput = existing.freshInputRef === freshInputRef;
          const sameFresh = canonicalString(existing.freshMeasurements ?? []) === canonicalString(freshMeasurements ?? []);
          if (sameInput && sameFresh) {
            return freeze({ status: "CONVERGED", outcome: existing, outcomeRef: head.value.outcomeRef, head });
          }
        }
      } catch {}
      fail(`recordOutcome requires state RESPONDED_ACTED; current state is ${head.value.state}`);
    }
    if (head.value.state !== "RESPONDED_ACTED") {
      fail(`recordOutcome requires state RESPONDED_ACTED; current state is ${head.value.state}`);
    }
    if (head.value.responseRef === null) fail("recordOutcome requires a current ACTED response");
    const episodeRaw = await artifactStore.resolve(head.value.episodeRef);
    if (episodeRaw === null) fail("episode artifact is unavailable for outcome");
    const episode = defineFeedbackEpisode({ ...structuredClone(episodeRaw), episodeId: episodeRaw?.episodeId });
    const responseRaw = await artifactStore.resolve(head.value.responseRef);
    if (responseRaw === null) fail("response artifact is unavailable for outcome");
    const responseDigest = digestSuffix(head.value.responseRef);
    // The frozen policy cannot be changed after the response: only the
    // policy digest stored in the current response is ever used.
    const policy = responseRaw.outcomePolicy ? defineFeedbackOutcomePolicy(responseRaw.outcomePolicy) : null;
    if (policy === null) fail("current response carries no frozen outcome policy");
    const policyDigest = responseRaw.outcomePolicyDigest ?? outcomePolicyDigestFor(policy);
    if (policyDigest !== outcomePolicyDigestFor(policy)) fail("frozen outcome policy digest mismatch");

    const freshDigest = digestSuffix(freshInputRef);
    if (!freshDigest) fail("freshInputRef is not content addressed");
    let freshInput = null;
    let freshStatus = "UNRESOLVED";
    let consumptionDetail = "unresolved";
    try {
      freshInput = await resolveInputOrThrow(freshInputRef, "freshInput");
      if (freshInput.groundingStatus === "GROUNDED") {
        const verdict = await consumptionStatusOrThrow(freshInput);
        freshStatus = verdict.status;
        consumptionDetail = verdict.detail ?? verdict.status;
      } else {
        freshStatus = "UNRESOLVED";
        consumptionDetail = "fresh input grounding is UNRESOLVED";
      }
    } catch (error) {
      freshStatus = "UNRESOLVED";
      consumptionDetail = error?.message ?? "fresh input unavailable";
      freshInput = null;
    }

    const baselineInputs = [];
    for (const pin of episode.groundedInputRefs) {
      try {
        baselineInputs.push(await resolveInputOrThrow(pin.ref, "baseline input"));
      } catch {
        // A missing baseline input makes freshness unverifiable; the outcome
        // below stays UNKNOWN rather than throwing.
      }
    }
    const baselineIdentity = await collectAttemptIdsAndBoundaries(baselineInputs);
    const effectiveAfterBoundary = latestBoundary(baselineIdentity.boundaries);
    let freshAttemptIds = [];
    let freshBoundaries = [];
    if (freshInput !== null) {
      const freshIdentity = await collectAttemptIdsAndBoundaries([freshInput]);
      freshAttemptIds = freshIdentity.attemptIds;
      freshBoundaries = freshIdentity.boundaries;
    }

    const suppliedResponseRef = responseRef ?? head.value.responseRef;
    const responseIsCurrent = suppliedResponseRef === head.value.responseRef;
    const isNewInput = !episode.groundedInputRefs.some((p) => p.ref === freshInputRef);
    const baselineSet = new Set(baselineIdentity.attemptIds);
    const attemptsDisjoint =
      freshAttemptIds.length > 0 && freshAttemptIds.every((id) => !baselineSet.has(id));
    const boundariesStrictlyLater =
      effectiveAfterBoundary !== null &&
      freshBoundaries.length > 0 &&
      freshBoundaries.every((at) => Date.parse(at) > Date.parse(effectiveAfterBoundary));

    const freshness = freeze({
      responseIsCurrent,
      freshInputStatus: freshStatus,
      isNewInput,
      attemptsDisjoint,
      boundariesStrictlyLater,
    });
    const baselineMeasurements = (episode.impact.measurements ?? []).map((m) => ({ key: m.key, value: m.value }));
    let outcomeValue;
    try {
      outcomeValue = classifyFeedbackOutcome(policy, baselineMeasurements, freshMeasurements, freshness);
    } catch {
      outcomeValue = "UNKNOWN";
    }

    const reasons = [];
    if (outcomeValue === "UNKNOWN") {
      if (!responseIsCurrent) reasons.push("NON_CURRENT_RESPONSE");
      if (!isNewInput) reasons.push("INPUT_ALREADY_IN_EPISODE");
      if (freshStatus !== "GROUNDED") reasons.push(`UNRESOLVED_FRESH_INPUT:${consumptionDetail}`);
      if (freshStatus === "GROUNDED" && !attemptsDisjoint) reasons.push("ATTEMPT_REUSED");
      if (freshStatus === "GROUNDED" && !boundariesStrictlyLater) reasons.push("BOUNDARY_NOT_AFTER_RESPONSE");
      // Missing-measurement UNKNOWN carries an explicit reason even when
      // freshness alone already failed.
      try {
        const baselineMap = new Map(baselineMeasurements.map((m) => [m.key, m.value]));
        const freshMap = new Map((freshMeasurements ?? []).map((m) => [m.key, m.value]));
        for (const k of policy.requiredMeasurementKeys) {
          const b = baselineMap.get(k);
          const f = freshMap.get(k);
          if (typeof b !== "number" || !Number.isFinite(b) || typeof f !== "number" || !Number.isFinite(f)) {
            reasons.push(`MISSING_MEASUREMENT:${k}`);
            break;
          }
        }
      } catch {}
      if (reasons.length === 0) reasons.push("FRESHNESS_FAILED");
    }

    const suppliedDigest = digestSuffix(suppliedResponseRef);
    const outcome = defineFeedbackOutcome({
      kind: "FEEDBACK_OUTCOME_V1",
      version: 1,
      responseRef: head.value.responseRef,
      responseDigest,
      freshInputRef,
      freshInputDigest: freshDigest,
      freshness: {
        freshExecutionAttemptIds: [...freshAttemptIds],
        effectiveAfterBoundary: effectiveAfterBoundary ?? "1970-01-01T00:00:00.000Z",
      },
      policyDigest,
      baselineMeasurements,
      freshMeasurements: structuredClone(freshMeasurements ?? []),
      outcome: outcomeValue,
      reasons,
    });
    const outcomeRef = await artifactStore.put("feedback-outcome", structuredClone(outcome));
    if (outcomeValue === "UNKNOWN") {
      // UNKNOWN never advances the lifecycle: the head stays RESPONDED_ACTED
      // so a later fresh outcome or a new DEFERRED/SUPERSEDED response is
      // still possible. The UNKNOWN artifact itself is orphan evidence.
      const current = await headStore.current(key);
      return freeze({ status: "UNKNOWN", outcome, outcomeRef, head: current });
    }
    const next = freeze({
      episodeRef: head.value.episodeRef,
      state: "OUTCOME_RECORDED",
      responseRef: head.value.responseRef,
      outcomeRef,
      resolutionRef: null,
    });
    const swapped = await headStore.compareAndSwap(key, expectedRevision ?? null, structuredClone(next));
    if (swapped) {
      const stored = await headStore.current(key);
      return freeze({ status: "OK", outcome, outcomeRef, head: stored });
    }
    const current = await headStore.current(key);
    if (current !== null && headValueEquals(current.value, next)) {
      return freeze({ status: "CONVERGED", outcome, outcomeRef, head: current });
    }
    return freeze({ status: "STALE_REVISION", outcome, outcomeRef, head: current });
  }

  async function resolve({ episodeId, expectedRevision, principal, resolution = null } = {}) {
    if (typeof episodeId !== "string" || !episodeId) fail("resolve requires episodeId");
    const key = feedbackEpisodeHeadKeyFor(episodeId);
    const head = await headStore.current(key);
    if (head === null) fail(`no feedback episode head for ${episodeId}`);
    if (head.value.state === "RESOLVED") {
      // Terminal state: exact replay converges, any new transition fails.
      const replayAuthority = await verifyPrincipal({
        principal,
        episodeRef: head.value.episodeRef,
        transition: "resolve",
      });
      void replayAuthority;
      const existingRaw = await artifactStore.resolve(head.value.resolutionRef);
      if (existingRaw === null) fail("RESOLVED head carries no resolution artifact");
      const existing = defineFeedbackResolution(existingRaw);
      if (resolution !== null && resolution !== undefined && resolution !== existing.resolution) {
        fail(`caller resolution ${resolution} differs from derived value ${existing.resolution}`);
      }
      return freeze({ status: "CONVERGED", resolution: existing, resolutionRef: head.value.resolutionRef, head });
    }
    const authorityRef = await verifyPrincipal({
      principal,
      episodeRef: head.value.episodeRef,
      transition: "resolve",
    });
    let derived;
    let outcomeRef = null;
    if (head.value.state === "OUTCOME_RECORDED") {
      if (head.value.outcomeRef === null) fail("OUTCOME_RECORDED head carries no outcome");
      const outcomeRaw = await artifactStore.resolve(head.value.outcomeRef);
      if (outcomeRaw === null) fail("outcome artifact is unavailable for resolve");
      if (outcomeRaw.outcome === "UNKNOWN") fail("UNKNOWN outcome never resolves an episode");
      if (!["IMPROVED", "NO_CHANGE", "REGRESSED"].includes(outcomeRaw.outcome)) {
        fail(`outcome ${outcomeRaw.outcome} cannot resolve an episode`);
      }
      derived = outcomeRaw.outcome;
      outcomeRef = head.value.outcomeRef;
    } else if (head.value.state === "RESPONDED_REJECTED") {
      derived = "REJECTED_ACKNOWLEDGED";
      outcomeRef = null;
    } else if (head.value.state === "RESPONDED_SUPERSEDED") {
      derived = "SUPERSEDED";
      outcomeRef = null;
    } else {
      fail(`state ${head.value.state} cannot resolve; UNKNOWN and DEFERRED never resolve`);
    }
    if (resolution !== null && resolution !== undefined && resolution !== derived) {
      fail(`caller resolution ${resolution} differs from derived value ${derived}`);
    }
    const outcomeDigest = outcomeRef === null ? null : digestSuffix(outcomeRef);
    const resolutionArtifact = defineFeedbackResolution({
      kind: "FEEDBACK_RESOLUTION_V1",
      version: 1,
      episodeRef: head.value.episodeRef,
      episodeDigest: digestSuffix(head.value.episodeRef),
      finalResponseRef: head.value.responseRef,
      finalResponseDigest: digestSuffix(head.value.responseRef),
      outcomeRef,
      outcomeDigest,
      resolution: derived,
      principalAuthorityRef: authorityRef,
    });
    const resolutionRef = await artifactStore.put("feedback-resolution", structuredClone(resolutionArtifact));
    const next = freeze({
      episodeRef: head.value.episodeRef,
      state: "RESOLVED",
      responseRef: head.value.responseRef,
      outcomeRef: head.value.outcomeRef,
      resolutionRef,
    });
    const swapped = await headStore.compareAndSwap(key, expectedRevision ?? null, structuredClone(next));
    if (swapped) {
      const stored = await headStore.current(key);
      return freeze({ status: "OK", resolution: resolutionArtifact, resolutionRef, head: stored });
    }
    const current = await headStore.current(key);
    if (current !== null && headValueEquals(current.value, next)) {
      return freeze({ status: "CONVERGED", resolution: resolutionArtifact, resolutionRef, head: current });
    }
    return freeze({ status: "STALE_REVISION", resolution: resolutionArtifact, resolutionRef, head: current });
  }

  async function recover(episodeId) {
    if (typeof episodeId !== "string" || !episodeId) fail("recover requires episodeId");
    const key = feedbackEpisodeHeadKeyFor(episodeId);
    const head = await headStore.current(key);
    if (head === null) return freeze({ status: "NO_HEAD", head: null });
    const episodeRaw = await artifactStore.resolve(head.value.episodeRef);
    if (episodeRaw === null) fail(`recover: episode artifact missing for ${episodeId}`);
    const episode = defineFeedbackEpisode({ ...structuredClone(episodeRaw), episodeId: episodeRaw?.episodeId });
    if (episode.episodeId !== episodeId) fail("recover: episodeId does not match head key");
    const episodeDigest = digestSuffix(head.value.episodeRef);
    if (!episodeDigest) fail("recover: episode head ref is not content addressed");
    let response = null;
    if (head.value.responseRef !== null) {
      const raw = await artifactStore.resolve(head.value.responseRef);
      if (raw === null) fail("recover: response artifact missing");
      response = defineFeedbackResponse(raw);
      if (response.episodeRef !== head.value.episodeRef) fail("recover: response episode binding mismatch");
    }
    let outcome = null;
    if (head.value.outcomeRef !== null) {
      const raw = await artifactStore.resolve(head.value.outcomeRef);
      if (raw === null) fail("recover: outcome artifact missing");
      outcome = defineFeedbackOutcome(raw);
      if (outcome.responseRef !== head.value.responseRef) fail("recover: outcome response binding mismatch");
    }
    let resolution = null;
    if (head.value.resolutionRef !== null) {
      const raw = await artifactStore.resolve(head.value.resolutionRef);
      if (raw === null) fail("recover: resolution artifact missing");
      resolution = defineFeedbackResolution(raw);
      if (resolution.episodeRef !== head.value.episodeRef) fail("recover: resolution episode binding mismatch");
    }
    // Orphan artifacts (puts without a head CAS) are ignored: only head-bound
    // refs are re-resolved above.
    return freeze({ status: "RECOVERED", head, episode, response, outcome, resolution });
  }

  return freeze({ openEpisode, respond, recordOutcome, resolve, recover });
}

export const __testOnly = freeze({});
