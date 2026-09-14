# Living-doc contracts

Status: **PROMOTED**

Decision: `decisions/D001-living-docs-authority.md`

These invariants govern Blackboard coordination, documentation authority and promotion.

## Blackboard coordination

1. **Board first.** Every non-trivial shared work session reads `blackboard.md` before choosing work.
2. **Shared work is recorded.** Work that changes shared project state must exist on the Blackboard.
3. **Claim before execution.** A worker claims eligible work before doing it.
4. **One resolved item reduces the next action space.** `DONE` work is not eligible by default for later workers.
5. **Respect dependencies.** A work item is eligible only when its required dependencies are resolved.
6. **Write back before leaving.** A worker records result/blocker, artifact/evidence refs and newly discovered work.
7. **No silent duplicate work.** Repeating `DONE` work requires an explicit `REOPENED` transition grounded by new evidence or a deliberate re-verification item.
8. **Board is operational, not a diary.** Keep only state needed for coordination and handoff.

## Authority

9. **No global source of truth.** Authority is typed by question and artifact kind.
10. **Path is not authority.** A file being named `architecture`, `state` or `decision` does not promote its contents automatically.
11. **Implementation authority stays executable.** Source/public exports establish what is implemented; docs do not override observable facts.
12. **Runtime claims require evidence.** Prose does not establish that behavior occurred.

## Candidate discipline

13. **New design starts non-authoritative.** Drafted components, schemas, services and boundaries are candidates until promoted.
14. **No promotion by session count.** Time/turn count is not evidence.
15. **Unknowns stay explicit.** A proposal must not silently convert unresolved choices into accepted architecture.
16. **Examples are not commitments.** Claim Manager, lease, event bus or workflow-engine ideas remain candidates unless evidence promotes them.

## Evidence and judgment

17. **Evidence requires provenance.** Material observations record where they came from.
18. **Judgment is not evidence.** Conclusions reference evidence rather than recursively treating conclusions as raw observation.
19. **Audit is challenge, not automatic truth.** Audit findings can create contradictions or new evidence needs.
20. **Contradiction reopens knowledge.** Promoted knowledge must be reconcilable when executable evidence disagrees.

## Promotion

21. **Work completion != knowledge promotion.** A `DONE` board item can produce only candidate design conclusions.
22. **Durable authority changes through explicit promotion or reconciliation.** New insights do not directly mutate accepted architecture/pipeline/contracts.
23. **Accepted and promoted are distinct.** Acceptance authorizes a choice; promotion materializes it into an authority view.
24. **Supersession is explicit.** Replaced decisions/views are marked superseded rather than silently rewritten.

## Storage and mechanism

25. **The Blackboard exists now.** Its canonical current representation is `docs/living/blackboard.md`.
26. **Storage is replaceable.** Git-backed persistence may later be replaced if real concurrency/write pressure requires it, while preserving board semantics.
27. **Do not pre-generalize coordination machinery.** No lease service, event bus, queue, database or generic Claim Manager without concrete pressure/evidence.
28. **Worktree is not the board.** `docs/worktree/` supports reasoning for already claimed work; it does not decide what work a session may pick up.

## Context loading

29. **Route from the board.** After claiming, load the smallest relevant authority/candidate surfaces required for that item.
30. **Candidate context stays labeled.** Worktree material cannot silently override promoted living knowledge or executable artifacts.
