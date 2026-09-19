# D021 — Promote merged integration research into worker implementation artifacts

Status: **ACCEPTED OUTER-PIPELINE DECISION**

Date: 2026-09-19

## Decision

The merged/research-grounded Integration B–F architecture is promoted into immutable worker implementation artifacts for the next bounded outer-Blackboard items.

This decision creates:

- BB-048 — DOMAIN_EXECUTION_CONTROL;
- BB-049 — cross-domain obligation + semantic lineage/invalidation;
- BB-050 — DOMAIN_ACTIVATION + FE/BE parallel autonomy;
- BB-051 — deployment identity + AcceptanceSnapshot + Product QA trust boundary.

Canonical worker artifacts live under:

```text
docs/living/work-artifacts/BB-048/implementation.json
docs/living/work-artifacts/BB-049/implementation.json
docs/living/work-artifacts/BB-050/implementation.json
docs/living/work-artifacts/BB-051/implementation.json
```

## Architecture authority

The implementation artifacts pin the exact research revisions/blob identities they derive from.

The architecture decisions inside those refs are treated as implementation input. Implementation workers are not expected to re-research or redesign those boundaries.

If source delivery exposes a genuine contradiction that cannot be solved within the accepted seams/invariants, the worker must return a grounded blocker and open a bounded architecture/research obligation. It must not silently broaden the architecture.

## Work-context rule

A worker artifact is **not** a WORK_CONTEXT_SPEC and is not claim/implementation authority.

Blocked future work must not receive an accepted implementation context with today's source baseline.

When a predecessor becomes terminal accepted/DONE:

```text
current Board item
  + exact implementation artifact
  + exact architecture refs
  + then-current source head
      ↓
new immutable WORK_CONTEXT_SPEC generation
      ↓
Board item becomes READY/claimable
```

This preserves both:

- immutable architecture intent;
- fresh source-baseline authority at execution time.

No Researcher or SA standing review is required merely because a worker request/PR exists.

## Development dependency chain

```text
BB-047 A.1 claim bridge
  -> BB-048 domain execution control
  -> BB-049 cross-domain obligation/lineage
  -> BB-050 domain activation + FE/BE autonomy
  -> BB-051 deployment identity + Product QA trust
```

This chain is ExHarness development ordering. It is not a runtime organization workflow.

## Non-decision

This decision does not:

- mark BB-047 accepted or DONE;
- make BB-048..051 claimable before their dependencies resolve;
- authorize source changes outside each implementation artifact;
- change runtime organizational architecture;
- introduce a global workflow/scheduler;
- require Researcher/SA review of each implementation PR.
