# DOMAIN_EXECUTION_CONTROL — judgment artifact contract

Status: **PENDING REVIEW**

Companion to domain-execution-control-implementation-readiness.md.

This artifact does not authorize Integration B implementation. It defines the minimum durable evidence/judgment surface that an Integration B implementation must produce so later bounded judgment consumers can decide from durable facts without reconstructing intent from chat, mutable process state, or strategy self-report.

It does **not** imply that Researcher or SA review every execution or every PR.

## Who consumes these artifacts — and when

Artifacts are produced per attempt because facts are cheapest and most reliable at the point they happen. **Judgment roles are not invoked per artifact or per PR.**

    execution attempt
      -> emit durable facts automatically
      -> ordinary domain completion/evaluation gate consumes what it needs

    repeated executions
      -> Observer/metrics aggregate facts continuously

    explicit implementation/promotion/phase gate
      -> independent acceptance/review consumes an exact bounded packet

    architecture obligation / tripwire / cross-domain inconsistency
      -> SA consumes relevant evidence and produces an architecture decision/artifact

    unresolved mechanism / surprising failure / evidence gap
      -> Researcher runs a bounded research workload and produces candidate evidence/design

Researcher and SA are **producers/decision roles for specific questions**, not standing PR reviewers.

Hard separation:

    Researcher
      = investigate unresolved questions, external/source evidence, alternatives, experiments

    SA
      = own technical architecture/contracts/trade-offs when an architecture obligation exists

    Reviewer / acceptance authority
      = judge an exact proposal/implementation/promotion when policy requires an acceptance gate

    Observer
      = aggregate operational history/metrics and surface grounded findings

    Domain completion evaluator
      = judge one domain workload against its existing acceptance contract

Therefore the existence of ExecutionJudgmentBundle does not schedule Researcher, SA, or a human reviewer. It only makes a later judgment cheap and grounded when some explicit policy/work item requires one.

## Why this companion exists

The A.1 implementation review exposed a general failure mode that also applies to Integration B:

    schema exists
    + ref-shaped field exists
    != fresh-session resolvable evidence
    != trusted producer authority
    != replay-safe currentness

Integration B already pins HOW before execution through ExecutionAttemptBinding. That is necessary but insufficient for useful judgment after execution.

A reviewer must be able to distinguish:

    what was authorized
    what HOW was selected
    what runtime actually executed
    what external effects are known
    what artifacts were produced
    what verification observed
    what completion policy decided
    what telemetry merely observed
    why recovery/new-attempt transitions happened

No one artifact may collapse those truths.

## Design evidence used

The design borrows shapes, not dependencies, from established provenance/lineage systems:

- SLSA provenance separates the produced subject, resolved dependencies, builder identity, invocation identity and byproducts.
- in-toto separates authorized functionaries, materials/products and verification of the chain.
- OpenLineage distinguishes run/job identity, exact inputs/outputs and explicit lineage edges rather than inferring every input affects every output.
- OpenTelemetry traces are correlation/observation data; a span/link is not correctness or acceptance authority.
- Event sourcing keeps immutable append-only facts and derives current projections rather than rewriting historical truth.
- Restate keeps immutable deployment versions and preserves existing invocations on their original deployment while newer invocations may route to newer deployments.

These patterns support the existing ExHarness boundary:

    immutable facts + exact refs
            ↓
    fresh reconstruction
            ↓
    independent judgment

They do not introduce a generic provenance framework into Core.

References:

- https://slsa.dev/spec/v1.2/provenance
- https://in-toto.io/docs/getting-started/
- https://openlineage.io/docs/spec/facets/
- https://openlineage.io/docs/spec/facets/job-facets/lineage/
- https://opentelemetry.io/docs/specs/otel/trace/api/
- https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
- https://docs.restate.dev/concepts/services/

## Judgment questions

A bounded judgment consumer must be able to answer these from durable refs only when that judgment is required:

1. **Authority** — was this exact work still executable for this principal/claim subject?
2. **Binding** — which exact WorkContract, policy, strategy, runtime/config refs were frozen before effects?
3. **Runtime fact** — which concrete runtime/deployment/invocation actually executed the bound strategy?
4. **Effects** — what external effects are confirmed, ambiguous, reconciled or absent?
5. **Products** — what immutable outputs were produced, and from which exact inputs?
6. **Verification** — which acceptance criteria were checked against which exact products/runtime subject?
7. **Decision** — which trusted completion boundary produced ACCEPT / REMEDIATION_REQUIRED / BLOCKED / INCONCLUSIVE?
8. **Recovery** — why did the attempt head move, and did restart/takeover reuse the same semantic attempt?
9. **Counterevidence** — what contradictory or stale evidence was observed and preserved?
10. **Currentness** — can all correctness-relevant refs still be resolved and revalidated now?

