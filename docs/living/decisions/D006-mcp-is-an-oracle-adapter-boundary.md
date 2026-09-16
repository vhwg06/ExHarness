# D006 — MCP is an Oracle adapter/continuation boundary, not Oracle lifecycle authority

Status: **PROPOSED**

Proposed: 2026-09-16

## Question

Does MCP 2026-07-28 justify changing Oracle into an MCP-first resolver/lifecycle layer, or reopening the generic resolver/diagnostics gaps?

## Evidence

Current Oracle has two concrete source classes:

```text
repositoryReader.readFile(...)
artifactReader.readArtifact(...)
```

Application contracts declare the exact context required; Oracle performs source IO/adaptation and returns a Worker input snapshot with source/provenance refs.

MCP 2026-07-28 changes the protocol boundary materially:

- the core protocol is stateless and removes protocol-level sessions / `Mcp-Session-Id`;
- cross-call state is explicit through server-minted handles passed as ordinary arguments;
- `resources/read` exposes URI-addressed context and is application-driven;
- `resources/read` and `tools/call` may return `resultType: input_required`; the client retries the original operation with a new JSON-RPC request id, `inputResponses`, and optional opaque `requestState`;
- the Tasks extension provides explicit long-running task handles outside the core protocol;
- cacheable list/read results carry `ttlMs` and `cacheScope`;
- a broken Streamable HTTP response loses the in-flight request; clients reissue it as a new request.

Primary evidence:

- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks

## Proposed decision

Treat MCP as a **source/capability adapter boundary** inside Oracle when a concrete source already exposes useful MCP capabilities. Do not make Oracle MCP-first.

```text
Application WorkOrder / context contract
        |
        | declares exact context need
        v
Oracle source-specific resolver
        |
        +--> direct repository reader
        +--> application artifact reader
        +--> concrete MCP-backed adapter  (only when a real source requires it)
                  |
                  +--> resources/read for URI-addressed context
                  +--> tools/call for source-specific computed probes
                  +--> explicit MCP continuation handle / requestState / task handle
        |
        v
resolved context snapshot + source/provenance refs
```

MCP transport/request identity is never Oracle work identity:

```text
WorkOrder id != MCP JSON-RPC request id
Board/session lifecycle != MCP transport lifetime
Oracle resolution attempt != MCP task id
source continuation handle != correctness/completion authority
```

## Continuation semantics

`input_required`, explicit state handles, and task handles are useful source-call continuation mechanisms. They do not make Oracle an orchestrator.

For a concrete MCP-backed resolver:

```text
complete
  -> adapt/validate result
  -> resolved context snapshot

input_required
  -> return/persist a typed source-resolution continuation owned by the enclosing application workflow
  -> later retry the source operation with opaque continuation data

task
  -> retain source task handle as continuation provenance
  -> poll/update/cancel through the concrete adapter when the enclosing application workflow resumes
```

The Blackboard/Orchestrator remains canonical project/work lifecycle authority. MCP continuation state is a referenced source artifact, not a project state machine.

## Provenance and freshness

- a configured MCP source identity/endpoint plus resource URI or concrete operation ref may contribute to `sourceRef` / source provenance;
- self-reported `serverInfo` / server names are descriptive metadata, not stable source identity or authorization/correctness authority;
- `structuredContent` and output schemas help transport validation but do not establish semantic correctness;
- `ttlMs` is a cache/freshness hint, not proof that content is true or current enough for an application acceptance boundary;
- authorization and server/tool metadata do not become correctness authority.

## Effect ambiguity

A new MCP request id after transport failure says nothing about whether an external mutation happened.

Oracle should remain read-oriented by default. If a future Oracle adapter invokes a mutating MCP tool, it must compose with explicit effect identity/reconciliation semantics rather than inferring success/failure from MCP retry or task state alone.

## Abstraction assessment

MCP itself does **not** count as a third Oracle source class. A concrete MCP-backed server/adapter becomes a third source only when its source identity, provenance, continuation or adaptation semantics materially differ from the existing repository/artifact readers.

Therefore this evaluation does not by itself justify:

- a generic `Resolver<I,O>` / provider registry;
- an MCP-first Oracle layer;
- reopening BB-009;
- reopening BB-010.

BB-009/BB-010 may reopen only after a concrete MCP-backed source demonstrates repeated resolver shape or machine-readable diagnostic/continuation pressure in source/tests.

## Consequences if accepted

- no runtime code is added solely to support MCP uniformity;
- existing direct readers remain the simplest default;
- a future MCP integration starts as one concrete source-specific adapter;
- WorkOrder/Board identity stays independent from MCP request/task/handle identity;
- source continuation remains explicit and handoff-safe without becoming completion authority.
