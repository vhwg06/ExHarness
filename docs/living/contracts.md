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
2. **Continuous projection.** `docs/worktree/*` is maintained as the closest source-backed projection of the currently implemented system at every durable/reviewable implementation checkpoint, not only at Board `DONE` or phase completion.
3. **Durable checkpoint boundary.** A commit/handoff/cross-session checkpoint/review submission/merge candidate is not documentation-safe while materially changed current-system semantics are absent from the affected worktree docs. Temporary local edit order inside one uninterrupted implementation step is not itself a documentation lifecycle boundary.
4. **Same-change synchronization.** If a change alters current behavior, architecture, contracts, authority boundaries, public surface or executable workflow, the affected worktree docs are reconciled in the same change before handoff/review/acceptance/merge.
5. **Partial state is still current state.** An unresolved work item may have partially implemented behavior; once that behavior exists materially in a durable checkpoint, the living docs describe that partial current state while the Blackboard continues to track what remains unresolved.
6. **Staleness is a defect.** If source/runtime/tests and worktree docs disagree, source wins and the affected worktree projection is stale; the relevant checkpoint is not handoff/review-complete until it is reconciled.
7. **No Blackboard excuse for stale docs.** Blackboard tracks unresolved work; it never permits `docs/worktree/*` to lag behind behavior that already exists in a durable current-system checkpoint.
8. **No backlog leakage.** `TODO`, `next`, `remaining`, unresolved design questions and future desired APIs do not stay in worktree docs.
9. **No `gaps.md` in worktree.** Every real open gap/problem is represented on the Blackboard.
10. **Deliberate absence is not a gap.** A capability explicitly not required by current pressure is recorded as a non-goal/current absence, not fake work.
11. **Resolved gaps become facts.** Review/acceptance-grounded resolved Board work may become `DONE`, but living-doc synchronization happens as implementation state changes rather than waiting for `DONE`.
12. **Living-doc impact is review input.** Every material change classifies whether current-system semantics changed. `CURRENT_SYSTEM_CHANGED` requires affected worktree updates in the same change; `CURRENT_SYSTEM_NOT_CHANGED` requires an explicit documentation-neutral assessment.
13. **Automation is not semantic authority.** CI may verify the impact declaration and require a worktree diff for `CURRENT_SYSTEM_CHANGED`; review still verifies that the classification is truthful and the projection is semantically accurate.

## Blackboard invariants

14. Every non-trivial shared open problem must be visible on the Board before another session works on it.
15. Blackboard is shared operational state, not an actor and not correctness authority.
16. Agentic Application orchestration owns Board lifecycle transitions.
17. Only eligible `READY`/`REOPENED` work may be claimed.
18. A Worker may submit work and request review; it cannot transition its own work directly from `CLAIMED` to `DONE`.
19. Submitted work stays unresolved as `PENDING_REVIEW`/`REVIEWING` until required acceptance obligations are satisfied.
20. Review may be Worker-requested or PM-required; request/require/dispatch/assessment/acceptance remain distinct authorities.
21. PM owns project coordination/timeline/dependency/progress semantics. SA owns architecture semantics only. Neither silently absorbs the other's authority.
22. Specialist execution/review outside PM/SA remains vertical and context-bound; no global Reviewer/Teacher runtime role is implied.
23. A rejected/inconclusive finding that is still part of the current acceptance obligation reopens/narrows the current item rather than creating replacement work.
24. A genuinely independent actionable finding may become a new Board item only with origin/dependency provenance; an already represented finding links existing work; speculative absence is not Board work.
25. `DONE` work is not eligible unless explicit new grounded evidence reopens it.
26. A session/orchestrator write-back preserves status, submission/result refs, artifacts/evidence, review state and newly discovered unresolved findings.
27. Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct.
28. Role-local completion does not automatically mean the enclosing Blackboard problem is complete.
29. **Session is not project lifecycle.** Project-critical continuation state may not exist only in prior conversation/model context.
30. A handoff-safe project must carry one durable user-defined intent root: objective plus explicit bullets/constraints supplied by the user.
31. Every handoff-safe work item must trace directly or transitively to that durable user intent or to grounded follow-up provenance from such work.
32. Blackboard remains the work tracker; durable work products remain external artifacts and the Board carries their refs.
33. A fresh session must be able to recover current lifecycle state and artifact/evidence refs from `Blackboard + referenced artifacts` without previous-session context.
34. A legacy Board without a durable user-intent root must fail closed as not session-handoff safe rather than guessing project intent from task descriptions.

## Knowledge invariants

35. Evidence requires provenance.
36. Judgment is derived from evidence and is not raw evidence itself.
37. Audit is challenge, not automatic truth.
38. Accepted/promoted knowledge may be reconciled when executable evidence contradicts it.