If any answer requires previous conversation state, a mutable in-memory object, a latest alias, or strategy prose, the judgment surface is incomplete.

## Required artifact chain

    OrganizationWorkContract
    + current ClaimReleaseReceipt
    + current ExecutionPolicyHead
            ↓
    ExecutionAttemptBinding                 PRE-EXECUTION FACT
            ↓
    RuntimeExecutionAttestation(s)          RUNTIME FACT
            ↓
    ExecutionAttemptOutcome                 STRATEGY RESULT
            ↓
    verification/effect artifacts           OBSERVED EVIDENCE
            ↓
    DomainCompletionDecision                DOMAIN JUDGMENT
            ↓
    DomainPublicationReceipt                WRITE/PUBLICATION AUTHORITY
            ↓
    ExecutionJudgmentBundle                 DERIVED REVIEW INDEX

ExecutionAttemptHead remains a durable current pointer over semantic-attempt lifecycle. Its transitions must reference immutable transition/decision artifacts; the head itself is not the historical audit record.

### 1. ExecutionPolicy currentness

ExecutionPolicy is immutable/versioned. Currentness is owned by a separate CAS-fenced head, not by a mutable latest alias:

    ExecutionPolicyHead(domain, workloadType)
      -> { generation, policyRef, status }

Only trusted policy-publisher authority may advance the head.

First-attempt creation must:

    read head P
     -> resolve exact policy/strategy/runtime target
     -> prepare immutable binding
     -> re-check head is still P
     -> CAS-create attempt/binding

If the head changed before binding commit, retry resolution against the new current head. After binding commit, later policy promotion does not rewrite the attempt.

A policy payload field such as issuedByAuthorityRef is provenance only; publisher authority must be verified outside the payload.

### 2. ExecutionAttemptBinding

Existing Integration B contract remains authoritative.

Required additions for judgment:

    kind: EXECUTION_ATTEMPT_BINDING
    executionAttemptId: <stable semantic attempt>
    workContractRef: <exact immutable ref>
    claimReleaseReceiptRef: <exact immutable ref>
    executionPolicyRef: <exact immutable ref>
    observedExecutionPolicyHead: <policyId + generation + head revision>
    observedClaimReleaseHead: <subject + head revision>
    executionStrategyRef: <exact immutable ref>

    runtimeBinding:
      kind: <application-core-loop | restate | human-assisted | ...>
      adapterRef: <exact adapter/config ref>
      expectedRuntimeCodeRef: <addressable immutable identity>
      runtimeInvocationKey: <stable attempt-scoped dispatch/recovery identity where supported>
      bindingMode: <IMMUTABLE_LOCAL | VERSION_ADDRESSABLE | HUMAN_SESSION>

    contextRefs: [...]
    toolsetRef: <exact or null>
    modelProfileRef: <exact or null>
    harnessRef: <exact or null>

The binding is committed before external effects. A mutable service name such as latest is not an acceptable exact runtime binding by itself.

Where the runtime supports a stable invocation/workflow/idempotency identity, that key is fixed before dispatch. A crash after dispatch but before local attestation publication must recover/observe the same runtime invocation rather than inventing a fresh call.

After binding commit and immediately before first runtime/effect dispatch, execution entry revalidates the exact claim/release authority again. A revoked/stale release cannot execute merely because an older binding exists.

### 3. RuntimeExecutionAttestation

A strategy must not prove its own runtime identity merely by returning a field.

A trusted runtime adapter/infrastructure boundary emits an immutable attestation for each concrete runtime invocation relevant to the attempt:

    kind: RUNTIME_EXECUTION_ATTESTATION
    executionAttemptId: <same semantic attempt>
    bindingRef: <exact + digest>
    runtimeInvocationId: <runtime-native invocation identity>
    runtimeKind: <restate | local-process | human-session | ...>
    runtimeDeploymentRef: <exact deployment/code identity>
    adapterRef: <exact adapter identity/version>
    startedAt: <timestamp>
    finishedAt: <timestamp or null>
    effectRefs: [...]
    traceRefs: [...]
    dispatchAuthoritySnapshot:
      claimReleaseHead: <exact observed subject/revision>
      executionPolicyHead: <exact policy generation used by binding>
    producerAuthorityRef: <trusted adapter/platform authority>
    attestationRef: <signature/trust artifact where required>

