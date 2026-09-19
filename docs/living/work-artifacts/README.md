# Outer implementation work artifacts

Status: **WORKER HANDOFF SURFACE**

This directory contains immutable, implementation-ready desired-state artifacts for future outer-Blackboard work.

These artifacts are **not** WORK_CONTEXT_SPEC generations, lifecycle authority, claim authority, or implementation permission by themselves.

They exist so accepted/research-grounded architecture does not have to be re-inferred when a predecessor finishes.

## Activation rule

A worker may implement one of these artifacts only after:

1. its Blackboard dependencies are terminal/accepted;
2. the Board item is made claimable by the canonical outer lifecycle;
3. a new WORK_CONTEXT_SPEC generation is materialized from the **then-current source head**;
4. that context pins this exact implementation artifact and its architecture inputs;
5. the context provides the exact current source baseline and write scope.

Do not pre-create accepted implementation contexts for blocked future work. Source baselines change as predecessor slices land.

## Architecture immutability

Worker responsibility is source delivery against the artifact.

A worker must not reinterpret or broaden accepted architecture to make implementation easier. If implementation exposes a genuine contradiction or missing mechanism that cannot be solved inside the artifact's seams/invariants, return a grounded blocker and create a bounded architecture/research obligation instead of silently changing the contract.

## Artifact chain

```text
BB-047  A.1 organization claim bridge
   ↓
BB-048  DOMAIN_EXECUTION_CONTROL
   ↓
BB-049  cross-domain obligation + semantic lineage/invalidation
   ↓
BB-050  DOMAIN_ACTIVATION + FE/BE parallel autonomy
   ↓
BB-051  deployment identity + AcceptanceSnapshot + Product QA trust
```

The chain is development ordering for ExHarness, not a runtime global workflow.
