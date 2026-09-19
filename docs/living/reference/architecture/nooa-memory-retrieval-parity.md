# Retrieval parity target

Reference: NVIDIA NOOA `packages/nooa-memory/src/nooa_memory/retrieval.py`.

Parity target:

- dense KNN union sparse keyword candidates
- embedding similarity plus cue overlap relevance
- ACT-R base-level activation from real access history
- importance signal
- per-candidate min-max normalization before weighted scoring
- bounded multi-hop associative graph spread for `recall`
- no graph hop for `search`
- access logging for selected results
- injected context does not self-reinforce ACT-R activation
- explainable ranking components

ExHarness-specific behavior is limited to the existing semantic-memory authority boundary (active-record re-read, tags, and context budgets). Ranking remains retrieval evidence, never correctness authority.
