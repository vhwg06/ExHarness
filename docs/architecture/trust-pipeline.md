# Trust Pipeline

ExHarness distinguishes verification from the artifact that records that verification happened, and distinguishes attestation integrity from the decision to trust that attestation at a boundary.

```text
subject
  |
  v
verification / observation
  |
  v
EvidenceArtifact
  |
  v
DecisionArtifact
  |
  v
Attestation
  |
  v
evaluateTrustBoundary()
  |
  +-- accept
  `-- reject / reverify
```

## Roles

### EvidenceArtifact

Evidence says what was observed, by which producer, in which environment, for which immutable subject. Its body has a content digest and the artifact itself has a digest.

Evidence is not a verdict.

### DecisionArtifact

A decision applies a versioned policy to an explicit evidence manifest and records claims, unresolved items, evaluator identity, boundary and verdict.

A decision is not an attestation.

### Attestation

An attestation is a signed provenance claim that a particular decision exists for a particular subject under a particular policy and environment, backed by a specific evidence manifest.

It contains digest references instead of embedding raw evidence. An attestation can reference upstream attestations, forming a trust lineage across boundaries.

### Envelope verification vs boundary trust

`evaluateAttestationTrust()` is the low-level envelope/provenance checker. It validates the attestation, supplied decision/evidence artifacts, declared identities, freshness, manifests and signature policy.

`evaluateTrustBoundary()` is the authorization-oriented API. When policy constrains evaluator or evidence authorities, it additionally requires independent callbacks that authenticate those authorities. A JSON identity field is never treated as proof by itself.

```text
attestation says evaluator=verification-service
                    |
                    v
        verifyEvaluatorAuthority(...)
                    |
             true / false

artifact says producer=unit-runner
                    |
                    v
         verifyEvidenceAuthority(...)
                    |
             true / false
```

If authority constraints are declared but their verification callbacks are absent or fail, boundary trust fails closed.

## TrustPolicy

A trust policy belongs to the consumer boundary. It decides whether an attestation may be relied on *here*.

It may constrain the complete authority chain:

- exact current subject;
- accepted policy digests;
- accepted attestation environments;
- accepted attestation issuer identities and roles;
- accepted decision evaluator identities and roles;
- accepted evidence producer identities and roles;
- accepted evidence environments;
- required satisfied claims;
- signature validity;
- maximum attestation age;
- evidence-manifest and artifact integrity;
- authority independence between subject producer and attestation issuer;
- authority independence between subject producer and evidence producers.

Boundary trust automatically makes the corresponding proof surfaces mandatory when authority constraints are declared. For example, accepted evidence producers cannot be configured while silently omitting the evidence artifacts that would need to be authenticated.

## Four boundaries

ExHarness names four common trust boundaries without encoding workload-specific checks:

```text
VERIFICATION
  change is technically ready for integration
        |
        v
COORDINATION
  independently verified changes are safe together
        |
        v
RELEASE_BUILD
  immutable release artifact is derived from approved source
        |
        v
ACCEPTANCE
  shipped artifact behaves as intended in the acceptance environment
```

Each stage can issue its own attestation and reference attestations from the previous stage.

This produces a trust graph instead of one giant CI PASS.

## Upstream attestation lineage

An upstream reference is not proof that the upstream claim was trusted.

`evaluateAttestationChainTrust()` evaluates the local boundary with `evaluateTrustBoundary()` and then requires exact referenced upstream attestations to have their own trusted boundary results.

```text
verification attestation V
        |
        | evaluateTrustBoundary(V) = trusted
        v
coordination attestation C references digest(V)
        |
        | evaluateAttestationChainTrust(C)
        |   verifyUpstream(digest(V)) -> trusted result for exact V
        v
coordination boundary may trust chain
```

If a coordination attestation merely contains an upstream digest but no trusted result for that exact id+digest, the chain is rejected. A boundary may also require specific upstream boundary types such as `VERIFICATION`.

## Freshness

Attestations are subject- and policy-bound.

```text
commit abc123 attested
commit becomes def456
=> STALE_SUBJECT

