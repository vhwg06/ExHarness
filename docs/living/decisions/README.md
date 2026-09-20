# Living decision policy

This directory is reserved for a **current material decision that still has semantic value not already expressed by the current system projection**.

At present there are no separate current decision documents. Delivered constraints are stated directly in `docs/living/system/*`; prior decision/review/repair/acceptance records live in Git history.

Do not use this directory as an ADR archive or delivery transcript.

```text
decision needed to understand current delivery
  -> one canonical semantic decision file

decision promoted into current system semantics
  -> remove the separate decision file

prior revision / review / repair / acceptance history
  -> Git history only
```

A future decision file must contain the current choice, constraint, trade-off and reopen condition only. It must not require a fresh session to reconstruct BB work ids, PR rounds, CI runs or superseded decision chains.

Current-tree invariant: current semantic decisions may exist here only while they add live value beyond `docs/living/system/*`; historical delivery records never do.
