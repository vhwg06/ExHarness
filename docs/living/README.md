# Living knowledge router

This directory defines how ExHarness turns ongoing work into durable knowledge without treating every draft as desired state.

The governing decision is `decisions/D001-living-docs-authority.md`.

## Three planes

```text
BLACKBOARD                     LIVING KNOWLEDGE                 ARTIFACT PLANE
operational work state         durable accepted meaning         what actually exists

work items                     architecture.md                  source code
claims                         pipelines.md                     tests
progress                       contracts.md                     configs
dependencies                   knowledge/state.md              runtime outputs
discoveries                    knowledge/evidence.md           produced artifacts
signals                        knowledge/judgment.md
blockers                       knowledge/audit.md
                               decisions/
```

The planes are linked but do not share one lifecycle.

- Blackboard answers: **what is happening now?**
- Living knowledge answers: **what do we currently know, accept, or require?**
- Artifacts answer: **what actually exists or happened?**

There is no single repository-wide source of truth. Authority is typed by question.

## Read route

Need the accepted system model?

- `architecture.md`

Need accepted lifecycle or delivery semantics?

- `pipelines.md`

Need invariants and mutation/promotion rules?

- `contracts.md`

Need the current durable knowledge snapshot?

- `knowledge/state.md`

Need observations and provenance?

- `knowledge/evidence.md`

Need current conclusions, confidence, alternatives or contradictions?

- `knowledge/judgment.md`

Need independent challenge?

- `knowledge/audit.md`

Need accepted choices and why they were promoted?

- `decisions/`

Need active implementation exploration, candidate designs or unresolved layer work?

- `../worktree/`

Need deeper historical/reference design material?

- `../architecture/`

## Typed authority

```text
Question                              Authority
────────────────────────────────────────────────────────────────────────
What work is active right now?        Blackboard / coordination plane
Who currently owns/claims work?       Blackboard / coordination plane
What is implemented?                  Source/public exports
What behavior actually occurred?      Runtime observation / executable evidence
What observations are durable?        knowledge/evidence.md
What conclusion is currently held?    knowledge/judgment.md
What was independently challenged?    knowledge/audit.md
What choice was accepted?             decisions/
What architecture is accepted now?    architecture.md
What pipeline is accepted now?        pipelines.md
What invariant must be preserved?     contracts.md
What is still being explored?         ../worktree/
```

A path does not grant authority by itself. Status, provenance and promotion do.

## Knowledge lifecycle

A new idea starts as a candidate. It does not become desired state because one session wrote it down.

```text
DRAFT
  -> PROPOSED
  -> SUPPORTED
  -> AUDITED
  -> ACCEPTED
  -> PROMOTED
```

Side exits:

```text
PROPOSED  -> REJECTED
SUPPORTED -> CONTRADICTED
ACCEPTED  -> SUPERSEDED
```

Promotion is evidence-driven, not session-count-driven. One session can be enough when evidence and acceptance are strong; many sessions can still leave a proposal unresolved.

`PROMOTED` means the accepted result has been materialized into the relevant durable authority surface such as `architecture.md`, `pipelines.md` or `contracts.md`.

## Mutation rule

Do not mutate durable authority directly from a new insight.

```text
candidate / discovery
    -> evidence
    -> judgment
    -> audit/challenge when material
    -> accepted decision
    -> promotion
    -> architecture / pipeline / contract
```

Implementation reality can also force reconciliation: when executable evidence contradicts durable docs, record the contradiction and reconcile the promoted view rather than pretending the document is automatically correct.

## Coordination is not Git

High-frequency coordination must not depend on high-frequency commits.

```text
coordination lifecycle != source-control lifecycle
```

The Blackboard is the architectural coordination plane. This documentation decision intentionally does **not** choose its storage engine, lease mechanism, event model, claim schema or runtime implementation yet. Those are candidate components until later work earns them.

`../worktree/` is durable convergence material in Git; it is not the runtime Blackboard.
