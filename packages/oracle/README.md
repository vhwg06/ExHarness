# exharness-oracle

`exharness-oracle` is a read-only pull bridge between infrastructure consumers and an ExHarness instance.

It is intentionally outside the `exharness` kernel package. Oracle does not own lifecycle, orchestration, model reasoning or mutation. It exposes bounded, explicit reads over canonical harness state.

## Boundary

```text
infrastructure consumer
        |
        | list / read
        v
      Oracle
        |
        | pull
        v
public ExHarness read surface
        |
        v
canonical session state / trust / recovery projections
```

The default resource surface is:

```text
exharness://sessions/{sessionId}/summary
exharness://sessions/{sessionId}/state
exharness://sessions/{sessionId}/trajectory/{limit}
exharness://sessions/{sessionId}/trust
exharness://sessions/{sessionId}/search-health
exharness://sessions/{sessionId}/recovery
```

`summary` and bounded `trajectory` are the normal paths. `state` is an explicit escape hatch for consumers that genuinely need the complete persistent state.

## JavaScript API

```js
import { createOracle } from "exharness-oracle";

const oracle = createOracle({ harness });

const templates = oracle.listResourceTemplates();
const summary = await oracle.readResource(
  "exharness://sessions/work-1/summary"
);
```

Reads return structured JavaScript values and never invoke a model.

## MCP adapter

The MCP adapter follows the official MCP Resources model: clients discover/read resources, while the official SDK owns JSON-RPC, transport and protocol-version behavior.

Install the optional peers when MCP transport is required:

```bash
npm install @modelcontextprotocol/server@^2 zod@^4
```

Then:

```js
import { createOracleMcpServer } from "exharness-oracle/mcp";

const server = await createOracleMcpServer({ oracle });
```

`createOracleMcpServer()` registers Resources only. Oracle does not register MCP Tools, Prompts, Sampling or Tasks.

For applications that already own an MCP server instance, use `registerOracleMcpResources()` and keep transport/server lifecycle outside Oracle.

## Design provenance

The architecture deliberately reuses established open-source patterns rather than inventing a new wire protocol:

- **Model Context Protocol** — Resources / resource templates as the pull contract; the official TypeScript SDK is the transport implementation.
- **OpenHands** — server/client boundary: runtime behavior stays behind a typed service boundary instead of leaking into UI/automation consumers.
- **LangGraph** — runtime consumers pull scoped state/store data at the consumer boundary instead of upstream code pushing whole context blobs through the execution loop.

See `docs/architecture/oracle-pull-bridge.md` for the adopt/reject mapping.
