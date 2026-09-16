# BB-023 — Blackboard commit-fencing implementation rationale

Status: **IMPLEMENTATION INPUT / NOT A PROMOTED DECISION**

## Grounded defect

R1 in `project-review-2026-09-16.md` reproduced a lost update in the previous local JSON Blackboard store: a paused but still-live transaction A could have its `.lock` treated as stale, transaction B could commit newer state, and A could later resume and overwrite B. Atomic temp-file rename did not fence the old transaction. The same design also allowed a stale owner to unlink a replacement owner's lock.

Elapsed time therefore does not establish that the previous writer is dead, and the old lock protocol has no compare-and-swap boundary that can revoke a live writer safely.

## Implemented candidate boundary

The BB-023 branch removes timeout-based `.lock` takeover from the public store correctness boundary and uses an append-only, single-successor revision chain:

```text
root snapshot
  -> commit(root) -> revision r1
  -> commit(r1)   -> revision r2
  -> commit(r2)   -> revision r3
```

Each transaction resolves the exact current revision, executes its mutator against that snapshot, writes a complete candidate commit record to a unique temp file, and atomically hard-links that record to the deterministic successor path for the base revision. If another writer already published a successor from the same base revision, publication fails explicitly.

A commit record carries an opaque base revision token, digest of the exact base snapshot, a fresh opaque next revision token, and the complete validated next snapshot. Snapshot digests validate content but are not revision identity, so legitimate repeated values such as A -> B -> A do not reconnect to old history.

## Expected consequences under test

- a paused old writer cannot publish after a newer writer commits from the same base;
- concurrent recovery attempts from one base have one commit winner and explicit conflicts for losers;
- legacy `.lock` files are neither trusted nor deleted by the new public store;
- crash after successor publication does not lose the successor because the immutable record is authoritative;
- commit records remain as fencing/history state; BB-023 does not introduce compaction;
- the local store requires same-filesystem hard-link support;
- `lockStaleMs` remains accepted only for call compatibility and does not grant mutation authority.

## Acceptance evidence required before decision promotion

- paused live writer vs newer commit reproducer preserves the newer state;
- competing writers from one base produce one winner and one explicit conflict;
- abandoned/replacement legacy lock remains untouched;
- failed publication cleans temp state and leaves committed state unchanged;
- repeated snapshot values preserve correct revision identity;
- existing Agentic Application restart/persistence contracts remain green.

Only after those gates and independent review should this boundary be promoted into `docs/living/decisions/`.
