# exharness

Reusable AVO-style long-horizon harness kernel with a NOOA-style programmable agent runtime and first-class trust attestations.

```js
import {
  createHarness,
  createAttestationIssuer,
  defineTrustPolicy,
  evaluateTrustBoundary,
  evaluateAttestationChainTrust
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

Attestations are subject-, policy-, environment- and issuer-bound. `attestCurrentEvaluation()` also refuses to attest stale evaluation inputs and can resolve evidence environment provenance separately for each verification artifact.

Domain workflows and concrete model/tool/sandbox/store/signature/key-management/authority-verification adapters are intentionally injected by consuming projects rather than embedded in the kernel.

See `docs/architecture/kernel-completion.md` and `docs/architecture/trust-pipeline.md` in the repository for the architecture contracts.
