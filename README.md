# ExHarness

ExHarness is a reusable long-horizon agent harness kernel that combines two NVIDIA ideas at different layers:

- **AVO** provides the control/search spine: candidate variation, persistent progress, evaluation feedback, committed lineage, and supervision for long-horizon work.
- **NOOA** provides the agent-facing execution substrate: explicit state/context, programmable strategies, model-visible capabilities, typed/validated boundaries, and event-oriented execution.

ExHarness does not contain backend, frontend, QA, Figma, repository, or product semantics. Those belong to consuming harnesses.

## Architecture

```text
Application / domain harness
        |
        | supplies objective, environment, verifiers, capabilities, policies
        v
+-------------------------------+
|          AVO Harness          |
|                               |
| candidate + lineage           |
| persistent engineering state  |
| variation                     |
| verification artifacts        |
| objective feedback            |
| supervision                   |
| promotion invariants          |
+---------------+---------------+
                |
                | runs autonomous variation
                v
+-------------------------------+
|       Agent Runtime           |
|       (NOOA-inspired)         |
|                               |
| strategy                      |
| capabilities                  |
| verification capabilities     |
| input/output validation       |
| scoped context                |
+---------------+---------------+
                |
                v
        model / tools / runtime
```

The layering rule is deliberate:

```text
AVO = what the harness does over time
NOOA = how an agent reasons and acts inside a variation
```

The agent owns local search judgment. The deterministic AVO core owns lifecycle invariants such as candidate identity, verification freshness, evaluation validity, and promotion authority.

## Verification progression

ExHarness treats tests as one possible verifier implementation, not as the verification architecture.

The intended progression is:

```text
manual vigilance
      |
      v
codify a verification artifact
      |
      v
automate the same check as a harness capability
```

A verification artifact is candidate-bound, persisted, and provenance-bearing. It states what was checked and what evidence supports the result.

```js
{
  kind: "VERIFICATION",
  candidate: { id: "candidate", version: "v7" },
  claim: "the candidate satisfies invariant X",
  status: "PASS",
  evidence: [{ kind: "measurement", ref: "artifact-42" }],
  source: {
    kind: "CAPABILITY",
    name: "verify.invariant-x"
  }
}
```

Manual checks can first be externalized through `recordVerification()`. Once a check is codified, consumers can automate it with `defineVerifier()`; ExHarness exposes each verifier to the variation agent as `verify.<name>`.

```js
const invariantVerifier = defineVerifier({
  name: "invariant-x",
  async verify({ candidate }) {
    const result = await checkInvariant(candidate);
    return {
      claim: "the candidate satisfies invariant X",
      status: result.pass ? "PASS" : "FAIL",
      evidence: result.evidence
    };
  }
});
```

The final objective evaluator receives the current candidate's verification artifacts:

```text
verify.* capabilities
        |
        v
VerificationArtifact[]
        |
        v
objective.evaluate(..., verifications)
        |
        v
AVO evaluation / feedback
        |
        v
continue search OR promote
```

Artifacts from older candidates remain historical memory but are not supplied as current verification after a mutation. A verification result that finishes after the candidate has changed is rejected instead of being attached to the new candidate.

## Candidate and lineage semantics

ExHarness keeps two histories separate because they answer different questions.

```text
Working candidate ancestry
v0 -> v1 -> v2
      repair  repair

Committed AVO lineage
P0(v0) --------> P1(v2)
```

Each working candidate records:

- `parent`: the candidate immediately mutated to create it;
- `lineageBase`: the committed lineage head from which that search branch began.

A promoted lineage entry records:

- `parent`: the previous committed candidate (`P_t`);
- `implementationParent`: the immediate working parent used during local repair;
- the evaluation that authorized the commit;
- the verification artifact IDs used by that evaluation;
- `committedAt`.

This lets the kernel distinguish local repair ancestry from the AVO transition `P_t -> P_t+1`. A working candidate cannot be promoted if it was derived from a stale committed lineage head.

## Current public surface

```js
import {
  AVOCapability,
  VerificationStatus,
  createAVOHarness,
  createAgentRuntime,
  defineCapability,
  defineVerifier,
  verificationCapabilityName
} from "exharness";
```

### Agent runtime

A strategy receives visible capabilities and an `invoke` function. The strategy may be a simple deterministic strategy, a model-backed tool loop, or a future CodeAct-style runtime.

```js
const agent = createAgentRuntime({
  capabilities: [
    defineCapability({
      name: "domain.inspect",
      async execute(input) {
        return inspectDomain(input);
      }
    })
  ],
  strategy: {
    async run({ invoke }) {
      return invoke("domain.inspect", { target: "candidate" });
    }
  }
});
```

Capabilities may define `parseInput` and `parseOutput` validators. This keeps contract validation at the runtime boundary without binding ExHarness to a particular schema library.

### AVO harness

`createAVOHarness` composes an agent runtime with the persistent AVO lifecycle.

```js
const harness = createAVOHarness({
  agent,
  objective,
  verifiers: [invariantVerifier],
  environment,
  sessionStore,
  contextProjector,
  supervisor,
  dosagePolicy
});

await harness.start({
  sessionId: "work-1",
  work,
  seedCandidate
});

const variation = await harness.vary("work-1", {
  problem: "improve the current candidate"
});
```

During `vary`, the agent receives session-scoped AVO capabilities:

- `avo.observe`
- `avo.act`
- `avo.evaluate`
- `avo.recordKnowledge`
- `avo.promote`
- `verify.<name>` for every configured verifier

The agent may choose when and how often to run verifiers. `avo.evaluate` receives only verification artifacts bound to the current candidate. Promotion remains deterministic: `avo.promote` fails unless the current candidate has a fresh valid `PASS` evaluation.

A variation also reports its committed-lineage transition:

```js
variation.lineage = {
  before,   // P_t
  after,    // P_t or P_t+1
  advanced  // true only when the variation committed a new lineage head
};
```

The strategy also receives the current committed `lineageHead` and configured verifier capability names in its input so local search can be grounded without exposing mutable core state.

## Design constraints

The kernel should remain domain agnostic. A feature belongs in ExHarness core only when it maps to the AVO control model or the NOOA-style execution substrate.

The kernel should also preserve these boundaries:

- persistent engineering state is not raw conversation history;
- projected context is a selective view of persistent state;
- working candidate ancestry is distinct from committed AVO lineage;
- verification is explicit data, not an implicit assumption that a test suite is the source of truth;
- verification artifacts are candidate-bound and provenance-bearing;
- supervisors may redirect search but cannot mutate candidates or issue correctness verdicts;
- model judgment is flexible, while lifecycle and safety invariants remain deterministic;
- generated-code containment must ultimately be enforced by an external sandbox/runtime boundary, not prompt instructions.

## Development

Requires Node.js 20 or newer.

```bash
npm test
```

Tests guard kernel invariants and compatibility. They are not treated as the harness's verification source of truth; consuming harnesses decide which verification capabilities and evidence are meaningful for their domain.

The repository currently contains one publishable package under `packages/core-harness`. The root workspace remains private so future optional adapters can be added without expanding the public kernel surface prematurely.

## Status

ExHarness is currently an early kernel implementation. The immediate direction is to complete the AVO + NOOA substrate before adding any workload-specific harnesses.