Important distinction:

    semantic executionAttemptId
    !=
    runtimeInvocationId

One semantic attempt may involve more than one runtime invocation during retry/recovery while retaining the same immutable binding. Runtime retries do not mint a new semantic attempt.

For Restate, the adapter must record/verify the immutable deployment serving the invocation. Restate's own versioning behavior is useful evidence, but ExHarness still needs the exact runtime identity bound into its evidence chain.

### 4. ExecutionAttemptOutcome

Produced by the ExecutionStrategy after execution/recovery.

It is **not** completion authority.

    kind: EXECUTION_ATTEMPT_OUTCOME
    executionAttemptId: <exact>
    bindingRef: <exact + digest>
    status: SUCCEEDED | FAILED | BLOCKED | UNKNOWN

    runtimeAttestationRefs: [...]
    outputArtifactRefs:
      - ref: <immutable>
        digest: <digest>
    effectRefs: [...]
    verificationCandidateRefs: [...]
    counterevidenceRefs: [...]
    startedAt: <timestamp>
    finishedAt: <timestamp>

    proposedDerivationEdges:
      - outputRef: <exact candidate output>
        derivedFrom:
          - <exact input/work/context/artifact ref>

proposedDerivationEdges must be as precise as the strategy can establish. Do not infer a Cartesian product where every output depends on every input merely because they appeared in one run.

These edges are **not authoritative product lineage yet**. Strategy output is a proposal/result. DomainCompletionDecision plus the write/publication authority boundary must validate and promote exact accepted lineage before Integration C+ may use it for selective invalidation.

The strategy may report failure/success mechanics, but a field such as accepted: true has no domain authority.

### 5. ExecutionAttemptTransition

Every semantic-attempt head transition that matters for recovery/new-attempt creation must be backed by an immutable reason artifact:

    kind: EXECUTION_ATTEMPT_TRANSITION
    workId: <exact>
    fromAttemptId: <id or null>
    toAttemptId: <id>
    fromStatus: <status>
    toStatus: <status>
    reasonKind:
      FIRST_ATTEMPT
      | RECOVERY_REQUIRED
      | RECOVERY_RESOLVED
      | REMEDIATION_AUTHORIZED
      | TERMINAL_FAILURE
    decisionRef: <exact lifecycle/remediation/recovery authority>
    observedHeadRevision: <CAS subject>

Process restart alone is never a valid REMEDIATION_AUTHORIZED reason.

The concrete store protocol must make transition publication/head CAS recoverable so a fresh process does not invent or lose attempt history after a crash.

### 6. DomainCompletionDecision

Domain completion is a separate trusted judgment over exact execution facts.

It may reuse the existing Core DecisionArtifact / trust-artifact envelope rather than inventing a second generic trust system.

Minimum semantic subject:

    kind: DOMAIN_COMPLETION_DECISION
    domain: <BA | SA | FE | BE | QA | DEVOPS | ...>
    workContractRef: <exact + digest>
    executionAttemptBindingRef: <exact + digest>
    executionAttemptOutcomeRef: <exact + digest>

    criterionResults:
      - criterionId: <stable WorkContract acceptance criterion>
        verdict: PASS | FAIL | INCONCLUSIVE
        evidenceRefs: [...]

    runtimeEvidenceRefs: [...]
    effectEvidenceRefs: [...]
    counterevidenceRefs: []

    verdict:
      ACCEPT
      | REMEDIATION_REQUIRED
      | BLOCKED
      | INCONCLUSIVE

    decisionAuthorityRef: <trusted domain completion authority>
    attestationRef: <where required>

Hard rule:

    ExecutionAttemptOutcome.status == SUCCEEDED
    !=
    DomainCompletionDecision.verdict == ACCEPT

Likewise, human-assisted execution does not bypass this decision boundary.

### 7. DomainPublicationReceipt

A successful domain completion decision still does not prove that candidate outputs were published as authoritative domain products.

For each authoritative publication, the domain write gate emits an immutable receipt:

    kind: DOMAIN_PUBLICATION_RECEIPT
    domain: <exact owning domain>
    producerPrincipalRef: <trusted principal>
    writeAuthorityRef: <exact current writer-authority subject>
    completionDecisionRef: <exact ACCEPT decision>
    publishedArtifactRefs: [{ ref, digest }]
    publishedClaimRefs: [{ ref, digest }]
    acceptedDerivationEdges:
      - outputRef: <published exact output>
        derivedFrom: [<exact authoritative input refs>]
    publicationStoreRevision: <commit/currentness subject>

