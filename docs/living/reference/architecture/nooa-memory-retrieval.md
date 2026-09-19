# NOOA memory retrieval fidelity

ExHarness adopts NOOA's memory-retrieval semantics rather than defining a competing ranking model.

The retrieval pipeline is: hybrid dense and sparse candidate generation; encoding-specific relevance from embedding similarity plus cue overlap; ACT-R-style base-level recency/frequency; importance; min-max normalization; weighted base activation; and bounded associative graph spreading for recall. Search remains lexical/term-oriented and disables graph hops.

ExHarness keeps only its authority boundaries around that algorithm: archived memory is filtered by the semantic-memory port, context projection remains bounded, and retrieval ranking is never correctness or evaluation authority.

The NOOA-fidelity engine is an adapter behind the existing semantic-memory retrieval port. Storage and embedding implementations remain injected concerns. Access logging records successful recall/search selections so later ACT-R activation can use actual retrieval history; injected context does not self-reinforce.

This module should track upstream NOOA behavior before accepting ExHarness-specific retrieval heuristics. Any intentional divergence must be documented and benchmarked separately.