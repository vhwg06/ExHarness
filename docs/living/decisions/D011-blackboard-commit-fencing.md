# D011 — Blackboard local persistence uses immutable successor commit fencing

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-023 persistence/concurrency + application/code review accepted the implementation on PR #84 after the R1 lost-update interleaving, competing-writer, legacy-lock, projection-authority, projection-failure and repeated-state contracts passed. Exact-head CI #1344 passed living-doc-impact and Node 20/22/24 before promotion.

## Question

How should the concrete local JSON Blackboard store prevent a paused but still-live stale transaction from overwriting a newer committed snapshot when elapsed lock age cannot prove that the original writer died?

## Decision

Elapsed time is not mutation authority. The public `createJsonBlackboardStore(...)` commits through an immutable single-successor revision chain.

```text
immutable root snapshot
  -> one successor for root
  -> one successor for revision r1
  -> one successor for revision r2
```

A transaction resolves one exact base revision, mutates that snapshot, writes a complete candidate successor record and atomically publishes the successor with same-filesystem hard-link no-overwrite semantics. If the base revision already has a successor, publication fails explicitly as a transaction conflict.

Each revision has an opaque identity token. Snapshot digests validate the exact base content but are not revision identity, so later state may legitimately repeat an earlier snapshot value without reconnecting to old history.

## Compatibility projection

`<path>.root` plus immutable successor records are persistence authority.

The caller-selected `<path>` JSON file remains a compatibility/inspection projection of the latest committed snapshot because existing application contracts inspect it directly. It is refreshed only after commit publication and is never authoritative once the immutable root exists.

A legacy pre-D011 `<path>` snapshot may initialize a missing immutable root exactly once. After root publication, tampering with, losing or lagging the projection cannot roll back the committed chain.

Projection refresh failure after a successful successor publication does not convert that commit into an unknown outcome. Fresh store reconstruction resolves the immutable chain.

## Lock semantics

Legacy `.lock` files are neither trusted nor deleted by the public store. `lockStaleMs` remains accepted for call compatibility, but lock age does not authorize takeover or retry.

This removes the stale-owner cleanup race from the correctness boundary instead of attempting to prove ownership through an unsafe check-then-unlink sequence.

## Scope

This decision is for the concrete local filesystem Blackboard store only.

It requires same-filesystem hard-link semantics and does not introduce:

- distributed storage or consensus;
- remote lease authority;
- automatic commit-history compaction;
- a generic storage-provider abstraction;
- work-item claim/review generation semantics.

History compaction/performance should be reopened only when retained local history produces concrete pressure; it is not inferred as part of BB-023.