policy digest P17 attested
boundary now accepts only P18
=> STALE_POLICY
```

The bridge from ExHarness evaluation to attestation also enforces evaluation-input freshness. If a new observation or verification artifact appears after the evaluation, `attestCurrentEvaluation()` refuses to package the old decision until the candidate is re-evaluated.

Environment and age constraints may make an attestation unacceptable even if its subject did not change.

## Authority separation

Different source names are not sufficient evidence of independent verification.

The trust model exposes identities, roles, environments and signatures so a boundary can require separation such as:

```text
implementation agent
  may mutate subject

unit / integration / review verifiers
  read subject in separately identified environments
  produce evidence artifacts

policy evaluator
  applies decision policy to evidence manifest
  produces decision artifact

attestation service
  signs the decision provenance envelope

integration boundary
  verifies evidence + decision + attestation provenance
  authenticates evidence/evaluator authority
  applies its own trust policy
  authorizes merge
```

A trusted attestation issuer cannot make an untrusted evaluator or untrusted evidence producer trustworthy merely by signing their output. Trust policy can constrain all three layers independently, and the boundary requires separate authority-verification callbacks when those constraints are present.

`requireIndependentIssuer` fails closed when subject producer authority is unknown or equals the attestation issuer. `requireIndependentEvidenceProducers` likewise fails closed when the subject producer is unknown or an evidence producer is the same authority as the subject producer.

ExHarness can validate declared identities, signatures, roles, environment digests and callback results. It cannot prove that two declared identities are actually isolated processes, credentials or organizations. Real authority separation must be enforced by deployment/runtime infrastructure.

## Per-verifier environment provenance

A set of verification artifacts does not imply that they ran in one environment.

`attestCurrentEvaluation()` therefore accepts either:

- one explicit evidence environment when every current verification genuinely shares it; or
- an `evidenceEnvironment(verification)` resolver that returns the environment reference for each verification artifact.

The facade does not infer environment provenance from verifier names and does not silently assign a common environment to heterogeneous verification runs.

## Provenance integrity

Trust validation must not trust stored digest fields blindly.

A boundary recomputes:

- evidence content digests when content is present;
- evidence artifact digests;
- decision artifact digests;
- attestation payload/envelope digests;
- evidence-manifest membership;
- cryptographic/procedural signature through the injected signature verifier.

It also verifies that the supplied DecisionArtifact is exactly the decision referenced by the attestation and that its subject, policy and evidence manifest match the envelope.

A tampered artifact retaining an old `digest` field is invalid provenance.

## Persistence

Trust artifacts are append-only engineering history in the production harness session:

```text
persistentMemory
  evidenceArtifacts[]
  decisionArtifacts[]
  attestations[]
```

State schema v2 introduces these collections. The built-in v1 -> v2 migration adds them without rewriting older engineering history.

`attestCurrentEvaluation()` bridges the existing verification/evaluation pipeline into the trust pipeline:

```text
VerificationArtifact[]
        |
        v
EvidenceArtifact[]
        |
Evaluation
        v
DecisionArtifact
        |
AttestationIssuer
        v
Attestation
```

The caller must supply truthful evidence-environment provenance, attestation environment and evaluator authority. ExHarness does not invent provenance that the previous verification pipeline did not record.

## Relationship to CI

CI is one possible trust boundary, not the owner of all verification.

A coordination CI can ask:

```text
is subject still exact?
is policy still accepted?
are evidence producers/environments trusted and authenticated?
is evaluator trusted and authenticated?
is issuer trusted?
is signature valid?
are required claims satisfied?
is provenance intact?
are referenced upstream attestations themselves trusted?
```

If yes, it may rely on the attestation rather than reconstructing all upstream verification from scratch. CI may still run coordination-specific checks and produce a new coordination attestation.

## Non-goals

The kernel does not:

- provide a PKI or key-management service;
- decide which authorities an organization should trust;
- prove runtime isolation from declared metadata alone;
- turn an attestation into truth merely because it is signed;
- let an attestor launder weak evidence/evaluator provenance;
- treat an upstream digest reference as proof of upstream trust;
- collapse verification, coordination, release build and acceptance into one verdict;
- automatically resolve contradictory semantic evidence.

Attestation increases trust only when the evidence producer, evidence environment, evaluator, attestation issuer, attestation environment, provenance, upstream trust lineage and policy are independently trustworthy enough for the consuming boundary.