Publication commit must revalidate the exact current work/lifecycle subject and current domain write-authority head after the completion decision and immediately before canonical publication. If either changed, no authoritative publication receipt may be committed.

The receipt proves the write/publication boundary accepted these exact products under this exact authority. It does not make the artifacts semantically correct by itself; correctness still comes from completion/evidence policy.

Hard separation:

    proposedDerivationEdges from strategy outcome
    !=
    acceptedDerivationEdges published by domain authority

Integration C dependency invalidation may consume only authoritative lineage/claim edges, not raw strategy proposals.

### 8. ExecutionJudgmentBundle

This is a derived orientation/index artifact for fresh review, analogous to the current DECISION_OUTCOME_SUMMARY pattern.

It is not correctness evidence, action authorization, product authority, or acceptance authority.

    kind: EXECUTION_JUDGMENT_BUNDLE
    subject:
      workId: <exact>
      executionAttemptId: <exact>

    pins:
      workContract: { ref, digest }
      claimReleaseReceipt: { ref, digest }
      binding: { ref, digest }
      runtimeAttestations: [{ ref, digest }]
      outcome: { ref, digest }
      completionDecision: { ref, digest }
      publicationReceipt: { ref, digest }
      evidence: [{ ref, digest }]
      transitionHistory: [{ ref, digest }]

    telemetryLinks:
      traceIds: [...]
      spanIds: [...]

    counterevidenceRefs: [...]

When a judgment bundle is consumed, read must:

    read bundle
     -> re-resolve every correctness-relevant pin
     -> verify digests + producer authority
     -> apply each pin's currentness mode (historical-at-execution vs current mutation gate)
     -> re-check cross-artifact identity relations
     -> re-derive correctness-relevant summary fields
     -> reject copied fields that conflict with sources

The bundle may make review cheaper; it may not launder missing or contradictory source evidence.

## Currentness semantics

Historical/acceptance judgment must distinguish **historical validity** from **current authority for a new mutation**.

Three modes are needed:

    EXECUTION_TIME_PIN
      The ref/head had to be current when binding/dispatch was authorized.
      Later head advancement does not invalidate the historical attempt.
      Examples: ClaimReleaseReceipt, observed ExecutionPolicyHead.

    REVIEW_INTEGRITY_PIN
      The immutable historical artifact must still resolve with the same digest/relations.
      It does not need to be the current head.
      Examples: binding, runtime attestations, outcome, transition history.

    MUTATION_CURRENT_GATE
      The authority/lifecycle subject must be current at the moment a new side effect/publication is committed.
      Examples: current domain write authority, exact current work/lifecycle subject for publication.

Therefore:

    old policy P17 after promotion to P18
      != invalid historical attempt

    released claim after work later leaves CLAIMED
      != invalid historical execution evidence

but:

    publish a new authoritative RequirementSet
      -> MUST revalidate current write/lifecycle authority now

ExecutionJudgmentBundle should classify each correctness-relevant pin by its currentness mode or otherwise make the distinction mechanically unambiguous.

Historical reconstruction checks historical execution-time heads against durable transition/history evidence; it must not compare every old head to today's current pointer and reject legitimate history.

## Telemetry is not evidence authority

OpenTelemetry-style traces/spans are valuable for causal reconstruction and Integration I metrics, but:

    Trace != EvidenceArtifact
    Trace != RuntimeExecutionAttestation
    Trace != DomainCompletionDecision

A trace can be linked as observation/counterevidence. If exact runtime identity is required for acceptance, it must come from the trusted runtime attestation boundary or another explicitly trusted verifier.

If telemetry claims deployment A while trusted runtime attestation claims deployment B, the disagreement is preserved as counterevidence and the relevant policy decides whether judgment must block. It is never silently reconciled by preferring whichever source is convenient.

## Persistence and producer authority

Every correctness-relevant artifact above must satisfy the same class of invariants that A.1 review exposed:

1. exact immutable/content-addressed ref;
2. fresh-process resolver can dereference it without caller-supplied raw payload;
3. payload digest is verified on read;
4. producer/publisher authority is verified outside payload self-assertion;
5. write-before-ref publication ordering;
6. current heads/pointers are separate from immutable historical payloads;
7. replay/reconciliation after crash is idempotent;
8. stale/currentness checks happen again at the authority boundary that consumes the artifact.

An object containing issuedBy: root does not prove root authority.

## Reuse before new framework

