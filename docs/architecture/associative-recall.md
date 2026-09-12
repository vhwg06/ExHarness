# Associative recall

NOOA-G5 adds bounded associative retrieval over G4 semantic memory without promoting retrieved content into truth, trust authority, or correctness evidence.

## Split authority

```text
Semantic Memory Provider
  owns records/lifecycle storage
            │
            ▼
       memory IDs
            ▲
            │
Retrieval Provider
  owns ranking/index strategy
            │
            ▼
 memoryId + score + reasons
            │
──────── kernel boundary ────────
            │
            ▼
re-read authoritative memory record
            │
filter lifecycle/tags
            │
enforce item + char budgets
            │
            ▼
RecallResult (RELEVANCE_ONLY)
```

The retriever is not allowed to supply memory content. It returns IDs plus relevance metadata only. The kernel re-reads each ID from the G4 lifecycle store before materialization.

This prevents a vector/keyword/index provider from fabricating or silently rewriting memory content.

## Public retrieval contract

A retriever declares:

```text
name
version (optional)
retrieve({
  mode: RECALL | SEARCH,
  query,
  tags,
  limit
}) -> [
  {
    memoryId,
    score?,
    reasons[]
  }
]
```

Provider ordering is the ranking order. Kernel output preserves that provider rank as explicit provenance.

`RECALL` and `SEARCH` share the same contract while keeping mode visible to provider implementations. A semantic/vector backend may treat RECALL differently from lexical SEARCH without changing the kernel API.

## Kernel-owned bounds

```text
maxItems
maxSerializedChars
```

Both are hard ceilings.

The caller may request a smaller item limit, but cannot exceed `maxItems`. The kernel serializes each materialized hit and stops at the first hit that would cross the character budget, preserving ranking-prefix semantics.

## Stale-index handling

Retrieval indexes are derivative state. Therefore:

- archived IDs are dropped even if a stale index still returns them;
- tag mismatches are filtered by authoritative memory metadata;
- unknown IDs fail closed as a retriever contract violation;
- duplicate IDs fail closed rather than manufacturing duplicate relevance evidence.

## Result semantics

Every result contains:

```text
semantics = RELEVANCE_ONLY
mode
query
tags
retriever { name, version }
hits[]
ranking counts
budget accounting
```

A hit contains the authoritative memory record plus:

```text
rank
relevance.score
relevance.reasons
```

`score` and `reasons` explain ranking only. They do not attest that the memory is correct.

## Trust boundary

```text
retrieved memory
!= truth
!= trusted instruction
!= verification evidence
!= evaluation verdict
```

G5 does not inject recalled memory into prompt context. G6 owns spontaneous recall cadence and bounded model-facing projection through the existing context plane.

## G5 invariants

- retrievers rank IDs, not content;
- authoritative record content comes only from the semantic-memory lifecycle provider;
- archived memories never re-enter active recall through stale indexes;
- unknown/duplicate provider IDs fail closed;
- kernel item and serialized-character bounds are authoritative;
- ranking provenance remains explicit;
- result semantics remain `RELEVANCE_ONLY`;
- no prompt injection occurs in G5.
