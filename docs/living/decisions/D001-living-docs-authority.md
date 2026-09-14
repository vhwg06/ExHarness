# D001 — Living docs use typed authority and evidence-driven promotion

Status: **PROMOTED**

Accepted at: 2026-09-14

Acceptance boundary: repository owner explicitly selected this architecture for ExHarness living documentation.

## Context

The previous worktree model treated `docs/worktree/` as active desired-state authority. That made it too easy for a newly drafted component or architecture sketch to become apparent truth simply because a session wrote it into the desired-state tree.

Long-horizon agentic work needs persistent external state, but operational coordination, durable knowledge and actual implementation have different lifecycles and authority semantics.

## Decision

ExHarness documentation uses three distinct planes:

1. **Blackboard / coordination plane** — high-frequency operational work state shared across agents/sessions.
2. **Living knowledge plane** — durable evidence, judgments, audits, decisions and promoted materialized views.
3. **Artifact plane** — source, tests, configs, runtime observations and produced artifacts.

There is no single global source of truth. Authority is typed by the question being answered.

New design does not become desired state when drafted. It progresses through:

```text
DRAFT -> PROPOSED -> SUPPORTED -> AUDITED -> ACCEPTED -> PROMOTED
```

Promotion depends on evidence and an acceptance boundary, not a fixed number of sessions.

`architecture.md`, `pipelines.md` and `contracts.md` are materialized promoted views. Candidate design belongs outside those authority surfaces until promoted.

`docs/worktree/` is retained as durable convergence material, but its location no longer grants desired-state authority.

Coordination lifecycle must remain independent from Git/source-control lifecycle.

## Deliberately not decided

This decision does not select the runtime Blackboard implementation. In particular it does not yet commit to:

- a Claim Manager component;
- lease semantics;
- a WorkItem schema;
- event bus or subscription mechanism;
- database/file/tuple-space storage;
- conflict-resolution rules;
- stale-state thresholds;
- retention/compaction strategy.

Those details require real ExHarness usage and evidence before promotion.

## Consequences

- documentation routing starts from `docs/living/`;
- worktree content must be interpreted as candidate/convergence material unless explicitly linked to a promoted decision;
- existing implemented facts remain grounded by source/public exports;
- existing accepted delivery ordering can remain active without promoting every stage-local design sketch;
- future sessions can accumulate evidence and refine candidates without pretending they are already the final architecture.

## Promotion targets

This decision is materialized in:

- `../architecture.md`
- `../pipelines.md`
- `../contracts.md`
- `../README.md`

## Reopen when

Reopen this decision if real use shows that the separation prevents necessary coordination, creates unmanageable knowledge duplication, or cannot be enforced without making the documentation lifecycle more expensive than the value it provides.
