# Integration E/F — deployment identity + AcceptanceSnapshot readiness

Status: **PROMOTED RESEARCH INPUT — NOT IMPLEMENTATION AUTHORITY**

This artifact is the canonical Researcher + SA architecture input for the trust boundary between DevOps deployment and Product QA.

It does not authorize Integration E/F source implementation.

## 1. Bottleneck

After Integration D proves FE/BE can execute independently, Integration E can build/deploy their outputs.

The next high-impact correctness question is:

> When Product QA says "accepted", what exact deployed software did QA actually test?

These identities are not equivalent:

    source commit
    build artifact
    image tag
    image digest
    deployment manifest
    runtime instance actually serving traffic

A green QA result against the wrong runtime revision is not product acceptance.

Integration E/F therefore needs an immutable chain from accepted domain outputs to observed runtime identity.

## 2. Research findings

### 2.1 Build provenance should identify exact subjects and resolved dependencies

SLSA provenance treats build outputs as exact subjects and records resolved dependencies needed to understand how those outputs were produced.

Implication:

    FE source revision
      != FE deployable artifact identity

    BE source revision
      != BE deployable artifact identity

Deployment should consume immutable deployable artifact refs/digests, not mutable branch/tag names alone.

Reference:
- https://slsa.dev/spec/v1.2/provenance

### 2.2 OCI digest is the right content identity for container artifacts

OCI descriptors use a digest as the content identifier. Consumers can verify retrieved content against that digest.

Implication:

    image: app:latest
      is not an acceptable exact deployment subject

    image: app@sha256:...
      is an acceptable immutable content identity

Reference:
- https://github.com/opencontainers/image-spec/blob/main/descriptor.md

### 2.3 Kubernetes tags and observed runtime identity are distinct

Kubernetes documents that image tags can move while digests identify an immutable image version. Pod/container status exposes runtime image identity through image/imageID fields, and runtime resolution can differ from the PodSpec reference.

Implication:

QA must not prove deployment identity only from the desired Deployment spec.

It needs observed runtime evidence from the environment being tested.

References:
- https://kubernetes.io/docs/concepts/containers/images/
- https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/

### 2.4 Supply-chain verification separates planned products from observed verified chain

in-toto separates authorized steps, materials/products and verification of the completed chain.

Implication for ExHarness:

    DevOps says "deployed FE-r8/BE-r5"
      != independent proof that QA traffic reached FE-r8/BE-r5

Deployment publication and QA runtime verification must remain separate authorities.

Reference:
- https://in-toto.io/docs/getting-started/

## 3. SA decision

Introduce two distinct immutable subjects:

    DeploymentRelease
      = DevOps claim about what exact artifacts/config were deployed

    AcceptanceSnapshot
      = exact immutable QA target derived from accepted requirements + one exact DeploymentRelease + expected runtime identities

Then require independent runtime observation:

    AcceptanceSnapshot
      + RuntimeObservationEvidence
      -> Product QA verification
      -> QualityAcceptance

Hard rule:

    DeploymentRelease != RuntimeObservation
    RuntimeObservation != QualityAcceptance

## 4. Deployable artifact identity

Integration E should consume exact deployable outputs from FE/BE publication.

Minimal normalized identity:

    DeployableArtifactRef {
      component
      artifactKind
      ref
      digest
      sourceDeliveryRef
      buildProvenanceRef
    }

Examples:

    component = FRONTEND
    artifactKind = OCI_IMAGE
    digest = sha256:...

    component = BACKEND
    artifactKind = OCI_IMAGE
    digest = sha256:...

For non-container outputs, the exact immutable ref/digest contract still applies.

A source commit may be carried as provenance, but it does not replace the deployable artifact digest.

## 5. DeploymentRelease

DevOps execution publishes one immutable release artifact only after deployment evidence is available.

Candidate shape:

    DEPLOYMENT_RELEASE {
      releaseId
      environmentRef

      deployedArtifacts[] {
        component
        artifactRef
        digest
        buildProvenanceRef
      }

      deploymentSpecRef
      deploymentSpecDigest

      runtimeConfigurationRefs[]
      secret/config refs or digests where policy permits

      rolloutEvidenceRefs[]
      healthEvidenceRefs[]

      expectedRuntimeIdentities[] {
        component
        artifactDigest
        runtimeLocator
      }

      devopsExecutionAttemptRef
      devopsCompletionDecisionRef
      publicationReceiptRef
    }

A human-readable version/tag may exist for UX, but correctness uses immutable refs/digests.

## 6. Runtime configuration identity

Code digest alone may not fully define behavior.

Therefore DeploymentRelease must explicitly bind the runtime configuration that is correctness-relevant:

    deployment spec
    feature/config revision
    environment identity
    routing target / service revision where applicable

Do not force secret values into artifacts.

Use policy-approved immutable refs/digests for sensitive configuration provenance.

The exact bounded set can stay deployment-adapter specific; the architecture only requires that correctness-relevant mutable configuration cannot remain an untracked "latest".

## 7. AcceptanceSnapshot