This contract names semantic artifacts; it does not require one new generic store/registry per name.

Prefer existing proven boundaries:

    EvidenceArtifact / DecisionArtifact / Attestation
      -> reuse for verifier/completion/trust payloads where the semantics fit

    Core effect-operation refs / effect journal
      -> reuse for external-effect truth and reconciliation

    immutable content-addressed application stores
      -> reuse the write-before-ref + exact-read pattern

    DECISION_OUTCOME_SUMMARY pattern
      -> reuse its "derived index, re-resolve sources on fresh read" semantics
         for ExecutionJudgmentBundle

    OpenTelemetry trace/span ids
      -> optional correlation links only

Do not introduce in Integration B:

    universal ArtifactRegistry
    generic ProvenanceGraph engine
    second trust framework
    second effect journal
    organization-wide telemetry-as-authority layer

Generalize storage/schema infrastructure only when multiple concrete artifact kinds prove the same persistence contract.

## Failure attribution

Integration B must capture raw facts now so Integration I/J do not infer history later.

The system does not need a universal failure-classifier in B, but the judgment bundle and completion decision must preserve enough refs to later attribute a finding to one or more layers:

    WORK_SEMANTICS
    AUTHORITY
    CONTEXT
    EXECUTION_POLICY
    EXECUTION_STRATEGY
    RUNTIME
    EXTERNAL_EFFECT
    VERIFICATION
    ARTIFACT_INTEGRITY

Any later ExecutionFinding/self-improvement proposal must reference the exact source artifacts used for attribution. It may not classify from final prose alone.

## Required acceptance tests

In addition to the DOMAIN_EXECUTION_CONTROL tests:

1. a fresh process can resolve the full judgment bundle and all correctness-relevant source refs without chat or caller-supplied raw payloads;
2. changing/removing any pinned correctness artifact fails fresh review closed;
3. strategy self-report of runtime version without trusted RuntimeExecutionAttestation is insufficient;
4. mutable/latest runtime alias cannot satisfy exact runtime identity;
5. policy head change before attempt/binding commit forces re-resolution; policy head change after binding does not rewrite the attempt;
6. crash after runtime dispatch but before local attestation publication recovers/observes the same stable runtime invocation identity rather than redispatching blindly;
7. same semantic attempt may record multiple runtime invocations, but all must resolve under the same immutable ExecutionAttemptBinding;
8. restart/recover of ACTIVE attempt preserves the same binding and transition history;
9. strategy SUCCEEDED cannot self-authorize DomainCompletionDecision ACCEPT;
10. human-assisted strategy passes through the same completion evidence/decision boundary;
11. known counterevidence is preserved in the decision/bundle and cannot be silently dropped;
12. telemetry-only evidence cannot satisfy an acceptance criterion that requires trusted runtime/effect evidence;
13. candidate output/input derivation edges survive fresh reconstruction but are not authoritative until the domain publication gate accepts them;
14. two outputs from one run may declare different input dependencies without the system inventing cross-edges;
15. a cross-domain consumer cannot use raw strategy lineage when DomainPublicationReceipt is missing/stale;
16. policy/strategy promotion after binding changes only new attempts;
17. advancing claim/policy heads after a completed attempt does not invalidate historical review solely because those old heads are no longer current;
18. authoritative publication revalidates current work/lifecycle + write authority after completion decision and fails closed on a revoke/race;
19. new remediation attempt requires an exact transition/decision ref, not process restart;
20. a crash between transition artifact publication and head CAS can be reconciled idempotently without creating duplicate semantic attempts.

## Integration B exit packet

Before Integration B can be judged accepted at its explicit slice gate, one concrete BA workload should expose a complete acceptance packet:

    OrganizationWorkContract
    ClaimReleaseReceipt
    ExecutionPolicyHead + exact ExecutionPolicy
    ExecutionStrategyDescriptor
    ExecutionAttemptBinding
    ExecutionAttemptTransition history
    RuntimeExecutionAttestation(s)
    ExecutionAttemptOutcome
    verification/effect artifacts
    DomainCompletionDecision
    DomainPublicationReceipt
    ExecutionJudgmentBundle

The Integration B acceptance consumer should be able to reconstruct:

    WHAT / WHO / AUTHORITY
            +
    HOW / exact runtime
            +
    WHAT ACTUALLY HAPPENED
            +
    WHY THE DOMAIN ACCEPTED / REJECTED IT

from those refs alone.

That is the judgment-quality exit criterion. Passing execution tests without this reconstructable chain is insufficient for Integration B acceptance.
