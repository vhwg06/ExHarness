# D021 — Pre-stage merged integration research as worker implementation artifacts

Status: **ACCEPTED OUTER-PIPELINE DESIGN INPUT**

Date: 2026-09-19

## Decision

The merged/research-grounded Integration B–F architecture is materialized as immutable worker implementation artifacts for the next bounded outer-Blackboard items:

- BB-048 — DOMAIN_EXECUTION_CONTROL;
- BB-049 — cross-domain obligation + semantic lineage/invalidation;
- BB-050 — DOMAIN_ACTIVATION + FE/BE parallel autonomy;
- BB-051 — deployment identity + AcceptanceSnapshot + Product QA trust boundary.

The artifacts are pre-staged on an immutable Git commit so an active outer review target does not need to carry future implementation payloads in its candidate tree.

## Architecture authority

Each implementation artifact pins the exact research revision/blob identities from which it derives.

Those decisions are implementation input. Workers are expected to deliver source against the bounded artifact, not repeat architecture discovery.

If implementation exposes a genuine contradiction that cannot be solved inside the artifact's declared seams/invariants, the worker returns a grounded blocker and opens one bounded Researcher/SA obligation. It must not silently broaden the architecture.

## Outer-Blackboard binding

The active Blackboard may reference a staged artifact by exact immutable Git subject:

```text
git:<commit-sha>:docs/living/work-artifacts/BB-0xx/implementation.json
```

The artifact ref may be queued while the item is BLOCKED.

The staged artifact itself is not:

- a WORK_CONTEXT_SPEC;
- current Board lifecycle state;
- claim authority;
- source-mutation authority.

## Work-context rule

Do not pre-create accepted implementation contexts for blocked future work because predecessor delivery changes the source baseline.

When a predecessor becomes terminal accepted/DONE:

```text
current Board item
  + exact staged implementation artifact
  + exact architecture refs
  + then-current source head
      ↓
new immutable WORK_CONTEXT_SPEC generation
      ↓
Board item becomes READY/claimable
```

No architecture re-review is required merely because the predecessor completed. A Researcher/SA loop is reopened only when grounded implementation evidence contradicts or falls outside the accepted artifact.

## Development ordering

```text
BB-047 A.1 claim bridge
  -> BB-048 domain execution control
  -> BB-049 cross-domain obligation/lineage
  -> BB-050 domain activation + FE/BE autonomy
  -> BB-051 deployment identity + Product QA trust
```

This is ExHarness development ordering, not a runtime organization workflow.

## Non-decision

This decision does not:

- mark BB-047 accepted or DONE;
- make BB-048..051 claimable before dependencies resolve;
- authorize source changes without a fresh WORK_CONTEXT_SPEC;
- change the accepted runtime architecture;
- introduce a global workflow/scheduler;
- require Researcher/SA review of implementation requests or PRs.
