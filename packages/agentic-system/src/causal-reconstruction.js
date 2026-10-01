import { createHash } from "node:crypto";
import { executionAttemptSubjectKey } from "./domain-execution-control.js";
import { productRevision, reverseSemanticClosure } from "./product-lineage.js";
import { productOutcomeSubjectKey } from "./product-closure.js";
import { INCONSISTENT_PROVENANCE, MISSING_PROVENANCE, UNKNOWN_PROVENANCE, listCausalLifecycleEvidence } from "./causal-provenance.js";

export { INCONSISTENT_PROVENANCE, MISSING_PROVENANCE, UNKNOWN_PROVENANCE };

export const NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT = "NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT";

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

function rejectExtraKeys(args, allowed, method) {
  for (const key of Object.keys(args ?? {})) {
    invariant(allowed.includes(key), `${method} accepts no caller-selected completeness refs; ${key} is not accepted`);
  }
}

// Explicit pinned observation subject. A CURRENT query first resolves the
// canonical history/acceptance/projection heads and then pins them here; a
// HISTORICAL query reuses a previously pinned subject verbatim and never
// silently advances to newer heads.
export function defineCausalObservationSubject(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "CausalObservationSubject required");
  invariant(raw.kind === "CAUSAL_OBSERVATION_SUBJECT" && raw.version === 1, "CausalObservationSubject kind/version mismatch");
  invariant(raw.mode === "CURRENT" || raw.mode === "HISTORICAL", "CausalObservationSubject.mode must be CURRENT or HISTORICAL");
  const productId = requireText(raw.productId, "CausalObservationSubject.productId");
  const rootIntentRef = requireText(raw.rootIntentRef, "CausalObservationSubject.rootIntentRef");
  invariant(Number.isInteger(raw.historyGeneration) && raw.historyGeneration >= 1, "CausalObservationSubject.historyGeneration invalid");
  const subject = {
    kind: "CAUSAL_OBSERVATION_SUBJECT",
    version: 1,
    mode: raw.mode,
    productId,
    rootIntentRef,
    historyGeneration: raw.historyGeneration,
    historyDigest: requireText(raw.historyDigest, "CausalObservationSubject.historyDigest"),
    historyCommitRef: requireText(raw.historyCommitRef, "CausalObservationSubject.historyCommitRef"),
    policyRef: requireText(raw.policyRef, "CausalObservationSubject.policyRef"),
    policyRevision: raw.policyRevision,
    waiverRefs: [...(raw.waiverRefs ?? [])].map((r, i) => requireText(r, `CausalObservationSubject.waiverRefs[${i}]`)).sort(),
    waiverSetDigest: requireText(raw.waiverSetDigest, "CausalObservationSubject.waiverSetDigest"),
    projectionRef: requireText(raw.projectionRef, "CausalObservationSubject.projectionRef"),
  };
  invariant(Number.isInteger(subject.policyRevision) && subject.policyRevision >= 1, "CausalObservationSubject.policyRevision invalid");
  return freeze(subject);
}

function projectionSubjectFor(subject) {
  return freeze({
    kind: "PRODUCT_PROJECTION_SUBJECT",
    version: 1,
    productId: subject.productId,
    rootIntentRef: subject.rootIntentRef,
    historyGeneration: subject.historyGeneration,
    historyDigest: subject.historyDigest,
    historyCommitRef: subject.historyCommitRef,
    policyRef: subject.policyRef,
    policyRevision: subject.policyRevision,
    waiverRefs: [...subject.waiverRefs].sort(),
    waiverSetDigest: subject.waiverSetDigest,
  });
}