QA must not assemble arbitrary FE/BE/deployment refs itself.

The snapshot builder derives the bounded target from one exact current DeploymentRelease plus current accepted requirement/acceptance subjects.

Candidate:

    ACCEPTANCE_SNAPSHOT {
      snapshotId

      productObjectiveRef
      requirementSetRef
      acceptanceCriterionRefs[]

      deploymentReleaseRef

      expectedDeployables[] {
        component
        artifactRef
        digest
      }

      expectedRuntimeIdentities[] {
        component
        artifactDigest
        runtimeLocator
      }

      environmentRef
      acceptancePolicyRef
      verifierProfileRef

      currentnessPins[] {
        subjectKey
        expectedHeadGeneration
        expectedAssertionRef
      }
    }

The snapshot is immutable.

It freezes **what QA is supposed to test**, not the whole product forever.

## 8. Snapshot derivation authority

AcceptanceSnapshot must be produced by a deterministic application boundary from canonical refs.

Caller may choose the QA target release id, but cannot silently omit a required component that the release/acceptance policy requires.

For the initial website vertical:

    DeploymentRelease
      must contain exact FRONTEND + BACKEND deployables

    AcceptanceSnapshot builder
      derives both

Caller cannot submit:

    only FRONTEND
    only BACKEND
    a different deployment release per component

unless the explicit acceptance policy allows that shape.

This is a bounded precursor to Integration G product-history completeness; it does not attempt to solve global ProductStateProjection yet.

## 9. RuntimeObservationEvidence

QA verifier must observe the tested runtime independently of DevOps self-report.

Candidate evidence:

    RUNTIME_OBSERVATION {
      snapshotRef
      environmentRef
      observedAt

      components[] {
        component
        runtimeLocator

        expectedArtifactDigest
        observedRuntimeIdentity

        evidenceKind
        evidenceRefs[]
        match: true | false | unknown
      }
    }

For Kubernetes/container deployment, possible evidence includes:

    Pod/container imageID
    immutable image digest
    ReplicaSet/Deployment revision evidence
    service routing target
    version/health metadata where trusted by policy

No single mechanism is universal; the verifier profile defines which observations are authoritative for the target runtime.

A workload/application self-report such as:

    GET /version -> "be-r5"

may be supporting evidence, but it is not automatically trusted merely because the application returned it.

## 10. Mixed rollout handling

QA must not silently accept while traffic can hit mixed old/new revisions unless policy explicitly permits a bounded mixed set.

Example:

    FE expected digest F8
    BE expected digest B5

Observed:

    BE replicas = [B4, B5]

Default result:

    runtime identity NOT CONVERGED
      -> QA BLOCKED / INCONCLUSIVE
      -> no current QualityAcceptance

The deployment verifier decides convergence from exact rollout/runtime evidence.

"Deployment Ready" alone is not sufficient if exact revision identity is still ambiguous for acceptance.

## 11. QA execution subject

Product QA WorkContract/ExecutionAttemptBinding should pin the exact AcceptanceSnapshot ref.

    QA WorkContract
      -> acceptanceSnapshotRef

    QA ExecutionAttemptBinding
      -> exact snapshot
      -> exact verifier profile
      -> exact QA strategy/runtime

QA strategy may execute:

    browser E2E
    API verification
    smoke
    regression

but it cannot rewrite the snapshot.

## 12. QA currentness handshake

Race:

    T1 snapshot pins deploy-r3
    T2 QA starts
    T3 DevOps deploys r4
    T4 QA finishes tests against a shifting environment
    T5 QA ACCEPT

That is invalid for current product acceptance.

Required handshake:

Before QA effects:

    resolve snapshot
    revalidate current DeploymentRelease/currentness pins
    independently observe initial runtime identity

Before QualityAcceptance publication:

    re-observe / confirm runtime identity
    revalidate current DeploymentRelease/currentness pins

If deployment changed across the verification window:

    QA result may remain historical evidence
    but no current QualityAcceptance for the newer release

The system does not rewrite the old snapshot.

## 13. QualityAcceptance

QualityAcceptance is an immutable domain claim over one exact AcceptanceSnapshot.

Candidate:

    QUALITY_ACCEPTANCE {
      snapshotRef
      qaExecutionAttemptRef

      runtimeObservationRefs[]
      verificationEvidenceRefs[]
      criterionDecisionRefs[]

      verdict:
        ACCEPT
        REJECT
        INCONCLUSIVE

      qaCompletionDecisionRef
      publicationReceiptRef
    }

Hard rule:

    QA strategy status SUCCEEDED
      != QualityAcceptance ACCEPT

and:

    DeploymentRelease changed after snapshot
      -> old QualityAcceptance may remain historical
      -> it is not current for the new release

## 14. Build -> deploy -> runtime -> QA provenance chain

The minimum explainable chain should be:

    FE/BE source delivery
      ↓
    BuildProvenance
      ↓
    exact deployable digest
      ↓
    DeploymentRelease
      ↓
    AcceptanceSnapshot
      ↓
    RuntimeObservationEvidence
      ↓
    QA verification evidence
      ↓
    QualityAcceptance

