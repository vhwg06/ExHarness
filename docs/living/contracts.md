# Living-knowledge contracts

Status: **PROMOTED**

Decision: `decisions/D001-living-docs-authority.md`

These invariants govern documentation authority and promotion.

## Authority

1. **No global source of truth.** Authority is typed by question and artifact kind.
2. **Path is not authority.** A file being named `architecture`, `state` or `decision` does not promote its contents automatically.
3. **Implementation authority stays executable.** Source/public exports establish what is implemented; durable docs must not override observable implementation facts.
4. **Runtime claims require evidence.** A prose statement does not establish that behavior occurred.

## Candidate discipline

5. **New design starts non-authoritative.** Drafted components, schemas, services and boundaries are candidates until promoted.
6. **No promotion by session count.** Time/turn count is not evidence.
7. **Unknowns stay explicit.** A proposal must not silently convert unresolved choices into accepted architecture.
8. **Examples are not commitments.** Illustrative names such as Claim Manager, lease, event bus or WorkItem schema remain examples unless a decision promotes them.

## Evidence and judgment

9. **Evidence requires provenance.** Material observations record where they came from.
10. **Judgment is not evidence.** Conclusions reference evidence rather than recursively treating conclusions as raw observation.
11. **Audit is challenge, not automatic truth.** Audit findings can create contradictions or new evidence needs.
12. **Contradiction reopens knowledge.** Promoted knowledge must be reconcilable when executable evidence disagrees.

## Promotion

13. **Durable authority changes through explicit promotion or reconciliation.** New insights do not directly mutate accepted architecture/pipeline/contracts.
14. **Accepted and promoted are distinct.** Acceptance authorizes a choice; promotion materializes it into an authority view.
15. **Supersession is explicit.** Replaced decisions and views are marked superseded rather than silently rewritten as if history never existed.

## Coordination boundary

16. **Coordination lifecycle is independent from Git lifecycle.** High-frequency progress/claim events must not require high-frequency commits.
17. **Worktree is not Blackboard.** `docs/worktree/` is durable convergence material, not the runtime coordination channel.
18. **Blackboard implementation is not yet selected.** Storage, claim, lease, event and stale-state mechanics require their own evidence and promotion.

## Context loading

19. **Route before loading.** Agents load the smallest relevant authority surface rather than the entire documentation tree.
20. **Candidate context is labeled as candidate.** Worktree material cannot silently override promoted living knowledge or executable artifacts.
