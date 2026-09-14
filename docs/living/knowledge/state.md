# Current knowledge state

This is a durable knowledge snapshot, not an execution-progress transcript.

## Question

How should ExHarness preserve evolving architecture and project knowledge across sessions without forcing early drafts to masquerade as desired state?

## Requirement

CLEAR

## Accepted

- ExHarness uses a three-plane knowledge model: coordination Blackboard, living knowledge, and actual artifacts.
- Authority is typed; there is no single universal source of truth.
- New components/designs begin as candidates and earn promotion through evidence, judgment, challenge and acceptance.
- Session count does not promote knowledge.
- Git/source-control lifecycle is not the runtime coordination lifecycle.
- `docs/living/` is the promoted durable knowledge authority surface.
- `docs/worktree/` is convergence material and must not claim authority merely by location/name.

## Current repository checkpoint

- Existing Agentic System delivery remains concrete-first.
- Waves A and B are delivered.
- Wave C is the active next delivery wave according to `../../worktree/pipeline.md`.
- Backend completion now uses grounded mutation/typecheck/tests evidence and an acceptance-boundary decision artifact; bounded BackendAdvisor judgment is limited to unresolved semantic gaps after required evidence passes.
- Existing worktree documents are retained for their domain knowledge, but their authority is interpreted through the living-knowledge contracts.

## Active unknowns

The runtime Blackboard implementation remains unresolved, including storage, ownership/claim semantics, leases, staleness, eventing, conflict resolution, retention and persistence boundaries.

Wave C will also provide new evidence about multi-role coordination and cross-work artifact flow. That evidence may influence which Blackboard primitives are actually necessary.

These unknowns must stay candidate until implementation/evidence earns promotion.

## Next evidence needed

Evidence from real multi-session/multi-worker and second-role ExHarness usage should determine which Blackboard primitives are actually necessary before a runtime coordination API is promoted.
