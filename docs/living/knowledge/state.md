# Current knowledge state

Durable knowledge snapshot; operational open work lives in `../blackboard.md`.

## Accepted documentation model

- source/public exports and executable behavior are implementation authority;
- `docs/worktree/*` is the source-synchronized current-system projection;
- `docs/living/blackboard.md` is the canonical home for all actionable gaps/problems/questions/blockers/next work;
- evidence, judgment, audit and decision remain separate from Board work status;
- session count does not promote knowledge;
- a completed Board item does not automatically promote an architectural conclusion.

## Current repository checkpoint

- Backend is a mutating/promoting role with grounded mutation/typecheck/tests completion evidence.
- QA is a non-mutating role over an accepted Backend revision with grounded behavior/regression evidence.
- Backend -> QA uses a ref-only application-artifact handoff with acceptance-decision provenance.
- `createDurableBackendQaWorkflow(...)` persists validated Backend/QA objectives and stage checkpoints, supports QA remediation and blocked artifact lookup recovery, and submits accepted QA to the Blackboard review path.
- `createApplicationOrchestrator(...)` and `createJsonBlackboardStore(...)` persist claims, checkpoints, submissions, review requirements, trusted assessments and follow-up reconciliation state; `createSessionHandoffSurface(...)` projects that state with the durable user-intent root for a fresh session.
- Core effect journaling, explicit replay/reconciliation policy and the restore -> effect reconciliation -> variation recovery -> evidence restoration -> resume composition are implemented as separate Core mechanisms under BB-006/BB-007.
- Oracle has distinct `repositoryReader` and `artifactReader` source boundaries.
- Backend and QA remain materially different roles, so the narrow shared shapes currently proven are application artifact refs, evidence-integrity/claim-state plumbing and durable Board state; no generic Worker/WorkOrder/Orchestrator is implemented.

## Documentation migration checkpoint

The former worktree gap files have been reconciled:

- resolved Oracle items became current source-backed facts;
- real Agentic/Core/Oracle open seams moved to the Blackboard;
- deliberate non-goals such as cache/MCP/RAG without concrete pressure were not converted into fake work;
- worktree docs no longer own future roadmap/gap state.

For current unresolved work, read `../blackboard.md`.