// Read-only reconstruction. This service receives canonical read handles
// only: product history/acceptance/projection readers, lineage snapshot,
// board reader, immutable artifact stores and CAS head readers. It receives
// no write-capable acceptance, claim, dispatch, recovery or policy-publisher
// ports, so it cannot mutate, dispatch, recover or select strategies.
export function createCausalReconstruction({
  productHistory = null,
  acceptanceAuthority = null,
  projectionBuilder = null,
  artifactStore = null,
  lineage = null,
  boardReader = null,
  organizationArtifactRegistry = null,
  domainArtifactRegistry = null,
  executionAttemptStore = null,
  evidenceHeadStore = null,
  closureController = null,
  outcomeHeadStore = null,
} = {}) {
  invariant(artifactStore && typeof artifactStore.resolve === "function", "reconstruction requires an immutable artifact store");

  // A CURRENT subject may only be used while it still equals the canonical
  // heads. Any advancement rejects: live board/lineage reads must never be
  // mixed with an older pin.
  async function assertSubjectCurrent(subject) {
    invariant(productHistory && typeof productHistory.current === "function", "currentness check requires the product history controller");
    invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "currentness check requires the acceptance authority");
    const history = await productHistory.current({ productId: subject.productId });
    const acceptance = await acceptanceAuthority.resolveCurrent({ productId: subject.productId });
    const current =
      history != null &&
      history.generation === subject.historyGeneration &&
      history.historyDigest === subject.historyDigest &&
      history.commitRef === subject.historyCommitRef &&
      acceptance.policyRef === subject.policyRef &&
      acceptance.policyRevision === subject.policyRevision &&
      acceptance.waiverSetDigest === subject.waiverSetDigest;
    invariant(current, "pinned observation subject is stale; a newer head requires a new subject");
  }

  // Refs reachable from the pinned subject: the history chain slice up to the
  // pinned generation plus every ref named by the pinned projection. Lineage
  // publications outside this set (including other products') are excluded.
  async function pinnedReachableRefs(subject, projection) {
    invariant(productHistory && typeof productHistory.readChain === "function", "pinned evidence scoping requires the product history controller");
    const observed = await productHistory.readChain({ productId: subject.productId });
    const index = observed.chain.findIndex((entry) => entry.ref === subject.historyCommitRef);
    invariant(index >= 0, "pinned history commit is not in the canonical chain");
    invariant(observed.chain[index].commit.generation === subject.historyGeneration, "pinned history generation mismatch during evidence scoping");
    const refs = new Set();
    for (const entry of observed.chain.slice(0, index + 1)) {
      for (const ref of entry.commit.transitionRefs ?? []) refs.add(ref);
    }
    for (const ref of [...(projection.claimRefs ?? []), ...(projection.obligationRefs ?? []), ...(projection.releaseRefs ?? []), ...(projection.qualityAcceptanceRefs ?? [])]) {
      refs.add(ref);
    }
    return refs;
  }

  async function resolveCurrentSubject(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["productId", "rootIntentRef"], "resolveCurrentSubject");
    const productId = requireText(input.productId, "productId");
    const rootIntentRef = requireText(input.rootIntentRef, "rootIntentRef");
    invariant(productHistory && typeof productHistory.current === "function", "current subject requires the product history controller");
    invariant(acceptanceAuthority && typeof acceptanceAuthority.resolveCurrent === "function", "current subject requires the acceptance authority");
    invariant(projectionBuilder && typeof projectionBuilder.build === "function", "current subject requires the projection builder");
    const [history, acceptance, built] = await Promise.all([
      productHistory.current({ productId }),
      acceptanceAuthority.resolveCurrent({ productId }),
      projectionBuilder.build({ productId, rootIntentRef }),
    ]);
    invariant(history != null, `no product history for ${productId}`);
    const subject = defineCausalObservationSubject({
      kind: "CAUSAL_OBSERVATION_SUBJECT",
      version: 1,
      mode: "CURRENT",
      productId,
      rootIntentRef,
      historyGeneration: history.generation,
      historyDigest: history.historyDigest,
      historyCommitRef: history.commitRef,
      policyRef: acceptance.policyRef,
      policyRevision: acceptance.policyRevision,
      waiverRefs: acceptance.waiverRefs,
      waiverSetDigest: acceptance.waiverSetDigest,
      projectionRef: built.projectionRef,
    });
    invariant(built.subject.historyGeneration === subject.historyGeneration, "projection/history head mismatch during subject pin");
    invariant(built.subject.policyRef === subject.policyRef, "projection/acceptance head mismatch during subject pin");
    const subjectRef = await artifactStore.put("causal-observation-subject", structuredClone(subject));
    return freeze({ subjectRef, subject, projection: built.projection, projectionRef: built.projectionRef });
  }

  // Rebuild the deterministic projection for the exact pinned subject and
  // verify it still equals the pinned projectionRef. Ignores newer live
  // state; a newer head requires a new subject.
  async function reconstructPinned(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject"], "reconstructPinned");
    const subject = defineCausalObservationSubject(input.subject);
    invariant(projectionBuilder && typeof projectionBuilder.rebuild === "function", "pinned reconstruction requires the projection builder");
    const rebuilt = await projectionBuilder.rebuild({ subject: projectionSubjectFor(subject) });
    invariant(rebuilt.projectionRef === subject.projectionRef, "pinned projection drifted from its subject; a newer head requires a new subject");
    const projection = await projectionBuilder.resolve(subject.projectionRef);
    return freeze({ subject, projection, projectionRef: subject.projectionRef });
  }

  async function explainBlockers(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject"], "explainBlockers");
    const { subject, projection, projectionRef } = await reconstructPinned({ subject: input.subject });
    const blockers = (projection.blockers ?? []).map((blocker) =>
      freeze({
        code: requireText(blocker.code, "blocker code"),
        ref: blocker.ref == null ? null : requireText(blocker.ref, "blocker ref"),
        evidenceRefs: freeze(
          blocker.ref == null
            ? [projectionRef, subject.historyCommitRef]
            : [blocker.ref, projectionRef, subject.historyCommitRef],
        ),
      }),
    );
    return freeze({
      readiness: projection.readiness,
      blockers,
      evidenceRefs: freeze([projectionRef, subject.historyCommitRef, subject.policyRef]),
    });
  }

  async function listRemainingWork(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject"], "listRemainingWork");
    const { subject } = await reconstructPinned({ subject: input.subject });
    // Board lifecycle and claim state are live mutable truth, not part of the
    // pinned subject, so a HISTORICAL subject cannot reconstruct them. The
    // gap is explicit, never filled from live state.
    if (subject.mode === "HISTORICAL") {
      return freeze({
        status: NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT,
        reason: "remaining work derives from the live board and lineage heads, which are not part of the pinned subject; pin a CURRENT subject to list remaining work",
        items: freeze([]),
      });
    }
    await assertSubjectCurrent(subject);
    invariant(boardReader && typeof boardReader.readBlackboard === "function", "remaining-work reconstruction requires the canonical board reader");
    invariant(organizationArtifactRegistry && typeof organizationArtifactRegistry.resolveWorkContract === "function", "remaining-work reconstruction requires the organization artifact registry");
    const board = await boardReader.readBlackboard();
    const items = [...(board?.items ?? [])]
      .filter((item) => item?.origin?.kind === "ORGANIZATION_MATERIALIZATION")
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let lineageSnapshot = null;
    if (lineage && typeof lineage.snapshot === "function") lineageSnapshot = await lineage.snapshot();
    const remaining = [];
    for (const item of items) {
      const contractRef = requireText(item.origin.workContractRef, "organization workContractRef");
      const raw = await organizationArtifactRegistry.resolveWorkContract(contractRef);
      invariant(raw, `organization work contract is unavailable: ${contractRef}`);
      const contract = raw.contractRef ? raw : { ...raw, contractRef };
      const actionable = ["READY", "REOPENED", "CLAIMED"].includes(item.status);
      let obligationStatus = "NO_OBLIGATION_REF";
      let obligationRef = null;
      if (contract.crossDomainObligationRef) {
        obligationRef = contract.crossDomainObligationRef;
        if (lineageSnapshot) {
          const head = lineageSnapshot.heads?.[contract.crossDomainObligationSubjectKey];
          obligationStatus = head?.status === "ACTIVE" && head.revisionRef === contract.crossDomainObligationRef ? "CURRENT" : (head?.status ?? "UNKNOWN");
        } else {
          obligationStatus = UNKNOWN_PROVENANCE;
        }
      }
      const entry = freeze({
        workId: requireText(item.id, "work id"),
        owningDomain: requireText(contract.owningDomain ?? item.origin.owningDomain, "owning domain"),
        lifecycleStatus: requireText(item.status, "lifecycle status"),
        claimState: freeze({
          owner: item.owner ?? null,
          claimGeneration: item.claimGeneration ?? null,
        }),
        actionable,
        obligationStatus,
        obligationRef,
        evidenceRefs: freeze(
          [contractRef, subject.projectionRef, subject.historyCommitRef].filter(Boolean),
        ),
      });
      remaining.push(entry);
    }
    return freeze(remaining);
  }

  async function traceObligation(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject", "obligationRef", "obligationSubjectKey"], "traceObligation");
    const subject = defineCausalObservationSubject(input.subject);
    // Obligation status, downstream invalidation and affected work all depend
    // on live lineage/board heads, which a HISTORICAL pin cannot capture.
    invariant(subject.mode === "CURRENT", "historical obligation tracing requires a pinned lineage head; query with a CURRENT subject");
    await assertSubjectCurrent(subject);
    invariant(lineage && typeof lineage.snapshot === "function", "obligation tracing requires the lineage snapshot reader");
    const hasRef = input.obligationRef != null;
    const hasKey = input.obligationSubjectKey != null;
    invariant(hasRef !== hasKey, "traceObligation requires exactly one of obligationRef or obligationSubjectKey");
    const snapshot = await lineage.snapshot();
    let obligationRef = hasRef ? requireText(input.obligationRef, "obligationRef") : null;
    let obligationSubjectKey = hasKey ? requireText(input.obligationSubjectKey, "obligationSubjectKey") : null;
    let obligation = null;
    if (obligationRef) {
      obligation = await artifactStore.resolve(obligationRef);
      invariant(obligation, `obligation revision is unavailable: ${obligationRef}`);
    } else {
      const head = snapshot.heads?.[obligationSubjectKey];
      invariant(head, `obligation subject has no lineage head: ${obligationSubjectKey}`);
      obligationRef = head.revisionRef;
      obligation = await artifactStore.resolve(obligationRef);
      invariant(obligation, `obligation revision is unavailable: ${obligationRef}`);
    }
    const issuer = freeze({
      issuingSubjectKey: obligation.issuingSubjectKey ?? UNKNOWN_PROVENANCE,
      issuingRevisionRef: obligation.issuingRevisionRef ?? UNKNOWN_PROVENANCE,
    });
    // The subject key is derived from the durable obligation bytes, so a
    // superseded (non-current) revision still resolves its lineage subject.
    try {
      const record = productRevision(obligation);
      if (obligationSubjectKey == null) {
        obligationSubjectKey = record.subjectKey;
      } else {
        invariant(obligationSubjectKey === record.subjectKey, "obligation subject/ref binding mismatch");
      }
      if (obligationRef == null) obligationRef = record.ref;
    } catch {
      obligationSubjectKey = obligationSubjectKey ?? UNKNOWN_PROVENANCE;
    }
    const head = obligationSubjectKey && obligationSubjectKey !== UNKNOWN_PROVENANCE
      ? (snapshot.heads?.[obligationSubjectKey] ?? null)
      : null;
    // A replaced head stays ACTIVE at the new revision; the queried older
    // revision is then explicitly non-current, never silently current.
    const headRevisionRef = head?.revisionRef ?? null;
    const obligationStatus = head == null
      ? UNKNOWN_PROVENANCE
      : (headRevisionRef === obligationRef ? (head.status ?? UNKNOWN_PROVENANCE) : "SUPERSEDED");
    const downstreamSubjectKeys = obligationSubjectKey && obligationSubjectKey !== UNKNOWN_PROVENANCE
      ? reverseSemanticClosure(snapshot, [obligationSubjectKey])
      : [];
    const impacted = new Set(downstreamSubjectKeys);
    const invalidationEvidence = [];
    if (obligationStatus === "SUPERSEDED") {
      invalidationEvidence.push(freeze({
        subjectKey: obligationSubjectKey,
        status: "SUPERSEDED",
        revisionRef: obligationRef,
        supersededBy: headRevisionRef,
        evidenceRefs: freeze([obligationRef, headRevisionRef, subject.historyCommitRef].filter(Boolean)),
      }));
    }
    for (const key of [...impacted].sort()) {
      const h = snapshot.heads?.[key];
      if (!h) {
        invalidationEvidence.push(freeze({ subjectKey: key, status: UNKNOWN_PROVENANCE, revisionRef: null, evidenceRefs: freeze([subject.projectionRef]) }));
      } else if (h.status !== "ACTIVE") {
        invalidationEvidence.push(freeze({
          subjectKey: key,
          status: h.status,
          revisionRef: h.revisionRef ?? null,
          evidenceRefs: freeze([h.revisionRef, subject.historyCommitRef].filter(Boolean)),
        }));
      }
    }
    const affectedWork = [];
    if (boardReader && organizationArtifactRegistry) {
      const board = await boardReader.readBlackboard();
      for (const item of [...(board?.items ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        if (item?.origin?.kind !== "ORGANIZATION_MATERIALIZATION") continue;
        const ref = item.origin.workContractRef;
        if (!ref) continue;
        const raw = await organizationArtifactRegistry.resolveWorkContract(ref);
        if (!raw) continue;
        const key = raw.crossDomainObligationSubjectKey;
        if (key && impacted.has(key)) {
          affectedWork.push(freeze({
            workId: item.id,
            owningDomain: raw.owningDomain ?? item.origin.owningDomain ?? UNKNOWN_PROVENANCE,
            lifecycleStatus: item.status,
            evidenceRefs: freeze([ref, obligationRef]),
          }));
        }
      }
    }
    return freeze({
      obligationRef,
      obligationSubjectKey: obligationSubjectKey ?? UNKNOWN_PROVENANCE,
      obligationStatus,
      issuer,
      downstreamSubjectKeys: freeze([...downstreamSubjectKeys].sort()),
      affectedWork: freeze(affectedWork),
      invalidationEvidence: freeze(invalidationEvidence),
      evidenceRefs: freeze([obligationRef, subject.historyCommitRef, subject.projectionRef]),
    });
  }

  async function resolveAttempt({ workId, workContractRef, projectId, attemptSubjectKey }) {
    invariant(executionAttemptStore && typeof executionAttemptStore.current === "function", "execution reconstruction requires the attempt head reader");
    invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveExecutionAttemptBinding === "function", "execution reconstruction requires the domain execution artifact registry");
    let key = attemptSubjectKey ?? null;
    if (!key) {
      key = executionAttemptSubjectKey({
        projectId: requireText(projectId, "projectId"),
        itemId: requireText(workId, "workId"),
        workContractRef: requireText(workContractRef, "workContractRef"),
      });
    }
    const head = await executionAttemptStore.current(key);
    invariant(head, `execution attempt head is unavailable: ${key}`);
    const bindingRef = requireText(head.value.bindingRef, "attempt bindingRef");
    const binding = await domainArtifactRegistry.resolveExecutionAttemptBinding(bindingRef);
    invariant(binding, `ExecutionAttemptBinding is unavailable: ${bindingRef}`);
    return freeze({ attemptKey: key, head, binding, bindingRef });
  }

  async function resolveAttestations(binding, bindingRef, head) {
    const refs = [];
    if (head?.value?.outcomeRef && typeof domainArtifactRegistry.resolveExecutionAttemptOutcome === "function") {
      const outcome = await domainArtifactRegistry.resolveExecutionAttemptOutcome(head.value.outcomeRef);
      for (const ref of outcome?.runtimeAttestationRefs ?? []) refs.push(ref);
    }
    const attestations = [];
    if (typeof domainArtifactRegistry.resolveRuntimeExecutionAttestation === "function") {
      for (const ref of refs) {
        const att = await domainArtifactRegistry.resolveRuntimeExecutionAttestation(ref);
        invariant(att, `RuntimeExecutionAttestation is unavailable: ${ref}`);
        invariant(att.bindingRef === bindingRef && att.executionAttemptId === binding.executionAttemptId, "runtime attestation/binding relation mismatch");
        attestations.push(freeze({ attestationRef: ref, attestation: att }));
      }
    }
    return freeze(attestations);
  }

  async function describeExecution(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject", "workId", "workContractRef", "projectId", "attemptSubjectKey"], "describeExecution");
    let subject = null;
    if (input.subject != null) subject = defineCausalObservationSubject(input.subject);
    const { binding, bindingRef, head } = await resolveAttempt(input);
    // Identity comes only from the immutable binding + attestations. The
    // current policy head is never consulted here (INV-3).
    const policy = await domainArtifactRegistry.resolveExecutionPolicy(binding.executionPolicyRef);
    const strategy = await domainArtifactRegistry.resolveExecutionStrategyDescriptor(binding.executionStrategyRef);
    invariant(policy && strategy, "pinned execution policy/strategy is unavailable");
    const attestations = await resolveAttestations(binding, bindingRef, head);
    const first = attestations[0] ?? null;
    // Recovery can produce several runtime invocations for one pinned
    // attempt; every attestation is reported. The singular
    // runtimeInvocationId/runtimeAttestationRef fields name the first
    // invocation for backward compatibility.
    const runtimeInvocations = attestations.map(({ attestationRef, attestation }) => freeze({
      runtimeInvocationId: requireText(attestation.runtimeInvocationId, "runtimeInvocationId"),
      attestationRef,
      startedAt: attestation.startedAt,
      finishedAt: attestation.finishedAt ?? null,
    }));
    return freeze({
      executionAttemptId: requireText(binding.executionAttemptId, "executionAttemptId"),
      runtimeInvocationId: first ? requireText(first.attestation.runtimeInvocationId, "runtimeInvocationId") : MISSING_PROVENANCE,
      runtimeAttestationRef: first ? first.attestationRef : null,
      runtimeInvocations: freeze(runtimeInvocations),
      policyRef: requireText(binding.executionPolicyRef, "policyRef"),
      strategyRef: requireText(binding.executionStrategyRef, "strategyRef"),
      contextRefs: freeze([...(binding.contextRefs ?? [])]),
      toolsetRef: binding.toolsetRef ?? null,
      modelProfileRef: binding.modelProfileRef ?? null,
      harnessRef: binding.harnessRef ?? null,
      runtimeDeploymentRef: requireText(binding.runtimeBinding?.expectedRuntimeCodeRef, "runtimeDeploymentRef"),
      runtimeAdapterRef: requireText(binding.runtimeBinding?.adapterRef, "runtimeAdapterRef"),
      observedPolicyHead: freeze({ ...(binding.observedExecutionPolicyHead ?? {}) }),
      attestationCount: attestations.length,
      evidenceRefs: freeze([bindingRef, binding.executionPolicyRef, binding.executionStrategyRef, ...attestations.map((a) => a.attestationRef), ...(subject ? [subject.projectionRef] : [])]),
    });
  }

  async function measureTiming(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject", "workId", "workContractRef", "projectId", "attemptSubjectKey"], "measureTiming");
    const subject = input.subject == null ? null : defineCausalObservationSubject(input.subject);
    const workId = requireText(input.workId, "workId");
    // Only an absent attempt head becomes MISSING_PROVENANCE. Binding and
    // attestation integrity failures throw instead of degrading silently.
    invariant(executionAttemptStore && typeof executionAttemptStore.current === "function", "timing reconstruction requires the attempt head reader");
    invariant(domainArtifactRegistry && typeof domainArtifactRegistry.resolveExecutionAttemptBinding === "function", "timing reconstruction requires the domain execution artifact registry");
    let attemptKey = input.attemptSubjectKey ?? null;
    if (!attemptKey) {
      attemptKey = executionAttemptSubjectKey({
        projectId: requireText(input.projectId, "projectId"),
        itemId: workId,
        workContractRef: requireText(input.workContractRef, "workContractRef"),
      });
    }
    const head = await executionAttemptStore.current(attemptKey);
    let binding = null;
    let bindingRef = null;
    let attestations = [];
    if (head != null) {
      bindingRef = requireText(head.value.bindingRef, "attempt bindingRef");
      binding = await domainArtifactRegistry.resolveExecutionAttemptBinding(bindingRef);
      invariant(binding, `ExecutionAttemptBinding is unavailable: ${bindingRef}`);
      attestations = await resolveAttestations(binding, bindingRef, head);
    }
    // The MATERIALIZED boundary for the same work generation: the entry
    // whose workContractRef matches the attempt's contract when known.
    let materializedAt = null;
    let materializedRef = null;
    if (evidenceHeadStore) {
      const entries = await listCausalLifecycleEvidence({ artifactStore, evidenceHeadStore }, { workId });
      const materialized = entries.filter((e) => e.evidence.eventKind === "MATERIALIZED");
      const picked = binding?.workContractRef
        ? (materialized.find((e) => e.evidence.workContractRef === binding.workContractRef) ?? null)
        : (materialized[0] ?? null);
      if (picked) {
        materializedAt = picked.evidence.observedAt;
        materializedRef = picked.evidenceRef;
      }
    }
    const intervals = attestations.map(({ attestationRef, attestation }) => {
      const start = Date.parse(attestation.startedAt);
      const finish = attestation.finishedAt == null ? null : Date.parse(attestation.finishedAt);
      return freeze({
        attestationRef,
        runtimeInvocationId: attestation.runtimeInvocationId,
        startedAt: attestation.startedAt,
        finishedAt: attestation.finishedAt ?? null,
        durationMs: finish == null || !Number.isFinite(start) || !Number.isFinite(finish) ? null : finish - start,
      });
    });
    const completeStarts = intervals.filter((i) => i.startedAt).map((i) => Date.parse(i.startedAt)).filter(Number.isFinite).sort((a, b) => a - b);
    let waiting = null;
    if (materializedAt != null && completeStarts.length > 0) {
      const durationMs = completeStarts[0] - Date.parse(materializedAt);
      // A MATERIALIZED boundary later than first runtime start contradicts
      // durable order; it is reported, never emitted as a negative duration.
      waiting = durationMs < 0
        ? freeze({ status: INCONSISTENT_PROVENANCE, durationMs: null, fromBoundaryRef: materializedRef, fromBoundaryAt: materializedAt, firstRuntimeStart: intervals.find((i) => Date.parse(i.startedAt) === completeStarts[0])?.startedAt ?? null })
        : freeze({ status: "AVAILABLE", durationMs, fromBoundaryRef: materializedRef, fromBoundaryAt: materializedAt });
    } else {
      waiting = freeze({ status: MISSING_PROVENANCE, durationMs: null, fromBoundaryRef: materializedRef, fromBoundaryAt: materializedAt });
    }
    const completeDurations = intervals.map((i) => i.durationMs).filter((d) => Number.isFinite(d));
    const executing = completeDurations.length > 0
      ? freeze({ status: "AVAILABLE", durationMs: completeDurations.reduce((a, b) => a + b, 0), invocationCount: completeDurations.length })
      : freeze({ status: MISSING_PROVENANCE, durationMs: null, invocationCount: 0 });
    return freeze({
      workId,
      waiting,
      executing,
      runtimeIntervals: intervals,
      evidenceRefs: freeze([...(materializedRef ? [materializedRef] : []), ...intervals.map((i) => i.attestationRef), ...(subject ? [subject.projectionRef] : [])]),
    });
  }

  async function chainEvidence(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject"], "chainEvidence");
    const { subject, projection } = await reconstructPinned({ subject: input.subject });
    const historical = subject.mode === "HISTORICAL";
    if (!historical) await assertSubjectCurrent(subject);
    const facts = [];
    for (const ref of [...(projection.releaseRefs ?? [])].sort()) {
      const raw = await artifactStore.resolve(ref);
      facts.push(freeze({
        factKind: raw?.kind ?? UNKNOWN_PROVENANCE,
        ref,
        evidenceRefs: freeze([ref, subject.historyCommitRef, subject.projectionRef]),
      }));
    }
    for (const ref of [...(projection.qualityAcceptanceRefs ?? [])].sort()) {
      const raw = await artifactStore.resolve(ref);
      facts.push(freeze({
        factKind: raw?.kind ?? UNKNOWN_PROVENANCE,
        ref,
        evidenceRefs: freeze([ref, subject.historyCommitRef, subject.projectionRef]),
      }));
    }
    if (historical) {
      // Never consult the live outcome head: the outcome counts only when it
      // is bound to exactly this pinned subject.
      let boundRef = null;
      if (outcomeHeadStore && typeof outcomeHeadStore.current === "function") {
        const head = await outcomeHeadStore.current(productOutcomeSubjectKey(subject.productId));
        if (head?.value?.outcomeRef) {
          const raw = await artifactStore.resolve(head.value.outcomeRef);
          const pinnedOutcome = raw?.subject ?? null;
          if (
            pinnedOutcome &&
            pinnedOutcome.historyGeneration === subject.historyGeneration &&
            pinnedOutcome.historyDigest === subject.historyDigest &&
            pinnedOutcome.historyCommitRef === subject.historyCommitRef &&
            pinnedOutcome.policyRef === subject.policyRef &&
            pinnedOutcome.policyRevision === subject.policyRevision &&
            pinnedOutcome.waiverSetDigest === subject.waiverSetDigest
          ) {
            boundRef = head.value.outcomeRef;
          }
        }
      }
      facts.push(boundRef
        ? freeze({ factKind: "PRODUCT_OUTCOME_CLAIM", ref: boundRef, status: "BOUND_TO_PINNED_SUBJECT", evidenceRefs: freeze([boundRef, subject.historyCommitRef, subject.policyRef]) })
        : freeze({ factKind: "PRODUCT_OUTCOME_CLAIM", ref: null, status: MISSING_PROVENANCE, evidenceRefs: freeze([subject.historyCommitRef]) }));
    } else if (closureController && typeof closureController.currentOutcome === "function") {
      try {
        const outcome = await closureController.currentOutcome({ productId: subject.productId });
        if (outcome?.outcomeRef) {
          facts.push(freeze({
            factKind: "PRODUCT_OUTCOME_CLAIM",
            ref: outcome.outcomeRef,
            status: outcome.status,
            evidenceRefs: freeze([outcome.outcomeRef, subject.historyCommitRef, subject.policyRef]),
          }));
        }
      } catch {
        facts.push(freeze({ factKind: "PRODUCT_OUTCOME_CLAIM", ref: null, status: MISSING_PROVENANCE, evidenceRefs: freeze([subject.historyCommitRef]) }));
      }
    }
    if (lineage && typeof lineage.snapshot === "function") {
      const reachable = await pinnedReachableRefs(subject, projection);
      const snapshot = await lineage.snapshot();
      for (const publication of Object.values(snapshot.publications ?? {}).sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
        for (const ref of [...(publication.recordRefs ?? [])].sort()) {
          // Only records reachable from the pinned projection/history count;
          // unrelated products' publications are never listed.
          if (!reachable.has(ref)) continue;
          const raw = await artifactStore.resolve(ref).catch(() => null);
          facts.push(freeze({
            factKind: raw?.kind ?? UNKNOWN_PROVENANCE,
            ref,
            publicationReceiptRef: publication.receiptRef ?? null,
            evidenceRefs: freeze([ref, publication.receiptRef, subject.historyCommitRef].filter(Boolean)),
          }));
        }
      }
    }
    facts.sort((a, b) => String(a.ref ?? a.factKind).localeCompare(String(b.ref ?? b.factKind)));
    return freeze(facts);
  }

  return Object.freeze({
    resolveCurrentSubject,
    reconstructPinned,
    explainBlockers,
    listRemainingWork,
    traceObligation,
    describeExecution,
    measureTiming,
    chainEvidence,
  });
}
