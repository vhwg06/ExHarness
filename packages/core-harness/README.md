# exharness

Reusable AVO-style long-horizon harness kernel with NOOA-style programmable agent runtime primitives.

```js
import { createHarness } from "exharness";
```

The package supplies candidate/lineage lifecycle, autonomous variation, objective verification, grounded feedback, persistent knowledge, supervision, recovery, capability/runtime contracts, execution boundaries, observability, and adapter testing utilities.

Domain workflows and concrete model/tool/sandbox/store adapters are intentionally injected by consuming projects rather than embedded in the kernel.

See the repository README and `docs/architecture/kernel-completion.md` for the architecture and completion contract.
