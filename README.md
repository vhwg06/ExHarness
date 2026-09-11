# ExHarness

ExHarness is a reusable long-horizon agent harness kernel that combines two NVIDIA ideas at different layers:

- **AVO** provides the control/search spine: candidate variation, persistent progress, evaluation feedback, committed lineage, and supervision for long-horizon work.
- **NOOA** provides the agent-facing execution substrate: explicit state/context, programmable strategies, model-visible capabilities, typed/validated boundaries, and event-oriented execution.

ExHarness does not contain backend, frontend, QA, Figma, repository, or product semantics. Those belong to consuming harnesses.

## Architecture

```text
Application / domain harness
        |
        | supplies objective, environment, capabilities, policies
        v
+-------------------------------+
|          AVO Harness          |
|                               |
| candidate + lineage           |
| persistent engineering state  |
| variation                     |
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

The agent owns local search judgment. The deterministic AVO core owns lifecycle invariants such as candidate identity, evaluation validity, and promotion authority.

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
- `committedAt`.

This lets the kernel distinguish local repair ancestry from the AVO transition `P_t -> P_t+1`. A working candidate cannot be promoted if it was derived from a stale committed lineage head.

## Current public surface

```js
import {
  AVOCapability,
  createAVOHarness,
  createAgentRuntime,
  defineCapability
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

`createAVOHarness` composes an agent runtime with the existing persistent AVO lifecycle.

```js
const harness = createAVOHarness({
  agent,
  objective,
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

The agent may choose when and how often to use them. Promotion still remains deterministic: `avo.promote` fails unless the current candidate has a fresh valid `PASS` evaluation.

A variation also reports its committed-lineage transition:

```js
variation.lineage = {
  before,   // P_t
  after,    // P_t or P_t+1
  advanced  // true only when the variation committed a new lineage head
};
```

The strategy also receives the current committed `lineageHead` in its input so local search can be grounded in the current AVO base without exposing mutable core state.

## Design constraints

The kernel should remain domain agnostic. A feature belongs in ExHarness core only when it maps to the AVO control model or the NOOA-style execution substrate.

The kernel should also preserve these boundaries:

- persistent engineering state is not raw conversation history;
- projected context is a selective view of persistent state;
- working candidate ancestry is distinct from committed AVO lineage;
- supervisors may redirect search but cannot mutate candidates or issue correctness verdicts;
- model judgment is flexible, while lifecycle and safety invariants remain deterministic;
- generated-code containment must ultimately be enforced by an external sandbox/runtime boundary, not prompt instructions.

## Development

Requires Node.js 20 or newer.

```bash
npm test
```

The repository currently contains one publishable package under `packages/core-harness`. The root workspace remains private so future optional adapters can be added without expanding the public kernel surface prematurely.

## Status

ExHarness is currently an early kernel implementation. The immediate direction is to complete the AVO + NOOA substrate before adding any workload-specific harnesses.
