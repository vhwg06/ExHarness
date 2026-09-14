# Living docs router

`docs/living/` is the shared external state for ExHarness long-horizon work.

It contains both the **active Blackboard** and the **durable knowledge that may eventually be promoted**. Do not treat these as the same lifecycle.

The governing decision is `decisions/D001-living-docs-authority.md`.

## Start every non-trivial session here

1. Read `blackboard.md`.
2. Select only eligible unresolved work.
3. Claim it on the Blackboard before execution.
4. Perform the work.
5. Write the result, artifact/evidence refs, blockers and newly discovered work back to the Blackboard.
6. Promote durable conclusions only through the knowledge lifecycle.

The Blackboard is therefore not a future component. It is the current coordination protocol.

## Surfaces

```text
BLACKBOARD                     LIVING KNOWLEDGE                 ARTIFACT REALITY
active shared work state       durable meaning                  what exists/happened

blackboard.md                  architecture.md                  source code
                               pipelines.md                     tests
work/questions                 contracts.md                     configs
claims                         knowledge/state.md               runtime outputs
progress                       knowledge/evidence.md            produced artifacts
dependencies                   knowledge/judgment.md
discoveries                    knowledge/audit.md
blockers                       decisions/
results / refs
```

- Blackboard answers: **what can/should a worker do next, and what is already taken/resolved?**
- Living knowledge answers: **what do we currently know, conclude, accept or require?**
- Artifacts answer: **what actually exists or happened?**

There is no single repository-wide source of truth. Authority is typed by question.

## Read route

Need to know what work is available now?

- `blackboard.md` — always first for non-trivial work.

Need accepted architecture?

- `architecture.md`

Need accepted lifecycle/delivery semantics?

- `pipelines.md`

Need invariants?

- `contracts.md`

Need durable evidence/judgment/audit?

- `knowledge/`

Need accepted choices?

- `decisions/`

Need candidate design details while executing a board item?

- `../worktree/`

Need deeper historical/reference material?

- `../architecture/`

## Typed authority

```text
Question                              Authority
────────────────────────────────────────────────────────────────────────
What work exists / is eligible now?   blackboard.md
Who owns current work?                blackboard.md
What work is already resolved?        blackboard.md + result/artifact refs
What is implemented?                  Source/public exports
What behavior occurred?               Runtime observation / executable evidence
What observations are durable?        knowledge/evidence.md
What conclusion is currently held?    knowledge/judgment.md
What was independently challenged?    knowledge/audit.md
What choice was accepted?             decisions/
What architecture is accepted now?    architecture.md
What pipeline is accepted now?        pipelines.md
What invariant must be preserved?     contracts.md
What is still being explored?         ../worktree/
```

## Two different lifecycles

### Work lifecycle

```text
READY -> CLAIMED -> DONE
          |   |
          |   +-> BLOCKED
          +------> READY

DONE -> REOPENED only with explicit reopening evidence
```

This lifecycle narrows the next worker's action space.

### Knowledge lifecycle

```text
DRAFT
  -> PROPOSED
  -> SUPPORTED
  -> AUDITED
  -> ACCEPTED
  -> PROMOTED
```

Finishing a work item does not automatically promote the design discovered while doing it.

## Promotion flow

```text
Blackboard result / discovery
    -> evidence
    -> judgment
    -> audit/challenge when material
    -> accepted decision
    -> promotion
    -> architecture / pipeline / contract
```

## Worktree relationship

`../worktree/` is supporting convergence/context material. It is not the active board.

The practical distinction is simple:

```text
blackboard.md says WHAT IS LEFT / WHO IS DOING WHAT / WHAT WAS RESOLVED
worktree/* helps a claimed worker reason about HOW a particular unresolved area currently looks
```

A worker must not skip the Blackboard and independently choose work from the worktree.

## Storage

The canonical Blackboard is currently Git-backed through `docs/living/blackboard.md` because ExHarness needs the coordination semantics now.

If real concurrency later proves this transport insufficient, storage can be replaced without changing the board protocol. Storage is an implementation detail; the Blackboard is not.
