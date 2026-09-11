# Trust Pipeline

ExHarness distinguishes verification from the artifact that records that verification happened.

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
TrustPolicy at a boundary
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

It contains digest references instead of embedding the raw evidence. An attestation can reference upstream attestations, forming a trust lineage across boundaries.

### TrustPolicy

A trust policy belongs to the consumer boundary. It decides whether an attestation may be relied on *here*.

It may constrain:

- exact current subject;
- accepted policy digests;
- accepted attestation environments;
- accepted issuer identities;
- required issuer roles;
- required satisfied claims;
- signature validity;
- maximum attestation age;
- evidence-manifest integrity;
- authority independence between the subject producer and attestation issuer.

The trust boundary does not rerun the complete upstream evaluation. It validates whether the upstream claim is trustworthy for the current boundary.

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

Environment and age constraints may make an attestation unacceptable even if its subject did not change.

## Authority separation

Different source names are not sufficient evidence of independent verification.

The trust model exposes identities, roles and signatures so a boundary can require separation such as:

```text
implementation agent
  may mutate subject
  cannot sign accepted verification attestation

verification service
  reads subject in isolated environment
  produces evidence / decision
  signs attestation

integration boundary
  verifies signature + trust policy
  authorizes merge
```

`requireIndependentIssuer` fails closed when subject producer authority is unknown or equals the attestation issuer.

ExHarness can validate declared identities, signatures and roles. It cannot prove that two declared identities are actually isolated processes, credentials or organizations. That authority separation must be enforced by deployment/runtime infrastructure.

## Provenance integrity

Trust validation must not trust stored digest fields blindly.

A boundary recomputes:

- evidence content digests when content is present;
- evidence artifact digests;
- decision artifact digests when supplied;
- attestation payload/envelope digests;
- evidence-manifest membership;
- cryptographic/procedural signature through the injected signature verifier.

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

The caller must supply evidence and attestation environment references plus evaluator authority. ExHarness does not invent provenance that the previous verification pipeline did not record.

## Relationship to CI

CI is one possible trust boundary, not the owner of all verification.

A coordination CI can ask:

```text
is subject still exact?
is policy still accepted?
is issuer trusted?
is signature valid?
are required claims satisfied?
is provenance intact?
```

If yes, it may rely on the attestation rather than reconstructing all upstream verification from scratch. CI may still run coordination-specific checks and produce a new coordination attestation.

## Non-goals

The kernel does not:

- provide a PKI or key-management service;
- decide which issuer identities an organization should trust;
- prove runtime isolation from declared metadata alone;
- turn an attestation into truth merely because it is signed;
- collapse verification, coordination, release build and acceptance into one verdict;
- automatically resolve contradictory semantic evidence.

Attestation increases trust only when the issuer, environment, provenance and policy are independently trustworthy enough for the consuming boundary.
