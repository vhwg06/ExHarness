# Living-document contracts

Status: **PROMOTED**

## Two operational surfaces

```text
docs/worktree/*
    = source-synchronized living system documentation

docs/living/blackboard.md
    = unresolved gaps / problems / questions / blockers / next work
```

## Living-doc invariants

1. **Current facts only.** Worktree docs describe behavior/architecture/contracts that exist in source now.
2. **Source wins.** Source/public exports and executable tests are implementation authority; living docs are reconciled to them.
3. **No backlog leakage.** `TODO`, `next`, `remaining`, unresolved design questions and future desired APIs do not stay in worktree docs.
4. **No `gaps.md` in worktree.** Every real open gap/problem is represented on the Blackboard.
5. **Deliberate absence is not a gap.** A capability explicitly not required by current pressure is recorded as a non-goal/current absence, not fake work.
6. **Resolved gaps become facts.** Only review/acceptance-grounded resolved Board work may become `DONE`; resulting source state is then reconciled into living docs.

## Blackboard invariants

7. Every non-trivial shared open problem must be visible on the Board before another session works on it.
8. Blackboard is shared operational state, not an actor and not correctness authority.
9. Agentic Application orchestration owns Board lifecycle transitions.
10. Only eligible `READY`/`REOPENED` work may be claimed.
11. A Worker may submit work and request review; it cannot transition its own work directly from `CLAIMED` to `DONE`.
12. Submitted work stays unresolved as `PENDING_REVIEW`/`REVIEWING` until required acceptance obligations are satisfied.
13. Review may be Worker-requested or PM-required; request/require/dispatch/assessment/acceptance remain distinct authorities.
14. PM owns project coordination/timeline/dependency/progress semantics. SA owns architecture semantics only. Neither silently absorbs the other's authority.
15. Specialist execution/review outside PM/SA remains vertical and context-bound; no global Reviewer/Teacher runtime role is implied.
16. A rejected/inconclusive finding that is still part of the current acceptance obligation reopens/narrows the current item rather than creating replacement work.
17. A genuinely independent actionable finding may become a new Board item only with origin/dependency provenance; an already represented finding links existing work; speculative absence is not Board work.
18. `DONE` work is not eligible unless explicit new grounded evidence reopens it.
19. A session/orchestrator write-back preserves status, submission/result refs, artifacts/evidence, review state and newly discovered unresolved findings.
20. Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct.
21. Role-local completion does not automatically mean the enclosing Blackboard problem is complete.

## Knowledge invariants

22. Evidence requires provenance.
23. Judgment is derived from evidence and is not raw evidence itself.
24. Audit is challenge, not automatic truth.
25. Accepted/promoted knowledge may be reconciled when executable evidence contradicts it.
