# Agentic Application Persistence

Status: current implementation projection for BB-023 branch.

## Blackboard store

The public `createJsonBlackboardStore(...)` persists Blackboard state as an immutable single-successor revision chain rather than using lock timeout as correctness authority.

A transaction resolves the current committed revision, runs its mutator against that exact snapshot, then atomically publishes one successor for that base revision with a hard link. If another transaction already published a successor for the same base revision, the later publication fails explicitly with a transaction conflict.

Commit records carry opaque revision tokens plus the digest of the exact base snapshot. Revision identity is intentionally distinct from snapshot value identity so the same logical snapshot value may appear again later in history without reconnecting to an earlier successor.

Legacy `.lock` files are neither trusted nor deleted by the public store. `lockStaleMs` remains accepted for call compatibility, but elapsed time does not authorize mutation takeover.

This persistence boundary is local-filesystem only. It requires same-filesystem hard-link support and does not claim distributed storage semantics or automatic history compaction.
