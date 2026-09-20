# Decisions

This directory contains **current material architecture/governance decisions** that still constrain or explain the system as it exists now.

A decision is not a transcript, review log, repair log, closure record, or revision archive.

```text
current material decision
  -> keep canonical decision file

decision fully promoted into current system semantics
and no longer needed to explain a live constraint
  -> remove from working tree

previous decision/review/repair/closure state
  -> Git history only
```

Do not keep `SUPERSEDED`, historical readiness, rejection, repair-finding, merge-acceptance, or closure files in Living Docs merely for traceability. Git already provides that history.

`docs/living/system/*` is the source-synchronized statement of what is true now. Active work belongs to `docs/blackboard/state.md`; current queued semantic work belongs to canonical Blackboard implementation-input artifacts.

A decision that remains here must still contribute current semantic value: an authority boundary, architecture constraint, accepted trade-off, or explicit non-goal that is not already self-evident from the current system projection.
