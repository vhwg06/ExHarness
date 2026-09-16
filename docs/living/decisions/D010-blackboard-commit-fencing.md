# D010 — Blackboard persistence uses immutable successor commit fencing

Status: **PROPOSED — BB-023 implementation under review**

## Context

The previous local JSON Blackboard store serialized mutations with a `.lock` file and allowed takeover when lock age exceeded `lockStaleMs`.

R1 in `docs/living/knowledge/project-review-2026-09-16.md` reproduced a lost update: a paused but still-live transaction A could have its lock treated as stale, transaction B could commit newer state, and A could later resume and overwrite B. Atomic temp-file rename did not fence the old transaction. The same design also allowed a stale owner to unlink a replacement owner's lock.

Elapsed time therefore does not establish that the previous writer is dead, and lock-file ownership cannot be safely recovered with the current filesystem primitives without a compare-and-swap boundary.

## Decision

The public `createJsonBlackboardStore(...)` no longer uses timeout-based lock takeover as correctness authority.

Persistence is an append-only, single-successor revision chain:

```text
root snapshot
  -> commit(root) -> revision r1
  -> commit(r1)   -> revision r2
  -> commit(r2)   -> revision r3
```

Each transaction:

1. resolves the current committed revision by following immutable successor records;
2. executes its mutator against that exact snapshot;
3. writes a complete candidate commit record to a unique temporary file;
4. publishes the successor with an atomic hard link to the deterministic path for the base revision;
5. fails explicitly if that base revision already has a successor.

The successor record contains:

- opaque `baseToken` revision identity;
- digest of the exact base snapshot for corruption/mismatch detection;
- fresh opaque `nextToken` revision identity;
- the complete validated next Blackboard snapshot.

Snapshot digests validate state but are not revision identity. This permits legitimate value repetition such as A -> B -> A without reconnecting to old history.

## Consequences

- a paused old writer cannot publish after another writer commits from the same base; its atomic successor publication fails with a transaction conflict;
- concurrent recovery attempts from the same base have exactly one commit winner;
- an abandoned legacy `.lock` file is not treated as authority and is not deleted by the new store;
- a stale writer cannot delete a replacement lock because the new public store does not mutate lock files;
- a process crash after successor publication but before returning does not lose the commit because the successor record itself is authoritative;
- commit records are retained as fencing/history state; compaction is deliberately not introduced in BB-023;
- the store requires same-filesystem hard-link support for atomic no-overwrite publication;
- `lockStaleMs` remains accepted for call compatibility but no longer grants takeover authority.

## Non-goals

BB-023 does not:

- change Blackboard work-item claim/review generation semantics;
- implement distributed/multi-host storage;
- generalize a storage-provider abstraction;
- compact historical successor records;
- use elapsed time as proof that another transaction stopped.

## Acceptance evidence required before promotion

- paused writer versus newer commit reproducer cannot lose the newer state;
- competing writers from one base produce one winner and one explicit conflict;
- legacy abandoned/replacement lock file remains untouched;
- failed commit publication removes temporary state and does not change the committed head;
- revision identity remains correct when snapshot values repeat;
- existing Agentic Application persistence/restart tests remain green.
