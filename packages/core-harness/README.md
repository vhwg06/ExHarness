# exharness

Reusable AVO-style long-horizon harness kernel with a NOOA-style programmable agent runtime and first-class trust attestations.

```js
import {
  createHarness,
  createAttestationIssuer,
  defineTrustPolicy,
  evaluateAttestationTrust
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

Attestations are subject-, policy-, environment- and issuer-bound. They may reference upstream attestations to form verification -> coordination -> release-build -> acceptance trust lineage.

Domain workflows and concrete model/tool/sandbox/store/signature/key-management adapters are intentionally injected by consuming projects rather than embedded in the kernel.

See `docs/architecture/kernel-completion.md` and `docs/architecture/trust-pipeline.md` in the repository for the architecture contracts.
