# Process Trust and the Agentic TCB

Attestation does not create trust. It makes a trust claim explicit and inspectable.

```text
Verifier V claims:

"Artifact X was checked under policy P
with control inputs C
inside verification domain D
and produced result R."
```

The next question is always:

```text
Why should this boundary trust V,
C, D, P and the runtime below them?
```

There is no absolute-truth endpoint. Trust is continually delegated down a stack such as:

```text
agent
  -> verifier
  -> runner
  -> runtime
  -> OS
  -> hardware
```

An organization chooses the lowest boundary it is prepared to trust and makes that assumption explicit.

## Attestation is not proof

A coding agent that edits implementation, edits tests, executes them, writes `result.json`, and signs its own attestation has not created an independent trust boundary. It has created a structured self-claim.

```text
coding agent
  writes code
  writes tests
  runs tests
  writes report
  signs report
       |
       v
"trust me" in JSON
```

A stronger model separates authority and mutation rights:

```text
Coding Agent
     |
     | immutable subject
     v
Isolated Verifier
     |  trusted test definitions
     |  controlled environment
     |  raw observations
     v
Evidence / Decision
     |
     v
Attestation
     |
     v
Trust Boundary
```

The boundary can independently verify subject digests, policy/config hashes, signatures, authority identities, required claims, completeness and freshness. It still explicitly trusts lower layers such as verifier execution correctness, runtime isolation, OS/kernel behavior and the quality of the verification policy itself.

## Agent instructions are supply-chain inputs

Agentic software production adds a control-plane dependency category that does not have to appear in the shipped binary:

```text
AGENTS.md
CLAUDE.md
reviewer prompts
evaluator prompts
verification-policy.yaml
skills/
workflow definitions
model configuration
test definitions
```

These inputs influence how the implementation and its verification are produced. They therefore belong to the trusted computing base of the harness and should be treated more like build/config inputs than ordinary documentation.

They should be versioned, reviewable, protected, hashed and auditable.

ExHarness represents them with `ControlInput` and `ControlInputManifest`.

```text
ControlInputManifest
  agents              sha256:...
  reviewer             sha256:...
  verification-policy  sha256:...
  skills               sha256:...
  workflow             sha256:...
```

A process attestation binds the exact manifest digest used to produce the trust claim. If a reviewer prompt, skill bundle or workflow changes, the current manifest changes and the previous process attestation becomes stale.

## Common-mode failure

Multiple agents are not automatically independent verification.

```text
poisoned AGENTS.md
        |
   +----+----+
   |    |    |
 coder review QA
   |    |    |
   +----+----+
        |
     all agree
```

This can be one corrupted premise executed three times.

ExHarness models a `VerificationDomain` with explicit fault-domain dimensions:

```text
model
contextDigest
instructionManifestDigest
evidenceSource
environmentDigest
runtimeDigest
```

An independence policy chooses which dimensions matter for the current threat model.

For example:

```text
minimum domains: 2
required distinct values:
  instructionManifestDigest: 2
  evidenceSource: 2
  environmentDigest: 2
```

Three different agent identities sharing one instruction manifest therefore still have instruction-domain diversity of one.

The kernel does not claim that every dimension must differ. Different models, contexts, instructions, evidence sources, environments or runtimes are required only when the consuming threat model says that dimension must be independent.

## Process attestation

The existing verification attestation answers what was claimed about a subject. A `PROCESS_ATTESTATION` answers what trusted process inputs and verification fault domains produced that claim.

```text
Verification Attestation
        |
        | exact id + digest
        v
Process Attestation
  baseAttestation
  controlInputManifest
  verificationDomainManifest
  explicit assumptions
  process issuer
  process environment
  signature
```

This layering prevents a process attestation from laundering a bad verification attestation: process trust requires an independently trusted result for the exact referenced base attestation.

## Explicit assumptions

Structured evidence cannot remove all trust. `PROCESS_ATTESTATION` therefore carries explicit assumptions rather than hiding them behind a green status.

Typical assumptions include:

```text
verifier runtime executes requested commands correctly
sandbox is not compromised
policy represents intended behavior
control-input authority is trustworthy
OS / kernel / hardware operate within accepted threat model
```

The goal is not to make these assumptions magically true. The goal is to make the trust graph inspectable enough that a boundary can decide whether those assumptions are acceptable.

## Control-input authority

A field such as:

```text
authority: security-team
```

is not proof that the security team actually authored or approved an instruction.

When a process trust policy constrains accepted control-input authorities, `evaluateProcessAttestationTrust()` fails closed unless an independent `verifyControlInputAuthority()` callback authenticates the authority claim.

This mirrors evidence/evaluator authority verification in the base trust pipeline.

## Security architecture

The complete mental model is therefore:

```text
TRUSTED CONTROL INPUTS
  policy / instructions / rubrics / skills / workflow
                     |
                     v
              Implementation
                     |
                     v
           isolated verification
                     |
              observations
                     |
                 evidence
                     |
                 decision
                     |
              attestation
                     |
          process attestation
                     |
                     v
               TRUST BOUNDARY
              independently checks
                subject hashes
                control-input hashes
                signatures
                authority proofs
                completeness
                freshness
                independence policy
                upstream trust
```

The question changes from:

```text
Is this code trustworthy?
```

to:

```text
Can this boundary trust the process
that produced the claim
that this code is trustworthy?
```

That is where agentic harness design becomes software supply-chain security.
