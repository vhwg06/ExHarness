# exharness

Reusable AVO-style long-horizon harness kernel with a NOOA-style programmable agent runtime, first-class trust attestations, and agentic process-trust primitives.

```js
import {
  createHarness,
  createAttestationIssuer,
  createProcessAttestationIssuer,
  controlInputFromValue,
  defineTrustPolicy,
  defineProcessTrustPolicy,
  evaluateTrustBoundary,
  evaluateAttestationChainTrust,
  evaluateProcessAttestationTrust
} from "exharness";
```

The package supplies candidate/lineage lifecycle, autonomous variation, objective verification, grounded feedback, persistent knowledge, supervision, recovery, capability/runtime contracts, execution boundaries, observability, adapter testing utilities, and a trust pipeline:

```text
EvidenceArtifact
  -> DecisionArtifact
  -> Attestation
  -> TrustPolicy
  -> boundary accept/reject
```

`evaluateTrustBoundary()` is the authorization-oriented trust API. It verifies attestation provenance and can require independent authentication of the decision evaluator and evidence producers/environments. Declared identity fields alone are not authority proof.

`evaluateAttestationChainTrust()` additionally requires exact referenced upstream attestations to have trusted boundary results, enabling verification -> coordination -> release-build -> acceptance trust lineage without treating a digest link as proof.

Agent instructions, reviewer/evaluator prompts, verification policies, skill bundles, workflow graphs, model configuration and test definitions can be modeled as `ControlInput` values and hashed into a `ControlInputManifest`. A `PROCESS_ATTESTATION` binds an exact base attestation to those control inputs, explicit assumptions and declared verification fault domains.

`evaluateProcessAttestationTrust()` detects stale control-plane inputs and evaluates common-mode independence across threat-model dimensions such as model, context, instruction manifest, evidence source, execution environment and runtime. Multiple agent identities do not count as independent verification when they share a required fault domain.

Process attestations do not turn assumptions into proof. They expose assumptions such as verifier-runtime correctness, sandbox integrity and policy quality so the consuming boundary can see what remains trusted rather than independently verified.

Attestations are subject-, policy-, environment- and issuer-bound. `attestCurrentEvaluation()` also refuses to attest stale evaluation inputs and can resolve evidence environment provenance separately for each verification artifact.

Domain workflows and concrete model/tool/sandbox/store/signature/key-management/authority-verification adapters are intentionally injected by consuming projects rather than embedded in the kernel.

See `docs/living/reference/architecture/kernel-completion.md`, `docs/living/reference/architecture/trust-pipeline.md`, and `docs/living/reference/architecture/process-trust.md` in the repository for the architecture contracts.
