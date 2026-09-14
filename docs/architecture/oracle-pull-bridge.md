# Oracle pull bridge

## Purpose

Oracle is the infrastructure-facing read bridge around ExHarness. It exists so infrastructure can pull exactly the state projection it needs without forcing the orchestrator, worker or kernel to push serialized context through the execution loop.

Oracle is not an agent and is not correctness authority.

```text
Infrastructure / control plane
        |
        | pull
        v
+-------------------+
|      Oracle       |
| list / read only  |
+---------+---------+
          |
          | public read surface
          v
+-------------------+
|     ExHarness     |
| canonical state   |
+-------------------+
```

## Open-source provenance

### Model Context Protocol

Adopt:

- `resources/list`, resource templates and `resources/read` as the external pull model;
- official TypeScript SDK v2 for MCP transport/protocol implementation;
- URI-addressed resources so consumers request an exact projection instead of receiving a context dump.

Do not reimplement:

- JSON-RPC;
- protocol/version negotiation;
- HTTP/stdio transport;
- MCP request/response codecs.

Oracle v0 registers MCP Resources only. Tools, Prompts, Sampling and Tasks are not part of the Oracle authority boundary.

References:

- https://github.com/modelcontextprotocol/modelcontextprotocol
- https://github.com/modelcontextprotocol/typescript-sdk

### OpenHands

Adopt the system-boundary lesson: runtime behavior stays behind a dedicated server/client boundary, while UI, automation and other infrastructure remain consumers of that boundary.

Do not adopt the OpenHands conversation model or REST endpoint taxonomy; ExHarness already owns its runtime/state semantics.

References:

- https://github.com/OpenHands/OpenHands
- https://github.com/OpenHands/software-agent-sdk

### LangGraph

Adopt the runtime/store access lesson: the consumer that needs state pulls the scoped data at its boundary. Upstream execution code should not carry an ever-growing context payload solely so another component can inspect it later.

Do not adopt graph execution or LangGraph persistence abstractions into ExHarness.

Reference:

- https://github.com/langchain-ai/langgraph

## Package boundary

```text
packages/core-harness
    exharness
    kernel/runtime/control semantics

packages/oracle
    exharness-oracle
    read-only infrastructure bridge
```

`exharness-oracle` depends structurally on the public `createHarness()` read surface. The kernel does not import Oracle, MCP or infrastructure protocols.

## Resource model

Normal consumers should use bounded resources:

```text
exharness://sessions/{sessionId}/summary
exharness://sessions/{sessionId}/trajectory/{limit}
exharness://sessions/{sessionId}/trust
exharness://sessions/{sessionId}/search-health
exharness://sessions/{sessionId}/recovery
```

Complete persistent state is intentionally explicit:

```text
exharness://sessions/{sessionId}/state
```

This keeps the default path token/data efficient while retaining a diagnostic escape hatch.

## Invariants

```text
Oracle != Orchestrator
Oracle != Advisor
Oracle != Worker
Oracle != correctness authority
Oracle != canonical state owner
Oracle read != model call
Oracle read != mutation
```

Additional constraints:

- canonical state remains owned by ExHarness/session persistence;
- Oracle projections are derived reads and must not become a second source of truth;
- returned values are isolated clones;
- trajectory reads are caller-bounded;
- full-state access is explicit rather than the default;
- MCP is an adapter around Oracle, not a dependency of the kernel.

## Deferred deliberately

Resource change subscriptions are not implemented in v0. MCP supports resource update subscriptions, but ExHarness currently accepts event sinks at harness construction rather than exposing an attachable read-side subscription port. Adding subscription semantics should begin with a clean kernel-neutral event/read contract instead of coupling Oracle to internal event history.

Write/control commands are also excluded. If infrastructure later needs mutation, that should be a separate control ingress boundary rather than silently expanding Oracle from a read bridge into an orchestrator.
