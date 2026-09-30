# Oracle progressive resolution

Source-synchronized projection of `packages/oracle/src/context-resolution.js`. Open Oracle questions live only in `../docs/blackboard/state.md`.

## Delivered explicit next step

`createOracleContextResolver` exposes `resolveNext(rawRequirement, previousResult)` alongside `resolve()`. Progression is always explicit application code: there is no automatic loop inside Oracle or Core, and Core still resolves each selected block once per agent call.

```text
packages/oracle/src/context-resolution.js
  -> resolver.resolveNext(rawRequirement, previousResult)   next chained step
  -> createPinnedResolver(facadeResult)                     hand one step to Core
  -> ProgressionRefused                                     refusal error
  -> PROGRESSION_RETRIABLE_REASONS                          retriable reason set
```

Import path: consumers import `createPinnedResolver`, `ProgressionRefused` and `PROGRESSION_RETRIABLE_REASONS` from `packages/oracle/src/context-resolution.js` directly. They are deliberately not re-exported from `packages/oracle/src/index.js`, whose export list is pinned by the architecture boundary (same precedent as the planning strategies).

`previousResult` is the exact prior facade result (`{ resolution, preObservations, ... }`). The next resolution is chained by index (`previous.step.index + 1`) and `previousResolutionId` through the delivered contract check, bound to the same `requirementId`; a previous result for a different requirement is rejected. Requirement identity never changes: planning runs against an operational sub-requirement, while the new resolution is built on the original requirement.

## What is re-attempted

Only evidence whose previous unresolved reason is retriable is re-planned:

- retriable: `BUDGET_EXHAUSTED`, `SOURCE_FAILURE`, `DEFERRED`;
- terminal: `STALE`, `AMBIGUOUS`, `UNSUPPORTED`, `CURRENTNESS_UNVERIFIABLE`, `MISSING`.

The operational sub-requirement contains only retriable evidence with the remaining cumulative budget (`requirement.budget` minus previous `consumed` per counter) and is passed to `retrievalPlanner.execute()` with catalog validation. Prior items are copied verbatim (same order and content) followed by new items only for re-attempted evidence; cumulative consumption is previous counters plus this step's deltas with exact contract-computed materialization bytes, so it never decreases and never exceeds the requirement budget. Budget overflow fails closed instead of growing context: a step that would exceed the budget is rejected rather than constructed.

## Refusals and currentness

`resolveNext` throws `ProgressionRefused` (with `reason`) when there is nothing to do:

- `ALREADY_COMPLETE` when the previous resolution is `COMPLETE`;
- `STEPS_EXHAUSTED` when no `maxResolutionSteps` remain;
- `NOTHING_RETRIABLE` when no unresolved evidence carries a retriable reason.

Currentness is fenced twice. Before planning, all evidence is pre-observed and any previously resolved evidence whose observation digest differs from the previous `preObservations` throws `DurabilityFailure` `STALE_DURING_RESOLUTION`; drift confined to still-unresolved evidence does not block the step. After the step is built, the unchanged pre/post observation fence applies before any consumer receives context.

## Pinned Core consumption

`createPinnedResolver(result)` returns `{ resolve(requirement) }` that returns that exact step's resolution when the `requirementId` matches and throws otherwise. An application resolves step N with the Oracle facade, pins it, and hands the pinned object to `resolveContextRequirementBlocks` as the injected resolver: Core calls `resolve` exactly once per call and projects the pinned step with no Core change.

## Limits

- Steps append prior items first, so a requirement whose retried evidence sorts before already-resolved evidence cannot chain and is rejected by the contract's evidence-order rule.
- `resolve()` behavior, the `ContextResolution` contract, planner, catalog, durability reuse semantics and the Core port are unchanged; only the facade file carries the progression surface.
- Reproduce with `node --test test/oracle-progressive-resolution.test.mjs` and `npm run test:oracle`.
