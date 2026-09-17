# Blackboard phase archive — 2026-09-17

Status: **CLOSED PHASE SNAPSHOT**

Source Board revision: `634133ce19624523c0409e6921f594c36dc940fc`.

This artifact closes the repository-development Blackboard phase that produced the current Agentic Application/Core/Oracle baseline. It exists so `docs/living/blackboard.md` can return to an empty operational surface before the Oracle-detail phase without deleting history or laundering unresolved work into `DONE`.

The phase transition is user-directed: previous Board work is no longer the active project scope. Historical delivery evidence remains authoritative only for the exact source/review subjects that were accepted. Unmerged or evidence-blocked work is recorded below as deferred/superseded, not delivered.

## Delivered body of work

All items already recorded as `DONE` on the source Board remain historical delivered/accepted work with their original artifact, review and evidence refs. This includes the delivered Backend -> QA lifecycle, Core effect/recovery boundaries, session handoff/project identity, project acceptance, PM/SA coordination, evaluation protocol, Blackboard correctness fixes, accepted architecture research, decision/outcome research, bounded work-selection research, composition work, self-upgrade research and accepted research addons.

The phase-close audit also reconciles three source-delivered items whose Markdown Board status had not yet caught up with merged implementation evidence:

| Item | Phase-close disposition | Evidence |
| --- | --- | --- |
| BB-029 | **DELIVERED** | PR #115 merged at `a387dc32296d7a1e5e3229637402e99b7454b9f0`; exact implementation head `da2ac964f323c9b16d7b14bb42d4fbd018a90257`; Actions #1923 green; application/code and independent outcome/authority reviews passed. Exact relation identity now includes normalized revision; the durability claim is limited to the evidence actually exercised. |
| BB-031 | **DELIVERED** | PR #111 delivered the bounded work-selection pilot; PR #117 closed the freshness-subject finding and merged at `9c644eeea3713bf8083dd24301968b16face88e3`; exact remediation head `5f425379f1604db2756afe5aca975c2b5931073c`; Actions #1877 and both required reviews passed. |
| BB-041 | **DELIVERED** | PR #120 merged at `e8b31315f2ba6945a7d44d440e16a5698ce8c4e9`; persisted-value validation was hardened for own-property descriptors/accessors and current worktree contracts were synchronized. |

BB-026's earlier post-merge proof defect was also repaired before phase close: PR #124 removed the process-local artifact-index dependency, measured actual resume/skip dispatch, bound the checked probe into repository verification and merged at `634133ce19624523c0409e6921f594c36dc940fc`.

## Phase-close disposition of non-delivered items

These items are intentionally **not** rewritten as delivered. They leave the operational Board because the user changed the active phase, their prerequisite evidence is unavailable, or the old task framing is being replaced by the Oracle-detail phase.

| Item | Final phase disposition | Durable rationale |
| --- | --- | --- |
| BB-005 | **DEFERRED — NOT CURRENT PRESSURE** | Production Backend -> QA effectiveness still requires a versioned representative real-repository/provider corpus. Deterministic fixtures remain `productionEvidence=false`. Re-admit only in a future production-evaluation phase with real workload evidence. |
| BB-009 | **CARRIED AS ORACLE INPUT; OLD TASK SUPERSEDED** | Two concrete source classes still have different lifecycle/provenance semantics; no third real source currently proves a common resolver abstraction. The constraint is carried into `oracle-detail-phase-input-2026-09-17.md`; the generic old question is not an active task. |
| BB-010 | **CARRIED AS ORACLE INPUT; OLD TASK SUPERSEDED** | Existing callers have not demonstrated a machine-readable diagnostic contract. The evidence gate is carried into the Oracle-detail phase rather than preserving the old task. |
| BB-027 | **SUPERSEDED BY PHASE TRANSITION** | PR #114 remains an unmerged draft. BB-026 dependency proof was repaired, and a partial application-level atomic required-review primitive exists on the branch, but the research-continuation implementation never passed its final exact-head CI/reviews/merge gates. No BB-027 runtime behavior is claimed on `main`. |
| BB-035 | **DEFERRED / SUPERSEDED** | The self-upgrade delivery pilot depended on BB-027 and was never implemented. D016 remains an accepted bounded proposal boundary, not runtime adoption. Re-admit only if self-upgrade becomes an explicit future objective. |
| BB-040 | **DEFERRED — EVIDENCE PREREQUISITE ABSENT** | No concrete provider configuration, representative task set or measured fixed-route baseline exists. Fixture-only routing cannot establish the stated quality/cost value. |
| BB-042 | **DEFERRED KNOWN LIMITATION** | The historical branch `fix/bb042-advisor-continuation` is unmerged and diverged from phase-close `main` (`ahead_by=5`, `behind_by=150` at audit). REQUEST_CONTEXT/ESCALATE durable-continuation pressure remains useful evidence, but no current-source delivery/acceptance is claimed. Re-admit only under a later Agentic Application workflow phase. |

## Rejected interpretation

Phase close does **not** mean:

```text
blocked/deferred -> DONE
unmerged branch -> current behavior
fixture evidence -> production effectiveness
accepted research boundary -> runtime adoption
archived limitation -> silently fixed
```

The archive is a historical/evidence surface, not a second operational backlog. A deferred/superseded item becomes actionable again only through an explicit future phase admission based on the then-current source and objective.

## Oracle-detail handoff

The next phase starts from current source-backed Oracle behavior plus the accepted D006 boundary, not by reopening the old Board verbatim.

Durable input:

- `docs/living/knowledge/oracle-detail-phase-input-2026-09-17.md`
- `docs/worktree/oracle/state.md`
- `docs/worktree/oracle/architecture.md`
- `docs/worktree/oracle/workflow.md`
- `docs/worktree/oracle/decisions.md`
- `docs/living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md`

`docs/living/blackboard.md` is intentionally empty after this archive. The Oracle-detail phase must create fresh work IDs from its own desired scope; historical `BB-*` identifiers in this archive are not claimable work.