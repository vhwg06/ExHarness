# Oracle gaps

Only unresolved choices that matter to the first Oracle implementation. Architecture and semantics above are already fixed.

## GENERIC RESOLVER CONTRACT

Current desired shape is function-oriented, but the exact TypeScript contract is not yet fixed.

Need to determine the smallest useful primitives for:

```text
ContextRequirement
Resolver<I, O>
resolution result / diagnostics
context assembly
schema validation
```

Exit condition:

- the generic surface is small enough that a direct file resolver does not need framework boilerplate;
- multiple source resolvers can compose without introducing a runtime/provider lifecycle;
- application schemas remain outside Oracle.

## FIRST VERTICAL SLICE

Exact Backend/Frontend/QA/Design context schemas are intentionally not defined yet.

Need to choose the first real Worker/context contract and implement Oracle only against the concrete sources required by that slice.

Exit condition:

- one Worker-owned context contract exists in the Agentic Application Layer;
- Oracle resolves that contract once using real sources;
- no unused connector/retrieval machinery is introduced.

## RESOLUTION DIAGNOSTICS

Required/optional semantics are application-owned, but the exact Oracle error/diagnostic shape is still open.

Need to define how resolution reports:

- source unavailable;
- authentication/authorization failure;
- requested artifact not found;
- parse/adaptation failure;
- schema validation failure;
- partial optional-source absence.

Exit condition:

- callers can identify which declared requirement failed and at which source/resolver boundary;
- Oracle does not convert missing required context into fabricated defaults.

## SOURCE PROVENANCE

Resolved context is not source authority. The minimum provenance needed for debugging/reproducibility has not yet been fixed.

Need to decide whether each resolved part carries only diagnostics internally or whether application-visible context also needs stable source references.

Do not add a generalized evidence/provenance framework before the first real context contract demonstrates the need.

## FRESHNESS / CACHING

Oracle v0 is resolve-once. Caching and freshness policy are not part of the agreed semantic core.

Need to defer these until a concrete source has meaningful latency/cost/freshness pressure.

Any later cache must remain an infrastructure optimization and must not change application-owned context semantics.

## SPECIALIZED CAPABILITIES

MCP and semantic retrieval are allowed only when justified by a concrete resolver.

Need source-specific evidence before adding either:

- MCP: source already exposes a useful MCP surface and using the official client is simpler than direct integration;
- retrieval/RAG: the resolver must identify an unknown relevant subset from a sufficiently large corpus.

Absence of either capability is not an Oracle gap by itself.