At any point, a fresh bounded consumer should be able to answer:

    which source produced this deployable?
    which digest was deployed?
    which release was targeted?
    what runtime identity was observed?
    what exact acceptance criteria were tested?
    did currentness change during verification?

## 15. DevOps / QA authority split

DevOps owns:

    build/package/deploy execution
    deployment evidence
    DeploymentRelease publication

DevOps does not own:

    Product QA verdict

QA owns:

    runtime observation under acceptance policy
    verification evidence
    QualityAcceptance

QA does not own:

    DeploymentRelease mutation
    artifact build provenance
    RootIntent / product scope

This prevents one domain from both declaring and verifying the same runtime truth.

## 16. Invalidation

Upstream changes propagate through Integration C lineage/currentness.

Examples:

    new BackendDelivery
      -> old DeploymentRelease becomes non-current if it depended on old BE artifact
      -> old AcceptanceSnapshot non-current
      -> old QualityAcceptance non-current for current product readiness

    acceptance criterion revision changes
      -> snapshot bound to old criterion revision remains historical
      -> new current QA requires a new snapshot

ExecutionStrategy promotion alone does not invalidate an accepted deployment/product claim unless product/deployable lineage changes.

## 17. Crash/race requirements

Before E/F acceptance:

1. mutable image tag alone cannot satisfy exact deployable identity;
2. build provenance/ref digest mismatch fails closed;
3. DeploymentRelease cannot publish component digest not backed by accepted FE/BE publication/build provenance;
4. snapshot builder cannot omit a mandatory component required by acceptance policy;
5. QA cannot construct a custom snapshot that swaps one component from another release;
6. runtime observation mismatch blocks/rejects acceptance;
7. mixed rollout old/new identity blocks by default;
8. deployment change after snapshot but before QA start prevents start/current acceptance;
9. deployment change during QA prevents current QualityAcceptance publication;
10. old snapshot/acceptance remains reconstructable historical evidence after new release;
11. restart of QA resolves exact snapshot/runtime evidence without previous conversation;
12. DevOps self-report alone cannot satisfy runtime observation requirement;
13. runtime observation evidence cannot mutate DeploymentRelease;
14. source commit sameness does not override deployable digest mismatch;
15. configuration/current environment drift required by policy invalidates snapshot/current acceptance.

## 18. First concrete slice

For the website vertical:

    FrontendDelivery F8
      -> FE image digest sha256:F8

    BackendDelivery B5
      -> BE image digest sha256:B5

    DevOps
      -> deploy exact F8+B5
      -> DeploymentRelease deploy-r3

    AcceptanceSnapshot
      -> RequirementSet req-r4
      -> criteria ac-set-r6
      -> FE sha256:F8
      -> BE sha256:B5
      -> deploy-r3
      -> test environment UAT-1

    QA
      -> observe runtime FE digest F8
      -> observe runtime BE digest B5
      -> browser/API/smoke tests
      -> QualityAcceptance qa-r7

Counterexample:

    backend rollout still has B4+B5
      -> snapshot expects B5
      -> runtime observation mismatch/mixed
      -> no ACCEPT

## 19. Non-goals

Do not add here:

- universal supply-chain framework;
- Sigstore/in-toto runtime dependency solely for this feature;
- generic artifact registry;
- global ProductStateProjection;
- product closure semantics;
- automatic remediation policy;
- environment inventory platform;
- QA as deployment controller.

Use existing ExHarness immutable/trust/evidence primitives where possible.

## 20. Implementation-ready boundary

The E/F trust boundary is implementation-ready when exact seams can be named for:

    DeployableArtifactRef
    BuildProvenance resolver
    DeploymentRelease
    deployment publication/currentness head
    AcceptanceSnapshot builder
    RuntimeObservation verifier/adapters
    QA WorkContract binding to snapshot
    QualityAcceptance
    pre/post QA deployment-currentness handshake
    mixed-rollout counterexample
    deployment-changes-during-QA counterexample

Desired invariant:

    exact accepted source outputs
      -> exact build artifacts
      -> exact deployed release
      -> exact immutable QA snapshot
      -> independently observed runtime identity
      -> evidence-bound QualityAcceptance

No component may substitute mutable/latest identity for an exact correctness subject.

This artifact is canonical architecture input for future Integration E/F implementation, not a standing review requirement.

## Outer-Blackboard implementation lifecycle

Promotion to `main` does not allocate Integration E/F work and does not authorize implementation.

When predecessor slices are accepted/current and a grounded entry trigger exists:

```text
promoted deployment/AcceptanceSnapshot research
  -> allocate bounded Blackboard item
  -> exact read-only REVIEW generation
  -> accepted decision bound to exact context/candidate
  -> child IMPLEMENT generation using then-current sourceBaseline
  -> READY -> worker
```

Researcher/SA do not review each deployment or QA PR. They reopen only if implementation/runtime evidence contradicts the promoted architecture or exposes a new unresolved architecture obligation.
