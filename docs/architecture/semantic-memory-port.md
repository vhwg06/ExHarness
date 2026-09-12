# Semantic memory port

NOOA-G4 introduces a semantic-memory lifecycle substrate without merging it into AVO knowledge, AgentEvent history, prompt context, or retrieval policy.

## Boundary

```text
AVO Knowledge                 AgentEvent
  grounded engineering K       canonical working journal
          │                           │
          └──────── separate ─────────┘
                      │
              Semantic Memory
                      │
             lifecycle + provenance
                      │
                 provider port
                      │
        persistence / future indexes
```

Semantic memory is associative information intended to be reusable across turns/sessions. It is not correctness evidence, not canonical execution history, and not AVO candidate/lineage knowledge.

G4 does not implement semantic recall, lexical/vector ranking, graph spread, or spontaneous prompt injection. Those remain G5/G6.

## Record contract

A stored semantic-memory record contains:

```text
id
content
tags
importance [0..1]
status ACTIVE | ARCHIVED
revision
createdAt
updatedAt
provenance[]
```

Every lifecycle mutation appends provenance rather than replacing origin metadata. Provenance records the mutation kind, revision, timestamp, source and optional source/call/turn identity.

```text
CREATED
  ↓
UPDATED ...
  ↓
ARCHIVED
```

Archive is a lifecycle state change, not silent physical deletion.

## Provider contract

A provider implements only physical record persistence for G4:

```text
create(record)
read(id)
replace(record, { expectedRevision })
list()
```

The kernel owns normalization, lifecycle transitions, provenance and optimistic revision checks. Provider implementations may later maintain embeddings, ANN indexes, lexical indexes or graph metadata, but G4 does not expose those mechanisms to the memory consumer.

The reference in-memory provider uses clone boundaries so a caller cannot mutate persisted memory through returned object identity.

## Conflict semantics

Updates and archive transitions are compare-and-swap operations.

```text
read revision N
      ↓
construct revision N+1
      ↓
replace(expectedRevision=N)
```

A stale writer fails with `SEMANTIC_MEMORY_CONFLICT`; it cannot overwrite a newer record.

## Public lifecycle port

```text
remember()
get()
list()
update()
archive()
```

`list()` is deterministic metadata enumeration/filtering. It is intentionally not called `recall()` or `search()` and does not score relevance. Associative retrieval belongs to G5.

## Trust boundary

Memory provenance describes where a memory came from; it does not make its content true or trusted instruction.

Later recall results must therefore remain model-facing data under existing context bounds/trust rules rather than being promoted into system authority.

## G4 invariants

- semantic memory remains separate from AVO `persistentMemory.knowledge`;
- semantic memory remains separate from canonical AgentEvent history;
- every write has explicit provenance;
- provenance history is append-only across normal lifecycle operations;
- archived records are hidden by default but remain inspectable explicitly;
- stale revision writes fail closed;
- provider return values cannot expose mutable persistence identity;
- G4 exposes no associative ranking or spontaneous recall surface.
