# DOMAIN_EXECUTION_CONTROL — judgment artifact contract

Status: **PENDING REVIEW**

Companion to domain-execution-control-implementation-readiness.md.

This artifact does not authorize Integration B implementation. It defines the minimum durable evidence/judgment surface that an Integration B implementation must produce so a fresh reviewer can decide correctness without reconstructing intent from chat, mutable process state, or strategy self-report.

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

A fresh reviewer for one domain execution must be able to answer these from durable refs only:

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
    ExecutionJudgmentBundle                 DERIVED REVIEW INDEX

ExecutionAttemptHead remains a durable current pointer over semantic-attempt lifecycle. Its transitions must reference immutable transition/decision artifacts; the head itself is not the historical audit record.

### 1. ExecutionAttemptBinding

Existing Integration B contract remains authoritative.

Required additions for judgment:

    kind: EXECUTION_ATTEMPT_BINDING
    executionAttemptId: <stable semantic attempt>
    workContractRef: <exact immutable ref>
    claimReleaseReceiptRef: <exact immutable ref>
    executionPolicyRef: <exact immutable ref>
    executionStrategyRef: <exact immutable ref>

    runtimeBinding:
      kind: <application-core-loop | restate | human-assisted | ...>
      adapterRef: <exact adapter/config ref>
      expectedRuntimeCodeRef: <addressable immutable identity>
      bindingMode: <IMMUTABLE_LOCAL | VERSION_ADDRESSABLE | HUMAN_SESSION>

    contextRefs: [...]
    toolsetRef: <exact or null>
    modelProfileRef: <exact or null>
    harnessRef: <exact or null>

The binding is committed before external effects. A mutable service name such as latest is not an acceptable exact runtime binding by itself.

### 2. RuntimeExecutionAttestation

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
    producerAuthorityRef: <trusted adapter/platform authority>
    attestationRef: <signature/trust artifact where required>

Important distinction:

    semantic executionAttemptId
    !=
    runtimeInvocationId

One semantic attempt may involve more than one runtime invocation during retry/recovery while retaining the same immutable binding. Runtime retries do not mint a new semantic attempt.

For Restate, the adapter must record/verify the immutable deployment serving the invocation. Restate's own versioning behavior is useful evidence, but ExHarness still needs the exact runtime identity bound into its evidence chain.

### 3. ExecutionAttemptOutcome

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

    derivationEdges:
      - outputRef: <exact output>
        derivedFrom:
          - <exact input/work/context/artifact ref>

derivationEdges must be as precise as the domain can establish. Do not infer a Cartesian product where every output depends on every input merely because they appeared in one run. This becomes correctness input for selective invalidation in Integration C+.

The strategy may report failure/success mechanics, but a field such as accepted: true has no domain authority.

### 4. ExecutionAttemptTransition

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

### 5. DomainCompletionDecision

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

### 6. ExecutionJudgmentBundle

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
      evidence: [{ ref, digest }]
      transitionHistory: [{ ref, digest }]

    telemetryLinks:
      traceIds: [...]
      spanIds: [...]

    counterevidenceRefs: [...]

Fresh read must:

    read bundle
     -> re-resolve every correctness-relevant pin
     -> verify digest/currentness/authority
     -> re-check cross-artifact identity relations
     -> re-derive correctness-relevant summary fields
     -> reject copied fields that conflict with sources

The bundle may make review cheaper; it may not launder missing or contradictory source evidence.

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
5. same semantic attempt may record multiple runtime invocations, but all must resolve under the same immutable ExecutionAttemptBinding;
6. restart/recover of ACTIVE attempt preserves the same binding and transition history;
7. strategy SUCCEEDED cannot self-authorize DomainCompletionDecision ACCEPT;
8. human-assisted strategy passes through the same completion evidence/decision boundary;
9. known counterevidence is preserved in the decision/bundle and cannot be silently dropped;
10. telemetry-only evidence cannot satisfy an acceptance criterion that requires trusted runtime/effect evidence;
11. exact output-input derivation edges survive fresh reconstruction;
12. two outputs from one run may declare different input dependencies without the system inventing cross-edges;
13. policy/strategy promotion after binding changes only new attempts;
14. new remediation attempt requires an exact transition/decision ref, not process restart;
15. a crash between transition artifact publication and head CAS can be reconciled idempotently without creating duplicate semantic attempts.

## Integration B exit packet

Before Integration B can be judged accepted, one concrete BA workload should expose a complete review packet:

    OrganizationWorkContract
    ClaimReleaseReceipt
    ExecutionPolicy
    ExecutionStrategyDescriptor
    ExecutionAttemptBinding
    ExecutionAttemptTransition history
    RuntimeExecutionAttestation(s)
    ExecutionAttemptOutcome
    verification/effect artifacts
    DomainCompletionDecision
    ExecutionJudgmentBundle

The reviewer should be able to reconstruct:

    WHAT / WHO / AUTHORITY
            +
    HOW / exact runtime
            +
    WHAT ACTUALLY HAPPENED
            +
    WHY THE DOMAIN ACCEPTED / REJECTED IT

from those refs alone.

That is the judgment-quality exit criterion. Passing execution tests without this reconstructable chain is insufficient for Integration B acceptance.
