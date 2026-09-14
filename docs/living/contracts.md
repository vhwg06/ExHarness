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
6. **Resolved gaps become facts.** When source closes a gap, the Board item becomes `DONE` and living docs are updated to the resulting current state.

## Blackboard invariants

7. Every non-trivial shared open problem must be visible on the Board before another session works on it.
8. Only eligible `READY`/`REOPENED` work may be claimed.
9. `DONE` work is not eligible unless explicit new evidence reopens it.
10. A session writes back status, result/blocker, artifacts/evidence and newly discovered follow-up items.
11. Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct.

## Knowledge invariants

12. Evidence requires provenance.
13. Judgment is derived from evidence and is not raw evidence itself.
14. Audit is challenge, not automatic truth.
15. Accepted/promoted knowledge may be reconciled when executable evidence contradicts it.
